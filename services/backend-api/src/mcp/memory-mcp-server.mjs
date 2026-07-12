/**
 * 个人记忆 MCP server（能力开放 E2）—「记忆主权」的实时协议形态：
 * 用户在 Claude Code / Claude Desktop / Cursor 等任意 MCP 客户端里带着自己的
 * Gedo 记忆。GMP 文件导出解决"搬家"，这里解决"随身"。
 *
 * 端点 `POST /mcp`（无状态 Streamable HTTP，JSON 响应），鉴权 = PAT
 * （`Authorization: Bearer gedo_pat_…`，sha256 查库，吊销即断）。
 * Pro 及以上专属（entitlements.memoryMcpAccess，2026-07-07 定案；
 * ENTITLEMENT_MODE=warn 时只记不拦，与全站配额语义一致）。
 *
 * 数据纪律（与工具实现同批落地，不后补）：
 * - 输出 schema 直接采用 GMP v0.1 片段（MCP 是传输层，GMP 是数据层）；
 * - ai_excluded 由 memory-file.service 检索默认过滤，暂停记忆开关在此显式尊重；
 * - PII 脱敏按 PAT 的 redact_pii 开关（默认开）走 persona/redactor.mjs；
 *   命中 BLOCK_PATTERNS（密钥/密码类）的内容无论开关一律整条遮蔽；
 * - 每次工具调用写审计（store.patAudit，设置页可见），并更新 last_used。
 * - 写入（E4）：唯一写工具 memory_capture 不直接落库——候选进 pendingCaptures
 *   确认队列（source='mcp'），与对话捕捉/来源导入共用评审与落库通道
 *   （approveCaptureWithEdits），确认才入库、拒绝无痕；暂停记忆时拒收。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { hashPatToken } from '../lib/crypto.mjs';
import { getEntitlementsForTier } from '../lib/entitlements.mjs';
import { getMemoryStore } from '../memory/store/index.mjs';
import { isMemoryPaused } from '../memory/context-builder.mjs';
import { rankByTSS } from '../memory/tss.mjs';
import { reciprocalRankFusion } from '../memory/retrieval/rrf.mjs';
import { embedText } from '../memory/embedding.mjs';
import { pcpEpisodeToGmpEpisode, pcpProfileToGmpIdentity, pcpProfileToGmpSemantic } from '../gmp/pcp-mapping.mjs';
import { redact } from '../persona/redactor.mjs';

const { getProfile, searchEpisodes, searchEpisodesByVector } = getMemoryStore();

const SERVER_INFO = { name: 'gedo-memory', version: '1.0.0' };

const INSTRUCTIONS =
  'Personal memory server for a GEDO user (the token owner). ' +
  'Use memory_search to recall the user\'s long-term memories before answering personal questions; ' +
  'use profile_get for a structured portrait (values, traits, goals) to calibrate tone and advice; ' +
  'use goals_list / tasks_today for assistant scenarios. ' +
  'memory_capture (if granted) proposes a new memory — it is queued for the owner\'s review and is NOT stored until they approve. ' +
  'Results follow the GMP v0.1 schema (https://gedo.ai/specs/gmp/v0.1) and may be PII-redacted per the owner\'s token settings. ' +
  'All calls are audited and visible to the owner.';

/** 设置页可勾选的 scope 全集（路由层校验用同一份）。 */
export const PAT_SCOPES = ['memory.read', 'profile.read', 'goals.read', 'memory.write'];

const GMP_EPISODE_TYPES = ['important_info', 'personal_trait', 'key_event', 'date_reminder', 'milestone', 'failure_learning', 'decision', 'relationship_event'];
const MAX_CAPTURE_CHARS = 2000;

const MAX_SEARCH_LIMIT = 20;

