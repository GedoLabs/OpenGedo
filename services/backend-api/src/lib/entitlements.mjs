import { isOSS } from './edition.mjs';

/**
 * Self-hosted (GEDO_EDITION=oss): no SaaS quotas — operator supplies LLM keys.
 * @type {TierEntitlements}
 */
export const OSS_ENTITLEMENTS = {
  activeGoalsLimit: null,
  memoryItemsLimit: null,
  smartCreditsMonthly: Number.MAX_SAFE_INTEGER,
  imagesMonthly: Number.MAX_SAFE_INTEGER,
  profileRefreshMonthly: Number.MAX_SAFE_INTEGER,
  personaPublishLimit: Number.MAX_SAFE_INTEGER,
  personaVisitorRepliesMonthly: Number.MAX_SAFE_INTEGER,
  personaDraftPreview: true,
  personaTwinLora: true,
  importSourcesMonthly: Number.MAX_SAFE_INTEGER,
  importQueueWeight: 20,
  memoryMcpAccess: true,
};

/**
 * Single source of truth for tier limits — do not duplicate in frontends.
 *
 * Two independent quota tracks:
 *  - 智能额度 (smart): internal AI (chat/plan/memory/image) → `smartCreditsMonthly` / credits_deducted.
 *  - 分身额度 (persona): the digital persona feature, billed separately and reserved for future
 *    expansion-pack / personal-model add-ons. Tracked via `personaVisitorRepliesMonthly` /
 *    visitor_credits_deducted. Today the only consumer is visitor replies; new persona consumers
 *    (training, packs…) should reuse the same `visitor` bucket. Internal numbers — never shown raw
 *    on the public landing page (qualitative tiers only, to avoid usage anxiety).
 */

export const TIERS = ['free', 'pro', 'ultra'];

/** @typedef {'free'|'pro'|'ultra'} MembershipTier */

/**
 * @typedef {Object} TierEntitlements
 * @property {number|null} activeGoalsLimit null = unlimited
 * @property {number|null} memoryItemsLimit
 * @property {number} smartCreditsMonthly
 * @property {number} imagesMonthly
 * @property {number} profileRefreshMonthly
 * @property {number} personaPublishLimit
 * @property {number} personaVisitorRepliesMonthly 分身额度（当前消费方=访客回复）
 * @property {boolean} personaDraftPreview
 * @property {boolean} personaTwinLora 个人 LoRA（Twin 分身模型，docs/GEDO_TWIN_LORA_PLAN.md）
 * @property {number} importSourcesMonthly 记忆来源导入（来源中心）每月新建来源数上限。
 *   配额哲学对齐 NotebookLM：分层卖"来源数量+队列优先级"，单来源体积上限恒定不分层
 *   （体积常量在 source-pipeline / chunking，不在此处）。
 * @property {number} importQueueWeight 导入队列基础优先级权重（job-queue 里每等待
 *   1 分钟 +0.5 老化，free 追平 pro 约需 20 分钟——会员优先但不饿死免费）。
 * @property {boolean} memoryMcpAccess 记忆 MCP（个人记忆对外接口，能力开放 E2）。
 *   Pro 及以上专属（2026-07-07 定案）：计量的是对外输出接口，不是内核循环，
 *   不违背 D4"内核循环永不设限"。
 */

/** @type {Record<MembershipTier, TierEntitlements>} */
export const TIER_ENTITLEMENTS = {
  free: {
    activeGoalsLimit: 5,
    memoryItemsLimit: 200,
    smartCreditsMonthly: 100,
    imagesMonthly: 10,
    profileRefreshMonthly: 0,
    personaPublishLimit: 0,
    personaVisitorRepliesMonthly: 0,
    personaDraftPreview: false,
    personaTwinLora: false,
    importSourcesMonthly: 10,
    importQueueWeight: 0,
    memoryMcpAccess: false,
  },
  pro: {
    activeGoalsLimit: null,
    memoryItemsLimit: null,
    smartCreditsMonthly: 800,
    imagesMonthly: 100,
    profileRefreshMonthly: 2,
    personaPublishLimit: 1,
    personaVisitorRepliesMonthly: 100, // 分身额度·体验级（对外不展示）
    personaDraftPreview: true,
    personaTwinLora: false, // Twin 归 ultra；放开到 pro 只改这一行
    importSourcesMonthly: 100,
    importQueueWeight: 10,
    memoryMcpAccess: true,
  },
  ultra: {
    activeGoalsLimit: null,
    memoryItemsLimit: null,
    smartCreditsMonthly: 2500,
    imagesMonthly: 300,
    profileRefreshMonthly: 8,
    personaPublishLimit: 1,
    personaVisitorRepliesMonthly: 1000, // 分身额度·基础使用（对外不展示）
    personaDraftPreview: true,
    personaTwinLora: true,
    importSourcesMonthly: 300,
    importQueueWeight: 20,
    memoryMcpAccess: true,
  },
};

/** @param {unknown} tier */
export function normalizeTier(tier) {
  const t = String(tier || 'free').toLowerCase();
  return TIERS.includes(t) ? /** @type {MembershipTier} */ (t) : 'free';
}

/** @param {MembershipTier} tier */
export function getEntitlementsForTier(tier) {
  if (isOSS()) return OSS_ENTITLEMENTS;
  return TIER_ENTITLEMENTS[normalizeTier(tier)];
}

/**
 * Semi-transparent usage label for UI.
 * @param {number} used
 * @param {number|null} limit
 * @returns {'normal'|'high'|'near_limit'|null}
 */
export function usageLevel(used, limit) {
  if (limit == null || limit <= 0) return 'normal';
  const pct = used / limit;
  if (pct >= 0.85) return 'near_limit';
  if (pct >= 0.6) return 'high';
  return 'normal';
}

/**
 * @param {MembershipTier} tier
 * @param {number} used
 * @param {number|null} limit
 */
export function formatUsageDisplay(tier, used, limit) {
  const t = normalizeTier(tier);
  if (limit == null) return { kind: 'status', level: 'normal', percent: null };
  const percent = Math.min(100, Math.round((used / limit) * 100));
  if (t === 'free') return { kind: 'percent', percent, level: usageLevel(used, limit) };
  if (t === 'ultra') return { kind: 'status', level: usageLevel(used, limit), percent: null };
  return { kind: 'status', level: usageLevel(used, limit), percent: null };
}
