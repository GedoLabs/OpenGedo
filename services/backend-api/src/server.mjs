import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import './lib/load-env.mjs';
import { isCloud } from './lib/edition.mjs';
import { hashPassword, signJwt, verifyJwt, verifyPassword, generatePatToken, hashPatToken } from './lib/crypto.mjs';
import { verifyGoogleIdToken, verifyAppleIdToken, resolveSocialLogin, canUnlinkIdentity } from './lib/oauth.mjs';
import { getAllFlags } from './lib/flags.mjs';
import { emitCheckInDone } from '../../agent/src/triggers/listenNotify.mjs';
import { saveSubscription, removeSubscription, getVapidPublicKey } from './services/push.service.mjs';
import { Store } from './lib/store.mjs';
import { dataPath } from './lib/data-dir.mjs';
import * as PlannerService from './services/planner.service.mjs';
import * as ConversationService from './services/conversation.service.mjs';
import * as DailyPlanService from './services/daily-plan.service.mjs';
import * as CompanionBriefService from './services/companion-brief.service.mjs';
import * as McpClientManager from './mcp/client-manager.mjs';
import { createPersonaMcpHandler } from './mcp/persona-public-server.mjs';
import { createMemoryMcpHandler, PAT_SCOPES } from './mcp/memory-mcp-server.mjs';
import * as McpOauth from './mcp/oauth-client.mjs';
import * as McpDirectory from './mcp/directory.mjs';
import * as TaskActionService from './services/task-action.service.mjs';
import { registerJob as registerScheduledJob } from '../../agent/src/scheduler.mjs';
import { getLLMRouter } from './llm/router.mjs';
import { buildMemoryContext } from './memory/context-builder.mjs';
import { embedText, embedEpisode } from './memory/embedding.mjs';
import { computeState, renderStateContext } from './memory/engines/state-engine.mjs';
import { getIdentity, computeIdentity } from './memory/engines/identity-engine.mjs';
import * as MemoryJobs from './memory/engines/scheduled-jobs.mjs';
import * as EntitySummary from './memory/entity-summary.service.mjs';
import { getNarrative, generateNarrative, renderNarrativeContext } from './memory/engines/narrative-engine.mjs';
import { getDimensionAssessment, computeDimensionAssessment } from './memory/engines/dimension-engine.mjs';
import { getMemoryStore } from './memory/store/index.mjs';
import { consolidate, consolidateRuleBased, consolidateSessionEnd, consolidateWeekly, consolidateQuarterly, consolidateFull } from './memory/consolidation.service.mjs';
import { classifyIntent } from './memory/intent-classifier.mjs';
import { resolveAllConflicts, getPendingConflicts } from './memory/conflict-resolver.mjs';
import { migrateMemoryItems } from './memory/migration.mjs';
import { formatAnswerText, applyOnboardingAnswers } from './memory/onboarding-profile.mjs';
import { episodeTypeForQuestion, getSlotForQuestion } from './memory/core-slots.mjs';
import { EPISODE_TYPES } from './memory/types.mjs';
import { classifyDimensions } from './memory/dimension-classifier.mjs';
import {
  approveCaptureWithEdits, undoCapturesBatch,
  buildInboxSnapshot, decideInboxBatch, processCaptureDecisions,
  undoCaptureMaterialised,
} from './memory/inbox.service.mjs';
import * as DigitalPersonaService from './services/digital-persona.service.mjs';
import { ingestSession as DigitalPersonaService_ingest } from './services/interaction-ingest.service.mjs';
import * as TwinService from './persona/twin.mjs';
import { createBillingService } from './services/billing.service.mjs';
import * as EmailService from './services/email.service.mjs';
import { getEntitlementsForTier } from './lib/entitlements.mjs';
import * as SourceStore from './memory/source-store.mjs';
import { initJobQueue, registerJobHandler, enqueueJob, getQueuePosition, cancelJobsBySource, sweepFinishedJobs } from './lib/job-queue.mjs';
import { runSourceIngest } from './services/source-pipeline.service.mjs';

const store = Store();
const billing = createBillingService(store);
// Memory access goes through the MemoryStore interface (P0.5); `MemoryFileService`
// is now the store instance, not the file service. Swapping to Postgres = factory change.
const MemoryFileService = getMemoryStore();

// ── Digital Persona: local avatar uploads + public-chat rate limiting ──────
// In production, uploads should go to R2 (see env.example); locally we persist
// under data/uploads and serve via GET /public/v1/uploads/:file.
const UPLOADS_DIR = dataPath('uploads');
function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Simple in-memory token bucket per (ip + slug) to throttle public chat abuse.
const personaRate = new Map();
const PERSONA_RATE_CAP = 20;          // burst capacity
const PERSONA_RATE_REFILL_MS = 3000;  // refill 1 token / 3s
function personaRateAllow(key) {
  const now = Date.now();
  let b = personaRate.get(key);
  if (!b) { b = { tokens: PERSONA_RATE_CAP, ts: now }; personaRate.set(key, b); }
  const refill = Math.floor((now - b.ts) / PERSONA_RATE_REFILL_MS);
  if (refill > 0) { b.tokens = Math.min(PERSONA_RATE_CAP, b.tokens + refill); b.ts = now; }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

// 分身公开 MCP server（能力开放 E1）：POST /public/mcp，依赖注入见模块头注释。
const handlePersonaMcp = createPersonaMcpHandler({ store, DigitalPersonaService, billing, personaRateAllow, clientIp });
// 个人记忆 MCP server（能力开放 E2）：POST /mcp，PAT 鉴权 + Pro 门禁，见模块头注释。
const handleMemoryMcp = createMemoryMcpHandler({ store, billing, corsHeaders });

// Initialize LLM Router
const llmRouter = getLLMRouter();

// 邀请码配置：注册邀请码以运营台「邀请码管理」动态发放为主（store.invite_codes，限次数/限期）。
// INVITE_CODES 是可选的"常青码"env 静态名单（逗号分隔），不设置时为空——不再有固定默认码。
const RAW_INVITE_CODES = process.env.INVITE_CODES || '';
const INVITE_CODES = RAW_INVITE_CODES.split(',')
  .map((c) => c.trim())
  .filter((c) => c.length > 0);
// 强制邀请码开关（硬性）：显式 REQUIRE_INVITE=true 时始终要求邀请码，忽略容量。
// 默认关闭 → 开放注册（免邀请码），达到 OPEN_REG_MAX_USERS 容量后自动切回邀请码模式。
const REQUIRE_INVITE = (process.env.REQUIRE_INVITE || 'false') === 'true';
// 开放注册容量：已占用名额（注册用户 + 平行人生/候补预约邮箱，去重）达到该值后自动转邀请码。
// 0 或非法值表示不限量。仅 cloud edition 生效；自托管 OSS 一律不限量。
const OPEN_REG_MAX_USERS = Math.max(0, Number.parseInt(process.env.OPEN_REG_MAX_USERS ?? '1000', 10) || 0);

// 当前是否需要邀请码：显式强制优先；否则 cloud 版达量后自动开启。
function inviteRequired() {
  if (REQUIRE_INVITE) return true;
  if (!isCloud() || OPEN_REG_MAX_USERS <= 0) return false;
  return store.registrationStats().consumed >= OPEN_REG_MAX_USERS;
}

// 安全修复：仅在开发环境初始化默认测试账号
function ensureDefaultUser() {
  // 仅在开发环境且明确启用时才创建默认账号
  const isDev = process.env.NODE_ENV !== 'production';
  const enableDemo = process.env.ENABLE_DEMO_USER === 'true';
  
  if (!isDev || !enableDemo) {
    return;
  }
  
  const defaultEmail = process.env.DEMO_USER_EMAIL || 'demo@example.com';
  const defaultPassword = process.env.DEMO_USER_PASSWORD || 'demo123';
  const existingUser = store.getUserByEmail(defaultEmail);
  if (!existingUser) {
    const passwordHash = hashPassword(defaultPassword);
    store.createUser({ email: defaultEmail, password_hash: passwordHash });
    console.log(`[backend-api] 开发环境：已创建默认测试账号: ${defaultEmail}`);
  }
}

// 启动时确保默认账号存在（仅在开发环境）
ensureDefaultUser();

// 是否启用 LLM（可通过环境变量控制）
const ENABLE_LLM = process.env.ENABLE_LLM !== 'false';

const PORT = Number(process.env.PORT || 8787);

// 安全修复：生产环境必须设置JWT_SECRET，开发环境使用默认值但给出警告
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[backend-api] 错误: 生产环境必须设置 JWT_SECRET 环境变量！');
    process.exit(1);
  } else {
    console.warn('[backend-api] 警告: JWT_SECRET 未设置，使用不安全的默认值（仅开发环境）');
  }
}
const JWT_SECRET_FINAL = JWT_SECRET || 'dev-secret-change-me-in-production';

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    ...extraHeaders,
  });
  res.end(text);
}

function corsHeaders() {
  return {
    'access-control-allow-origin': CORS_ORIGIN,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    // mcp-* 头：浏览器类 MCP 客户端（inspector 等）访问 /public/mcp 需要
    'access-control-allow-headers': 'content-type,authorization,mcp-protocol-version,mcp-session-id',
    'access-control-expose-headers': 'mcp-session-id',
    'access-control-allow-credentials': 'true',
  };
}

function sseHeaders() {
  return {
    ...corsHeaders(),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  };
}

function sendSSE(res, event, data) {
  // No framework here, no global unhandledRejection/uncaughtException handler —
  // an unguarded write after the client disconnects can crash the whole process.
  if (res.writableEnded || res.destroyed) return;
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { __parse_error: true };
  }
}

const MAX_GMP_BYTES = 32 * 1024 * 1024; // 32 MB

async function readBodyBuffer(req, { limit = MAX_GMP_BYTES } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const err = new Error('payload_too_large');
      err.code = 'PAYLOAD_TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}

function requireUser(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'unauthorized' }, corsHeaders());
    return null;
  }
  const v = verifyJwt(token, JWT_SECRET_FINAL);
  if (!v.ok) {
    sendJson(res, 401, { error: 'unauthorized', detail: v.error }, corsHeaders());
    return null;
  }
  const user = store.getUserById(v.payload.sub);
  if (!user) {
    sendJson(res, 401, { error: 'unauthorized' }, corsHeaders());
    return null;
  }
  return user;
}

function sanitizeUser(u) {
  return { id: u.id, email: u.email, created_at: u.created_at, display_name: u.display_name || null, avatar_url: u.avatar_url || null };
}

// Social login: turn a verified Google/Apple identity into a session, reusing the
// same {token, user} envelope as password login. Invite gating for BRAND-NEW
// accounts mirrors /v1/auth/signup (returning + email-linked users pass through).
function sendSocialSession(res, verified, body) {
  const r = resolveSocialLogin({
    store,
    verified,
    inviteCode: body?.invite_code,
    requireInvite: inviteRequired(),
    staticCodes: INVITE_CODES,
  });
  if (r.error) return sendJson(res, r.status, { error: r.error }, corsHeaders());
  const token = signJwt({ sub: r.user.id }, JWT_SECRET_FINAL);
  return sendJson(res, 200, { token, user: sanitizeUser(r.user), is_new: !!r.isNew }, corsHeaders());
}

// Shape + send the signed-in user's sign-in methods (used by the GET endpoint and
// after a link/unlink so the client can re-render without a second round-trip).
function sendAuthIdentities(res, userId) {
  const identities = store.listAuthIdentities(userId);
  return sendJson(res, 200, {
    identities: identities.map((i) => ({
      id: i.id, provider: i.provider, email: i.email, created_at: i.created_at,
    })),
  }, corsHeaders());
}

// Attach a verified provider identity to the CURRENT (already-authenticated) user.
// Unlike sendSocialSession this issues no session — the caller is already signed in;
// it just links the provider so future logins with it resolve to this account.
function linkIdentity(res, user, verified) {
  const { provider, subject, email } = verified;
  if (!provider || !subject) return sendJson(res, 401, { error: 'invalid_token' }, corsHeaders());
  // Refuse to steal a provider identity already tied to a different account.
  const owner = store.getUserByProviderSubject(provider, subject);
  if (owner && owner.id !== user.id) {
    return sendJson(res, 409, { error: 'identity_linked_elsewhere' }, corsHeaders());
  }
  store.upsertAuthIdentity({ user_id: user.id, provider, provider_subject: subject, email });
  // Keep the returned list complete regardless of call order (matches the GET route).
  if (user.password_hash) store.ensurePasswordIdentity(user.id, user.email);
  return sendAuthIdentities(res, user.id);
}

async function buildClarifyQuestions(prompt, userId) {
  // 启用 LLM 时使用 AI 生成问题
  if (ENABLE_LLM) {
    try {
      const userMemories = store.searchMemory(userId, '').slice(0, 5);
      return await PlannerService.generateClarifyQuestions(prompt, userMemories, store.getSettings(userId)?.language);
    } catch (error) {
      console.error('[API] LLM clarify error:', error);
      // 降级到规则
    }
  }
  
  // 规则化占位
  const p = String(prompt || '').toLowerCase();
  const questions = [];
  if (p.includes('cpa')) {
    questions.push({
      id: 'cpa_priority',
      prompt: '你的 CPA 备考优先级是？',
      options: [
        { value: 'acct_audit', label: '会计 + 审计' },
        { value: 'tax_law', label: '税法 + 经济法' },
      ],
    });
    questions.push({
      id: 'daily_time',
      prompt: '你每天可用于学习的时间大约多久？（小时）',
      options: [
        { value: '1', label: '1 小时' },
        { value: '2', label: '2 小时' },
        { value: '3', label: '3 小时' },
      ],
    });
    return questions;
  }

  questions.push({
    id: 'timebound',
    prompt: '这个目标的期望截止时间是？',
    options: [
      { value: '1m', label: '1 个月' },
      { value: '3m', label: '3 个月' },
      { value: '6m', label: '6 个月' },
      { value: '1y', label: '1 年' },
    ],
  });
  questions.push({
    id: 'weekly_hours',
    prompt: '你每周可投入的总时间（小时）大概是？',
    options: [
      { value: '3', label: '3 小时' },
      { value: '6', label: '6 小时' },
      { value: '10', label: '10 小时' },
    ],
  });
  return questions;
}

async function buildPlanTasks(prompt, answers, userId) {
  const title = String(prompt || '').trim() || '未命名目标';
  
  // 启用 LLM 时使用 AI 生成 SMART 计划
  if (ENABLE_LLM) {
    try {
      const userMemories = store.searchMemory(userId, '').slice(0, 5);
      const plan = await PlannerService.generateSmartPlan(prompt, answers, userMemories, store.getSettings(userId)?.language);
      
      return {
        goal: {
          title: plan.goal.title || title,
          description: plan.goal.description,
          life_wheel_dimension: plan.goal.life_wheel_dimension,
          specific: plan.goal.specific,
          measurable: plan.goal.measurable,
          achievable: plan.goal.achievable,
          relevant: plan.goal.relevant,
          time_bound: plan.goal.time_bound,
          created_at: new Date().toISOString(),
          meta: { answers: answers || {}, milestones: plan.milestones },
        },
        tasks: plan.tasks.map(t => ({
          title: t.title,
          estimated_duration: t.estimated_duration,
          energy_level: t.energy_level,
        })),
      };
    } catch (error) {
      console.error('[API] LLM plan error:', error);
      // 降级到规则
    }
  }
  
  // 规则化占位
  const goal = {
    title,
    created_at: new Date().toISOString(),
    meta: { answers: answers || {} },
  };

  const tasks = [
    { title: `拆解目标：${title}（定义里程碑）` },
    { title: `收集资料：为「${title}」准备资源清单` },
    { title: `执行第一步：完成 1 个最小行动` },
  ];
  return { goal, tasks };
}

