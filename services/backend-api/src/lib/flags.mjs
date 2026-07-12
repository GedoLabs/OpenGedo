/**
 * Feature Flags (横切关注点)
 *
 * 读取顺序：process.env → feature_flags 表（用户级 override 高于全局）
 *
 * 当前支持的 flag（与计划文档一致）：
 *   FEATURE_CHAT_FIRST_UI     — S0-2 chat-first UI（生产先 48h 关闭）
 *   FEATURE_GENUI_V1          — P1-B Generative UI 卡片
 *   FEATURE_PROACTIVE         — P2-B 主动 Agent
 *   FEATURE_LAYERED_MEMORY    — P3-A L1-L5 记忆层抽象
 *   FEATURE_HYBRID_V2         — P3-B 4 路 Hybrid Retrieval
 *   FEATURE_PERSONA_AS_MODE   — P3-C AS 代写模式（opt-in）
 *
 * 用法：
 *   import { isEnabled } from '../lib/flags.mjs';
 *   if (isEnabled('FEATURE_GENUI_V1', userId)) { ... }
 */

const ENV_FLAGS = {
  FEATURE_CHAT_FIRST_UI:   process.env.FEATURE_CHAT_FIRST_UI   !== 'false',
  FEATURE_GENUI_V1:        process.env.FEATURE_GENUI_V1        !== 'false',
  FEATURE_PROACTIVE:       process.env.FEATURE_PROACTIVE       === 'true',
  FEATURE_LAYERED_MEMORY:  process.env.FEATURE_LAYERED_MEMORY  === 'true',
  FEATURE_HYBRID_V2:       process.env.FEATURE_HYBRID_V2       === 'true',
  FEATURE_PERSONA_AS_MODE: process.env.FEATURE_PERSONA_AS_MODE === 'true',
};

// In-memory per-user override cache: { userId -> { flagName -> bool } }
// Phase 2: replace with DB-backed feature_flags table + pg LISTEN/NOTIFY refresh.
const _userOverrides = new Map();

/**
 * Set a per-user feature flag override (used by admin endpoints / tests).
 * @param {string} userId
 * @param {string} flag
 * @param {boolean} value
 */
export function setUserFlag(userId, flag, value) {
  if (!_userOverrides.has(userId)) _userOverrides.set(userId, {});
  _userOverrides.get(userId)[flag] = Boolean(value);
}

/**
 * Check whether a feature flag is enabled.
 * User-level override (if present) takes precedence over global env value.
 *
 * @param {string} flag  — e.g. 'FEATURE_GENUI_V1'
 * @param {string} [userId] — optional; if provided checks per-user override first
 * @returns {boolean}
 */
export function isEnabled(flag, userId) {
  if (userId && _userOverrides.has(userId)) {
    const overrides = _userOverrides.get(userId);
    if (flag in overrides) return overrides[flag];
  }
  return ENV_FLAGS[flag] ?? false;
}

/**
 * Return all flags enabled for a given user (for /v1/me/flags endpoint).
 * @param {string} [userId]
 * @returns {Record<string, boolean>}
 */
export function getAllFlags(userId) {
  const result = { ...ENV_FLAGS };
  if (userId && _userOverrides.has(userId)) {
    Object.assign(result, _userOverrides.get(userId));
  }
  return result;
}
