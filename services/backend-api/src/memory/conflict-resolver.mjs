/**
 * Memory Conflict Resolution & Versioning
 *
 * From PCP Architecture §4.5:
 *   Detect  → New extraction contradicts existing L1/L2 field
 *   Branch  → Create conflict node with both versions + evidence
 *   Resolve → Nightly LLM pass reconciles by temporal order + context weight
 *             Low-confidence outcomes flagged for user confirmation
 */

import { getLLMRouter } from '../llm/router.mjs';
import { getMemoryStore } from './store/index.mjs';
const {
  getProfile,
  updateProfile,
  getConflicts,
  resolveConflict: resolveConflictInStore,
} = getMemoryStore();

const CONFLICT_RESOLUTION_PROMPT = `你是一个用户画像冲突仲裁者。以下是用户画像中检测到的矛盾。

冲突详情：
字段路径：{FIELD}
旧值：{OLD_VALUE}
新值：{NEW_VALUE}
旧值证据：{OLD_EVIDENCE}
新值证据：{NEW_EVIDENCE}

请根据以下原则判断：
1. 时间优先：新信息通常更准确（但不绝对）
2. 上下文权重：哪个来源更可靠
3. 一致性：与用户画像其他部分的一致性
4. 如果无法确定，标记为"需要用户确认"

输出JSON：
{
  "resolution": "keep_old" | "accept_new" | "merge" | "needs_user_confirmation",
  "resolved_value": "最终采用的值（merge时为合并值）",
  "confidence": 0.0-1.0,
  "reasoning": "简短推理过程"
}

只输出JSON。`;

/**
 * Detect potential conflicts between new data and existing profile.
 *
 * @param {object} existingProfile
 * @param {object} newData - Proposed updates from consolidation
 * @returns {object[]} Array of detected conflicts
 */
export function detectConflicts(existingProfile, newData) {
  const conflicts = [];

  const ci = existingProfile.core_identity || {};
  const newCI = newData.core_identity || {};

  // Check scalar fields
  const scalarChecks = [
    { path: 'core_identity.name', old: ci.name, new: newCI.name },
    { path: 'core_identity.profession', old: ci.profession, new: newCI.profession },
    { path: 'core_identity.personality.mbti_proxy', old: ci.personality?.mbti_proxy, new: newCI.personality?.mbti_proxy },
    { path: 'core_identity.cognition.learning_style', old: ci.cognition?.learning_style, new: newCI.cognition?.learning_style },
    { path: 'core_identity.cognition.reasoning_mode', old: ci.cognition?.reasoning_mode, new: newCI.cognition?.reasoning_mode },
    { path: 'core_identity.communication.preferred_tone', old: ci.communication?.preferred_tone, new: newCI.communication?.preferred_tone },
  ];

  for (const check of scalarChecks) {
    if (check.old && check.new && check.old !== check.new) {
      conflicts.push({
        field: check.path,
        old_value: check.old,
        new_value: check.new,
        type: 'scalar_contradiction',
      });
    }
  }

  // Check Big5 significant shifts (>0.3 delta)
  if (ci.personality?.big5 && newCI.personality?.big5) {
    for (const trait of ['O', 'C', 'E', 'A', 'N']) {
      const oldVal = ci.personality.big5[trait];
      const newVal = newCI.personality.big5[trait];
      if (oldVal != null && newVal != null && Math.abs(oldVal - newVal) > 0.3) {
        conflicts.push({
          field: `core_identity.personality.big5.${trait}`,
          old_value: oldVal,
          new_value: newVal,
          type: 'personality_drift',
        });
      }
    }
  }

  // Check value priority changes
  if (ci.values?.top_priorities?.length && newCI.values?.top_priorities?.length) {
    const removed = ci.values.top_priorities.filter(v => !newCI.values.top_priorities.includes(v));
    if (removed.length > 0) {
      conflicts.push({
        field: 'core_identity.values.top_priorities',
        old_value: ci.values.top_priorities,
        new_value: newCI.values.top_priorities,
        type: 'value_shift',
      });
    }
  }

  return conflicts;
}

/**
 * Resolve all unresolved conflicts using LLM.
 *
 * @param {string} userId
 * @returns {{ resolved: number, pending: number, results: object[] }}
 */
export async function resolveAllConflicts(userId) {
  const conflicts = getConflicts(userId);
  const unresolved = conflicts.filter(c => !c.resolved);

  if (unresolved.length === 0) {
    return { resolved: 0, pending: 0, results: [] };
  }

  const router = getLLMRouter();
  const results = [];

  for (const conflict of unresolved) {
    if (router.isAvailable()) {
      try {
        const result = await resolveSingleConflict(userId, conflict, router);
        results.push(result);
      } catch (error) {
        console.error(`[ConflictResolver] Error resolving ${conflict.field}:`, error.message);
        results.push({ field: conflict.field, resolution: 'error', error: error.message });
      }
    } else {
      // Without LLM, mark as needing user confirmation
      resolveConflictInStore(userId, conflict.id, {
        resolution: 'needs_user_confirmation',
        reasoning: 'LLM unavailable for automatic resolution',
      });
      results.push({ field: conflict.field, resolution: 'needs_user_confirmation' });
    }
  }

  const resolved = results.filter(r => r.resolution !== 'needs_user_confirmation' && r.resolution !== 'error').length;
  const pending = results.length - resolved;

  return { resolved, pending, results };
}

async function resolveSingleConflict(userId, conflict, router) {
  const prompt = CONFLICT_RESOLUTION_PROMPT
    .replace('{FIELD}', conflict.field)
    .replace('{OLD_VALUE}', JSON.stringify(conflict.old_value))
    .replace('{NEW_VALUE}', JSON.stringify(conflict.new_value))
    .replace('{OLD_EVIDENCE}', conflict.old_evidence || '(无)')
    .replace('{NEW_EVIDENCE}', conflict.new_evidence || '(无)');

  const response = await router.runTask('memory.conflict', [
    { role: 'user', content: prompt },
  ]);
  const parsed = response.json;

  // Apply resolution
  if (parsed.resolution === 'accept_new' || parsed.resolution === 'merge') {
    const resolvedValue = parsed.resolved_value ?? conflict.new_value;
    applyConflictResolution(userId, conflict.field, resolvedValue);
  }

  resolveConflictInStore(userId, conflict.id, {
    resolution: parsed.resolution,
    resolved_value: parsed.resolved_value,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    resolved_by: response.provenance?.model || null,
  });

  return {
    field: conflict.field,
    resolution: parsed.resolution,
    confidence: parsed.confidence,
  };
}

function applyConflictResolution(userId, fieldPath, value) {
  const parts = fieldPath.split('.');
  if (parts[0] !== 'core_identity') return;

  const profile = getProfile(userId);
  let target = profile;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]]) target[parts[i]] = {};
    target = target[parts[i]];
  }

  target[parts[parts.length - 1]] = value;
  updateProfile(userId, { core_identity: profile.core_identity });
}

/**
 * Get pending conflicts that need user confirmation.
 */
export function getPendingConflicts(userId) {
  const conflicts = getConflicts(userId);
  return conflicts.filter(c => !c.resolved || c.resolution?.resolution === 'needs_user_confirmation');
}

export default {
  detectConflicts,
  resolveAllConflicts,
  getPendingConflicts,
};