// ── Open-core seam：src/cloud/ 只存在于闭源仓；开源仓无此目录 → cloud 恒为 null ──
// 用 existsSync 判存在而非 try/catch 吞 ERR_MODULE_NOT_FOUND，避免掩盖 cloud 内部的真实 import 错误。
// isCloud() 前置使闭源仓以 GEDO_EDITION=oss 运行时与开源构建行为完全一致。
let cloud = null;
const CLOUD_ENTRY = new URL('./cloud/index.mjs', import.meta.url);
if (isCloud() && fs.existsSync(CLOUD_ENTRY)) {
  const { createCloudModule } = await import('./cloud/index.mjs');
  cloud = createCloudModule({
    store,
    billing,
    memory: MemoryFileService,
    helpers: { sendJson, sendText, corsHeaders, readJsonBody, requireUser, personaRateAllow, clientIp },
    services: { EmailService },
    constants: { EPISODE_TYPES },
  });
  console.log('[backend-api] cloud modules loaded');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = u.pathname;
  const method = (req.method || 'GET').toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // health
  if (method === 'GET' && pathname === '/') {
    sendText(res, 200, 'GEDO.AI backend-api ok', corsHeaders());
    return;
  }

  // GET /healthz — 拨测/compose healthcheck 用。故意不读 store.json：
  // 健康检查必须廉价，且在数据层故障时仍能报告进程存活。
  if (method === 'GET' && pathname === '/healthz') {
    return sendJson(res, 200, {
      ok: true,
      service: 'backend-api',
      uptime_sec: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    }, corsHeaders());
  }

  // Cloud-only 路由（测评/sim 桥接等）前置分发：命中即已写响应。开源构建 cloud=null 直接落回主链。
  if (cloud && await cloud.handleRoute(req, res, { method, pathname, url: u })) return;

  // ══════════════════════════════════════════════════════════════════════
  //  Twin 个人模型（T0 数据地基，docs/GEDO_TWIN_LORA_PLAN.md）
  // ══════════════════════════════════════════════════════════════════════

  // GET /v1/twin/status — 进度条：同意/语料统计/门槛/任务列表/权益
  if (method === 'GET' && pathname === '/v1/twin/status') {
    const user = requireUser(req, res);
    if (!user) return;
    const tier = billing.resolveUserTier(user.id);
    return sendJson(res, 200, TwinService.twinStatus(user.id, tier), corsHeaders());
  }

  // POST/DELETE /v1/twin/consent — Twin 独立训练同意（撤回=语料与产物物理删除）
  if (pathname === '/v1/twin/consent' && (method === 'POST' || method === 'DELETE')) {
    const user = requireUser(req, res);
    if (!user) return;
    const result = method === 'POST'
      ? TwinService.grantTwinConsent(user.id)
      : TwinService.revokeTwinConsent(user.id);
    return sendJson(res, 200, result, corsHeaders());
  }

  // POST /v1/twin/samples — 上传写作样本（数据不足时的引导入口）
  if (method === 'POST' && pathname === '/v1/twin/samples') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req) || {};
    try {
      return sendJson(res, 200, TwinService.addTwinSample(user.id, String(body.text || ''), 'upload'), corsHeaders());
    } catch (e) {
      const status = e.code === 'TWIN_CONSENT_REQUIRED' ? 403 : 400;
      return sendJson(res, status, { error: e.code || 'invalid_input', message: e.message }, corsHeaders());
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Public digital persona (免鉴权) — 对外可发布的数字人
  //  Security: ABOUT-mode only, no tools, no owner-history writes, rate-limited.
  // ══════════════════════════════════════════════════════════════════════

  // GET /public/v1/persona/:slug — public-safe profile (404 if not published)
  if (method === 'GET' && pathname.startsWith('/public/v1/persona/')) {
    const rest = pathname.slice('/public/v1/persona/'.length);
    if (rest && !rest.includes('/')) {
      const slug = decodeURIComponent(rest);
      const persona = store.getDigitalPersonaBySlug(slug);
      if (!persona) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
      store.incPersonaView(slug);
      return sendJson(res, 200, DigitalPersonaService.buildPublicProfile(persona), corsHeaders());
    }
  }

  // POST /public/v1/persona/:slug/verify — clear the access gate, open a session
  if (method === 'POST' && /^\/public\/v1\/persona\/[^/]+\/verify$/.test(pathname)) {
    const slug = decodeURIComponent(pathname.split('/')[4]);
    const persona = store.getDigitalPersonaBySlug(slug);
    if (!persona) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    if (!personaRateAllow(`${clientIp(req)}:${slug}`)) return sendJson(res, 429, { error: 'rate_limited' }, corsHeaders());

    const body = await readJsonBody(req) || {};
    const result = DigitalPersonaService.verifyAccess(
      persona,
      { passcode: body.passcode, invite_token: body.invite_token },
      { resolveInvite: (t) => store.getRelationshipByInviteToken(t) },
    );
    if (!result.ok) return sendJson(res, 403, { error: result.reason || 'forbidden' }, corsHeaders());

    const rel = result.relationship;
    const session = store.createVisitorSession({
      userId: persona.user_id,
      persona_slug: slug,
      visitor: {
        declared_name: rel?.name || null,
        relationship_id: rel?.id || null,
        matched: !!rel,
        via: result.via,
      },
    });
    if (rel) store.touchRelationship(persona.user_id, rel.id);

    return sendJson(res, 200, {
      session_token: session.session_token,
      trusted: result.trusted,
      visitor: { matched: !!rel, name: rel?.name || null, role: rel?.role || null },
    }, corsHeaders());
  }

  // POST /public/v1/persona/:slug/identify — visitor declares a name, match to graph
  if (method === 'POST' && /^\/public\/v1\/persona\/[^/]+\/identify$/.test(pathname)) {
    const slug = decodeURIComponent(pathname.split('/')[4]);
    const persona = store.getDigitalPersonaBySlug(slug);
    if (!persona) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());

    const body = await readJsonBody(req) || {};
    const session = store.getVisitorSessionByToken(body.session_token);
    if (!session || session.persona_slug !== slug) return sendJson(res, 403, { error: 'session_required' }, corsHeaders());
    const declared = String(body.declared_name || '').trim();
    if (!declared) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());

    const rel = store.matchRelationshipByName(persona.user_id, declared);
    store.bindVisitorIdentity(session.session_token, {
      declared_name: declared,
      relationship_id: rel?.id || null,
      matched: !!rel,
    });
    if (rel) store.touchRelationship(persona.user_id, rel.id);
    return sendJson(res, 200, { matched: !!rel, name: rel?.name || null, role: rel?.role || null }, corsHeaders());
  }

  // POST /public/v1/persona/:slug/finalize — analyze session → owner review inbox
  if (method === 'POST' && /^\/public\/v1\/persona\/[^/]+\/finalize$/.test(pathname)) {
    const slug = decodeURIComponent(pathname.split('/')[4]);
    const body = await readJsonBody(req) || {};
    const session = store.getVisitorSessionByToken(body.session_token);
    if (!session || session.persona_slug !== slug) return sendJson(res, 403, { error: 'session_required' }, corsHeaders());
    if (session.finalized) return sendJson(res, 200, { ok: true, items: 0 }, corsHeaders());
    let created = [];
    try {
      const drafts = await DigitalPersonaService_ingest(session);
      created = store.createInboxItems(session.user_id, drafts);
    } catch (e) {
      console.error('[API] ingest error:', e);
    }
    store.finalizeVisitorSession(session.session_token);
    if (created.length > 0) {
      const owner = store.getUserById(session.user_id);
      if (owner) EmailService.sendPersonaInbox(owner, { count: created.length }).catch((e) => console.warn('[email] persona-inbox failed:', e?.message));
    }
    return sendJson(res, 200, { ok: true, items: created.length }, corsHeaders());
  }

  // POST /public/v1/persona/:slug/chat/stream — session-based ABOUT SSE chat
  if (method === 'POST' && /^\/public\/v1\/persona\/[^/]+\/chat\/stream$/.test(pathname)) {
    const slug = decodeURIComponent(pathname.split('/')[4]);
    const persona = store.getDigitalPersonaBySlug(slug);
    if (!persona) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    if (!personaRateAllow(`${clientIp(req)}:${slug}`)) return sendJson(res, 429, { error: 'rate_limited' }, corsHeaders());

    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const session = store.getVisitorSessionByToken(body.session_token);
    if (!session || session.persona_slug !== slug) return sendJson(res, 403, { error: 'session_required' }, corsHeaders());
    const message = String(body.message || '').trim();
    if (!message) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());
    if (message.length > DigitalPersonaService.MAX_MESSAGE_CHARS) return sendJson(res, 400, { error: 'message_too_long' }, corsHeaders());

    const relationship = session.visitor?.relationship_id
      ? store.getRelationship(persona.user_id, session.visitor.relationship_id)
      : null;
    const history = (session.transcript || []).slice(-12).map((t) => ({ role: t.role, content: t.content }));
    store.appendVisitorTurn(session.session_token, { role: 'user', content: message });

    res.writeHead(200, sseHeaders());
    // 分身额度（按主人的额度计量）：用尽则优雅降级、不调 LLM。访客 user 轮已先记录（守安全红线）。
    if (billing.checkEntitlement(persona.user_id, 'visitor')) {
      const who = persona.display_name || 'TA';
      const text = `${who} 现在不方便回复，晚点再来聊聊吧 🙏`;
      sendSSE(res, 'text', { text });
      sendSSE(res, 'done', { full_content: text });
      res.end();
      return;
    }
    try {
      let full = '';
      for await (const chunk of DigitalPersonaService.streamAboutResponse({
        persona, userId: persona.user_id, message, history, relationship,
      })) {
        if (chunk.type === 'text') { full += chunk.text; sendSSE(res, 'text', { text: chunk.text }); }
        else if (chunk.type === 'error') sendSSE(res, 'error', { error: chunk.error });
        else if (chunk.type === 'done') sendSSE(res, 'done', { full_content: full });
      }
      if (full) {
        store.appendVisitorTurn(session.session_token, { role: 'assistant', content: full });
        billing.recordUsage(persona.user_id, 'persona.visitor_reply'); // 扣 1 分身额度（仅成功回复）
      }
    } catch (e) {
      console.error('[API] public persona chat error:', e);
      sendSSE(res, 'error', { error: e?.message || 'stream_failed' });
    }
    res.end();
    return;
  }

  // POST /public/v1/persona/:slug/chat — non-streaming ABOUT answer (REST/MCP, session-less)
  if (method === 'POST' && /^\/public\/v1\/persona\/[^/]+\/chat$/.test(pathname)) {
    const slug = decodeURIComponent(pathname.split('/')[4]);
    const persona = store.getDigitalPersonaBySlug(slug);
    if (!persona) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    if (!personaRateAllow(`${clientIp(req)}:${slug}`)) return sendJson(res, 429, { error: 'rate_limited' }, corsHeaders());

    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());

    // Enforce the access gate for non-public personas (MCP/REST must pass passcode/invite).
    const access = DigitalPersonaService.verifyAccess(
      persona,
      { passcode: body.passcode, invite_token: body.invite_token },
      { resolveInvite: (t) => store.getRelationshipByInviteToken(t) },
    );
    if (!access.ok) return sendJson(res, 403, { error: access.reason || 'forbidden' }, corsHeaders());

    const message = String(body.message || '').trim();
    if (!message) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());
    if (message.length > DigitalPersonaService.MAX_MESSAGE_CHARS) return sendJson(res, 400, { error: 'message_too_long' }, corsHeaders());
    const history = Array.isArray(body.history) ? body.history : [];

    // 分身额度（按主人的额度计量）：用尽则优雅返回不可用、不调 LLM。
    if (billing.checkEntitlement(persona.user_id, 'visitor')) {
      const who = persona.display_name || 'TA';
      return sendJson(res, 200, {
        reply: `${who} 现在不方便回复，晚点再来聊聊吧 🙏`,
        display_name: persona.display_name || '智能助理',
        unavailable: true,
      }, corsHeaders());
    }

    let reply = '';
    let streamError = null;
    for await (const chunk of DigitalPersonaService.streamAboutResponse({
      persona, userId: persona.user_id, message, history, relationship: access.relationship,
    })) {
      if (chunk.type === 'text') reply += chunk.text;
      else if (chunk.type === 'error') streamError = chunk.error;
    }
    if (streamError && !reply) return sendJson(res, 502, { error: 'llm_error', detail: streamError }, corsHeaders());
    if (reply) billing.recordUsage(persona.user_id, 'persona.visitor_reply'); // 扣 1 分身额度（仅成功回复）
    return sendJson(res, 200, { reply, display_name: persona.display_name || '智能助理' }, corsHeaders());
  }

  // ── 能力开放 E1：分身公开 MCP server（Streamable HTTP，无状态）──────────
  // POST /public/mcp — 外部 Agent 以 MCP 工具访问已发布分身（profile / ask）。
  if (pathname === '/public/mcp') {
    if (method === 'POST') return handlePersonaMcp(req, res);
    // 无状态端点不支持 GET(SSE)/DELETE 的会话语义。
    return sendJson(res, 405, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This is a stateless MCP endpoint; use POST.' },
      id: null,
    }, { ...corsHeaders(), allow: 'POST, OPTIONS' });
  }

  // ── 能力开放 E2：个人记忆 MCP server（PAT 鉴权，Pro+）────────────────────
  // POST /mcp — 用户把自己的 Gedo 记忆接入任意外部 AI（Claude Code/Desktop/Cursor…）。
  if (pathname === '/mcp') {
    if (method === 'POST') return handleMemoryMcp(req, res);
    return sendJson(res, 405, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This is a stateless MCP endpoint; use POST.' },
      id: null,
    }, { ...corsHeaders(), allow: 'POST, OPTIONS' });
  }

  // GET /public/v1/uploads/:file — serve locally-stored avatar image
  if (method === 'GET' && pathname.startsWith('/public/v1/uploads/')) {
    const file = path.basename(decodeURIComponent(pathname.slice('/public/v1/uploads/'.length)));
    const fp = path.join(UPLOADS_DIR, file);
    if (!fp.startsWith(UPLOADS_DIR) || !fs.existsSync(fp)) {
      return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    }
    const ext = path.extname(fp).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : ext === '.pdf' ? 'application/pdf'
      : ext === '.txt' ? 'text/plain'
      : 'image/jpeg';
    const buf = fs.readFileSync(fp);
    res.writeHead(200, {
      ...corsHeaders(),
      'content-type': mime,
      'cache-control': 'public, max-age=86400',
      'content-length': String(buf.length),
    });
    res.end(buf);
    return;
  }

  // Auth
  if (method === 'POST' && pathname === '/v1/auth/signup') {
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const inviteCode = String(body.invite_code || '').trim();
    const locale = body.locale ? String(body.locale).trim().slice(0, 8) : null;

    if (!email || !password || password.length < 6) {
      return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());
    }
    if (store.getUserByEmail(email)) return sendJson(res, 409, { error: 'email_taken' }, corsHeaders());

    // 静态 env 码为"常青码"，无限次数；动态码来自运营台发放（申请内测记录 / 邀请码管理），
    // 限次数/限期，注册成功才消费一次（放在 email/密码校验之后，避免失败请求白白烧掉单次码）。
    // inviteRequired()：开放注册期直接放行；达容量或显式强制后才校验邀请码。
    if (inviteRequired()) {
      const isStaticCode = inviteCode && INVITE_CODES.includes(inviteCode);
      if (!isStaticCode) {
        const redeemed = inviteCode ? store.redeemInviteCode(inviteCode) : { ok: false };
        if (!redeemed.ok) {
          return sendJson(
            res,
            403,
            { error: '需要有效的邀请码才能注册' },
            corsHeaders(),
          );
        }
      }
    }

    const password_hash = hashPassword(password);
    const user = store.createUser({ email, password_hash, locale });
    store.ensurePasswordIdentity(user.id, user.email);

    // 发验证信但不拦:注册照旧直接登录,额外异步发一封邮箱验证(失败不影响注册)。
    try {
      const { token: verifyToken } = store.createEmailToken({
        user_id: user.id, kind: 'verify', email: user.email, ttlMs: 24 * 3600 * 1000,
      });
      EmailService.sendVerifyEmail(user, verifyToken, { funnelLocale: locale })
        .catch((e) => console.warn('[email] verify send failed:', e?.message));
    } catch (e) {
      console.warn('[email] verify token/send skipped:', e?.message);
    }

    const token = signJwt({ sub: user.id }, JWT_SECRET_FINAL);
    return sendJson(res, 200, { token, user: sanitizeUser(user) }, corsHeaders());
  }

  // 注册模式配置（公开，无需鉴权）：前端据此决定是否显示/要求邀请码，并展示限量名额。
  // limited/capacity/used/remaining 仅在 cloud 且设置了容量时有意义；平行人生预约邮箱按去重计入 used。
  if (method === 'GET' && pathname === '/public/v1/auth/config') {
    const limited = isCloud() && OPEN_REG_MAX_USERS > 0;
    const used = limited ? store.registrationStats().consumed : null;
    const remaining = limited ? Math.max(0, OPEN_REG_MAX_USERS - used) : null;
    return sendJson(res, 200, {
      invite_required: inviteRequired(),
      limited,
      capacity: limited ? OPEN_REG_MAX_USERS : null,
      used,
      remaining,
    }, corsHeaders());
  }

  // 访问埋点（公开，无需鉴权）：web 前端各页 + 平行人生专题页上报一次页面浏览。
  // 仅存 channel/page/匿名 visitor_id，不落入 CORS 白名单来源之外的调用（沿用统一 corsHeaders）。
  // Cloud edition only — 自托管 OSS 零遥测（前端 trackPageview 也有同款守卫，双保险）。
  if (method === 'POST' && pathname === '/public/v1/analytics/beacon') {
    if (!isCloud()) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    if (!personaRateAllow(`analytics:${clientIp(req)}`)) {
      return sendJson(res, 429, { error: 'rate_limited' }, corsHeaders());
    }
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const visitor_id = String(body.visitor_id || '').trim();
    if (!visitor_id) return sendJson(res, 400, { error: 'missing_visitor_id' }, corsHeaders());
    const channel = String(body.channel || 'web').trim().toLowerCase();
    const page = String(body.page || '/').trim();
    const referrer = body.referrer ? String(body.referrer).trim() : null;
    const locale = body.locale ? String(body.locale).trim() : null;
    store.addAnalyticsEvent({ channel, page, visitor_id, referrer, locale });
    return sendJson(res, 200, { ok: true }, corsHeaders());
  }

  // 内测候补名单（公开，无需鉴权）：留邮箱排队，发码靠人工/脚本读取 store.waitlist。
  // Cloud edition only — self-hosted OSS has no waitlist funnel.
  if (method === 'POST' && pathname === '/v1/waitlist') {
    if (!isCloud()) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'invalid_email' }, corsHeaders());
    }
    if (store.getWaitlistByEmail(email)) {
      return sendJson(res, 409, { error: 'already_on_waitlist' }, corsHeaders());
    }
    const name = body.name ? String(body.name).trim().slice(0, 120) : null;
    const reason = body.reason ? String(body.reason).trim().slice(0, 500) : null;
    const locale = body.locale ? String(body.locale).trim().slice(0, 8) : null;
    store.createWaitlistEntry({ email, name, reason, locale });
    EmailService.sendWaitlistConfirm({ email, name, locale }).catch((e) => console.warn('[email] waitlist-confirm failed:', e?.message));
    return sendJson(res, 200, { ok: true }, corsHeaders());
  }

  // 平行人生存档桥接（/public/v1/sim/pack、/v1/sim/pending、/v1/sim/claim/:id）
  // 已迁入 cloud 模块（src/cloud/routes/sim-bridge.mjs）：营销漏斗，自托管 OSS 无此功能。

  if (method === 'POST' && pathname === '/v1/auth/login') {
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = store.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) return sendJson(res, 401, { error: 'bad_credentials' }, corsHeaders());
    const token = signJwt({ sub: user.id }, JWT_SECRET_FINAL);
    return sendJson(res, 200, { token, user: sanitizeUser(user) }, corsHeaders());
  }

  // POST /v1/auth/google — verify a Google ID token (GIS on web / google-signin on
  // mobile), then resolve/link/create the user. Same {token, user} shape as login.
  if (method === 'POST' && pathname === '/v1/auth/google') {
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const idToken = String(body.id_token || body.credential || '').trim();
    if (!idToken) return sendJson(res, 400, { error: 'missing_id_token' }, corsHeaders());
    let verified;
    try {
      verified = await verifyGoogleIdToken(idToken);
    } catch (e) {
      if (e.code === 'provider_not_configured') return sendJson(res, 503, { error: 'google_not_configured' }, corsHeaders());
      return sendJson(res, 401, { error: 'invalid_token' }, corsHeaders());
    }
    verified.locale = body.locale ? String(body.locale).trim().slice(0, 8) : null;
    return sendSocialSession(res, verified, body);
  }

  // POST /v1/auth/apple — verify an Apple identity token (Sign in with Apple JS on
  // web / expo-apple-authentication on iOS). Apple sends the name only to the
  // client on first auth, so accept it in the body and use it at create time.
  if (method === 'POST' && pathname === '/v1/auth/apple') {
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const idToken = String(body.id_token || body.identity_token || '').trim();
    if (!idToken) return sendJson(res, 400, { error: 'missing_id_token' }, corsHeaders());
    let verified;
    try {
      verified = await verifyAppleIdToken(idToken);
    } catch (e) {
      if (e.code === 'provider_not_configured') return sendJson(res, 503, { error: 'apple_not_configured' }, corsHeaders());
      return sendJson(res, 401, { error: 'invalid_token' }, corsHeaders());
    }
    const fullName = body.full_name || body.name;
    if (fullName && !verified.name) verified.name = String(fullName).trim().slice(0, 120) || null;
    verified.locale = body.locale ? String(body.locale).trim().slice(0, 8) : null;
    return sendSocialSession(res, verified, body);
  }

  // POST /v1/auth/forgot-password — 找回密码:恒返 200(不泄露账号存在与否),存在则发重置链接。
  if (method === 'POST' && pathname === '/v1/auth/forgot-password') {
    if (!personaRateAllow(`forgot:${clientIp(req)}`)) return sendJson(res, 429, { error: 'rate_limited' }, corsHeaders());
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const email = String(body.email || '').trim().toLowerCase();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const user = store.getUserByEmail(email);
      if (user) {
        try {
          const { token } = store.createEmailToken({ user_id: user.id, kind: 'reset', email: user.email, ttlMs: 60 * 60 * 1000 });
          EmailService.sendPasswordReset(user, token).catch((e) => console.warn('[email] reset send failed:', e?.message));
        } catch (e) { console.warn('[email] reset token/send skipped:', e?.message); }
      }
    }
    return sendJson(res, 200, { ok: true }, corsHeaders());
  }

  // POST /v1/auth/reset-password — 用邮件里的 token 设新密码;成功即置 email_verified(已证明控信箱)。
  if (method === 'POST' && pathname === '/v1/auth/reset-password') {
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const token = String(body.token || '');
    const next = String(body.new_password || '');
    if (next.length < 6) return sendJson(res, 400, { error: 'weak_password' }, corsHeaders());
    const row = store.consumeEmailToken('reset', token);
    if (row?.error) return sendJson(res, 400, { error: row.error }, corsHeaders());
    const user = store.getUserById(row.user_id);
    if (!user) return sendJson(res, 400, { error: 'invalid_token' }, corsHeaders());
    store.updateUserPassword(user.id, hashPassword(next));
    store.setEmailVerified(user.id, true);
    EmailService.sendPasswordChanged(user).catch((e) => console.warn('[email] pwd-changed send failed:', e?.message));
    return sendJson(res, 200, { ok: true }, corsHeaders());
  }

  // POST /v1/auth/verify-email — 点邮件链接后确认邮箱(注册验证 + 改邮箱验证共用)。
  if (method === 'POST' && pathname === '/v1/auth/verify-email') {
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const token = String(body.token || '');
    const row = store.consumeEmailToken('verify', token);
    if (row?.error) return sendJson(res, 400, { error: row.error }, corsHeaders());
    const user = store.getUserById(row.user_id);
    if (!user) return sendJson(res, 400, { error: 'invalid_token' }, corsHeaders());
    store.setEmailVerified(user.id, true);
    return sendJson(res, 200, { ok: true, email: user.email }, corsHeaders());
  }

  // POST /v1/auth/resend-verification — 登录态重发验证信(已验证则直接 ok)。
  if (method === 'POST' && pathname === '/v1/auth/resend-verification') {
    const user = requireUser(req, res);
    if (!user) return;
    if (user.email_verified) return sendJson(res, 200, { ok: true, already_verified: true }, corsHeaders());
    if (!personaRateAllow(`resend-verify:${user.id}`)) return sendJson(res, 429, { error: 'rate_limited' }, corsHeaders());
    try {
      const { token } = store.createEmailToken({ user_id: user.id, kind: 'verify', email: user.email, ttlMs: 24 * 3600 * 1000 });
      EmailService.sendVerifyEmail(user, token).catch((e) => console.warn('[email] verify resend failed:', e?.message));
    } catch (e) { console.warn('[email] verify resend skipped:', e?.message); }
    return sendJson(res, 200, { ok: true }, corsHeaders());
  }

  // GET/POST /v1/email/unsubscribe?token= — opt out of P1 "updates" emails (RFC 8058 one-click via POST).
  if ((method === 'GET' || method === 'POST') && pathname === '/v1/email/unsubscribe') {
    const userId = EmailService.verifyUnsubscribeToken(u.searchParams.get('token'));
    if (!userId) {
      return method === 'POST'
        ? sendJson(res, 400, { error: 'invalid_token' }, corsHeaders())
        : sendText(res, 400, 'Invalid or expired unsubscribe link.', corsHeaders());
    }
    store.updateEmailPrefs(userId, { updates: false });
    return method === 'POST'
      ? sendJson(res, 200, { ok: true }, corsHeaders())
      : sendText(res, 200, 'You have been unsubscribed from GEDO product update emails.', corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/me') {
    const user = requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, sanitizeUser(user), corsHeaders());
  }

  // GET /v1/me/account — account center overview
  if (method === 'GET' && pathname === '/v1/me/account') {
    const user = requireUser(req, res);
    if (!user) return;
    const status = billing.getBillingStatus(user.id);
    const summary = billing.getEntitlementsSummary(user.id);
    const identities = store.listAuthIdentities(user.id);
    return sendJson(res, 200, {
      user: sanitizeUser(user),
      membership: status,
      usage: summary.usage,
      tier: summary.tier,
      identities: identities.map((i) => ({ provider: i.provider, email: i.email })),
    }, corsHeaders());
  }

  // GET /v1/me/entitlements — tier limits + monthly usage (semi-transparent UI)
  if (method === 'GET' && pathname === '/v1/me/entitlements') {
    const user = requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, billing.getEntitlementsSummary(user.id), corsHeaders());
  }

  // GET /v1/billing/status — JWT-bound subscription snapshot (cloud only)
  if (method === 'GET' && pathname === '/v1/billing/status') {
    if (!isCloud()) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    const user = requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, billing.getBillingStatus(user.id), corsHeaders());
  }

  // POST /v1/billing/stripe/webhook — Stripe event forward from web (cloud only)
  if (method === 'POST' && pathname === '/v1/billing/stripe/webhook') {
    if (!isCloud()) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    const forwardToken = process.env.STRIPE_WEBHOOK_FORWARD_TOKEN;
    if (forwardToken) {
      const auth = String(req.headers.authorization || '');
      if (auth !== `Bearer ${forwardToken}`) {
        return sendJson(res, 401, { error: 'unauthorized' }, corsHeaders());
      }
    }
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const row = billing.upsertFromStripePayload(body);
    // 交易邮件分发(best-effort,不阻断 webhook 200)。buildPayload 事件带 userId;
    // invoice.* 只带 customerId → 反查。续费回执(invoice.paid 缺 tier/周期)留待 P1。
    try {
      const evt = String(body.stripeEventType || '');
      const user =
        (body.userId && store.getUserById(body.userId)) ||
        (body.customerId && store.getUserByStripeCustomerId(body.customerId)) ||
        null;
      if (user) {
        const idem = body.stripeEventId ? `stripe_${body.stripeEventId}` : undefined;
        const periodEndIso = body.currentPeriodEnd ? new Date(body.currentPeriodEnd * 1000).toISOString() : null;
        if (evt === 'invoice.payment_failed') {
          EmailService.sendPaymentFailed(user, { idempotencyKey: idem }).catch((e) => console.warn('[email] payment-failed send failed:', e?.message));
        } else if (evt === 'customer.subscription.deleted') {
          EmailService.sendSubscriptionCanceled(user, { endDate: periodEndIso }, { idempotencyKey: idem }).catch((e) => console.warn('[email] sub-canceled send failed:', e?.message));
        } else if (evt === 'checkout.session.completed' && (row?.status === 'active' || row?.status === 'trialing')) {
          EmailService.sendSubscriptionReceipt(user, { tier: row.tier, interval: row.interval, periodEnd: periodEndIso }, { idempotencyKey: idem }).catch((e) => console.warn('[email] receipt send failed:', e?.message));
        }
      }
    } catch (e) { console.warn('[email] billing dispatch skipped:', e?.message); }
    return sendJson(res, 200, { ok: true, billing: row }, corsHeaders());
  }

  // POST /v1/billing/revenuecat/webhook — RC 跨渠道 entitlement 事件(cloud only)
  // RC 后台 Webhook 的 Authorization header 需填 `Bearer ${REVENUECAT_WEBHOOK_TOKEN}`。
  if (method === 'POST' && pathname === '/v1/billing/revenuecat/webhook') {
    if (!isCloud()) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    const rcToken = process.env.REVENUECAT_WEBHOOK_TOKEN;
    if (rcToken) {
      const auth = String(req.headers.authorization || '');
      if (auth !== `Bearer ${rcToken}` && auth !== rcToken) {
        return sendJson(res, 401, { error: 'unauthorized' }, corsHeaders());
      }
    }
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const event = body.event || {};
    const row = billing.upsertFromRevenueCatEvent(event);
    // 交易邮件(best-effort;语义对齐 Stripe 路由:购买→回执、扣款失败→提醒、
    // 关自动续订→取消确认;EXPIRATION 不再发信,取消时已告知)。
    try {
      const type = String(event.type || '').toUpperCase();
      const user = event.app_user_id ? store.getUserById(event.app_user_id) : null;
      if (user && row) {
        const idem = event.id ? `rc_${event.id}` : undefined;
        const periodEndIso = row.current_period_end ? new Date(row.current_period_end * 1000).toISOString() : null;
        if (type === 'INITIAL_PURCHASE') {
          EmailService.sendSubscriptionReceipt(user, { tier: row.tier, interval: row.interval, periodEnd: periodEndIso }, { idempotencyKey: idem }).catch((e) => console.warn('[email] rc receipt send failed:', e?.message));
        } else if (type === 'BILLING_ISSUE') {
          EmailService.sendPaymentFailed(user, { idempotencyKey: idem }).catch((e) => console.warn('[email] rc payment-failed send failed:', e?.message));
        } else if (type === 'CANCELLATION') {
          EmailService.sendSubscriptionCanceled(user, { endDate: periodEndIso }, { idempotencyKey: idem }).catch((e) => console.warn('[email] rc sub-canceled send failed:', e?.message));
        }
      }
    } catch (e) { console.warn('[email] rc billing dispatch skipped:', e?.message); }
    return sendJson(res, 200, { ok: true, billing: row }, corsHeaders());
  }

  // GET /v1/me/auth-identities — the signed-in user's sign-in methods. The password
  // row is listed only when a real password is set, so a social-only account doesn't
  // show a phantom "email & password" method it can't actually use.
  if (method === 'GET' && pathname === '/v1/me/auth-identities') {
    const user = requireUser(req, res);
    if (!user) return;
    if (user.password_hash) store.ensurePasswordIdentity(user.id, user.email);
    return sendAuthIdentities(res, user.id);
  }

  // POST /v1/me/auth-identities/google — link a Google identity to the signed-in
  // user (no new session). 409 if that Google account is already tied to someone else.
  if (method === 'POST' && pathname === '/v1/me/auth-identities/google') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const idToken = String(body.id_token || body.credential || '').trim();
    if (!idToken) return sendJson(res, 400, { error: 'missing_id_token' }, corsHeaders());
    let verified;
    try {
      verified = await verifyGoogleIdToken(idToken);
    } catch (e) {
      if (e.code === 'provider_not_configured') return sendJson(res, 503, { error: 'google_not_configured' }, corsHeaders());
      return sendJson(res, 401, { error: 'invalid_token' }, corsHeaders());
    }
    return linkIdentity(res, user, verified);
  }

  // POST /v1/me/auth-identities/apple — link an Apple identity to the signed-in user.
  if (method === 'POST' && pathname === '/v1/me/auth-identities/apple') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const idToken = String(body.id_token || body.identity_token || '').trim();
    if (!idToken) return sendJson(res, 400, { error: 'missing_id_token' }, corsHeaders());
    let verified;
    try {
      verified = await verifyAppleIdToken(idToken);
    } catch (e) {
      if (e.code === 'provider_not_configured') return sendJson(res, 503, { error: 'apple_not_configured' }, corsHeaders());
      return sendJson(res, 401, { error: 'invalid_token' }, corsHeaders());
    }
    return linkIdentity(res, user, verified);
  }

  // DELETE /v1/me/auth-identities/:id — unlink a social provider. Guarded so the
  // account never loses its last usable sign-in method; the password method is
  // managed via change-password, not removed here.
  if (method === 'DELETE' && pathname.startsWith('/v1/me/auth-identities/')) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = decodeURIComponent(pathname.slice('/v1/me/auth-identities/'.length));
    if (!id) return sendJson(res, 400, { error: 'missing_id' }, corsHeaders());
    const identities = store.listAuthIdentities(user.id);
    const guard = canUnlinkIdentity({ identities, targetId: id, hasPassword: !!user.password_hash });
    if (!guard.ok) {
      return sendJson(res, guard.error === 'not_found' ? 404 : 400, { error: guard.error }, corsHeaders());
    }
    store.deleteAuthIdentity(user.id, id);
    return sendAuthIdentities(res, user.id);
  }

  // POST /v1/me/password — 修改密码（需当前密码校验）
  if (method === 'POST' && pathname === '/v1/me/password') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const current = String(body.current_password || '');
    const next = String(body.new_password || '');
    if (!verifyPassword(current, user.password_hash)) return sendJson(res, 401, { error: 'bad_credentials' }, corsHeaders());
    if (next.length < 6) return sendJson(res, 400, { error: 'weak_password' }, corsHeaders());
    if (verifyPassword(next, user.password_hash)) return sendJson(res, 400, { error: 'same_password' }, corsHeaders());
    store.updateUserPassword(user.id, hashPassword(next));
    EmailService.sendPasswordChanged(user).catch((e) => console.warn('[email] pwd-changed send failed:', e?.message));
    return sendJson(res, 200, { ok: true }, corsHeaders());
  }

  // POST /v1/me/email — 更改账号邮箱（需密码校验 + 邮箱唯一）
  if (method === 'POST' && pathname === '/v1/me/email') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const password = String(body.password || '');
    const newEmail = String(body.new_email || '').trim().toLowerCase();
    if (!verifyPassword(password, user.password_hash)) return sendJson(res, 401, { error: 'bad_credentials' }, corsHeaders());
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return sendJson(res, 400, { error: 'invalid_email' }, corsHeaders());
    if (newEmail === String(user.email || '').toLowerCase()) return sendJson(res, 400, { error: 'same_email' }, corsHeaders());
    const existing = store.getUserByEmail(newEmail);
    if (existing && existing.id !== user.id) return sendJson(res, 409, { error: 'email_taken' }, corsHeaders());
    const oldEmail = String(user.email || '').toLowerCase();
    const updated = store.updateUserEmail(user.id, newEmail);
    store.setEmailVerified(user.id, false);
    // 改邮箱即时生效(发信不拦):安全告警发旧址 + 验证链接发新址。
    EmailService.sendEmailChangedAlert(updated, oldEmail, newEmail).catch((e) => console.warn('[email] email-changed alert failed:', e?.message));
    try {
      const { token } = store.createEmailToken({ user_id: user.id, kind: 'verify', email: newEmail, ttlMs: 24 * 3600 * 1000 });
      EmailService.sendVerifyNewEmail(updated, newEmail, token).catch((e) => console.warn('[email] verify-new send failed:', e?.message));
    } catch (e) { console.warn('[email] verify-new token/send skipped:', e?.message); }
    return sendJson(res, 200, sanitizeUser(updated), corsHeaders());
  }

  // POST /v1/me/profile — 编辑显示名 + 可选移除头像（上传新头像走 /v1/me/avatar）
  if (method === 'POST' && pathname === '/v1/me/profile') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const patch = {};
    if (body.display_name !== undefined) patch.display_name = String(body.display_name ?? '').trim().slice(0, 40) || null;
    if (body.remove_avatar === true) patch.avatar_url = null;
    const updated = store.updateUserProfile(user.id, patch);
    return sendJson(res, 200, sanitizeUser(updated), corsHeaders());
  }

  // POST /v1/me/avatar — 账号头像上传（原始二进制，mirrors /v1/me/digital-persona/avatar）
  if (method === 'POST' && pathname === '/v1/me/avatar') {
    const user = requireUser(req, res);
    if (!user) return;
    let buf;
    try {
      buf = await readBodyBuffer(req, { limit: 4 * 1024 * 1024 }); // ≤4 MB
    } catch {
      return sendJson(res, 413, { error: 'payload_too_large' }, corsHeaders());
    }
    if (!buf || buf.length === 0) return sendJson(res, 400, { error: 'empty_upload' }, corsHeaders());
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    const ext = ct.includes('png') ? '.png'
      : ct.includes('webp') ? '.webp'
      : ct.includes('gif') ? '.gif'
      : '.jpg';
    ensureUploadsDir();
    const fname = `me_${user.id.slice(0, 8)}_${Date.now()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fname), buf);
    const avatar_url = `/public/v1/uploads/${fname}`;
    const updated = store.updateUserProfile(user.id, { avatar_url });
    return sendJson(res, 200, sanitizeUser(updated), corsHeaders());
  }

  // GET /v1/me/flags — return feature flags for current user (short-cached by client)
  if (method === 'GET' && pathname === '/v1/me/flags') {
    const user = requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, getAllFlags(user.id), corsHeaders());
  }

  // P3-C: GET /v1/me/persona — return available persona modes + current mode
  if (method === 'GET' && pathname === '/v1/me/persona') {
    const user = requireUser(req, res);
    if (!user) return;
    const { PERSONA_MODE_LABELS, PERSONA_MODE_OPTIN, resolvePersonaMode } = await import('./services/avatar.service.mjs');
    const storedMode = store.getUserPersonaMode?.(user.id) || 'FOR';
    const activeMode = resolvePersonaMode(storedMode);
    return sendJson(res, 200, {
      active_mode: activeMode,
      available_modes: PERSONA_MODE_LABELS,
      optin_required: PERSONA_MODE_OPTIN,
      feature_enabled: process.env.FEATURE_PERSONA_AS_MODE === 'true',
    }, corsHeaders());
  }

  // P3-C: PUT /v1/me/persona — update persona mode (AS/ABOUT require explicit opt-in)
  if (method === 'PUT' && pathname === '/v1/me/persona') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const { resolvePersonaMode } = await import('./services/avatar.service.mjs');
    const requested = String(body?.mode || 'FOR').toUpperCase();
    const resolved  = resolvePersonaMode(requested);
    store.setUserPersonaMode?.(user.id, resolved);
    return sendJson(res, 200, { active_mode: resolved }, corsHeaders());
  }

  // ── Digital Persona owner-side management (对外数字人配置) ───────────────
  // GET  /v1/me/digital-persona            → read config (+ public link if published)
  // PUT  /v1/me/digital-persona            → update editable fields
  // POST /v1/me/digital-persona/publish    → publish + mint slug
  // POST /v1/me/digital-persona/unpublish  → revoke public link
  // POST /v1/me/digital-persona/avatar     → octet-stream photo upload
  if (method === 'GET' && pathname === '/v1/me/digital-persona') {
    const user = requireUser(req, res);
    if (!user) return;
    const persona = store.getDigitalPersonaByUser(user.id);
    return sendJson(res, 200, persona, corsHeaders());
  }

  if (method === 'PUT' && pathname === '/v1/me/digital-persona') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const persona = store.upsertDigitalPersona(user.id, body);
    return sendJson(res, 200, persona, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/me/digital-persona/publish') {
    const user = requireUser(req, res);
    if (!user) return;
    const gate = billing.checkEntitlement(user.id, 'persona_publish');
    if (gate) return sendJson(res, 402, gate, corsHeaders());
    // Ensure a row exists before publishing (lazy-create).
    store.getDigitalPersonaByUser(user.id);
    const persona = store.setPersonaPublished(user.id, true);
    return sendJson(res, 200, persona, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/me/digital-persona/unpublish') {
    const user = requireUser(req, res);
    if (!user) return;
    const persona = store.setPersonaPublished(user.id, false);
    return sendJson(res, 200, persona, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/me/digital-persona/avatar') {
    const user = requireUser(req, res);
    if (!user) return;
    let buf;
    try {
      buf = await readBodyBuffer(req, { limit: 8 * 1024 * 1024 }); // ≤8 MB
    } catch {
      return sendJson(res, 413, { error: 'payload_too_large' }, corsHeaders());
    }
    if (!buf || buf.length === 0) return sendJson(res, 400, { error: 'empty_upload' }, corsHeaders());
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    const ext = ct.includes('png') ? '.png'
      : ct.includes('webp') ? '.webp'
      : ct.includes('gif') ? '.gif'
      : '.jpg';
    ensureUploadsDir();
    const fname = `${user.id.slice(0, 8)}_${Date.now()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fname), buf);
    const avatar_url = `/public/v1/uploads/${fname}`;
    const persona = store.upsertDigitalPersona(user.id, { avatar_kind: 'uploaded', avatar_url });
    return sendJson(res, 200, persona, corsHeaders());
  }

  // Chat composer attachment upload — display-only this round (no LLM vision).
  // Same raw-octet-stream + local-disk pattern as the avatar upload above;
  // served back via the same GET /public/v1/uploads/:file route.
  if (method === 'POST' && pathname === '/v1/chat/attachments') {
    const user = requireUser(req, res);
    if (!user) return;
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    const ATTACHMENT_EXT = ct.startsWith('image/png') ? '.png'
      : ct.startsWith('image/webp') ? '.webp'
      : ct.startsWith('image/gif') ? '.gif'
      : ct.startsWith('image/jpeg') || ct.startsWith('image/jpg') ? '.jpg'
      : ct.startsWith('application/pdf') ? '.pdf'
      : ct.startsWith('text/plain') ? '.txt'
      : null;
    if (!ATTACHMENT_EXT) return sendJson(res, 415, { error: 'unsupported_media_type' }, corsHeaders());

    let buf;
    try {
      buf = await readBodyBuffer(req, { limit: 8 * 1024 * 1024 }); // ≤8 MB
    } catch {
      return sendJson(res, 413, { error: 'payload_too_large' }, corsHeaders());
    }
    if (!buf || buf.length === 0) return sendJson(res, 400, { error: 'empty_upload' }, corsHeaders());

    ensureUploadsDir();
    const fname = `chat_${user.id.slice(0, 8)}_${Date.now()}${ATTACHMENT_EXT}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fname), buf);
    // Original filename has no multipart field on a raw-octet-stream upload —
    // the client sends it via this header instead.
    const declaredName = String(req.headers['x-attachment-name'] || '').trim();
    const name = declaredName ? path.basename(decodeURIComponent(declaredName)) : fname;
    return sendJson(res, 200, {
      url: `/public/v1/uploads/${fname}`,
      name,
      mime: ct.split(';')[0].trim(),
      size: buf.length,
    }, corsHeaders());
  }

  // ── Relationships (人际关系图谱) owner-side ─────────────────────────────
  if (method === 'GET' && pathname === '/v1/me/relationships') {
    const user = requireUser(req, res);
    if (!user) return;
    // Lazy one-time seed from PCP relationship_map + key_relationships.
    try {
      const profile = MemoryFileService.getProfile(user.id) || {};
      const fromMap = (profile.semantic_memory?.relationship_map || []);
      const fromKey = (profile.core_identity?.key_relationships || []).map((k) =>
        typeof k === 'string' ? { name: k } : k);
      store.seedRelationshipsFromPcp(user.id, [...fromMap, ...fromKey]);
    } catch { /* non-fatal */ }
    return sendJson(res, 200, { items: store.listRelationships(user.id) }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/me/relationships') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const rel = store.upsertRelationship(user.id, body);
    return sendJson(res, 200, rel, corsHeaders());
  }

  const relMatch = /^\/v1\/me\/relationships\/([^/]+)$/.exec(pathname);
  if (relMatch && (method === 'PUT' || method === 'DELETE')) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = relMatch[1];
    if (method === 'DELETE') {
      const ok = store.deleteRelationship(user.id, id);
      return sendJson(res, ok ? 200 : 404, { ok }, corsHeaders());
    }
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const rel = store.upsertRelationship(user.id, { ...body, id });
    return sendJson(res, 200, rel, corsHeaders());
  }

  const relInviteMatch = /^\/v1\/me\/relationships\/([^/]+)\/invite$/.exec(pathname);
  if (method === 'POST' && relInviteMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const rel = store.generateInviteToken(user.id, relInviteMatch[1]);
    if (!rel) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    return sendJson(res, 200, rel, corsHeaders());
  }

  // ── Entities (图鉴：与用户有关的人/物/地/事实体卡) owner-side ────────────
  // Person cards subsume the legacy relationships collection (same ids);
  // /v1/me/relationships above stays as the compat alias for mobile/studio.
  if (method === 'GET' && pathname === '/v1/me/entities') {
    const user = requireUser(req, res);
    if (!user) return;
    // Same lazy PCP seed as the relationships alias so first-open of the
    // codex shows the people the profile already knows about.
    try {
      const profile = MemoryFileService.getProfile(user.id) || {};
      const fromMap = (profile.semantic_memory?.relationship_map || []);
      const fromKey = (profile.core_identity?.key_relationships || []).map((k) =>
        typeof k === 'string' ? { name: k } : k);
      store.seedRelationshipsFromPcp(user.id, [...fromMap, ...fromKey]);
    } catch { /* non-fatal */ }
    const type = u.searchParams.get('type') || undefined;
    return sendJson(res, 200, { items: store.listEntities(user.id, { type }) }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/me/entities') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const created = store.upsertEntity(user.id, body);
    EntitySummary.markDirty(user.id, created.id);
    return sendJson(res, 200, created, corsHeaders());
  }

  const entityMatch = /^\/v1\/me\/entities\/([^/]+)$/.exec(pathname);
  if (entityMatch && (method === 'PUT' || method === 'DELETE')) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = entityMatch[1];
    if (method === 'DELETE') {
      const ok = store.deleteEntity(user.id, id);
      return sendJson(res, ok ? 200 : 404, { ok }, corsHeaders());
    }
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const updated = store.upsertEntity(user.id, { ...body, id });
    EntitySummary.markDirty(user.id, id);
    return sendJson(res, 200, updated, corsHeaders());
  }

  // ── 实体合并（IA v2 批次3：两张「妈妈」卡问题）─────────────────────────
  // POST /v1/me/entities/:id/merge { target_id } — :id 卡并入 target 卡：
  // facts 缺键补齐/aliases+维度并集/互动数相加，episodes 回链改写，删源卡。
  const entityMergeMatch = /^\/v1\/me\/entities\/([^/]+)\/merge$/.exec(pathname);
  if (method === 'POST' && entityMergeMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req) || {};
    const sourceId = entityMergeMatch[1];
    const targetId = String(body.target_id || '');
    if (!targetId || targetId === sourceId) return sendJson(res, 400, { error: 'invalid_target' }, corsHeaders());
    if (!store.getEntity(user.id, sourceId) || !store.getEntity(user.id, targetId)) {
      return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    }
    const merged = store.mergeEntities(user.id, sourceId, targetId);
    if (!merged) return sendJson(res, 500, { error: 'merge_failed' }, corsHeaders());
    const relinked = MemoryFileService.replaceEntityIdInEpisodes(user.id, sourceId, targetId);
    EntitySummary.markDirty(user.id, targetId); // 合并改变素材（store 已清 hash）
    return sendJson(res, 200, { entity: merged, relinked_episodes: relinked }, corsHeaders());
  }

  // Invite links only make sense for people (digital-persona visitor flow).
  const entityInviteMatch = /^\/v1\/me\/entities\/([^/]+)\/invite$/.exec(pathname);
  if (method === 'POST' && entityInviteMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const entity = store.getEntity(user.id, entityInviteMatch[1]);
    if (!entity) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    if (entity.entity_type !== 'person') return sendJson(res, 400, { error: 'person_only' }, corsHeaders());
    const withToken = store.generateInviteToken(user.id, entity.id);
    return sendJson(res, 200, withToken, corsHeaders());
  }

  // 手动重新生成卡面 AI 总结（详情面板「重新生成」；同步等待返回更新后实体）。
  const entitySummaryMatch = /^\/v1\/me\/entities\/([^/]+)\/summary$/.exec(pathname);
  if (method === 'POST' && entitySummaryMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const entity = store.getEntity(user.id, entitySummaryMatch[1]);
    if (!entity) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    if (entity.ai_excluded) return sendJson(res, 400, { error: 'ai_excluded' }, corsHeaders());
    const updated = await EntitySummary.generateFor(user.id, entity.id, { force: true });
    if (!updated) return sendJson(res, 503, { error: 'llm_unavailable' }, corsHeaders());
    if (updated.ai_summary_meta?.status === 'failed') {
      return sendJson(res, 502, { error: 'generate_failed', entity: updated }, corsHeaders());
    }
    return sendJson(res, 200, updated, corsHeaders());
  }

  // Fragments referencing this card (codex detail panel).
  const entityEpisodesMatch = /^\/v1\/me\/entities\/([^/]+)\/episodes$/.exec(pathname);
  if (method === 'GET' && entityEpisodesMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = entityEpisodesMatch[1];
    const limit = Math.min(Number(u.searchParams.get('limit')) || 50, 200);
    const items = MemoryFileService.listEpisodes(user.id, { limit: 500, includeExcluded: true })
      .filter((ep) => Array.isArray(ep.entity_ids) && ep.entity_ids.includes(id))
      .slice(0, limit);
    return sendJson(res, 200, { items }, corsHeaders());
  }

  // ── Visitor sessions + review inbox (owner-side) ───────────────────────
  if (method === 'GET' && pathname === '/v1/me/persona/sessions') {
    const user = requireUser(req, res);
    if (!user) return;
    const q = u.searchParams.get('q') || undefined;
    const limit = Math.min(50, Math.max(1, parseInt(u.searchParams.get('limit') || '10', 10) || 10));
    const offset = Math.max(0, parseInt(u.searchParams.get('offset') || '0', 10) || 0);
    const minMessages = Math.max(0, parseInt(u.searchParams.get('min_messages') || '1', 10) || 1);
    const since = u.searchParams.get('since') || undefined;
    const until = u.searchParams.get('until') || undefined;
    return sendJson(res, 200, store.listVisitorSessions(user.id, { q, limit, offset, minMessages, since, until }), corsHeaders());
  }

  // Aggregate insights for the owner activity panel (views / sessions / inbox yield / top questions).
  if (method === 'GET' && pathname === '/v1/me/persona/stats') {
    const user = requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, store.getPersonaStats(user.id), corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/me/inbox') {
    const user = requireUser(req, res);
    if (!user) return;
    const status = u.searchParams.get('status') || undefined;
    return sendJson(res, 200, { items: store.listInbox(user.id, { status }) }, corsHeaders());
  }

  const inboxDecideMatch = /^\/v1\/me\/inbox\/([^/]+)\/decide$/.exec(pathname);
  if (method === 'POST' && inboxDecideMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req) || {};
    const decision = body.decision === 'approved' ? 'approved' : 'rejected';
    const item = store.decideInboxItem(user.id, inboxDecideMatch[1], decision);
    if (!item) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());

    // On approval, materialise into the owner's real tasks/memory with provenance.
    if (decision === 'approved') {
      const tag = item.source_relationship_id ? `from:${item.source_relationship_id}` : 'source:visitor';
      try {
        if (item.kind === 'task') {
          store.createTasks(user.id, [{ title: item.payload?.title || '访客提出的待办' }]);
        } else {
          // memory / reminder → store as a memory item tagged with provenance.
          store.createMemoryItem(user.id, {
            type: item.payload?.type || (item.kind === 'reminder' ? 'date_reminder' : 'important_info'),
            content_raw: item.payload?.content || item.payload?.quote || '',
            tags: [...(item.payload?.tags || []), tag, 'source:visitor'],
            source: 'passive_event',
          });
        }
      } catch (e) {
        console.error('[API] inbox approve materialise error:', e);
      }
    }
    return sendJson(res, 200, item, corsHeaders());
  }

  // ── Proactive captures (对话主动捕获的记忆/待办候选) ─────────────────────
  // GET  /v1/me/captures?status=pending&kind=memory|task → candidate list
  // POST /v1/me/captures/:id/decide { decision: 'approve'|'reject', edits? }
  //      approve memory → persist to memoryItems + episodes; approve task → createTasks
  // POST /v1/me/captures/:id/undo  → revert an auto-saved/confirmed capture
  if (method === 'GET' && pathname === '/v1/me/captures') {
    const user = requireUser(req, res);
    if (!user) return;
    const status = u.searchParams.get('status') || undefined;
    const kind = u.searchParams.get('kind') || undefined;
    const sourceId = u.searchParams.get('source_id') || undefined; // 来源中心：按来源过滤候选
    const limit = Math.min(Number(u.searchParams.get('limit')) || 50, sourceId ? 1000 : 200);
    const items = store.listCaptures(user.id, { status, kind, sourceId, limit })
      .map(c => ConversationService.captureToCandidate(c));
    return sendJson(res, 200, { items }, corsHeaders());
  }

  const captureDecideMatch = /^\/v1\/me\/captures\/([^/]+)\/decide$/.exec(pathname);
  if (method === 'POST' && captureDecideMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req) || {};
    const capture = store.getCapture(user.id, captureDecideMatch[1]);
    if (!capture) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    if (capture.status !== 'pending') return sendJson(res, 409, { error: 'already_decided' }, corsHeaders());

    const decision = body.decision === 'approve' ? 'approve' : 'reject';
    if (decision === 'reject') {
      const updated = store.updateCapture(user.id, capture.id, { status: 'rejected', decided_at: new Date().toISOString() });
      return sendJson(res, 200, ConversationService.captureToCandidate(updated), corsHeaders());
    }

    // memory 类过记忆条数配额（对齐 decide-batch 口径；warn 模式只记不拦）——
    // 此前单条路由漏了这道门，自动收下依赖它兜底。
    if (!capture.kind || capture.kind === 'memory') {
      const gate = billing.checkEntitlement(user.id, 'memory');
      if (gate && process.env.ENTITLEMENT_MODE !== 'warn') {
        return sendJson(res, 402, { error: 'quota_exceeded', quota: gate }, corsHeaders());
      }
    }

    // Approve — 套编辑 + materialise（与 decide-batch 共用 approveCaptureWithEdits）。
    let patch;
    try {
      patch = approveCaptureWithEdits(user, capture, body.edits);
    } catch (e) {
      console.error('[API] capture approve materialise error:', e);
      return sendJson(res, 500, { error: 'materialise_failed', detail: e.message }, corsHeaders());
    }
    const updated = store.updateCapture(user.id, capture.id, patch);
    return sendJson(res, 200, ConversationService.captureToCandidate(updated), corsHeaders());
  }

  // ── 来源中心：候选批量确认（Review 界面一次接受/拒绝多条）─────────────────
  // POST /v1/me/captures/decide-batch { decisions: [{ id, decision, edits? }] }
  // memory 类逐条过记忆条数配额（ENTITLEMENT_MODE=warn 只记不拦，对齐 recordUsage 语义）；
  // 部分失败语义：quota_exceeded / materialise_failed 落 failed[]，其余继续。
  if (method === 'POST' && pathname === '/v1/me/captures/decide-batch') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req) || {};
    const decisions = Array.isArray(body.decisions) ? body.decisions.slice(0, 200) : [];
    if (!decisions.length) return sendJson(res, 400, { error: 'no_decisions' }, corsHeaders());
    const result = processCaptureDecisions(user, decisions);
    return sendJson(res, 200, result, corsHeaders());
  }

  const captureUndoMatch = /^\/v1\/me\/captures\/([^/]+)\/undo$/.exec(pathname);
  if (method === 'POST' && captureUndoMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const capture = store.getCapture(user.id, captureUndoMatch[1]);
    if (!capture) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    if (capture.status !== 'saved' && capture.status !== 'confirmed') {
      return sendJson(res, 409, { error: 'not_undoable' }, corsHeaders());
    }
    try {
      undoCaptureMaterialised(user, capture);
    } catch (e) {
      console.error('[API] capture undo error:', e);
    }
    const updated = store.updateCapture(user.id, capture.id, { status: 'undone', decided_at: new Date().toISOString() });
    return sendJson(res, 200, ConversationService.captureToCandidate(updated), corsHeaders());
  }

  // ── 批量撤销（IA v2：自动收下/大导入误收的后悔药）────────────────────────
  // POST /v1/me/captures/undo-batch { ids?: string[], source_id?, since?, until?, limit? }
  // 按显式 ids 或「来源 + decided_at 时间窗」筛选已收下（saved/confirmed）的
  // captures 逐条还原；部分失败语义与 decide-batch 一致。
  if (method === 'POST' && pathname === '/v1/me/captures/undo-batch') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req) || {};
    const result = undoCapturesBatch(user, {
      ids: body.ids, sourceId: body.source_id,
      since: body.since, until: body.until, limit: body.limit,
    });
    if (result.error === 'no_selector') {
      return sendJson(res, 400, { error: 'no_selector', detail: 'pass ids[] or source_id/since/until' }, corsHeaders());
    }
    return sendJson(res, 200, result, corsHeaders());
  }

  // ── 统一收件箱（IA v2 批次0）───────────────────────────────────────────
  // GET /v1/memory/inbox?limit=200 → { counts, items }
  // 三个确认队列聚合为一处：来源导入候选 + 聊天新发现（同为 captures）+ 画像
  // 变更（profile conflicts，id 前缀 conflict_）。计数为服务端全量口径。
  if (method === 'GET' && pathname === '/v1/memory/inbox') {
    const user = requireUser(req, res);
    if (!user) return;
    const itemsLimit = Math.min(Number(u.searchParams.get('limit')) || 200, 1000);
    const snapshot = buildInboxSnapshot(user, { itemsLimit });
    return sendJson(res, 200, snapshot, corsHeaders());
  }

  // POST /v1/memory/inbox/decide-batch { decisions: [{ id, decision, edits? }] }
  // id 可为 capture id 或 conflict_<id>；capture 走 processCaptureDecisions
  // （含配额门），conflict approve=采用新值写画像、reject=保留原值。
  if (method === 'POST' && pathname === '/v1/memory/inbox/decide-batch') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req) || {};
    const decisions = Array.isArray(body.decisions) ? body.decisions.slice(0, 200) : [];
    if (!decisions.length) return sendJson(res, 400, { error: 'no_decisions' }, corsHeaders());
    const result = decideInboxBatch(user, decisions);
    return sendJson(res, 200, result, corsHeaders());
  }

  // ── User memory control center (逐条记忆控制 + 账号清除) ─────────────────
  // GET    /v1/me/episodes?includeExcluded=true  → owner-visible memory list
  // PATCH  /v1/me/episodes/:id  { ai_excluded }   → toggle AI visibility
  // DELETE /v1/me/episodes/:id                    → hard-delete one memory
  // DELETE /v1/me/account                         → wipe ALL of the user's data
  if (method === 'GET' && pathname === '/v1/me/episodes') {
    const user = requireUser(req, res);
    if (!user) return;
    const includeExcluded = u.searchParams.get('includeExcluded') !== 'false'; // default true for the owner
    const limit = Math.min(Number(u.searchParams.get('limit')) || 200, 1000);
    const dimension = u.searchParams.get('dimension') || undefined; // 生活领域筛选
    const sourceId = u.searchParams.get('source_id') || undefined;  // 来源库：按导入来源过滤
    const origin = u.searchParams.get('origin') || undefined;       // 固定项：chat|manual|import
    const items = MemoryFileService.listEpisodes(user.id, { limit, includeExcluded, dimension, sourceId, origin });
    return sendJson(res, 200, { items }, corsHeaders());
  }

  const epMatch = /^\/v1\/me\/episodes\/([^/]+)$/.exec(pathname);
  if (epMatch && (method === 'PATCH' || method === 'DELETE')) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = epMatch[1];
    if (method === 'DELETE') {
      const ok = MemoryFileService.deleteEpisode(user.id, id);
      return sendJson(res, ok ? 200 : 404, { ok }, corsHeaders());
    }
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const patch = {};
    if ('ai_excluded' in body) patch.ai_excluded = !!body.ai_excluded;       // AI 可见/排除
    if ('impact_score' in body) patch.impact_score = Number(body.impact_score); // 降权/恢复
    if ('confirmed' in body) patch.confirmed = !!body.confirmed;             // 确认
    if (Array.isArray(body.entity_ids)) patch.entity_ids = body.entity_ids;  // 图鉴卡改链
    if (Array.isArray(body.dimensions)) patch.dimensions = body.dimensions;  // 维度改归属
    const ep = MemoryFileService.setEpisodeFlag(user.id, id, patch);
    // 改链 = 相关卡的总结素材变了（解链的卡由夜扫指纹失配兜住）
    if (ep && Array.isArray(patch.entity_ids)) {
      for (const eid of patch.entity_ids) EntitySummary.markDirty(user.id, eid);
    }
    return sendJson(res, ep ? 200 : 404, ep || { error: 'not_found' }, corsHeaders());
  }

  if (method === 'DELETE' && pathname === '/v1/me/account') {
    const user = requireUser(req, res);
    if (!user) return;
    // 注销为不可逆操作：要求密码二次确认。
    const body = await readJsonBody(req);
    const password = body && !body.__parse_error ? String(body.password || '') : '';
    if (!verifyPassword(password, user.password_hash)) return sendJson(res, 401, { error: 'bad_credentials' }, corsHeaders());
    // 注销确认信:在 wipe 之前抓取邮件语言(wipe 后 settings 行已删)。
    const deletedEmail = user.email;
    const deletedName = user.display_name || null;
    const settingsRow = store.getSettingsRow(user.id);
    const deletedLang = settingsRow?.language || user.locale || 'en';
    const removed = store.wipeUser(user.id);
    MemoryFileService.wipeUserMemory(user.id);
    EmailService.sendAccountDeleted({ email: deletedEmail, name: deletedName, lang: deletedLang })
      .catch((e) => console.warn('[email] account-deleted send failed:', e?.message));
    return sendJson(res, 200, { ok: true, removed }, corsHeaders());
  }

  // Memory (legacy endpoints kept for backward compatibility)
  if (method === 'POST' && pathname === '/v1/memory/capture') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());

    const type = String(body.type || '');
    const content_raw = String(body.content_raw || '').trim();
    const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
    const source = String(body.source || 'text');
    if (!type || !content_raw) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());

    const content_struct = { summary: content_raw.slice(0, 80) };
    const item = store.createMemoryItem(user.id, { type, content_raw, tags, source, content_struct });

    // Write to the new episodic memory layer
    try {
      MemoryFileService.addEpisode(user.id, {
        type,
        contentRaw: content_raw,
        tags,
        source,
        contentStruct: content_struct,
        reminderDate: body.reminder_date || null,
        dimensions: Array.isArray(body.dimensions) && body.dimensions.length
          ? body.dimensions
          : classifyDimensions(content_raw, tags),
      });
    } catch (e) {
      console.error('[API] addEpisode error:', e);
    }

    return sendJson(res, 200, item, corsHeaders());
  }

  // Patch a single legacy memory item (inline edit on a chat capture_memory
  // tool-result card — content/tags/type only, mirrors the PATCH /v1/tasks/:id
  // whitelist convention).
  const memoryItemMatch = /^\/v1\/memory\/([^/]+)$/.exec(pathname);
  if (method === 'PATCH' && memoryItemMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());

    const patch = {};
    if (typeof body.content_raw === 'string') patch.content_raw = body.content_raw.trim();
    if (Array.isArray(body.tags)) patch.tags = body.tags.map(String);
    if (typeof body.type === 'string') patch.type = body.type;

    const item = store.updateMemoryItem(user.id, memoryItemMatch[1], patch);
    if (!item) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    return sendJson(res, 200, item, corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/memory/search') {
    const user = requireUser(req, res);
    if (!user) return;
    const q = u.searchParams.get('q') || '';
    const items = store.searchMemory(user.id, q);
    return sendJson(res, 200, { items }, corsHeaders());
  }

  // =============================================
  // Memory System v2 (Four-Layer Architecture)
  // =============================================

  // Get memory profile (L1 Core Identity + L2 Semantic Memory)
  if (method === 'GET' && pathname === '/v1/memory/profile') {
    const user = requireUser(req, res);
    if (!user) return;
    const profile = MemoryFileService.getProfile(user.id);
    return sendJson(res, 200, profile, corsHeaders());
  }

  // Update memory profile
  if (method === 'PUT' && pathname === '/v1/memory/profile') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    try {
      const profile = MemoryFileService.updateProfile(user.id, body);
      return sendJson(res, 200, profile, corsHeaders());
    } catch (e) {
      return sendJson(res, 400, { error: e.message }, corsHeaders());
    }
  }

  // Get working memory (L3)
  if (method === 'GET' && pathname === '/v1/memory/working') {
    const user = requireUser(req, res);
    if (!user) return;
    const wm = MemoryFileService.getWorkingMemory(user.id);
    return sendJson(res, 200, wm, corsHeaders());
  }

  // Update working memory
  if (method === 'PUT' && pathname === '/v1/memory/working') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    try {
      const wm = MemoryFileService.updateWorkingMemory(user.id, body);
      return sendJson(res, 200, wm, corsHeaders());
    } catch (e) {
      return sendJson(res, 400, { error: e.message }, corsHeaders());
    }
  }

  // Add episodic memory (L4)
  if (method === 'POST' && pathname === '/v1/memory/episodes') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const type = String(body.type || '');
    const contentRaw = String(body.content_raw || '').trim();
    if (!type || !contentRaw) return sendJson(res, 400, { error: 'invalid_input: type and content_raw required' }, corsHeaders());
    const memGate = billing.checkEntitlement(user.id, 'memory');
    if (memGate) return sendJson(res, 402, memGate, corsHeaders());
    try {
      const tags = Array.isArray(body.tags) ? body.tags : [];
      const episode = MemoryFileService.addEpisode(user.id, {
        type,
        contentRaw,
        tags,
        source: body.source || 'text',
        contentStruct: body.content_struct || { summary: contentRaw.slice(0, 80) },
        reminderDate: body.reminder_date || null,
        confidence: body.confidence,
        // 维度：用户选了就用（createEpisode 会钳制到标准 8 维）；没选走关键词兜底。
        dimensions: Array.isArray(body.dimensions) && body.dimensions.length
          ? body.dimensions
          : classifyDimensions(contentRaw, tags),
      });
      embedEpisode(user.id, episode).catch(() => {}); // P1: embed-on-write (fire-and-forget)
      return sendJson(res, 200, episode, corsHeaders());
    } catch (e) {
      return sendJson(res, 400, { error: e.message }, corsHeaders());
    }
  }

  // List/search episodic memories
  if (method === 'GET' && pathname === '/v1/memory/episodes') {
    const user = requireUser(req, res);
    if (!user) return;
    const q = u.searchParams.get('q') || '';
    const type = u.searchParams.get('type') || undefined;
    const dimension = u.searchParams.get('dimension') || undefined;
    const sourceId = u.searchParams.get('source_id') || undefined;
    const origin = u.searchParams.get('origin') || undefined;
    const limit = parseInt(u.searchParams.get('limit') || '50');
    let episodes;
    if (q) {
      episodes = MemoryFileService.searchEpisodes(user.id, q, { limit });
      if (dimension) episodes = episodes.filter(ep => Array.isArray(ep.dimensions) && ep.dimensions.includes(dimension));
      if (sourceId) episodes = episodes.filter(ep => ep.source_id === sourceId);
    } else {
      episodes = MemoryFileService.listEpisodes(user.id, { type, limit, dimension, sourceId, origin });
    }
    return sendJson(res, 200, { episodes, total: episodes.length }, corsHeaders());
  }

  // Trigger memory consolidation (supports level: session|nightly|weekly|quarterly)
  if (method === 'POST' && pathname === '/v1/memory/consolidate') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const force = body?.force || false;
    const useLLM = body?.use_llm !== false;
    const level = body?.level || 'nightly';
    const isDeepRefresh = level === 'quarterly' || level === 'full';
    const consolidateGate = billing.checkEntitlement(
      user.id,
      isDeepRefresh ? 'profile_refresh' : 'smart',
      { feature: isDeepRefresh ? 'profile.deep_refresh' : 'memory.light_consolidate' }
    );
    if (consolidateGate) return sendJson(res, 402, consolidateGate, corsHeaders());

    try {
      let result;
      if (useLLM && ENABLE_LLM) {
        result = await consolidate(user.id, { force, level });
      } else {
        result = consolidateRuleBased(user.id);
      }
      billing.recordUsage(user.id, isDeepRefresh ? 'profile.deep_refresh' : 'memory.light_consolidate');
      return sendJson(res, 200, result, corsHeaders());
    } catch (e) {
      console.error('[API] Consolidation error:', e);
      return sendJson(res, 500, { error: 'consolidation_failed', detail: e.message }, corsHeaders());
    }
  }

  // 一键梳理记忆：大模型全量整理历史 + 智能分流（高置信自动入库，冲突/低置信进待确认）。
  if (method === 'POST' && pathname === '/v1/memory/reorganize') {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const result = await consolidateFull(user.id);
      // 生命之花八维评估同步刷新（await 刻意：前端梳理返回后立即 load()，
      // 要拿到新分与解读；LLM 失败不阻断梳理结果本身）
      await computeDimensionAssessment(user.id, { useLLM: true, trigger: 'reorganize' })
        .catch((e) => console.error('[API] reorganize dimension assess error:', e?.message));
      const pending = getPendingConflicts(user.id);
      return sendJson(res, 200, { ...result, pendingConflicts: pending.length }, corsHeaders());
    } catch (e) {
      console.error('[API] reorganize error:', e);
      return sendJson(res, 500, { error: 'reorganize_failed', detail: e.message }, corsHeaders());
    }
  }

  // Memory system stats
  if (method === 'GET' && pathname === '/v1/memory/stats') {
    const user = requireUser(req, res);
    if (!user) return;
    const stats = MemoryFileService.getMemoryStats(user.id);
    return sendJson(res, 200, stats, corsHeaders());
  }

  // ── 关于我首屏聚合（IA v2 批次0）────────────────────────────────────────
  // 一次请求替代画像页 7 并发 + 2 重复：profile/working/stats/state/narrative/
  // identity + 收件箱计数 + 活跃导入来源。narrative 读已存报告、identity 读最新
  // 版本（均不触发 LLM 生成），端点保持轻量可轮询。
  if (method === 'GET' && pathname === '/v1/memory/overview') {
    const user = requireUser(req, res);
    if (!user) return;
    const profile = MemoryFileService.getProfile(user.id);
    const working = MemoryFileService.getWorkingMemory(user.id);
    const stats = MemoryFileService.getMemoryStats(user.id);
    const state = computeState(user.id);
    const narrative = MemoryFileService.getNarrative(user.id, 30);
    const identity = await getIdentity(user.id);
    const dimensions = await getDimensionAssessment(user.id);
    const inbox = buildInboxSnapshot(user, { itemsLimit: 0 }).counts;
    const sourcesActive = SourceStore.listSources(user.id)
      .filter((m) => ['queued', 'fetching', 'parsing', 'extracting'].includes(m.status))
      .map((m) => SourceStore.toPublicSource(m));
    return sendJson(res, 200, {
      profile, working, stats, state, narrative, identity, dimensions,
      inbox, sources_active: sourcesActive,
    }, corsHeaders());
  }

  // Current computed state (State Engine, P2)
  if (method === 'GET' && pathname === '/v1/memory/state/current') {
    const user = requireUser(req, res);
    if (!user) return;
    const state = computeState(user.id);
    return sendJson(res, 200, state, corsHeaders());
  }

  // Dynamic identity model (Identity Engine, P3)
  if (method === 'GET' && pathname === '/v1/memory/identity') {
    const user = requireUser(req, res);
    if (!user) return;
    const identity = await getIdentity(user.id);
    return sendJson(res, 200, identity, corsHeaders());
  }
  if (method === 'GET' && pathname === '/v1/memory/identity/versions') {
    const user = requireUser(req, res);
    if (!user) return;
    const versions = MemoryFileService.getIdentityVersions(user.id, { limit: 50 });
    return sendJson(res, 200, { versions }, corsHeaders());
  }
  if (method === 'POST' && pathname === '/v1/memory/identity/recompute') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const version = await computeIdentity(user.id, { useLLM: body?.use_llm === true, trigger: 'manual' });
    return sendJson(res, 200, version, corsHeaders());
  }

  // 测评/自我认知报告（/v1/memory/assessment* 4 条）已迁入 cloud 模块
  // （src/cloud/routes/assessment.mjs）：cloud edition 专属，OSS 构建下 404。

  // Growth narrative / trajectory (Narrative Engine, P4)
  if (method === 'GET' && pathname === '/v1/memory/narrative') {
    const user = requireUser(req, res);
    if (!user) return;
    const w = parseInt(u.searchParams.get('window') || '30', 10);
    const report = await getNarrative(user.id, w);
    return sendJson(res, 200, report, corsHeaders());
  }
  if (method === 'POST' && pathname === '/v1/memory/narrative/refresh') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const report = await generateNarrative(user.id, parseInt(body?.window || '30', 10), { useLLM: body?.use_llm === true, trigger: 'manual' });
    return sendJson(res, 200, report, corsHeaders());
  }

  // 生命之花八维 AI 评估（Dimension Engine）：读=永远有值（缺则规则生成，不触发 LLM）
  if (method === 'GET' && pathname === '/v1/memory/dimensions') {
    const user = requireUser(req, res);
    if (!user) return;
    const assessment = await getDimensionAssessment(user.id);
    return sendJson(res, 200, assessment, corsHeaders());
  }
  if (method === 'POST' && pathname === '/v1/memory/dimensions/recompute') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const assessment = await computeDimensionAssessment(user.id, { useLLM: body?.use_llm === true, trigger: 'manual' });
    return sendJson(res, 200, assessment, corsHeaders());
  }

  // Memory context preview with intent classification
  if (method === 'GET' && pathname === '/v1/memory/context') {
    const user = requireUser(req, res);
    if (!user) return;
    const q = u.searchParams.get('q') || '';
    const queryEmbedding = q ? await embedText(q) : null;
    const stateText = renderStateContext(computeState(user.id));
    const narrativeText = renderNarrativeContext(MemoryFileService.getNarrative(user.id, 30));
    const ctx = buildMemoryContext(user.id, { query: q || null, maxEpisodes: 5, queryEmbedding, stateText, narrativeText });
    return sendJson(res, 200, ctx, corsHeaders());
  }

  // Intent classification preview
  if (method === 'GET' && pathname === '/v1/memory/intent') {
    const user = requireUser(req, res);
    if (!user) return;
    const q = u.searchParams.get('q') || '';
    const wm = MemoryFileService.getWorkingMemory(user.id);
    const result = classifyIntent(q, { activeGoals: wm.active_goals || [] });
    return sendJson(res, 200, result, corsHeaders());
  }

  // P1-A: GEDO Memory Pack (.gmp) — open, signable, importable.
  // GET  /v1/memory/export.gmp           → ZIP download
  // POST /v1/memory/import               → raw octet-stream upload (≤32 MB)
  // POST /v1/memory/import?dryRun=true   → validate without persisting
  if (method === 'GET' && pathname === '/v1/memory/export.gmp') {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const { buildPack } = await import('./gmp/exporter.mjs');
      const { buffer, filename, manifest, warnings } = await buildPack(user.id, { displayName: user.email });
      res.writeHead(200, {
        ...corsHeaders(),
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${filename}"`,
        'content-length': String(buffer.length),
        'x-gmp-stats': JSON.stringify(manifest.stats),
        ...(warnings.length ? { 'x-gmp-warnings': String(warnings.length) } : {}),
      });
      res.end(buffer);
      return;
    } catch (e) {
      console.error('[gmp] export failed', e);
      return sendJson(res, 500, { error: 'gmp_export_failed', detail: e.message, code: e.code }, corsHeaders());
    }
  }

  // P3-D: GET /v1/lora/dataset — export redacted writing samples as JSONL
  if (method === 'GET' && pathname === '/v1/lora/dataset') {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const { collectDataset, toJSONL } = await import('./persona/dataset.mjs');
      const db = store._db || null;
      if (!db) return sendJson(res, 503, { error: 'db_not_connected' }, corsHeaders());
      const dryRun  = urlObj.searchParams.get('dryRun') === 'true';
      const maxStr  = urlObj.searchParams.get('max');
      const { samples, stats } = await collectDataset(db, user.id, {
        redact:     true,
        maxSamples: maxStr ? Math.min(parseInt(maxStr, 10), 5000) : 2000,
      });
      if (dryRun) return sendJson(res, 200, { stats, sample: samples.slice(0, 3) }, corsHeaders());
      const jsonl  = toJSONL(samples);
      const bytes  = Buffer.from(jsonl, 'utf8');
      res.writeHead(200, {
        ...corsHeaders(),
        'content-type': 'application/x-ndjson',
        'content-disposition': `attachment; filename="lora_dataset_${user.id.slice(0, 8)}.jsonl"`,
        'content-length': String(bytes.length),
        'x-dataset-stats': JSON.stringify(stats),
      });
      res.end(bytes);
      return;
    } catch (e) {
      console.error('[lora] dataset export failed', e);
      return sendJson(res, 500, { error: 'dataset_export_failed', detail: e.message }, corsHeaders());
    }
  }

  if (method === 'POST' && pathname === '/v1/memory/import') {
    const user = requireUser(req, res);
    if (!user) return;
    let body;
    try {
      body = await readBodyBuffer(req);
    } catch (e) {
      if (e.code === 'PAYLOAD_TOO_LARGE') {
        return sendJson(res, 413, { error: 'payload_too_large', limit_bytes: MAX_GMP_BYTES }, corsHeaders());
      }
      return sendJson(res, 400, { error: 'bad_request', detail: e.message }, corsHeaders());
    }
    if (!body || !body.length) {
      return sendJson(res, 400, { error: 'empty_body' }, corsHeaders());
    }
    try {
      const dryRun = u.searchParams.get('dryRun') === 'true';
      const { importPack } = await import('./gmp/importer.mjs');
      const summary = await importPack(user.id, body, { dryRun });
      return sendJson(res, 200, summary, corsHeaders());
    } catch (e) {
      console.error('[gmp] import failed', e);
      const status = e.code === 'GMP_NOT_ZIP' || e.code === 'GMP_BAD_JSON' || e.code === 'GMP_SCHEMA_INVALID' ? 400
                   : e.code === 'GMP_ENCRYPTED' || e.code === 'GMP_VERSION_TOO_NEW' ? 415
                   : 500;
      return sendJson(res, status, {
        error: 'gmp_import_failed',
        code: e.code || 'unknown',
        detail: e.message,
        ...(e.details ? { details: e.details } : {}),
      }, corsHeaders());
    }
  }

  // Conflict management
  if (method === 'GET' && pathname === '/v1/memory/conflicts') {
    const user = requireUser(req, res);
    if (!user) return;
    const conflicts = getPendingConflicts(user.id);
    return sendJson(res, 200, { conflicts }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/memory/conflicts/resolve') {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const result = await resolveAllConflicts(user.id);
      return sendJson(res, 200, result, corsHeaders());
    } catch (e) {
      console.error('[API] Conflict resolution error:', e);
      return sendJson(res, 500, { error: 'conflict_resolution_failed', detail: e.message }, corsHeaders());
    }
  }

  if (method === 'POST' && pathname === '/v1/memory/conflicts/resolve-single') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    try {
      const conflicts = MemoryFileService.getConflicts(user.id);
      const conflict = conflicts.find(c => c.id === body.conflict_id);
      if (!conflict) return sendJson(res, 404, { error: 'conflict_not_found' }, corsHeaders());
      MemoryFileService.resolveConflict(user.id, body.conflict_id, {
        resolution: body.resolution,
        resolved_value: body.resolved_value,
        reasoning: body.reasoning || 'User manual resolution',
      });
      // 用户确认采用新值（或合并）时，真正写入画像；保留原值则不动。
      let applied = false;
      if (body.resolution === 'accept_new' || body.resolution === 'merge') {
        try {
          MemoryFileService.applyConflictResolution(user.id, conflict.field, body.resolved_value ?? conflict.new_value);
          applied = true;
        } catch (e) {
          console.error('[API] applyConflictResolution failed:', e.message);
        }
      }
      return sendJson(res, 200, { success: true, applied }, corsHeaders());
    } catch (e) {
      return sendJson(res, 500, { error: 'resolution_failed', detail: e.message }, corsHeaders());
    }
  }

  // Goal management (L2 Working Memory)
  if (method === 'POST' && pathname === '/v1/memory/goals') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    try {
      const wm = MemoryFileService.updateWorkingMemory(user.id, { add_goal: body });
      return sendJson(res, 200, { goals: wm.active_goals }, corsHeaders());
    } catch (e) {
      return sendJson(res, 500, { error: 'goal_creation_failed', detail: e.message }, corsHeaders());
    }
  }

  if (method === 'PUT' && pathname === '/v1/memory/goals') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    try {
      const wm = MemoryFileService.updateWorkingMemory(user.id, { update_goal: body });
      return sendJson(res, 200, { goals: wm.active_goals }, corsHeaders());
    } catch (e) {
      return sendJson(res, 500, { error: 'goal_update_failed', detail: e.message }, corsHeaders());
    }
  }

  // Consolidation logs
  if (method === 'GET' && pathname === '/v1/memory/consolidation-logs') {
    const user = requireUser(req, res);
    if (!user) return;
    const limit = parseInt(u.searchParams.get('limit') || '20');
    const logs = MemoryFileService.getConsolidationLogs(user.id, { limit });
    return sendJson(res, 200, { logs }, corsHeaders());
  }

  // Migrate legacy memoryItems to new system
  if (method === 'POST' && pathname === '/v1/memory/migrate') {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const result = migrateMemoryItems(user.id);
      return sendJson(res, 200, result, corsHeaders());
    } catch (e) {
      return sendJson(res, 500, { error: 'migration_failed', detail: e.message }, corsHeaders());
    }
  }

  // Planner
  // S0-5: onboarding quest ("人生快照·初始画像") gate + answer ingestion.
  // GET /v1/onboarding/step → { step: 0..7 }
  // POST /v1/onboarding/step
  //   Body: { day: 1..7, answers: { [questionId]: string|string[]|object }, skip?: boolean }
  //   - persists each answer as legacy memoryItem AND episodic memory (double-write),
  //     typed via core-slots and tagged ['identity','onboarding','dayN',questionId,'slot:…']
  //   - immediately backfills profile.json / working.json (see onboarding-profile.mjs)
  //   - bumps users.onboarding_step to max(current, day)
  if (method === 'GET' && pathname === '/v1/onboarding/step') {
    const user = requireUser(req, res);
    if (!user) return;
    const step = store.getOnboardingStep(user.id) ?? 0;
    return sendJson(res, 200, { step }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/onboarding/step') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());

    const day = Number(body.day);
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      return sendJson(res, 400, { error: 'invalid_day' }, corsHeaders());
    }

    if (!body.skip && body.answers && typeof body.answers === 'object') {
      for (const [questionId, value] of Object.entries(body.answers)) {
        if (value == null || value === '') continue;
        // Human-readable text (rating grids / lists are formatted, not JSON.stringify'd)
        const content_raw = formatAnswerText(questionId, value);
        if (!content_raw.trim()) continue;
        const type = episodeTypeForQuestion(questionId);
        const slot = getSlotForQuestion(questionId);
        const tags = ['identity', 'onboarding', `day${day}`, questionId];
        if (slot) tags.push(`slot:${slot.id}`);
        const content_struct = { onboarding_day: day, question_id: questionId };
        try {
          store.createMemoryItem(user.id, {
            type,
            content_raw,
            tags,
            source: 'reflection',
            content_struct,
          });
        } catch (error) {
          console.error('[onboarding] failed to persist answer', { day, questionId, error: error?.message });
        }
        // Double-write to the episodic layer so answers show up in the memory
        // browser (which reads episodes) and in AI retrieval.
        try {
          MemoryFileService.addEpisode(user.id, {
            type,
            contentRaw: content_raw,
            tags,
            source: 'reflection',
            contentStruct: content_struct,
            confidence: 1.0,
            impactScore: 0.9,
            dimensions: classifyDimensions(content_raw, tags),
          });
        } catch (error) {
          console.error('[onboarding] failed to persist episode', { day, questionId, error: error?.message });
        }
      }
      // Immediate L1/L2/L3 backfill — answers become the profile right away
      // instead of waiting for a consolidation pass.
      try {
        applyOnboardingAnswers(user.id, day, body.answers);
      } catch (error) {
        console.error('[onboarding] profile backfill failed', { day, error: error?.message });
      }
    }

    const current = store.getOnboardingStep(user.id) ?? 0;
    const nextStep = Math.max(current, day);
    const persisted = store.setOnboardingStep(user.id, nextStep);
    return sendJson(res, 200, { step: persisted }, corsHeaders());
  }

  // S0-4: manual trigger for the Daily Planner (testing + UI "run now" button).
  // POST /v1/agent/daily-plan/run-now
  // Body: { skipPost?: boolean }  // true = preview only, don't write to chat
  if (method === 'POST' && pathname === '/v1/agent/daily-plan/run-now') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (body && body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const skipPost = Boolean(body?.skipPost);
    try {
      const result = await DailyPlanService.runDailyPlanForUser(user.id, { skipPost });
      return sendJson(res, 200, {
        plan: result.plan,
        source: result.source,
        conversation_id: result.conversationId || null,
        message_id: result.messageId || null,
      }, corsHeaders());
    } catch (error) {
      console.error('[API] daily-plan/run-now error:', error);
      return sendJson(res, 500, { error: 'daily_plan_failed' }, corsHeaders());
    }
  }

  // P14: 手动触发自动化待办扫描（调试/运维用；cron 每日 08:00 自动跑）
  if (method === 'POST' && pathname === '/v1/agent/task-actions/run-now') {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const result = await TaskActionService.runScheduledForAllUsers();
      return sendJson(res, 200, result, corsHeaders());
    } catch (error) {
      console.error('[API] task-actions/run-now error:', error);
      return sendJson(res, 500, { error: 'task_actions_failed' }, corsHeaders());
    }
  }

  if (method === 'POST' && pathname === '/v1/planner/clarify') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());
    const questions = await buildClarifyQuestions(prompt, user.id);
    return sendJson(res, 200, { questions }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/planner/generate') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const prompt = String(body.prompt || '').trim();
    const answers = body.answers || {};
    if (!prompt) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());

    const { goal, tasks: taskDrafts } = await buildPlanTasks(prompt, answers, user.id);
    
    // 创建目标
    const createdGoal = store.createGoal(user.id, {
      title: goal.title,
      description: goal.description,
      life_wheel_dimension: goal.life_wheel_dimension || 'growth',
    });
    
    // 检查生命之花平衡
    let balanceCheck = null;
    if (ENABLE_LLM && goal.life_wheel_dimension) {
      const existingGoals = store.listGoals(user.id);
      balanceCheck = await PlannerService.checkLifeWheelBalance(
        existingGoals,
        goal.life_wheel_dimension
      );
    }
    
    // 创建任务
    const tasks = store.createTasks(user.id, taskDrafts);
    
    return sendJson(res, 200, { goal: createdGoal, tasks, balanceCheck }, corsHeaders());
  }

  // Companion home brief — 智伴首页智能引导（真实数据规则拼装 + 每日 LLM 开场白缓存）
  if (method === 'GET' && pathname === '/v1/companion/brief') {
    const user = requireUser(req, res);
    if (!user) return;
    const lang = u.searchParams.get('lang');
    const brief = CompanionBriefService.getBrief(user, lang);
    return sendJson(res, 200, brief, corsHeaders());
  }

  // ── 三方记忆导入（P6）：上传 → 异步分解 → 轮询进度 ─────────────────────────
  if (method === 'POST' && pathname === '/v1/memory/import/external') {
    const user = requireUser(req, res);
    if (!user) return;
    const format = ['chatgpt', 'claude', 'text'].includes(u.searchParams.get('format'))
      ? u.searchParams.get('format') : 'chatgpt';
    let buf;
    try {
      buf = await readBodyBuffer(req, { limit: MAX_GMP_BYTES });
    } catch (e) {
      if (e.code === 'PAYLOAD_TOO_LARGE') return sendJson(res, 413, { error: 'payload_too_large', limit_bytes: MAX_GMP_BYTES }, corsHeaders());
      return sendJson(res, 400, { error: 'bad_request', detail: e.message }, corsHeaders());
    }
    if (!buf || !buf.length) return sendJson(res, 400, { error: 'empty_body' }, corsHeaders());
    try {
      const { parseUpload, runImportJob, IMPORT_MAX_CONVS } = await import('./services/memory-import.service.mjs');
      const conversations = await parseUpload(buf, format);
      if (!conversations.length) return sendJson(res, 400, { error: 'no_conversations_found' }, corsHeaders());
      const job = store.createImportJob(user.id, {
        source: `import_${format}`,
        convs_total: Math.min(conversations.length, IMPORT_MAX_CONVS),
      });
      // 单实例进程内异步跑；失败落到任务状态，前端轮询可见。
      void runImportJob(user.id, job.id, conversations, `import_${format}`).catch(err => {
        console.error('[memory-import] job failed', err);
        store.updateImportJob(user.id, job.id, { status: 'failed', error: err?.message || String(err) });
      });
      return sendJson(res, 200, { job_id: job.id, convs_total: job.progress.convs_total, convs_found: conversations.length }, corsHeaders());
    } catch (e) {
      const status = e.code === 'NO_CONVERSATIONS_JSON' || e instanceof SyntaxError ? 400 : 500;
      return sendJson(res, status, { error: 'import_parse_failed', detail: e.message }, corsHeaders());
    }
  }

  {
    const importJobMatch = /^\/v1\/memory\/import\/jobs\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && importJobMatch) {
      const user = requireUser(req, res);
      if (!user) return;
      const job = store.getImportJob(user.id, importJobMatch[1]);
      if (!job) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
      return sendJson(res, 200, { id: job.id, status: job.status, source: job.source, progress: job.progress, report: job.report, error: job.error }, corsHeaders());
    }
  }

  // ── 来源中心（记忆导入 v2）：来源 CRUD + 持久队列 + 确认制提取 ──────────────
  // 上面的 /v1/memory/import/external 是旧管线（直接落库，老版本移动端仍在调），
  // 保留不动、视为 deprecated；新客户端一律走 /v1/memory/sources。
  if (method === 'POST' && pathname === '/v1/memory/sources') {
    const user = requireUser(req, res);
    if (!user) return;
    // 配额闸门：来源数/月（ENTITLEMENT_MODE=warn 只记不拦，对齐 recordUsage 语义）
    const gate = billing.checkEntitlement(user.id, 'import_sources');
    if (gate && process.env.ENTITLEMENT_MODE !== 'warn') {
      return sendJson(res, 402, gate, corsHeaders());
    }
    const contentType = String(req.headers['content-type'] || '');
    let fields = null;
    let rawBuffer = null;
    if (contentType.includes('application/json')) {
      const body = await readJsonBody(req);
      if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_request' }, corsHeaders());
      if (body.type === 'url') {
        const url = String(body.url || '').trim();
        if (!/^https?:\/\/\S+$/i.test(url)) return sendJson(res, 400, { error: 'bad_url' }, corsHeaders());
        fields = {
          type: 'url',
          platform: null,
          title: String(body.title || '').trim() || url.replace(/^https?:\/\//i, '').slice(0, 120),
          origin: { url },
        };
      } else {
        const text = String(body.text || '').trim();
        if (!text) return sendJson(res, 400, { error: 'empty_body' }, corsHeaders());
        if (text.length > 200_000) return sendJson(res, 413, { error: 'text_too_long', limit_chars: 200_000 }, corsHeaders());
        fields = {
          type: 'text',
          platform: body.platform || null, // 豆包/DeepSeek 等"指引+粘贴"路径会带平台标
          title: String(body.title || '').trim() || text.slice(0, 40),
          origin: { chars: text.length },
        };
        rawBuffer = Buffer.from(text, 'utf8');
      }
    } else {
      // 文件/导出包（octet-stream）：?type=file|chat_export&platform=… + x-source-name(编码后文件名)
      let buf;
      try {
        buf = await readBodyBuffer(req, { limit: MAX_GMP_BYTES });
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') return sendJson(res, 413, { error: 'payload_too_large', limit_bytes: MAX_GMP_BYTES }, corsHeaders());
        return sendJson(res, 400, { error: 'bad_request', detail: e.message }, corsHeaders());
      }
      if (!buf || !buf.length) return sendJson(res, 400, { error: 'empty_body' }, corsHeaders());
      let filename = String(req.headers['x-source-name'] || '');
      try { filename = decodeURIComponent(filename); } catch { /* 保留原样 */ }
      fields = {
        type: u.searchParams.get('type') === 'chat_export' ? 'chat_export' : 'file',
        platform: u.searchParams.get('platform') || null,
        title: filename.slice(0, 120) || null,
        origin: {
          filename: filename.slice(0, 200) || null,
          mime: contentType.split(';')[0].trim() || null,
          size_bytes: buf.length,
        },
      };
      rawBuffer = buf;
    }
    const source = SourceStore.createSource(user.id, fields, rawBuffer);
    const weight = getEntitlementsForTier(billing.resolveUserTier(user.id)).importQueueWeight || 0;
    const job = enqueueJob({ type: 'source_ingest', user_id: user.id, source_id: source.id, priority: weight });
    const meta = SourceStore.updateSource(user.id, source.id, { job_id: job.id });
    billing.recordUsage(user.id, 'memory.import_source', { force: true }); // 0 积分事件，仅计数来源配额
    return sendJson(res, 200, {
      source: SourceStore.toPublicSource(meta),
      queue_position: getQueuePosition(job.id),
    }, corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/memory/sources') {
    const user = requireUser(req, res);
    if (!user) return;
    const sources = SourceStore.listSources(user.id).map((m) => ({
      ...SourceStore.toPublicSource(m),
      queue_position: m.status === 'queued' && m.job_id ? getQueuePosition(m.job_id) : null,
    }));
    const ent = getEntitlementsForTier(billing.resolveUserTier(user.id));
    const usage = billing.getMonthlyUsage(user.id);
    const limit = ent.importSourcesMonthly >= Number.MAX_SAFE_INTEGER ? null : ent.importSourcesMonthly;
    return sendJson(res, 200, { sources, quota: { used: usage.importSources, limit } }, corsHeaders());
  }

  {
    const sourceMatch = /^\/v1\/memory\/sources\/([^/]+)$/.exec(pathname);
    if (sourceMatch && (method === 'GET' || method === 'DELETE')) {
      const user = requireUser(req, res);
      if (!user) return;
      const sourceId = sourceMatch[1];
      const meta = SourceStore.getSource(user.id, sourceId);
      if (!meta) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
      if (method === 'GET') {
        const pending = store.listCaptures(user.id, { sourceId, status: 'pending', limit: 1000 }).length;
        const total = store.listCaptures(user.id, { sourceId, limit: 1000 }).length;
        return sendJson(res, 200, {
          source: {
            ...SourceStore.toPublicSource(meta),
            queue_position: meta.status === 'queued' && meta.job_id ? getQueuePosition(meta.job_id) : null,
          },
          candidates: { pending, total },
        }, corsHeaders());
      }
      // DELETE：取消任务 + 清未决候选 + 删目录。已确认碎片保留（归用户记忆管理）。
      cancelJobsBySource(user.id, sourceId);
      store.deleteCapturesBySource(user.id, sourceId);
      SourceStore.deleteSource(user.id, sourceId);
      return sendJson(res, 200, { ok: true }, corsHeaders());
    }
  }

  // 来源详情：转化产物（清洗正文 + 分块，均分页）——"解析过程可见"的数据出口
  {
    const srcContentMatch = /^\/v1\/memory\/sources\/([^/]+)\/content$/.exec(pathname);
    if (method === 'GET' && srcContentMatch) {
      const user = requireUser(req, res);
      if (!user) return;
      const meta = SourceStore.getSource(user.id, srcContentMatch[1]);
      if (!meta) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
      const textOffset = Math.max(0, Number(u.searchParams.get('text_offset')) || 0);
      const textLimit = Math.min(50_000, Math.max(0, Number(u.searchParams.get('text_limit') ?? 20_000)) || 20_000);
      const chunksOffset = Math.max(0, Number(u.searchParams.get('chunks_offset')) || 0);
      const chunksLimitRaw = u.searchParams.get('chunks_limit');
      const chunksLimit = chunksLimitRaw === '0' ? 0 : Math.min(100, Math.max(1, Number(chunksLimitRaw) || 30));
      const fullText = SourceStore.readText(user.id, meta.id) || '';
      const chunks = chunksLimit === 0 ? [] : SourceStore.readChunks(user.id, meta.id);
      const chunksTotal = chunksLimit === 0 ? (meta.stats?.chunk_count || 0) : chunks.length;
      return sendJson(res, 200, {
        text: { content: fullText.slice(textOffset, textOffset + textLimit), offset: textOffset, total: fullText.length },
        chunks: {
          items: chunks.slice(chunksOffset, chunksOffset + chunksLimit).map((c) => ({
            i: c.i,
            text: c.text,
            meta: c.meta || {},
            has_embedding: Array.isArray(c.embedding) && c.embedding.length > 0, // 转化"嵌入"环节是否成功（RAG 原始层）
          })),
          offset: chunksOffset,
          total: chunksTotal,
        },
      }, corsHeaders());
    }
  }

  // 来源原始附件下载（raw.bin：上传的文件/导出包/粘贴文本原文；url 来源无 raw → 404）
  {
    const srcRawMatch = /^\/v1\/memory\/sources\/([^/]+)\/raw$/.exec(pathname);
    if (method === 'GET' && srcRawMatch) {
      const user = requireUser(req, res);
      if (!user) return;
      const meta = SourceStore.getSource(user.id, srcRawMatch[1]);
      if (!meta) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
      const buf = SourceStore.readRaw(user.id, meta.id);
      if (!buf || !buf.length) return sendJson(res, 404, { error: 'no_raw' }, corsHeaders());
      const fallbackName = `${String(meta.title || meta.id).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)}${meta.type === 'text' ? '.txt' : ''}`;
      const filename = meta.origin?.filename || fallbackName;
      const mime = meta.origin?.mime || (meta.type === 'text' ? 'text/plain; charset=utf-8' : 'application/octet-stream');
      res.writeHead(200, {
        ...corsHeaders(),
        'content-type': mime,
        'content-length': buf.length,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      });
      return res.end(buf);
    }
  }

  {
    const retryMatch = /^\/v1\/memory\/sources\/([^/]+)\/retry$/.exec(pathname);
    if (method === 'POST' && retryMatch) {
      const user = requireUser(req, res);
      if (!user) return;
      const sourceId = retryMatch[1];
      const meta = SourceStore.getSource(user.id, sourceId);
      if (!meta) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
      if (meta.status !== 'failed' && meta.status !== 'canceled') {
        return sendJson(res, 409, { error: 'not_retryable', status: meta.status }, corsHeaders());
      }
      const weight = getEntitlementsForTier(billing.resolveUserTier(user.id)).importQueueWeight || 0;
      const job = enqueueJob({ type: 'source_ingest', user_id: user.id, source_id: sourceId, priority: weight });
      const updated = SourceStore.updateSource(user.id, sourceId, {
        status: 'queued',
        error: null,
        job_id: job.id,
        progress: { chunks_done: 0, chunks_total: 0, candidates_created: 0, entities_suggested: 0 },
      });
      return sendJson(res, 200, {
        source: SourceStore.toPublicSource(updated),
        queue_position: getQueuePosition(job.id),
      }, corsHeaders());
    }
  }

  // ── 能力开放 E2：PAT（个人访问令牌）管理，供「开发者/接入」设置页 ─────────
  // 明文 token 仅在创建响应回显一次；列表/审计永不含明文或 hash。

  if (method === 'GET' && pathname === '/v1/me/pats') {
    const user = requireUser(req, res);
    if (!user) return;
    const tier = billing.resolveUserTier(user.id);
    return sendJson(res, 200, {
      items: store.listPats(user.id),
      scopes: PAT_SCOPES,
      entitled: !!getEntitlementsForTier(tier).memoryMcpAccess,
      tier,
    }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/me/pats') {
    const user = requireUser(req, res);
    if (!user) return;
    // Pro+ 门禁（与 /mcp 调用侧同一开关；warn 模式只记不拦）
    const tier = billing.resolveUserTier(user.id);
    if (!getEntitlementsForTier(tier).memoryMcpAccess && process.env.ENTITLEMENT_MODE !== 'warn') {
      return sendJson(res, 403, { error: 'quota_exceeded', resource: 'memory_mcp', upgrade_tier: 'pro', current_tier: tier }, corsHeaders());
    }
    const body = await readJsonBody(req) || {};
    const scopes = Array.isArray(body.scopes) ? [...new Set(body.scopes.filter(s => PAT_SCOPES.includes(s)))] : [];
    if (!scopes.length) return sendJson(res, 400, { error: 'invalid_input', detail: 'at_least_one_scope' }, corsHeaders());
    if (store.listPats(user.id).filter(p => !p.revoked_at).length >= 10) {
      return sendJson(res, 400, { error: 'too_many_tokens', detail: 'revoke an existing token first' }, corsHeaders());
    }
    const token = generatePatToken();
    const pat = store.createPat(user.id, {
      name: body.name,
      scopes,
      redact_pii: body.redact_pii !== false,
      token_hash: hashPatToken(token),
      token_prefix: token.slice(0, 14),
    });
    return sendJson(res, 200, { token, pat }, corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/me/pats/audit') {
    const user = requireUser(req, res);
    if (!user) return;
    const limit = Math.min(200, Number(u.searchParams.get('limit')) || 50);
    return sendJson(res, 200, { items: store.listPatAudit(user.id, { limit }) }, corsHeaders());
  }

  {
    const patMatch = /^\/v1\/me\/pats\/([^/]+)$/.exec(pathname);
    if (patMatch && method === 'DELETE') {
      const user = requireUser(req, res);
      if (!user) return;
      const revoked = store.revokePat(user.id, patMatch[1]);
      if (!revoked) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
      return sendJson(res, 200, { ok: true, pat: revoked }, corsHeaders());
    }
  }

  // ── 能力开放 E3：MCP 精选目录 + OAuth 客户端流程 ─────────────────────────

  if (method === 'GET' && pathname === '/v1/mcp/directory') {
    const user = requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { items: McpDirectory.listDirectory() }, corsHeaders());
  }

  // 授权回调（免鉴权——state 即绑定凭据）：换 token 后给用户一个可自关的小页面。
  if (method === 'GET' && pathname === '/v1/mcp/oauth/callback') {
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const asError = u.searchParams.get('error');
    let ok = false;
    let detail = '';
    if (asError) {
      detail = `${asError}: ${u.searchParams.get('error_description') || ''}`;
    } else if (!code || !state) {
      detail = 'missing code/state';
    } else {
      try {
        await McpOauth.finishOAuth({ store, code, state, fetchFn: McpClientManager.mcpFetch });
        ok = true;
      } catch (e) {
        console.error('[mcp-oauth] callback failed:', e);
        detail = e?.message || 'exchange_failed';
      }
    }
    const title = ok ? '已连接 · Connected' : '授权失败 · Authorization failed';
    const body = ok
      ? '授权完成，回到 GEDO 设置页点「测试」即可使用。此窗口可关闭。'
      : `授权未完成（${detail}）。请回到 GEDO 设置页重试。`;
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;display:grid;place-items:center;height:90vh;background:#0b0b0e;color:#e7e7ea"><div style="text-align:center"><h2>${title}</h2><p>${body}</p></div><script>try{window.opener&&window.opener.postMessage({type:'gedo-mcp-oauth',ok:${ok}},'*')}catch(e){}setTimeout(function(){window.close()},${ok ? 1800 : 8000})</script></body>`);
    return;
  }

  // ── 外部工具（MCP 客户端，P5 MVP）────────────────────────────────────────
  if (method === 'GET' && pathname === '/v1/mcp/servers') {
    const user = requireUser(req, res);
    if (!user) return;
    const items = store.listMcpServers(user.id).map(s => ({
      ...s, headers: undefined, env: undefined,
      has_headers: Object.keys(s.headers || {}).length > 0,
      // oauth 内是秘密（tokens/client_information/verifier），只回传状态
      oauth: undefined,
      oauth_status: s.oauth?.tokens ? 'connected' : (s.oauth?.state ? 'pending' : 'none'),
    }));
    return sendJson(res, 200, { items, stdio_allowed: McpClientManager.stdioAllowed() }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/mcp/servers') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const name = String(body.name || '').trim().slice(0, 60);
    const transport = body.transport === 'stdio' ? 'stdio' : 'http';
    if (!name) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());
    if (transport === 'stdio') {
      const valid = McpClientManager.validateStdioCommand(body.command);
      if (!valid.ok) return sendJson(res, 400, { error: 'invalid_stdio', reason: valid.reason }, corsHeaders());
    } else {
      const url = String(body.url || '').trim();
      if (!url) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());
      const valid = McpClientManager.validateMcpUrl(url);
      if (!valid.ok) return sendJson(res, 400, { error: 'invalid_url', reason: valid.reason }, corsHeaders());
    }
    const headers = body.headers && typeof body.headers === 'object' ? body.headers : {};
    const entry = store.createMcpServer(user.id, {
      name, slug: McpClientManager.slugify(name), transport,
      url: String(body.url || '').trim(), command: String(body.command || '').trim(),
      args: body.args, env: body.env, headers,
    });
    return sendJson(res, 200, { server: { ...entry, headers: undefined, env: undefined, oauth: undefined } }, corsHeaders());
  }

  {
    const mcpMatch = /^\/v1\/mcp\/servers\/([^/]+)(\/test|\/oauth\/start)?$/.exec(pathname);
    if (mcpMatch) {
      const user = requireUser(req, res);
      if (!user) return;
      const serverId = mcpMatch[1];
      const server = store.getMcpServer(user.id, serverId);
      if (!server) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());

      if (method === 'POST' && mcpMatch[2] === '/test') {
        const result = await McpClientManager.testServer(server);
        return sendJson(res, 200, result, corsHeaders());
      }
      // E3：发起 OAuth 授权。返回 authorization_url（前端 window.open）或
      // connected:true（refresh_token 直接续上，无需交互）。
      if (method === 'POST' && mcpMatch[2] === '/oauth/start') {
        if (server.transport === 'stdio') return sendJson(res, 400, { error: 'oauth_not_applicable' }, corsHeaders());
        const valid = McpClientManager.validateMcpUrl(server.url);
        if (!valid.ok) return sendJson(res, 400, { error: 'invalid_url', reason: valid.reason }, corsHeaders());
        try {
          const result = await McpOauth.startOAuth({ store, userId: user.id, server, fetchFn: McpClientManager.mcpFetch });
          return sendJson(res, 200, result, corsHeaders());
        } catch (e) {
          console.error('[mcp-oauth] start failed:', e);
          return sendJson(res, 502, { error: 'oauth_start_failed', detail: e?.message || String(e) }, corsHeaders());
        }
      }
      if (method === 'PATCH' && !mcpMatch[2]) {
        const body = await readJsonBody(req);
        if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
        if (body.url !== undefined) {
          const valid = McpClientManager.validateMcpUrl(String(body.url));
          if (!valid.ok) return sendJson(res, 400, { error: 'invalid_url', reason: valid.reason }, corsHeaders());
        }
        if (body.transport === 'stdio' || body.command !== undefined) {
          const valid = McpClientManager.validateStdioCommand(body.command ?? server.command);
          if (!valid.ok) return sendJson(res, 400, { error: 'invalid_stdio', reason: valid.reason }, corsHeaders());
        }
        const updated = store.updateMcpServer(user.id, serverId, body);
        return sendJson(res, 200, { server: { ...updated, headers: undefined, env: undefined, oauth: undefined } }, corsHeaders());
      }
      if (method === 'DELETE' && !mcpMatch[2]) {
        store.deleteMcpServer(user.id, serverId);
        return sendJson(res, 200, { success: true }, corsHeaders());
      }
      return sendJson(res, 405, { error: 'method_not_allowed' }, corsHeaders());
    }
  }

  // 已启用外部工具清单（app「+」菜单 / web settings 展示用）
  if (method === 'GET' && pathname === '/v1/mcp/tools') {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const { listChatTools } = McpClientManager;
      const tools = await listChatTools(user.id);
      return sendJson(res, 200, { items: tools.map(t => ({ name: t.name, description: t.description })) }, corsHeaders());
    } catch (e) {
      return sendJson(res, 200, { items: [], error: e?.message }, corsHeaders());
    }
  }

  // Execution
  if (method === 'GET' && pathname === '/v1/tasks/today') {
    const user = requireUser(req, res);
    if (!user) return;
    const items = store.listTodayTasks(user.id);
    return sendJson(res, 200, { items }, corsHeaders());
  }

  // All tasks across time (powers execution page 今日/未来/历史 scopes).
  if (method === 'GET' && pathname === '/v1/tasks') {
    const user = requireUser(req, res);
    if (!user) return;
    const items = store.listAllTasks(user.id);
    return sendJson(res, 200, { items }, corsHeaders());
  }

  // Quick-create a single executable task from the mobile/web execution UI.
  if (method === 'POST' && pathname === '/v1/tasks') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());
    const [task] = store.createTasks(user.id, [{
      title,
      description: String(body.description || '').trim(),
      scheduled_date: body.scheduled_date || null,
      due_date: body.due_date || null,
      priority: ['high', 'medium', 'low'].includes(body.priority) ? body.priority : 'medium',
      energy_level: ['high', 'medium', 'low'].includes(body.energy_level) ? body.energy_level : 'medium',
      estimated_duration: Math.max(5, Math.min(Number(body.estimated_duration) || 30, 480)),
      is_mit: !!body.is_mit,
      goal_id: body.goal_id || null,
      key_result_id: body.key_result_id || null,
    }]);
    return sendJson(res, 201, { task }, corsHeaders());
  }

  // P1-B: batch task adjustment (Generative UI TaskAdjustCard apply/undo)
  if (method === 'POST' && pathname === '/v1/tasks/batch-adjust') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const items = Array.isArray(body.items) ? body.items : [];
    const snapshots = [];
    for (const item of items) {
      if (!item.task_id) continue;
      const task = store.getTask?.(user.id, item.task_id);
      if (!task) continue;
      snapshots.push({ ...task });  // capture state before mutation
      if (item.action === 'postpone' || item.action === 'reschedule') {
        const newDate = item.new_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        store.updateTask?.(user.id, item.task_id, { scheduled_date: newDate });
      } else if (item.action === 'remove') {
        store.updateTask?.(user.id, item.task_id, { status: 'cancelled' });
      } else if (item.action === 'priority_up') {
        store.updateTask?.(user.id, item.task_id, { priority: Math.min((task.priority || 3) + 1, 5) });
      } else if (item.action === 'priority_down') {
        store.updateTask?.(user.id, item.task_id, { priority: Math.max((task.priority || 3) - 1, 1) });
      }
    }
    // Store undo snapshots in memory (Phase 2: pg-boss + DB)
    const undoToken = `undo_${user.id}_${Date.now()}`;
    store.setUndoSnapshot?.(undoToken, snapshots);
    return sendJson(res, 200, { ok: true, undo_token: undoToken, applied: snapshots.length }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/tasks/batch-adjust/undo') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const token = body?.undo_token;
    if (!token) return sendJson(res, 400, { error: 'missing undo_token' }, corsHeaders());
    const snapshots = store.getUndoSnapshot?.(token);
    if (!snapshots) return sendJson(res, 404, { error: 'undo_token_not_found_or_expired' }, corsHeaders());
    for (const snap of snapshots) {
      store.updateTask?.(user.id, snap.id, {
        scheduled_date: snap.scheduled_date,
        status: snap.status,
        priority: snap.priority,
      });
    }
    store.deleteUndoSnapshot?.(token);
    return sendJson(res, 200, { ok: true, restored: snapshots.length }, corsHeaders());
  }

  // Edit / delete a single task (used by the chat 拆解明细 inline editing).
  const taskEditMatch = /^\/v1\/tasks\/([^/]+)$/.exec(pathname);
  if (method === 'PATCH' && taskEditMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const patch = {};
    if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 200);
    if (typeof body.description === 'string') patch.description = body.description.trim();
    if ('scheduled_date' in body) patch.scheduled_date = body.scheduled_date || null;
    if ('due_date' in body) patch.due_date = body.due_date || null;
    if (body.priority != null) patch.priority = body.priority;
    if (['high', 'medium', 'low'].includes(body.energy_level)) patch.energy_level = body.energy_level;
    if (body.estimated_duration != null) patch.estimated_duration = Math.max(5, Math.min(Number(body.estimated_duration) || 30, 480));
    if (typeof body.is_mit === 'boolean') patch.is_mit = body.is_mit;
    if ('goal_id' in body) patch.goal_id = body.goal_id || null;
    if ('key_result_id' in body) patch.key_result_id = body.key_result_id || null;
    const task = store.updateTask ? store.updateTask(user.id, taskEditMatch[1], patch) : null;
    if (!task) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    return sendJson(res, 200, { task }, corsHeaders());
  }
  if (method === 'DELETE' && taskEditMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    if (store.deleteTask) store.deleteTask(user.id, taskEditMatch[1]);
    return sendJson(res, 200, { success: true }, corsHeaders());
  }

  const checkinMatch = /^\/v1\/tasks\/([^/]+)\/checkin$/.exec(pathname);
  if (method === 'POST' && checkinMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const taskId = checkinMatch[1];
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    // 智能混合状态机：待办→进行中→完成（+稍后跳过）。in_progress 是「开始」而非完成。
    const ALLOWED_STATUS = ['todo', 'in_progress', 'done', 'skipped'];
    const status = ALLOWED_STATUS.includes(body.status) ? body.status : 'skipped';
    const reason_code = String(body.reason_code || '');
    const note = String(body.note || '');

    const task = store.updateTaskStatus(user.id, taskId, status);
    if (!task) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());

    // P14: 自动化待办 —— checkin 推进触发工具动作（fire-and-forget，不阻塞响应）
    TaskActionService.maybeRunOnCheckin(user.id, task, status);

    // 动态调整建议
    const adjustments = [];
    if (status === 'skipped' && reason_code) {
      // 使用 LLM 生成调整建议
      if (ENABLE_LLM) {
        try {
          const suggestion = await PlannerService.generateAdjustmentSuggestion(
            task,
            reason_code,
            note,
            store.getSettings(user.id)?.language
          );
          adjustments.push({
            id: `adj_${Date.now()}`,
            type: suggestion.adjustment_type,
            suggestion: suggestion.suggestion,
            new_tasks: suggestion.new_tasks,
            encouragement: suggestion.encouragement,
          });
        } catch (error) {
          console.error('[API] LLM adjustment error:', error);
        }
      }
      
      // 保存调整记录
      store.createAdjustment(user.id, adjustments[0]?.type || 'reschedule_hint', { taskId, reason_code, note });
    }

    // P2-B: 触发 LISTEN/NOTIFY → Stuck Detector（仅终态算一次 check-in 收口，
    // 「开始」(in_progress) 不触发）。生产环境 pg_notify 由 DB trigger 发出；dev 环境用内存总线。
    if (status === 'done' || status === 'skipped') {
      try { emitCheckInDone(user.id); } catch (_) {}
    }

    return sendJson(res, 200, { task, adjustments }, corsHeaders());
  }

  // 任务「细化」：把一条粗任务拆成 2-4 个小步骤。
  //   - 预览（默认）：返回 LLM 建议的子步骤，不落库。
  //   - 应用（apply:true + subtasks）：把确认后的子步骤创建为真实任务（继承排期/目标）。
  const breakdownMatch = /^\/v1\/tasks\/([^/]+)\/breakdown$/.exec(pathname);
  if (method === 'POST' && breakdownMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const taskId = breakdownMatch[1];
    const body = await readJsonBody(req);
    if (body && body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const task = store.getTask(user.id, taskId);
    if (!task) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());

    if (body?.apply) {
      const list = Array.isArray(body.subtasks) ? body.subtasks : [];
      const drafts = list
        .map((s) => ({
          title: String(s.title || '').trim(),
          description: String(s.description || ''),
          estimated_duration: Number(s.estimated_duration) || 20,
          energy_level: ['high', 'medium', 'low'].includes(s.energy_level) ? s.energy_level : 'medium',
          scheduled_date: task.scheduled_date || new Date().toISOString().slice(0, 10),
          goal_id: task.goal_id || null,
          key_result_id: task.key_result_id || null,
          plan_node_id: task.plan_node_id || null,
        }))
        .filter((s) => s.title);
      const createdTasks = drafts.length ? store.createTasks(user.id, drafts) : [];
      return sendJson(res, 200, { created: createdTasks }, corsHeaders());
    }

    const subtasks = await PlannerService.breakdownTask(task, store.getSettings(user.id)?.language);
    return sendJson(res, 200, { subtasks }, corsHeaders());
  }

  // Tree — LLM-enriched snapshot with 24h cache; rule-based fallback if no LLM.
  if (method === 'GET' && pathname === '/v1/tree/snapshot') {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const { getEnrichedTreeSnapshot } = await import('./services/tree.service.mjs');
      const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const force = u.searchParams.get('refresh') === '1';
      const snapshot = await getEnrichedTreeSnapshot(user.id, { force });
      return sendJson(res, 200, snapshot, corsHeaders());
    } catch (err) {
      console.error('[API] tree/snapshot error:', err);
      const fallback = store.getTreeSnapshot(user.id);
      return sendJson(res, 200, { ...fallback, source: 'rules' }, corsHeaders());
    }
  }

  // Goals
  if (method === 'GET' && pathname === '/v1/goals') {
    const user = requireUser(req, res);
    if (!user) return;
    const goals = store.listGoals(user.id);
    const allTasks = store.listAllTasks ? store.listAllTasks(user.id) : [];
    // Enrich with computed progress (done/total tasks) and decompose state
    // (has child goals or tasks) so the UI can show real % and switch the
    // "拆解" button to a "查看/重新拆解" state.
    const items = goals.map((g) => {
      const childCount = goals.filter((x) => x.parent_id === g.id).length;
      // Attribute ToDos to this node by the right linkage per OKR level, so
      // progress rolls ToDo→KR→O: key_result counts tasks tagged with its
      // key_result_id; monthly counts its plan_node_id; objective (default)
      // counts every ToDo under the goal via goal_id.
      const goalTasks = allTasks.filter((t) =>
        g.level === 'key_result' ? t.key_result_id === g.id
        : g.level === 'monthly' ? t.plan_node_id === g.id
        : t.goal_id === g.id);
      const doneCount = goalTasks.filter((t) => t.status === 'done').length;
      const progress = goalTasks.length ? Math.round((doneCount / goalTasks.length) * 100) : (g.progress || 0);
      return {
        ...g,
        progress,
        child_count: childCount,
        task_count: goalTasks.length,
        decomposed: childCount > 0 || goalTasks.length > 0,
      };
    });
    return sendJson(res, 200, { items }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/goals') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const title = String(body.title || '').trim();
    if (!title) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());
    // Sub-goals (KR / 月度) carry parent_id + level. Only top-level objectives
    // count against the goals entitlement; a KR is part of an existing objective.
    const parentId = body.parent_id || null;
    const level = parentId
      ? (['key_result', 'monthly'].includes(body.level) ? body.level : 'key_result')
      : 'objective';
    if (!parentId) {
      const gate = billing.checkEntitlement(user.id, 'goals');
      if (gate) return sendJson(res, 402, gate, corsHeaders());
    }
    const goal = store.createGoal(user.id, {
      title,
      description: body.description,
      life_wheel_dimension: body.life_wheel_dimension,
      parent_id: parentId,
      level,
    });
    // Persist WOOP if the create form collected it. createGoal doesn't take
    // these fields, but the updateGoal whitelist does — so the mobile/web goal
    // form can capture 愿望/最佳结果/最大障碍 at creation instead of forcing a
    // separate edit afterwards.
    const woopPatch = {};
    for (const k of ['wish', 'outcome', 'obstacle']) {
      if (typeof body[k] === 'string' && body[k].trim()) woopPatch[k] = body[k].trim();
    }
    const finalGoal = Object.keys(woopPatch).length ? store.updateGoal(user.id, goal.id, woopPatch) : goal;
    return sendJson(res, 200, finalGoal, corsHeaders());
  }

  const goalStatusMatch = /^\/v1\/goals\/([^/]+)\/status$/.exec(pathname);
  if (method === 'PATCH' && goalStatusMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const goalId = goalStatusMatch[1];
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const status = String(body.status || '');
    if (!['draft', 'active', 'completed', 'paused', 'abandoned'].includes(status)) {
      return sendJson(res, 400, { error: 'invalid_status' }, corsHeaders());
    }
    const goal = store.updateGoalStatus(user.id, goalId, status);
    if (!goal) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    return sendJson(res, 200, goal, corsHeaders());
  }

  // 编辑目标本身（标题/描述/维度/WOOP/SMART）。目标模块的「编辑」用此端点。
  const goalEditMatch = /^\/v1\/goals\/([^/]+)$/.exec(pathname);
  if (method === 'PATCH' && goalEditMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const goalId = goalEditMatch[1];
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const goal = store.updateGoal(user.id, goalId, body);
    if (!goal) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    return sendJson(res, 200, goal, corsHeaders());
  }

  const goalDeleteMatch = /^\/v1\/goals\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && goalDeleteMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const goalId = goalDeleteMatch[1];
    const deleted = store.deleteGoal(user.id, goalId);
    if (!deleted) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    return sendJson(res, 200, { success: true, tasks: deleted }, corsHeaders());
  }

  // =============================================
  // Obstacles (If-Then Cards)
  // =============================================

  if (method === 'GET' && pathname === '/v1/obstacles/cards') {
    const user = requireUser(req, res);
    if (!user) return;
    const goalId = u.searchParams.get('goal_id') || undefined;
    const obstacleType = u.searchParams.get('obstacle_type') || undefined;
    const items = store.listIfThenCards(user.id, { goalId, obstacleType });
    return sendJson(res, 200, { items }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/obstacles/cards') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    if (!body.obstacle_type || !body.if_condition || !body.then_action) {
      return sendJson(res, 400, { error: 'invalid_input', detail: 'obstacle_type, if_condition, then_action required' }, corsHeaders());
    }
    const card = store.createIfThenCard(user.id, body);
    return sendJson(res, 200, card, corsHeaders());
  }

  const cardDeleteMatch = /^\/v1\/obstacles\/cards\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && cardDeleteMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const deleted = store.deleteIfThenCard(user.id, cardDeleteMatch[1]);
    if (!deleted) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    return sendJson(res, 200, { success: true }, corsHeaders());
  }

  const cardTriggerMatch = /^\/v1\/obstacles\/cards\/([^/]+)\/trigger$/.exec(pathname);
  if (method === 'POST' && cardTriggerMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const executed = body?.executed ?? false;
    const card = store.triggerIfThenCard(user.id, cardTriggerMatch[1], executed);
    if (!card) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    return sendJson(res, 200, card, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/obstacles/match') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const reasonCode = body.reason_code;
    if (!reasonCode) return sendJson(res, 400, { error: 'reason_code required' }, corsHeaders());
    const result = store.matchObstacle(user.id, reasonCode);
    return sendJson(res, 200, result, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/obstacles/events') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const event = store.createObstacleEvent(user.id, body);
    return sendJson(res, 200, event, corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/obstacles/events') {
    const user = requireUser(req, res);
    if (!user) return;
    const items = store.listObstacleEvents(user.id);
    return sendJson(res, 200, { items }, corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/obstacles/stats') {
    const user = requireUser(req, res);
    if (!user) return;
    const stats = store.getObstacleStats(user.id);
    return sendJson(res, 200, stats, corsHeaders());
  }

  // =============================================
  // ECS History
  // =============================================

  if (method === 'POST' && pathname === '/v1/ecs/record') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const record = store.recordECS(user.id, body);
    return sendJson(res, 200, record, corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/ecs/history') {
    const user = requireUser(req, res);
    if (!user) return;
    const days = parseInt(u.searchParams.get('days') || '30');
    const items = store.getECSHistory(user.id, { days });
    return sendJson(res, 200, { items }, corsHeaders());
  }

  // =============================================
  // Reflections
  // =============================================

  if (method === 'POST' && pathname === '/v1/reflections') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const reflection = store.createReflection(user.id, body);
    return sendJson(res, 200, reflection, corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/reflections') {
    const user = requireUser(req, res);
    if (!user) return;
    const items = store.listReflections(user.id);
    return sendJson(res, 200, { items }, corsHeaders());
  }

  // =============================================
  // Reviews
  // =============================================

  if (method === 'GET' && pathname === '/v1/reviews') {
    const user = requireUser(req, res);
    if (!user) return;
    const items = store.listReviews(user.id);
    return sendJson(res, 200, { items }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/reviews/generate') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    // Shared with the chat `generate_review` tool (ConversationService) so both
    // produce identically-shaped review objects.
    const review = await ConversationService.generateReview(user.id, { periodType: body?.period_type });
    return sendJson(res, 200, review, corsHeaders());
  }

  // =============================================
  // Insights / Stats
  // =============================================

  if (method === 'GET' && pathname === '/v1/insights/stats') {
    const user = requireUser(req, res);
    if (!user) return;
    const periodType = u.searchParams.get('period') || 'weekly';
    const stats = store.getInsightStats(user.id, { periodType });
    return sendJson(res, 200, stats, corsHeaders());
  }

  if (method === 'GET' && pathname === '/v1/insights/suggestions') {
    const user = requireUser(req, res);
    if (!user) return;
    const stats = store.getInsightStats(user.id, { periodType: 'weekly' });
    const suggestions = [];
    if (stats.completionRate < 50) suggestions.push({ type: 'warning', text: '本周完成率较低，建议减少每日任务到3-5项' });
    if (stats.completionRate >= 80) suggestions.push({ type: 'praise', text: '执行力出色！保持这个节奏' });
    if (stats.reflectionCount === 0) suggestions.push({ type: 'tip', text: '还没有做晚间反思，反思有助于持续改进' });
    if (stats.newMemories === 0) suggestions.push({ type: 'tip', text: '试试和智伴聊聊，记录你的想法和经历' });
    if (stats.activeGoals === 0) suggestions.push({ type: 'tip', text: '还没有活跃目标，去智引创建一个吧' });
    return sendJson(res, 200, { suggestions }, corsHeaders());
  }

  // =============================================
  // Settings
  // =============================================

  if (method === 'GET' && pathname === '/v1/settings') {
    const user = requireUser(req, res);
    if (!user) return;
    const settings = store.getSettings(user.id);
    return sendJson(res, 200, settings, corsHeaders());
  }

  if (method === 'PUT' && pathname === '/v1/settings') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const settings = store.updateSettings(user.id, body);
    return sendJson(res, 200, settings, corsHeaders());
  }

  // =============================================
  // Goals WOOP/OKR AI Generation
  // =============================================

  if (method === 'POST' && pathname === '/v1/goals/woop-generate') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());

    const { prompt, diagnosis_answers, woop, regenerate_hint } = body;
    if (!prompt) return sendJson(res, 400, { error: 'prompt required' }, corsHeaders());

    const { okrStructure, ifThenCards } = await PlannerService.generateOkrStructure({
      prompt,
      diagnosisAnswers: diagnosis_answers,
      woop,
      regenerateHint: regenerate_hint || '',
      enableLLM: ENABLE_LLM,
      language: store.getSettings(user.id)?.language,
    });

    return sendJson(res, 200, { okrStructure, ifThenCards }, corsHeaders());
  }

  // Decompose an existing goal into a persisted OKR tree: KR → 月目标 → 任务
  // become child goals (parent_id + level), so the 目标建构 page can expand the
  // hierarchy. Idempotent — re-calling a goal that already has children is a no-op.
  const goalDecomposeMatch = /^\/v1\/goals\/([^/]+)\/decompose$/.exec(pathname);
  if (method === 'POST' && goalDecomposeMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const goalId = goalDecomposeMatch[1];
    const allGoals = store.listGoals(user.id);
    const goal = allGoals.find((g) => g.id === goalId);
    if (!goal) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());

    const body = await readJsonBody(req);
    // Shared OKR decompose (also used by the chat plan_goal tool) — builds the
    // sub-goal tree + materializes near-term tasks. A fresh decompose may fall
    // back to the deterministic skeleton if the LLM fails, but a re-decompose
    // (replace) must not: swapping a real tree for the generic skeleton is a
    // net loss, so generation failure keeps the existing tree (failed:true).
    const result = await PlannerService.decomposeGoalToOkr(store, user.id, goal, {
      answers: body?.answers || {},
      woop: body?.woop || null,
      okrStructure: body?.okrStructure || null,
      regenerateHint: body?.regenerate_hint || '',
      enableLLM: ENABLE_LLM,
      replace: !!body?.replace,
      allowFallback: !body?.replace,
    });
    return sendJson(res, 200, result, corsHeaders());
  }

  // 目标规划 · 预览：结合画像/记忆，大模型生成「分阶段每日节奏」计划（不落库，可反复重生成）。
  const planPreviewMatch = /^\/v1\/goals\/([^/]+)\/plan\/preview$/.exec(pathname);
  if (method === 'POST' && planPreviewMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const goalId = planPreviewMatch[1];
    const goal = store.listGoals(user.id).find((g) => g.id === goalId);
    if (!goal) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    const body = await readJsonBody(req);

    // 个人上下文：画像（L1/L3）+ 工作记忆（L2）+ 与目标相关的记忆，喂给规划做个性化。
    let personalContext = '';
    try {
      const profile = MemoryFileService.getProfile(user.id) || {};
      const working = MemoryFileService.getWorkingMemory(user.id) || {};
      const ci = profile.core_identity || {};
      const sm = profile.semantic_memory || {};
      const wctx = working.current_context || {};
      const lines = [];
      if (ci.name) lines.push(`称呼：${ci.name}`);
      if (ci.profession) lines.push(`角色：${ci.profession}`);
      if (ci.location) lines.push(`所在地：${ci.location}`);
      const vals = ci.values?.top_priorities; if (vals?.length) lines.push(`看重：${vals.slice(0, 3).join('、')}`);
      const ns = ci.vision?.north_star || ci.vision?.five_year; if (ns) lines.push(`愿景：${ns}`);
      const dimLines = Object.entries(sm.dimensions || {}).filter(([, d]) => d?.summary).slice(0, 4).map(([k, d]) => `${k}：${d.summary}`);
      if (dimLines.length) lines.push(`近况：${dimLines.join('；')}`);
      if (wctx.focus_domain) lines.push(`当前关注：${wctx.focus_domain}`);
      if (Array.isArray(wctx.challenges) && wctx.challenges.length) lines.push(`挑战：${wctx.challenges.slice(0, 3).join('、')}`);
      const mems = (store.searchMemory(user.id, goal.title) || []).slice(0, 5).map(m => (m.content_raw || '').slice(0, 60)).filter(Boolean);
      if (mems.length) lines.push(`相关记忆：${mems.join('；')}`);
      personalContext = lines.join('\n');
    } catch { /* best-effort */ }

    // 周期天数：请求 > 目标起止日期 > 标题/描述里的「N天」 > 默认 30。
    let durationDays = Number(body?.durationDays) || 0;
    if (!durationDays && goal.start_date && goal.end_date) {
      const ms = new Date(goal.end_date) - new Date(goal.start_date);
      if (ms > 0) durationDays = Math.round(ms / 86400000);
    }
    if (!durationDays) {
      const m = /(\d{1,3})\s*天/.exec(`${goal.title} ${goal.description || ''}`);
      if (m) durationDays = Number(m[1]);
    }
    if (!durationDays) durationDays = 30;

    // 重规划上下文：本目标完成情况 + 其他在推进目标 + 是否已拆解。
    const stats = store.getTaskStatsByGoal(user.id, goalId);
    const allGoals = store.listGoals(user.id);
    const alreadyPlanned = allGoals.some((g) => g.parent_id === goalId);
    const isReplan = alreadyPlanned || stats.total > 0;
    const otherGoals = allGoals
      .filter((g) => g.id !== goalId && !g.parent_id && (g.status === 'active' || g.status === 'draft'))
      .slice(0, 5)
      .map((g) => `${g.title}（进度 ${g.progress || 0}%）`);
    const progLines = [];
    if (stats.total > 0) {
      progLines.push(`本目标已完成 ${stats.done}/${stats.total}（完成率 ${stats.completionRate}%）`
        + `${stats.skipped ? `，跳过 ${stats.skipped} 次` : ''}${stats.open ? `，还有 ${stats.open} 项未完成` : ''}`);
    }
    if (otherGoals.length) progLines.push(`同时在推进：${otherGoals.join('；')}`);
    const progressContext = progLines.join('\n');

    const plan = await PlannerService.generateGoalPlan({
      goalTitle: goal.title,
      goalDescription: goal.description || '',
      durationDays,
      personalContext,
      progressContext,
      isReplan,
      regenerateHint: String(body?.regenerateHint || ''),
      enableLLM: ENABLE_LLM,
      language: store.getSettings(user.id)?.language,
    });
    const estimatedTasks = PlannerService.expandPlanToTasks(plan, { cap: 2000 }).length;
    return sendJson(res, 200, { goal: { id: goal.id, title: goal.title }, plan, estimatedTasks, personalized: !!personalContext, isReplan, stats }, corsHeaders());
  }

  // 目标规划 · 确认落库：建 KR/阶段节点 + 把（用户编辑后的）每日节奏展开成可执行任务。
  const planCommitMatch = /^\/v1\/goals\/([^/]+)\/plan\/commit$/.exec(pathname);
  if (method === 'POST' && planCommitMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const goalId = planCommitMatch[1];
    const goal = store.listGoals(user.id).find((g) => g.id === goalId);
    if (!goal) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    const body = await readJsonBody(req);
    if (!body || body.__parse_error || !body.plan) return sendJson(res, 400, { error: 'bad_plan' }, corsHeaders());
    const plan = body.plan;
    const dim = goal.life_wheel_dimension || 'growth';
    const created = [];

    // 重规划：先把未完成的旧任务作废 + 删除旧子节点（已完成任务保留为历史），再重建。
    const replaced = store.cancelOpenTasksByGoal(user.id, goalId);
    store.deleteDescendantGoals(user.id, goalId);

    const krIds = [];
    for (const kr of plan.keyResults || []) {
      const title = (typeof kr === 'string' ? kr : kr?.title || '').trim();
      if (!title) continue;
      const node = store.createGoal(user.id, { title, description: '', life_wheel_dimension: dim, parent_id: goalId, level: 'key_result', status: 'active' });
      krIds.push(node.id);
      created.push(node);
    }
    const phaseNode = {}; // phase name → goal node id（用于任务 plan_node_id 关联）
    if (plan.cadence !== 'milestone') {
      for (const ph of plan.phases || []) {
        if (!ph?.name) continue;
        const node = store.createGoal(user.id, { title: ph.name, description: ph.focus || '', life_wheel_dimension: dim, parent_id: goalId, level: 'monthly', status: 'active' });
        phaseNode[ph.name] = node.id;
        created.push(node);
      }
    }
    // 每日节奏的任务不按 KR 切分,均匀轮转挂到各 KR(让 KR 进度随整体推进一起涨,而非恒 0)。
    const drafts = PlannerService.expandPlanToTasks(plan, { cap: 400 })
      .map((t, i) => ({ ...t, goal_id: goalId, key_result_id: krIds.length ? krIds[i % krIds.length] : null, plan_node_id: phaseNode[t.milestone] || null }));
    const tasks = drafts.length ? store.createTasks(user.id, drafts) : [];
    try { store.updateGoalStatus(user.id, goalId, 'active'); } catch { /* non-fatal */ }

    return sendJson(res, 200, {
      goal, created, tasks, taskCount: tasks.length, replaced,
      message: `已生成 ${created.length} 个规划节点、${tasks.length} 个可执行任务${replaced ? `（替换了 ${replaced} 个未完成的旧任务）` : ''}`,
    }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/goals/diagnose') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());

    const { prompt, answers } = body;
    let diagnosis = null;

    if (ENABLE_LLM) {
      try {
        const llm = getLLMRouter();
        const llmPrompt = `作为目标诊断专家，分析以下目标的可行性：
目标: ${prompt}
回答: ${JSON.stringify(answers || {})}

返回JSON: {"score": 0-100, "strengths": ["优势"], "risks": ["风险"], "suggestions": ["建议"]}`;
        const result = await llm.chatToText([{ role: 'user', content: llmPrompt }], { temperature: 0.5 });
        try {
          diagnosis = JSON.parse(result.content.replace(/```json?\n?/g, '').replace(/```/g, ''));
        } catch { /* use fallback */ }
      } catch (e) {
        console.error('[API] Diagnose LLM error:', e);
      }
    }

    if (!diagnosis) {
      diagnosis = {
        score: 65,
        strengths: ['目标方向明确'],
        risks: ['时间规划需要更具体'],
        suggestions: ['建议设定可衡量的里程碑', '分解为每周可执行的小任务'],
      };
    }

    return sendJson(res, 200, diagnosis, corsHeaders());
  }

  // =============================================
  // AI Daily Plan Generation
  // =============================================

  if (method === 'POST' && pathname === '/v1/plan/daily-generate') {
    const user = requireUser(req, res);
    if (!user) return;

    const userGoals = store.listGoals(user.id).filter(g => g.status === 'active');
    const todayTasks = store.listTodayTasks(user.id);
    const memories = store.searchMemory(user.id, '').slice(0, 5);
    const reflections = store.listReflections(user.id, { limit: 3 });
    const obstacleCards = store.listIfThenCards(user.id);

    let plan = null;

    if (ENABLE_LLM) {
      try {
        const llm = getLLMRouter();
        const llmPrompt = `作为AI日规划师，基于以下信息生成今日任务计划：

活跃目标: ${JSON.stringify(userGoals.map(g => ({ title: g.title, progress: g.progress })))}
现有任务: ${JSON.stringify(todayTasks.map(t => ({ title: t.title, status: t.status })))}
近期记忆: ${JSON.stringify(memories.map(m => m.content_raw?.slice(0, 50)))}
近期反思: ${JSON.stringify(reflections.map(r => ({ obstacle: r.q1_obstacle_tag, adjustment: r.q3_adjustment_tag })))}
障碍预案数: ${obstacleCards.length}

生成5-7项今日任务，返回JSON:
{
  "tasks": [{"title":"任务","description":"描述","timeSlot":"09:00-10:00","priority":"high|medium|low","energyRequired":"high|medium|low","isMIT":true|false,"estimatedMinutes":60,"reasoning":"安排原因","sourceType":"goal|memory|review|habit","sourceLabel":"来源说明"}],
  "adjustmentNote": "基于复盘的调整说明",
  "energyForecast": "high|medium|low"
}`;
        const result = await llm.chatToText([{ role: 'user', content: llmPrompt }], { temperature: 0.7 });
        try {
          plan = JSON.parse(result.content.replace(/```json?\n?/g, '').replace(/```/g, ''));
        } catch { /* use fallback */ }
      } catch (e) {
        console.error('[API] Daily plan LLM error:', e);
      }
    }

    if (!plan) {
      const taskTemplates = [];
      for (const goal of userGoals.slice(0, 3)) {
        taskTemplates.push({
          title: `推进「${goal.title}」`,
          description: `目标进度 ${goal.progress || 0}%`,
          timeSlot: '09:00-10:30',
          priority: 'high',
          energyRequired: 'high',
          isMIT: taskTemplates.length === 0,
          estimatedMinutes: 90,
          reasoning: '基于活跃目标优先推进',
          sourceType: 'goal',
          sourceLabel: goal.title,
        });
      }
      if (taskTemplates.length === 0) {
        taskTemplates.push({
          title: '规划今日目标',
          description: '设定今天最重要的3件事',
          timeSlot: '09:00-09:30',
          priority: 'high',
          energyRequired: 'medium',
          isMIT: true,
          estimatedMinutes: 30,
          reasoning: '没有活跃目标，先做计划',
          sourceType: 'habit',
          sourceLabel: '每日习惯',
        });
      }
      taskTemplates.push({
        title: '晚间复盘与明日计划',
        description: '回顾今日执行，准备明日计划',
        timeSlot: '21:00-21:30',
        priority: 'medium',
        energyRequired: 'low',
        isMIT: false,
        estimatedMinutes: 30,
        reasoning: '保持每日反思习惯',
        sourceType: 'habit',
        sourceLabel: '每日习惯',
      });

      plan = {
        tasks: taskTemplates,
        adjustmentNote: reflections.length > 0 ? '基于近期复盘调整了任务安排' : null,
        energyForecast: 'medium',
      };
    }

    return sendJson(res, 200, plan, corsHeaders());
  }

  // =============================================
  // Memory AI Analysis
  // =============================================

  if (method === 'POST' && pathname === '/v1/memory/analyze') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const content = String(body.content || '').trim();
    if (!content) return sendJson(res, 400, { error: 'content required' }, corsHeaders());

    let analysis = null;

    if (ENABLE_LLM) {
      try {
        const llm = getLLMRouter();
        const llmPrompt = `分析以下内容，提取结构化信息：

"${content}"

返回JSON:
{
  "summary": "一句话摘要",
  "category": "personal_trait|life_goal|task|emotion|experience|preference|skill",
  "suggestedType": "important_info|personal_trait|key_event|date_reminder|task_item",
  "keyEntities": ["实体"],
  "sentiment": "positive|neutral|negative",
  "confidence": 0.8,
  "suggestedTags": ["标签"],
  "needsClarification": false,
  "clarificationQuestion": "",
  "taskExtracted": null
}`;
        const result = await llm.chatToText([{ role: 'user', content: llmPrompt }], { temperature: 0.3 });
        try {
          analysis = JSON.parse(result.content.replace(/```json?\n?/g, '').replace(/```/g, ''));
        } catch { /* use fallback */ }
      } catch (e) {
        console.error('[API] Memory analyze LLM error:', e);
      }
    }

    if (!analysis) {
      const lower = content.toLowerCase();
      let category = 'experience';
      let suggestedType = 'important_info';
      const suggestedTags = [];

      if (lower.includes('擅长') || lower.includes('能力') || lower.includes('技能')) {
        category = 'skill'; suggestedType = 'personal_trait'; suggestedTags.push('self_awareness');
      } else if (lower.includes('目标') || lower.includes('想要') || lower.includes('计划')) {
        category = 'life_goal'; suggestedType = 'important_info'; suggestedTags.push('goal_related');
      } else if (lower.includes('完成') || lower.includes('待办') || lower.includes('需要')) {
        category = 'task'; suggestedType = 'task_item'; suggestedTags.push('goal_related');
      } else if (lower.includes('开心') || lower.includes('难过') || lower.includes('焦虑') || lower.includes('压力')) {
        category = 'emotion'; suggestedType = 'key_event'; suggestedTags.push('growth_journey');
      } else if (lower.includes('喜欢') || lower.includes('偏好') || lower.includes('习惯')) {
        category = 'preference'; suggestedType = 'personal_trait'; suggestedTags.push('self_awareness');
      }

      analysis = {
        summary: content.slice(0, 80),
        category,
        suggestedType,
        keyEntities: [],
        sentiment: 'neutral',
        confidence: 0.6,
        suggestedTags,
        needsClarification: false,
        clarificationQuestion: '',
        taskExtracted: category === 'task' ? { title: content.slice(0, 50), urgency: 'medium' } : null,
      };
    }

    return sendJson(res, 200, analysis, corsHeaders());
  }

  // =============================================
  // V2 Streaming Chat & Conversations API
  // =============================================

  // SSE streaming chat endpoint
  if (method === 'POST' && pathname === '/v1/chat/stream') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());

    const message = String(body.message || '').trim();
    if (!message) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());

    const conversationId = body.conversation_id || null;
    // Mode-picker forced tool (智忆/待办/目标/复盘 chips) — 'auto' sends no hint,
    // preserving today's LLM auto-detection + wantsDecompose regex backstop.
    const toolHint = typeof body.tool_hint === 'string' && body.tool_hint.trim() ? body.tool_hint.trim() : null;
    // Composer attachments — display-only this round (no LLM vision), just
    // persisted alongside the user message for the transcript to render.
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.filter(a => a && typeof a.url === 'string').slice(0, 6)
      : [];

    // 显式关联（「+」→ 关联目标/待办/图鉴卡）：校验归属并解析出展示字段，
    // 注入 system prompt + 持久化到用户消息 metadata（chips 还原）。
    const chatReferences = ConversationService.resolveChatReferences(user.id, body.references);

    // Edit flow: "edit a past message" = truncate that message + everything
    // after it, then run the edited text through the exact same send pipeline
    // as a normal turn. A foreign/unknown id just no-ops (scoped to this user's
    // own messages), so this never touches another user's conversation.
    const editMessageId = typeof body.edit_message_id === 'string' && body.edit_message_id.trim()
      ? body.edit_message_id.trim() : null;
    if (editMessageId && conversationId && store.truncateConversationFrom) {
      store.truncateConversationFrom(conversationId, user.id, editMessageId);
    }

    // Force-stop wiring: aborting the client's fetch() closes this connection,
    // which fires res 'close' — that's the only signal we need, no separate
    // cancel endpoint. The signal rides on `context` (like `_memoryService`
    // below) down into streamChatResponse → the LLM provider call itself, so a
    // Stop click actually cancels the upstream request instead of just hiding
    // it client-side.
    const streamAbort = new AbortController();
    res.on('close', () => streamAbort.abort());

    // Build context – use four-layer memory system
    const userGoals = store.listGoals(user.id);
    const todayTasks = store.listTodayTasks(user.id);

    let memoryCtx = null;
    try {
      // P1: embed the query (cheap tier) so recall is semantic, not just keyword.
      // embedText returns null when no embedder is configured → keyword fallback.
      const queryEmbedding = await embedText(message);
      const stateText = renderStateContext(computeState(user.id)); // P2: inject computed state
      const narrativeText = renderNarrativeContext(MemoryFileService.getNarrative(user.id, 30)); // P4: stored trajectory hint
      memoryCtx = buildMemoryContext(user.id, { query: message, maxEpisodes: 5, queryEmbedding, stateText, narrativeText });
    } catch (e) {
      console.error('[API] buildMemoryContext error:', e);
    }

    const chatFeature = memoryCtx?.layers?.episodic?.count ? 'chat.long_memory' : 'chat.normal';
    const chatGate = billing.checkEntitlement(user.id, 'smart', { feature: chatFeature });
    if (chatGate) return sendJson(res, 402, chatGate, corsHeaders());

    // P3-C: persona mode from request (resolvePersonaMode validates it)
    let resolvedPersonaMode = 'FOR';
    if (process.env.FEATURE_PERSONA_AS_MODE === 'true' && body.persona_mode) {
      try {
        const { resolvePersonaMode } = await import('./services/avatar.service.mjs');
        resolvedPersonaMode = resolvePersonaMode(body.persona_mode);
      } catch { /* non-fatal */ }
    }

    // Lazy-load MemoryService for P3-C L1/L2/L5 persona context
    let lazyMemoryService = null;
    if (process.env.FEATURE_PERSONA_AS_MODE === 'true') {
      try {
        const { MemoryService } = await import('./services/memory.service.mjs');
        const db = store._db || null; // use store's db connection if available
        lazyMemoryService = db ? new MemoryService({ db, llm: llmRouter }) : null;
      } catch { /* non-fatal — memory service may not be connected */ }
    }

    const context = {
      memoryContext: memoryCtx,
      memories: memoryCtx ? [] : store.searchMemory(user.id, '').slice(0, 5),
      goals: userGoals,
      todayTasks,
      personaMode: resolvedPersonaMode,
      _memoryService: lazyMemoryService,  // injected so streamChatResponse can pull L1/L2/L5
      _abortSignal: streamAbort.signal,   // force-stop: cancels the in-flight LLM call
      forcedTool: toolHint,
      references: chatReferences,
    };

    // Get conversation history (in-memory for MVP, DB for production)
    let conversationMessages = [];
    if (conversationId && store.getConversationMessages) {
      conversationMessages = store.getConversationMessages(conversationId) || [];
    }

    // Start SSE stream
    res.writeHead(200, sseHeaders());

    // Send conversation metadata
    const convId = conversationId || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sendSSE(res, 'conversation', { id: convId });

    try {
      let fullText = '';
      // Per-turn tool events, persisted into the assistant message metadata so
      // the context panel survives reloads / conversation switches. Stored raw
      // ({ name, result }); the client re-summarizes via summarizeToolResult.
      const turnTools = [];
      // 用户消息 metadata：附件 + 显式关联（chips 还原只需 type/id/label）。
      const userMsgMetadata = (() => {
        const m = {};
        if (attachments.length) m.attachments = attachments;
        if (chatReferences.length) m.references = chatReferences.map(r => ({ type: r.type, id: r.id, label: r.label }));
        return Object.keys(m).length ? m : undefined;
      })();

      for await (const chunk of ConversationService.streamChatResponse(user, conversationMessages, message, context)) {
        switch (chunk.type) {
          case 'text':
            fullText += chunk.text;
            sendSSE(res, 'text', { text: chunk.text });
            break;
          case 'tool_call':
            sendSSE(res, 'tool_call', chunk.toolCall);
            turnTools.push({ name: chunk.toolCall?.name, result: null });
            break;
          case 'tool_result': {
            sendSSE(res, 'tool_result', { tool: chunk.toolCall, result: chunk.result });
            const pendingTool = turnTools.find(t => t.name === chunk.toolCall && t.result == null);
            if (pendingTool) pendingTool.result = chunk.result;
            else turnTools.push({ name: chunk.toolCall, result: chunk.result });
            break;
          }
          case 'metadata':
            sendSSE(res, 'metadata', chunk.data);
            break;
          case 'memory_candidate':
            // Proactive capture event — saved (undoable) or pending-confirmation
            // memory/todo candidates surfaced to the context panel.
            sendSSE(res, 'memory_candidate', { memory_candidate: chunk.candidate });
            break;
          case 'error':
            sendSSE(res, 'error', { error: chunk.error });
            break;
          case 'done': {
            // Store messages in memory
            let userMsgRow = null;
            let assistantMsgRow = null;
            if (store.addConversationMessage) {
              userMsgRow = store.addConversationMessage(convId, user.id, {
                role: 'user',
                content: message,
                metadata: userMsgMetadata,
              });
              assistantMsgRow = store.addConversationMessage(convId, user.id, {
                role: 'assistant',
                content: fullText,
                metadata: turnTools.length ? { tools: turnTools } : undefined,
              });
            }

            // Auto-generate title for new conversations, persisted so it
            // survives reloads (previously only sent once via SSE below).
            let title = null;
            if (!conversationId) {
              title = await ConversationService.generateTitle(message);
              if (title && store.updateConversationTitle) {
                store.updateConversationTitle(convId, user.id, title);
              }
            }

            sendSSE(res, 'done', {
              conversation_id: convId,
              title,
              full_content: fullText,
              // Lets the client swap its transient u-/a- ids for the real
              // persisted ones, so a just-sent message can be edited/deleted
              // without needing a reload first.
              user_message_id: userMsgRow?.id,
              assistant_message_id: assistantMsgRow?.id,
            });
            billing.recordUsage(user.id, chatFeature, {
              model: body.model || null,
              inputTokens: Math.ceil(message.length / 4),
              outputTokens: Math.ceil(fullText.length / 4),
            });
            break;
          }
          case 'aborted': {
            // Force-stop: persist whatever was generated before the user hit
            // Stop, same as 'done' but flagged — no separate "discard" path,
            // partial output is still real output (and real spend).
            let userMsgRow = null;
            let assistantMsgRow = null;
            if (store.addConversationMessage) {
              userMsgRow = store.addConversationMessage(convId, user.id, {
                role: 'user',
                content: message,
                metadata: userMsgMetadata,
              });
              if (fullText) {
                assistantMsgRow = store.addConversationMessage(convId, user.id, {
                  role: 'assistant',
                  content: fullText,
                  metadata: { ...(turnTools.length ? { tools: turnTools } : {}), stopped: true },
                });
              }
            }
            // Best-effort — the client that clicked Stop already tore down its
            // fetch and will never read this; harmless no-op via sendSSE's guard.
            sendSSE(res, 'aborted', {
              conversation_id: convId,
              user_message_id: userMsgRow?.id,
              assistant_message_id: assistantMsgRow?.id,
            });
            if (fullText) {
              billing.recordUsage(user.id, chatFeature, {
                model: body.model || null,
                inputTokens: Math.ceil(message.length / 4),
                outputTokens: Math.ceil(fullText.length / 4),
              });
            }
            break;
          }
        }
      }
    } catch (error) {
      console.error('[API] Chat stream error:', error);
      // 把上游 SDK 的错误（429/5xx/网络异常）以结构化形式回吐给前端
      const status = error?.status || error?.response?.status;
      const reason =
        status === 429 ? 'rate_limited'
        : status === 401 || status === 403 ? 'unauthorized'
        : status >= 500 ? 'upstream_error'
        : 'stream_failed';
      sendSSE(res, 'error', {
        error: reason,
        status,
        message: error?.message || String(error),
      });
    }

    res.end();
    return;
  }

  // List conversations
  if (method === 'GET' && pathname === '/v1/conversations') {
    const user = requireUser(req, res);
    if (!user) return;
    const conversations = store.listConversations ? store.listConversations(user.id) : [];
    return sendJson(res, 200, { conversations }, corsHeaders());
  }

  // Get conversation messages
  const convMsgMatch = /^\/v1\/conversations\/([^/]+)\/messages$/.exec(pathname);
  if (method === 'GET' && convMsgMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const convId = convMsgMatch[1];
    const messages = store.getConversationMessages ? store.getConversationMessages(convId) : [];
    return sendJson(res, 200, { messages }, corsHeaders());
  }

  // Delete conversation
  const convDeleteMatch = /^\/v1\/conversations\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && convDeleteMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const convId = convDeleteMatch[1];
    if (store.deleteConversation) {
      store.deleteConversation(convId, user.id);
    }
    return sendJson(res, 200, { success: true }, corsHeaders());
  }

  // Recall (hard-delete) a single message — no cascade to the rest of the thread.
  const convMsgDeleteMatch = /^\/v1\/conversations\/([^/]+)\/messages\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && convMsgDeleteMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const [, convId, messageId] = convMsgDeleteMatch;
    const removed = store.deleteConversationMessage ? store.deleteConversationMessage(convId, user.id, messageId) : false;
    if (!removed) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
    return sendJson(res, 200, { success: true }, corsHeaders());
  }

  // LLM status endpoint
  if (method === 'GET' && pathname === '/v1/llm/status') {
    const status = llmRouter.getStatus();
    return sendJson(res, 200, status, corsHeaders());
  }

  // =============================================
  // V1 Legacy Endpoints
  // =============================================

  // Chat (数字人对话) - legacy non-streaming
  if (method === 'POST' && pathname === '/v1/chat') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    
    const message = String(body.message || '').trim();
    if (!message) return sendJson(res, 400, { error: 'invalid_input' }, corsHeaders());
    
    const context = body.context || {};
    
    try {
      // 获取用户上下文数据（优先使用四层记忆系统）
      let memoryCtxLegacy = null;
      try {
        const queryEmbedding = await embedText(message);
        const stateText = renderStateContext(computeState(user.id)); // P2: inject computed state
        memoryCtxLegacy = buildMemoryContext(user.id, { query: message, maxEpisodes: 3, queryEmbedding, stateText });
      } catch (e) {
        console.error('[API] Legacy chat buildMemoryContext error:', e);
      }

      const legacyChatFeature = memoryCtxLegacy?.layers?.episodic?.count ? 'chat.long_memory' : 'chat.normal';
      const legacyGate = billing.checkEntitlement(user.id, 'smart', { feature: legacyChatFeature });
      if (legacyGate) return sendJson(res, 402, legacyGate, corsHeaders());

      const userMemories = memoryCtxLegacy ? [] : store.searchMemory(user.id, '').slice(0, 5);
      const userGoals = store.listGoals(user.id).filter(g => g.status === 'active').slice(0, 5);
      const todayTasks = store.listTodayTasks(user.id);
      
      // 构建对话上下文
      const chatContext = {
        user: { email: user.email },
        memoryContextText: memoryCtxLegacy?.contextText || '',
        recentMemories: userMemories.map(m => ({
          id: m.id,
          type: m.type,
          summary: m.content_raw?.slice(0, 100) || '',
          createdAt: m.created_at,
        })),
        activeGoals: userGoals.map(g => ({
          id: g.id,
          title: g.title,
          progress: g.progress || 0,
          dimension: g.life_wheel_dimension,
        })),
        todayTasks: todayTasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
        })),
        todayCompleted: context.todayCompleted || todayTasks.filter(t => t.status === 'done').length,
        todayTotal: context.todayTotal || todayTasks.length,
        streakDays: context.streakDays || 0,
        language: store.getSettings(user.id)?.language,
      };
      
      // 调用 LLM 生成回复
      let reply = '';
      let mood = 'neutral';
      let functionCall = null;
      let quickActions = null;
      
      if (ENABLE_LLM) {
        try {
          const llmResponse = await PlannerService.generateChatResponse(message, chatContext);
          reply = llmResponse.reply || '';
          mood = llmResponse.mood || 'neutral';
          functionCall = llmResponse.functionCall;
          quickActions = llmResponse.quickActions;
          
          // 执行 function call
          if (functionCall) {
            switch (functionCall.name) {
              case 'capture_memory':
                const memoryItem = store.createMemoryItem(user.id, {
                  type: functionCall.arguments.type || 'important_info',
                  content_raw: functionCall.arguments.content,
                  tags: functionCall.arguments.tags || [],
                  source: 'chat',
                  content_struct: { summary: functionCall.arguments.content?.slice(0, 80) },
                });
                functionCall.result = { success: true, memoryId: memoryItem.id };
                break;
              case 'complete_task':
                const taskId = functionCall.arguments.taskId;
                if (taskId) {
                  const task = store.updateTaskStatus(user.id, taskId, 'done');
                  functionCall.result = { success: !!task };
                }
                break;
            }
          }
        } catch (error) {
          console.error('[API] Chat LLM error:', error);
          // 降级到本地响应
        }
      }
      
      // 如果 LLM 失败或未启用，使用本地规则生成回复
      if (!reply) {
        const result = generateLocalChatResponse(message, chatContext);
        reply = result.reply;
        mood = result.mood;
        quickActions = result.quickActions;
      }
      
      billing.recordUsage(user.id, legacyChatFeature, {
        inputTokens: Math.ceil(message.length / 4),
        outputTokens: Math.ceil((reply || '').length / 4),
      });
      return sendJson(res, 200, { reply, mood, functionCall, quickActions }, corsHeaders());
    } catch (error) {
      console.error('[API] Chat error:', error);
      return sendJson(res, 500, { error: 'chat_failed' }, corsHeaders());
    }
  }

  // ── P2-C: Web Push ────────────────────────────────────────────────────────
  // GET  /v1/push/vapid-public-key   — 返回 VAPID 公钥供客户端订阅
  // POST /v1/push/subscribe          — 保存 PushSubscription
  // POST /v1/push/unsubscribe        — 删除 PushSubscription
  if (method === 'GET' && pathname === '/v1/push/vapid-public-key') {
    return sendJson(res, 200, { vapidPublicKey: getVapidPublicKey() }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/push/subscribe') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body?.endpoint) return sendJson(res, 400, { error: 'missing endpoint' }, corsHeaders());
    saveSubscription(user.id, body);
    return sendJson(res, 200, { ok: true }, corsHeaders());
  }

  if (method === 'POST' && pathname === '/v1/push/unsubscribe') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (!body?.endpoint) return sendJson(res, 400, { error: 'missing endpoint' }, corsHeaders());
    removeSubscription(user.id, body.endpoint);
    return sendJson(res, 200, { ok: true }, corsHeaders());
  }

  // ── P2-B: Proactive Messages ──────────────────────────────────────────────
  // GET  /v1/proactive/messages         — 未读/近期主动消息列表
  // POST /v1/proactive/messages/:id/feedback — accepted | dismissed | snoozed
  if (method === 'GET' && pathname === '/v1/proactive/messages') {
    const user = requireUser(req, res);
    if (!user) return;
    const msgs = store.listProactiveMessages?.(user.id, { unreadOnly: true }) ?? [];
    return sendJson(res, 200, { items: msgs }, corsHeaders());
  }

  const proactiveFeedbackMatch = /^\/v1\/proactive\/messages\/([^/]+)\/feedback$/.exec(pathname);
  if (method === 'POST' && proactiveFeedbackMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const msgId = proactiveFeedbackMatch[1];
    const body  = await readJsonBody(req);
    if (!body || body.__parse_error) return sendJson(res, 400, { error: 'bad_json' }, corsHeaders());
    const allowed = ['accepted', 'dismissed', 'snoozed'];
    if (!allowed.includes(body.feedback)) {
      return sendJson(res, 400, { error: `feedback must be one of: ${allowed.join(', ')}` }, corsHeaders());
    }
    const updated = store.updateProactiveMessage?.(user.id, msgId, {
      feedback:      body.feedback,
      snoozed_until: body.feedback === 'snoozed'
        ? new Date(Date.now() + (body.snooze_minutes ?? 60) * 60_000).toISOString()
        : null,
    });
    if (!updated) return sendJson(res, 404, { error: 'not_found' }, corsHeaders());

    // 被 dismiss 时通知 CareAgent 记录 procedural_rule
    if (body.feedback === 'dismissed' && updated.type?.startsWith('care_')) {
      const { recordCareDismiss } = await import('../../agent/src/agents/CareAgent.mjs');
      const careType = updated.type.replace('care_', '');
      await recordCareDismiss(user.id, careType, store).catch(() => {});
    }

    return sendJson(res, 200, { ok: true, message: updated }, corsHeaders());
  }

  return sendJson(res, 404, { error: 'not_found' }, corsHeaders());
});