const TOOLS = [
  {
    name: 'memory_search',
    scope: 'memory.read',
    title: 'Search personal memories',
    description:
      "Hybrid search (keyword + semantic, TSS-ranked) over the user's long-term episodic memories. " +
      'Returns GMP v0.1 episode fragments. Memories the owner excluded from AI are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to recall, natural language' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT, description: 'Max results (default 8)' },
        type: {
          type: 'string',
          enum: GMP_EPISODE_TYPES,
          description: 'Optional episode type filter',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'profile_get',
    scope: 'profile.read',
    title: 'Get user portrait',
    description:
      "Structured portrait of the user: identity (values, personality, long-term goals) and per-dimension semantic profile. " +
      'GMP v0.1 identity + semantic fragments. Fetch once per session to calibrate how you assist this specific person.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'goals_list',
    scope: 'goals.read',
    title: 'List goals',
    description: "The user's goals (OKR-style) with status, life-wheel dimension and progress.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Optional status filter, e.g. 'active' | 'completed'" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'tasks_today',
    scope: 'goals.read',
    title: "Today's tasks",
    description: "The user's tasks for today (title, status, priority, due).",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'memory_capture',
    scope: 'memory.write',
    title: 'Propose a memory (queued for owner review)',
    description:
      'Propose a durable memory about the user (fact, preference, decision, key event). ' +
      'It is NOT stored directly: it enters the owner\'s review queue in GEDO and only persists after explicit approval. ' +
      'Use sparingly for things worth remembering long-term — never for chit-chat or transient context.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: `The memory text, first person about the user (max ${MAX_CAPTURE_CHARS} chars)` },
        type: { type: 'string', enum: GMP_EPISODE_TYPES, description: "Episode type (default 'important_info')" },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (max 8)' },
      },
      required: ['content'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// ── 结果/脱敏助手 ────────────────────────────────────────────────────────────

function textResult(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

function errorResult(text) {
  return { isError: true, content: [{ type: 'text', text: String(text) }] };
}

const REDACT_SKIP_KEYS = new Set(['id', 'created_at', 'updated_at', 'superseded_by', 'reminder_date', 'type', 'source', 'decay_class', 'schema']);
const BLOCKED_PLACEHOLDER = '[withheld: matches sensitive-content blocklist]';

/**
 * 递归脱敏对象里的字符串值（只动值不动键，避免整串 JSON 过正则误伤 id/时间戳）。
 * redactPii=false 时仍做 BLOCK_PATTERNS 检查——密钥/密码类内容永不出边界。
 */
function redactDeep(value, redactPii, key = '') {
  if (typeof value === 'string') {
    if (REDACT_SKIP_KEYS.has(key)) return value;
    const r = redact(value);
    if (r.blocked) return BLOCKED_PLACEHOLDER;
    return redactPii ? r.text : value;
  }
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redactPii, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, redactPii, k);
    return out;
  }
  return value;
}

// ── 每 PAT 限流（in-memory token bucket，重启即清） ─────────────────────────

const patRate = new Map();
const PAT_RATE_CAP = 30;          // burst
const PAT_RATE_REFILL_MS = 2000;  // 1 token / 2s

function patRateAllow(patId) {
  const now = Date.now();
  let b = patRate.get(patId);
  if (!b) { b = { tokens: PAT_RATE_CAP, ts: now }; patRate.set(patId, b); }
  const refill = Math.floor((now - b.ts) / PAT_RATE_REFILL_MS);
  if (refill > 0) { b.tokens = Math.min(PAT_RATE_CAP, b.tokens + refill); b.ts = now; }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}

// ── 工厂 ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {object} deps.store        lib/store.mjs 实例（PAT/goals/tasks）
 * @param {object} deps.billing      billing service（resolveUserTier）
 * @param {() => object} deps.corsHeaders
 */
export function createMemoryMcpHandler({ store, billing, corsHeaders }) {
  function httpError(res, status, message, extraHeaders = {}) {
    res.writeHead(status, { ...corsHeaders(), 'content-type': 'application/json', ...extraHeaders });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  }

  async function callTool(pat, name, args) {
    const userId = pat.user_id;

    if (name === 'memory_search') {
      const query = String(args.query || '').trim();
      if (!query) return errorResult('invalid_input: query is required');
      const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Number(args.limit) || 8));

      // 隐私开关：暂停记忆时不检索（与聊天注入同语义），返回空集而非报错。
      if (isMemoryPaused(userId)) {
        return textResult({ schema: 'gmp/v0.1#episodes', count: 0, items: [], notice: 'memory_paused_by_owner' });
      }

      // 与聊天检索同源：keyword + vector 双路 → RRF 融合 → TSS 排序。
      // embedding 失败非致命（本地服务可能未起），降级为纯 keyword。
      const keywordEps = searchEpisodes(userId, query, { limit: 60 });
      const sources = [{ results: keywordEps, weight: 0.8, source: 'bm25' }];
      try {
        const emb = await embedText(query);
        if (Array.isArray(emb) && emb.length) {
          sources.unshift({ results: searchEpisodesByVector(userId, emb, { topK: 80 }), weight: 1.0, source: 'vector' });
        }
      } catch { /* keyword-only fallback */ }

      let episodes = sources.length > 1 ? reciprocalRankFusion(sources, { topK: 60 }) : keywordEps;
      const typeFilter = (list) => (args.type ? list.filter((ep) => ep.type === args.type) : list);
      episodes = typeFilter(episodes);
      const ranked = rankByTSS(episodes, {
        similarities: episodes.map((ep) => ep.vector_score ?? 0),
        intentType: 'default',
        limit,
      }).slice(0, limit);

      // 精确子串命中保底：TSS 的语义/频率权重会把尚无向量分的新记忆挤出
      // top-K（聊天装配可容忍，显式搜索不行——整串命中是最强信号，前置回填）。
      const rankedIds = new Set(ranked.map((ep) => ep.id));
      const missedExact = typeFilter(keywordEps)
        .filter((ep) => !rankedIds.has(ep.id))
        .slice(0, Math.max(1, Math.floor(limit / 3)));
      const finalEps = [...missedExact, ...ranked].slice(0, limit);

      const items = finalEps.map((ep) => redactDeep(pcpEpisodeToGmpEpisode(ep), pat.redact_pii !== false));
      return textResult({ schema: 'gmp/v0.1#episodes', count: items.length, items });
    }

    if (name === 'profile_get') {
      const profile = getProfile(userId) || {};
      const identity = pcpProfileToGmpIdentity(profile);
      const semantic = pcpProfileToGmpSemantic(profile);
      const redactPii = pat.redact_pii !== false;
      return textResult({
        schema: 'gmp/v0.1#identity+semantic',
        identity: redactDeep(identity, redactPii),
        semantic: redactDeep(semantic, redactPii),
      });
    }

    if (name === 'goals_list') {
      let goals = store.listGoals(userId);
      if (args.status) goals = goals.filter((g) => g.status === String(args.status));
      return textResult({
        count: goals.length,
        goals: goals.slice(0, 50).map((g) => ({
          id: g.id,
          title: g.title,
          status: g.status,
          dimension: g.life_wheel_dimension,
          progress: g.progress || 0,
          due_date: g.due_date || null,
        })),
      });
    }

    if (name === 'tasks_today') {
      const tasks = store.listTodayTasks(userId);
      return textResult({
        count: tasks.length,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          due_date: t.due_date || null,
        })),
      });
    }

    if (name === 'memory_capture') {
      const content = String(args.content || '').trim();
      if (!content) return errorResult('invalid_input: content is required');
      if (content.length > MAX_CAPTURE_CHARS) return errorResult(`content_too_long: max ${MAX_CAPTURE_CHARS} characters`);
      // 暂停记忆 = 停止收集，连"待确认候选"也不收（与聊天自动捕捉同语义）。
      if (isMemoryPaused(userId)) {
        return textResult({ queued: false, notice: 'memory_paused_by_owner — the owner has paused memory collection; do not retry' });
      }
      const type = GMP_EPISODE_TYPES.includes(args.type) ? args.type : 'important_info';
      const tags = Array.isArray(args.tags) ? args.tags.map((x) => String(x).slice(0, 64)).slice(0, 8) : [];
      // 不直接落库：进 pendingCaptures 确认队列（createCapture 自带同 payload 去重，
      // 重复提交幂等返回既有候选），确认后经 approveCaptureWithEdits 统一落库。
      const capture = store.createCapture(userId, {
        kind: 'memory',
        payload: { type, content, tags },
        confidence: 0.9,
        source: 'mcp',
      });
      return textResult({
        queued: true,
        capture_id: capture.id,
        status: capture.status,
        note: 'Queued for the owner\'s review in GEDO; it is NOT stored until approved. Do not resubmit.',
      });
    }

    return errorResult(`unknown_tool: ${name}`);
  }

  return async function handleMemoryMcp(req, res) {
    // 1) PAT 鉴权（明文只在此比对为 hash，不落日志）
    const m = /^Bearer\s+(gedo_pat_[A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '');
    if (!m) return httpError(res, 401, 'Unauthorized: provide a GEDO personal access token (Authorization: Bearer gedo_pat_…)', { 'www-authenticate': 'Bearer' });
    const pat = store.getPatByHash(hashPatToken(m[1]));
    if (!pat) return httpError(res, 401, 'Unauthorized: unknown token', { 'www-authenticate': 'Bearer' });
    if (pat.revoked_at) return httpError(res, 401, 'Unauthorized: token revoked', { 'www-authenticate': 'Bearer' });

    // 2) 档位门禁：Pro 及以上（warn 模式只记不拦）
    const tier = billing.resolveUserTier(pat.user_id);
    const ent = getEntitlementsForTier(tier);
    if (!ent.memoryMcpAccess) {
      if (process.env.ENTITLEMENT_MODE === 'warn') {
        console.warn(`[memory-mcp] entitlement warn: user=${pat.user_id} tier=${tier} lacks memoryMcpAccess`);
      } else {
        return httpError(res, 403, 'Forbidden: the memory MCP requires a GEDO Pro (or higher) subscription');
      }
    }

    // 3) 限流（每 PAT）
    if (!patRateAllow(pat.id)) return httpError(res, 429, 'Too many requests for this token, retry later');

    // 4) 无状态 MCP server（工具表按 scope 过滤——agent 只看得到被授权的工具）
    const scopes = new Set(pat.scopes || []);
    const visibleTools = TOOLS.filter((t) => scopes.has(t.scope));

    const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: visibleTools.map(({ scope: _s, ...tool }) => tool),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const def = TOOLS.find((t) => t.name === name);
      if (!def) return errorResult(`unknown_tool: ${name}`);
      if (!scopes.has(def.scope)) return errorResult(`forbidden_scope: this token lacks the '${def.scope}' scope`);
      try {
        store.touchPat(pat.id);
        store.addPatAudit(pat.user_id, {
          pat_id: pat.id,
          tool: name,
          summary: name === 'memory_search' ? String(args?.query || '').slice(0, 80)
            : name === 'memory_capture' ? String(args?.content || '').slice(0, 80)
            : '',
        });
        return await callTool(pat, name, args || {});
      } catch (e) {
        console.error('[memory-mcp] tool call failed:', e);
        return errorResult(`internal_error: ${e?.message || 'unexpected failure'}`);
      }
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };
}
