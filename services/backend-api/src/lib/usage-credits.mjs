/**
 * Smart-credit deduction rules. Manual CRUD on goals/tasks/memory costs 0.
 * @typedef {import('./entitlements.mjs').MembershipTier} MembershipTier
 */

/** @type {Record<string, { smart?: number, visitor?: number, imageExtra?: number }>} */
export const FEATURE_CREDITS = {
  'chat.normal': { smart: 1 },
  'chat.long_memory': { smart: 2 },
  'plan.daily': { smart: 2 },
  'review.evening': { smart: 2 },
  'goal.decompose': { smart: 4 },
  'memory.light_consolidate': { smart: 5 },
  'profile.deep_refresh': { smart: 20 },
  'image.understand': { smart: 1 },
  'image.understand.complex': { smart: 3 },
  'persona.visitor_reply': { visitor: 1 },
};

/** Features that never deduct credits (explicit allowlist). */
export const ZERO_CREDIT_FEATURES = new Set([
  'goal.create',
  'goal.update',
  'goal.delete',
  'task.create',
  'task.update',
  'task.delete',
  'memory.create',
  'memory.update',
  'memory.delete',
]);

/**
 * @param {string} feature
 * @param {{ imageCount?: number, complex?: boolean }} [opts]
 */
export function creditsForFeature(feature, opts = {}) {
  if (ZERO_CREDIT_FEATURES.has(feature)) {
    return { smart: 0, visitor: 0 };
  }
  const base = FEATURE_CREDITS[feature] || { smart: 0, visitor: 0 };
  let smart = base.smart || 0;
  let visitor = base.visitor || 0;
  if (feature === 'image.understand' && opts.imageCount) {
    const per = opts.complex ? 3 : 1;
    smart = per * opts.imageCount;
  }
  return { smart, visitor };
}

/** Rough USD cost estimate from token usage (internal ops). */
export function estimateTokenCostUsd(model, inputTokens, outputTokens) {
  const m = String(model || '').toLowerCase();
  // 自有/本地端点（gedo 车道：Ollama / vLLM 上的 qwen 及未来 gedo-persona-*）：
  // 无外部 API 成本，不得按外部价计入
  if (m.startsWith('gedo') || m.includes('qwen')) return 0;
  let inRate = 0.000003;
  let outRate = 0.000015;
  if (m.includes('haiku')) {
    inRate = 0.00000025;
    outRate = 0.00000125;
  } else if (m.includes('sonnet')) {
    inRate = 0.000003;
    outRate = 0.000015;
  } else if (m.includes('gpt-4o-mini')) {
    inRate = 0.00000015;
    outRate = 0.0000006;
  }
  return (inputTokens * inRate) + (outputTokens * outRate);
}