// 本地规则生成对话回复（LLM 降级）
function generateLocalChatResponse(message, context) {
  const lowerMsg = message.toLowerCase();
  let reply = '';
  let mood = 'neutral';
  let quickActions = null;
  
  const completedRatio = context.todayTotal > 0 
    ? context.todayCompleted / context.todayTotal 
    : 0;
  
  // 记忆相关
  if (lowerMsg.includes('记住') || lowerMsg.includes('记录') || lowerMsg.includes('学会') || lowerMsg.includes('学到')) {
    reply = `好的，我帮你记下了 📝\n\n「${message}」\n\n要给它打个标签吗？`;
    mood = 'happy';
    quickActions = [
      { id: 'save', label: '保存到智忆', type: 'confirm' },
      { id: 'skip', label: '暂不保存', type: 'cancel' },
    ];
  }
  // 目标相关
  else if (lowerMsg.includes('目标') || lowerMsg.includes('计划') || lowerMsg.includes('想要') || lowerMsg.includes('打算')) {
    reply = `听起来是个不错的想法！🎯\n\n让我帮你拆解成可执行的计划：\n1. 首先，这个目标的截止时间是？\n2. 你觉得最大的挑战是什么？`;
    mood = 'thinking';
    quickActions = [
      { id: 'create', label: '创建目标', type: 'confirm' },
      { id: 'later', label: '稍后再说', type: 'cancel' },
    ];
  }
  // 完成任务
  else if (lowerMsg.includes('完成') || lowerMsg.includes('做完') || lowerMsg.includes('搞定')) {
    const newCompleted = context.todayCompleted + 1;
    reply = `太棒了！✅ 又完成一项任务！\n\n今日进度：${newCompleted}/${context.todayTotal}\n\n继续加油！`;
    mood = 'excited';
  }
  // 情绪相关
  else if (lowerMsg.includes('累') || lowerMsg.includes('烦') || lowerMsg.includes('压力') || lowerMsg.includes('迷茫')) {
    reply = `我理解你的感受 💙\n\n有时候放慢脚步也是一种进步。要不要：\n• 调整一下今天的任务优先级？\n• 或者就聊聊，我在这里陪你`;
    mood = 'encouraging';
  }
  // 问候
  else if (lowerMsg.includes('你好') || lowerMsg.includes('嗨') || lowerMsg.includes('hi') || lowerMsg.includes('hello')) {
    reply = `嗨！很高兴见到你 😊\n\n今天想做点什么？`;
    mood = 'happy';
  }
  // 查看进度
  else if (lowerMsg.includes('进度') || lowerMsg.includes('怎么样') || lowerMsg.includes('情况')) {
    const streakText = context.streakDays > 0 ? `，已连续打卡 ${context.streakDays} 天 🔥` : '';
    reply = `📊 今日进度：${context.todayCompleted}/${context.todayTotal}${streakText}\n\n`;
    if (completedRatio >= 1) {
      reply += '太棒了，今天任务全部完成！🎉';
      mood = 'excited';
    } else if (completedRatio >= 0.5) {
      reply += '进展不错，继续加油！💪';
      mood = 'happy';
    } else {
      reply += '还有一些任务待完成，需要帮你调整优先级吗？';
      mood = 'neutral';
    }
  }
  // 默认响应
  else {
    reply = `收到！${message.length > 20 ? '这是个有意思的话题~' : ''}\n\n我可以帮你记录想法、规划目标或打卡任务，你想做什么呢？`;
    mood = 'neutral';
  }
  
  return { reply, mood, quickActions };
}

