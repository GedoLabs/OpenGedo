/**
 * Entity AI Summary (图鉴卡面总结) — 事件驱动 + 存量补跑。
 *
 * 每张图鉴卡维护一段 60-120 字的第二人称自然总结（entity.ai_summary），
 * 供图鉴卡面/详情面板展示。素材 = 卡片结构化信息（facts/note/relation）
 * + 关联记忆碎片原文。生成链路：
 *
 *   markDirty(userId, entityId)   — 变更事件挂钩点调用（建卡/编辑/合并/
 *                                   新碎片关联/收件箱确认…），45s 防抖合并
 *                                   同一实体的连续变更，之后进串行队列生成
 *   sweep(userId) / sweepAll()    — 存量补跑：缺总结或素材指纹失配的补生成
 *                                   （启动 30s 后错峰跑一次 + 夜间 cron 兜底）
 *   generateFor(userId, entityId) — 单卡生成（手动「重新生成」走 force）
 *
 * 隐私红线：ai_excluded=true 的卡不进任何 LLM 链路（与 detectEntityMentions
 * / renderEntityContext 口径一致）——旧总结保留展示，但永不再生成；
 * ai_excluded 的碎片由 listEpisodes 默认过滤，天然不入 prompt。
 *
 * 幂等：source_hash = 素材指纹（sha1）。指纹未变且上次成功则跳过，
 * 补跑/夜扫对干净卡零 LLM 成本。写库走 store.setEntityAiSummary
 * （系统字段，不动 updated_at，不在 upsertEntity 的 EDITABLE 白名单）。
 */

import crypto from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { getMemoryStore } from './store/index.mjs';
import { getLLMRouter } from '../llm/router.mjs';
import { entityTypeLabel, factKeyLabel } from './entity-registry.mjs';
import { outputLanguageDirective } from '../lib/language.mjs';

const store = Store();

const MAX_FACTS = 10;
const MAX_EPISODES = 10;
const EPISODE_SNIPPET_CHARS = 120;
const NOTE_CHARS = 120;
const SUMMARY_MAX_CHARS = 300;

const debounceMs = () => Number(process.env.ENTITY_SUMMARY_DEBOUNCE_MS || 45_000);
const llmEnabled = () => process.env.ENABLE_LLM !== 'false';

// ── 素材构建与指纹 ──────────────────────────────────────────────────────

/**
 * 组装单卡的总结素材。episodes 可传预加载列表（sweep 每用户读一次），
 * 不传则现读 —— listEpisodes 默认 includeExcluded=false，ai_excluded
 * 的碎片在这里就出不了库，无需再过滤。
 */
export function buildInput(userId, entity, { episodes } = {}) {
  const all = episodes ?? getMemoryStore().listEpisodes(userId, { limit: 500 });
  const related = all
    .filter((ep) => Array.isArray(ep.entity_ids) && ep.entity_ids.includes(entity.id))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, MAX_EPISODES)
    .map((ep) => ({
      at: String(ep.created_at || '').slice(0, 10),
      text: String(ep.content_raw || '').slice(0, EPISODE_SNIPPET_CHARS),
    }));
  return {
    name: entity.name || '',
    type: entityTypeLabel(entity.entity_type),
    relation: entity.relation || '',
    facts: (entity.facts || []).slice(0, MAX_FACTS).map((f) => ({ k: factKeyLabel(f.k), v: f.v })),
    note: String(entity.note || '').slice(0, NOTE_CHARS),
    dimensions: entity.dimensions || [],
    recent_memories: related,
  };
}

export function computeSourceHash(input) {
  return crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex');
}

// ── 生成 ────────────────────────────────────────────────────────────────

function buildSystemPrompt(lang) {
  return `你是用户的私人记忆助手。给你一张「图鉴卡」的结构化信息和相关记忆片段，请用第二人称（称用户为"你"）写一段 60-120 字的自然总结：这是谁/什么、和你的关系、最近的动态、对你的意义。只依据给定信息，不要编造；信息很少时写短一点即可，不要凑字数。只输出 JSON：{"summary":"..."}
${outputLanguageDirective(lang)}`;
}

/**
 * 为单卡生成/刷新总结。返回更新后的实体；跳过（ai_excluded / 指纹未变 /
 * LLM 不可用）返回 null 或原实体。force=true 绕过指纹跳过（手动重新生成）。
 * opts.router 供测试注入 stub。
 */