// S0-4: register the Daily Planner cron. Default 07:00 server-local; override via DAILY_PLAN_CRON.
const dailyPlanCron = process.env.DAILY_PLAN_CRON || '0 7 * * *';
try {
  registerScheduledJob(
    'daily-plan',
    dailyPlanCron,
    () => DailyPlanService.runDailyPlanForAllUsers(),
    { timezone: process.env.SCHEDULER_TZ || undefined }
  );
} catch (error) {
  console.error('[backend-api] failed to register daily-plan cron:', error?.message || error);
}

// P14: 自动化待办 scheduled 扫描（默认每天 08:00；override via TASK_ACTION_CRON）
try {
  registerScheduledJob(
    'task-actions',
    process.env.TASK_ACTION_CRON || '0 8 * * *',
    () => TaskActionService.runScheduledForAllUsers(),
    { timezone: process.env.SCHEDULER_TZ || undefined }
  );
} catch (error) {
  console.error('[backend-api] failed to register task-actions cron:', error?.message || error);
}

// P3: periodic memory consolidation + dynamic identity refresh (in-process node-cron).
try {
  registerScheduledJob('memory-nightly', process.env.MEMORY_NIGHTLY_CRON || '0 3 * * *', () => MemoryJobs.runNightlyForAll(), { timezone: process.env.SCHEDULER_TZ || undefined });
  registerScheduledJob('memory-weekly', process.env.MEMORY_WEEKLY_CRON || '0 4 * * 1', () => MemoryJobs.runWeeklyForAll(), { timezone: process.env.SCHEDULER_TZ || undefined });
  registerScheduledJob('memory-quarterly', process.env.MEMORY_QUARTERLY_CRON || '0 5 1 1,4,7,10 *', () => MemoryJobs.runQuarterlyForAll(), { timezone: process.env.SCHEDULER_TZ || undefined });
} catch (error) {
  console.error('[backend-api] failed to register memory crons:', error?.message || error);
}