export async function generateFor(userId, entityId, { force = false, episodes, router } = {}) {
  const entity = store.getEntity(userId, entityId);
  if (!entity) return null;
  if (entity.ai_excluded === true) return null; // 隐私红线：不进 LLM

  const input = buildInput(userId, entity, { episodes });
  const hash = computeSourceHash(input);
  const meta = entity.ai_summary_meta;
  if (!force && entity.ai_summary && meta?.status === 'ok' && meta?.source_hash === hash) {
    return entity; // 素材没变，零成本跳过
  }

  const llm = router ?? getLLMRouter();
  if (!llmEnabled() || !llm?.isAvailable?.()) return null; // 不落 failed，留给下次补跑

  const lang = store.getSettings(userId)?.language;
  try {
    const res = await llm.runTask('entity.summary', [
      { role: 'system', content: buildSystemPrompt(lang) },
      { role: 'user', content: JSON.stringify(input) },
    ]);
    const summary = String(res?.json?.summary || '').trim().slice(0, SUMMARY_MAX_CHARS);
    if (!summary) throw new Error('empty summary');
    return store.setEntityAiSummary(userId, entityId, summary, {
      generated_at: new Date().toISOString(),
      source_hash: hash,
      episode_count: input.recent_memories.length,
      provenance: res?.provenance?.provider || 'unknown',
      status: 'ok',
    });
  } catch (e) {
    console.error(`[entity-summary] generate failed for ${entityId}:`, e?.message);
    // 保留旧总结文本；status=failed + 新指纹 → 夜扫/下次变更重试
    return store.setEntityAiSummary(userId, entityId, entity.ai_summary || '', {
      generated_at: new Date().toISOString(),
      source_hash: hash,
      episode_count: input.recent_memories.length,
      provenance: entity.ai_summary_meta?.provenance || null,
      status: 'failed',
    });
  }
}

// ── 事件驱动：防抖 + 串行队列 ───────────────────────────────────────────

const dirtyTimers = new Map(); // `${userId}:${entityId}` → timeout
let queue = Promise.resolve(); // 并发 1：单 JSON store 写放大最小化

function enqueue(userId, entityId) {
  queue = queue
    .then(() => generateFor(userId, entityId))
    .catch((e) => console.error('[entity-summary] queue error:', e?.message));
  return queue;
}

/**
 * 标脏一张卡：防抖窗口内的重复变更合并为一次生成（导入批量确认场景）。
 * 不阻塞调用方 —— 挂钩点直接同步调用即可。
 */
export function markDirty(userId, entityId) {
  if (!userId || !entityId) return;
  const key = `${userId}:${entityId}`;
  const prev = dirtyTimers.get(key);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    dirtyTimers.delete(key);
    enqueue(userId, entityId);
  }, debounceMs());
  timer.unref?.(); // 不阻止进程退出（防抖丢失由启动补跑/夜扫兜底）
  dirtyTimers.set(key, timer);
}

/** 测试用：立刻冲掉某用户所有防抖中的任务并等队列排干。 */
export async function flushDirty() {
  for (const [key, timer] of dirtyTimers) {
    clearTimeout(timer);
    dirtyTimers.delete(key);
    const [userId, entityId] = key.split(':');
    enqueue(userId, entityId);
  }
  await queue;
}

// ── 存量补跑 ────────────────────────────────────────────────────────────

/** 补齐一个用户：缺总结 / 上次失败 / 素材指纹失配的卡逐张生成（串行）。 */
export async function sweep(userId) {
  if (!llmEnabled() || !getLLMRouter()?.isAvailable?.()) return 0;
  const entities = store.listEntities(userId).filter((e) => e.ai_excluded !== true && e.name);
  if (!entities.length) return 0;
  const episodes = getMemoryStore().listEpisodes(userId, { limit: 500 }); // 每用户读一次
  let generated = 0;
  for (const e of entities) {
    const input = buildInput(userId, e, { episodes });
    const hash = computeSourceHash(input);
    const meta = e.ai_summary_meta;
    if (e.ai_summary && meta?.status === 'ok' && meta?.source_hash === hash) continue;
    const updated = await generateFor(userId, e.id, { episodes });
    if (updated?.ai_summary_meta?.status === 'ok') generated += 1;
  }
  return generated;
}

/** 全量补跑（启动错峰调用）。逐用户 best-effort，失败不阻断。 */
export async function sweepAll() {
  const users = (store.listAllUsers?.() ?? []).filter((u) => u && u.id);
  let total = 0;
  for (const u of users) {
    try { total += await sweep(u.id); }
    catch (e) { console.error(`[entity-summary] sweep ${u.id}:`, e?.message); }
  }
  if (total) console.log(`[entity-summary] backfill generated ${total} summaries`);
  return total;
}

export default { buildInput, computeSourceHash, generateFor, markDirty, flushDirty, sweep, sweepAll };