// 来源中心 janitor：终结 24h 的 job 文件清理 + 导入候选 90 天兜底过期。
try {
  registerScheduledJob('import-janitor', process.env.IMPORT_JANITOR_CRON || '30 3 * * *', () => {
    const jobs = sweepFinishedJobs();
    const captures = store.expireImportCaptures(90);
    if (jobs || captures) console.log(`[import-janitor] swept ${jobs} job files, expired ${captures} stale import captures`);
  }, { timezone: process.env.SCHEDULER_TZ || undefined });
} catch (error) {
  console.error('[backend-api] failed to register import janitor:', error?.message || error);
}

// 来源中心：注册导入管线 handler 并启动轻量持久队列（重启恢复中断任务）
try {
  registerJobHandler('source_ingest', runSourceIngest);
  initJobQueue();
} catch (error) {
  console.error('[backend-api] failed to init import job queue:', error?.message || error);
}

// 图鉴 AI 总结存量补跑：启动 30s 后错峰跑一次（防抖 timer 随进程丢失也由
// 此兜住），夜间 cron（memory-nightly）每日兜底。指纹未变的卡零 LLM 成本。
const summaryBackfillTimer = setTimeout(() => {
  EntitySummary.sweepAll().catch((e) => console.error('[entity-summary] backfill error:', e?.message));
}, 30_000);
summaryBackfillTimer.unref?.();

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[backend-api] listening on http://localhost:${PORT}`);
});

// P2-B: start pg-boss cron triggers + LISTEN/NOTIFY (non-blocking)
import('../../agent/src/triggers/cron.mjs')
  .then(m => m.registerCronTriggers())
  .catch(err => console.warn('[backend-api] cron triggers init failed:', err?.message));

import('../../agent/src/triggers/listenNotify.mjs')
  .then(m => m.startListening())
  .catch(err => console.warn('[backend-api] LISTEN/NOTIFY init failed:', err?.message));






