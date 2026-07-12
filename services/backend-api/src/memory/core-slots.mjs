/**
 * Core Memory Slots — 通用核心记忆模板
 *
 * Single source of truth for "what GEDO should proactively remember about a
 * person". Each slot describes one core memory point:
 *
 *   - which PCP layer it lives in (L1 identity / L2 working / L3 semantic)
 *   - how important it is (core / high / normal)
 *   - which onboarding question(s) seed it
 *   - which episode type its raw evidence should use
 *   - how to tell whether the user's profile already fills it
 *
 * Consumers:
 *   1. Onboarding ingestion  → maps answers to episode types + profile fields
 *   2. Conversation extractor → injects *unfilled* slots into the extraction
 *      prompt so the model proactively captures them, and tags hits
 *   3. Memory stats / arch view → profile completeness ("画像完成度")
 */

// ── Slot registry ──────────────────────────────────────────────────

export const CORE_SLOTS = [
  {
    id: 'identity.name',
    layer: 'L1',
    importance: 'core',
    label: '称呼',
    hint: '用户希望被怎么称呼（名字/昵称）',
    episode_type: 'personal_trait',
    question_ids: ['name'],
  },
  {
    id: 'identity.role',
    layer: 'L1',
    importance: 'core',
    label: '当前角色',
    hint: '用户当前的主要身份/职业/人生阶段',
    episode_type: 'personal_trait',
    question_ids: ['role'],
  },
  {
    id: 'identity.basics',
    layer: 'L1',
    importance: 'normal',
    label: '基础信息',
    hint: '生日、常驻城市等基础事实',
    episode_type: 'personal_trait',
    question_ids: ['birthday', 'location'],
  },
  {
    id: 'values.core_beliefs',
    layer: 'L1',
    importance: 'core',
    label: '核心价值观',
    hint: '用户最坚信的原则/信念',
    episode_type: 'personal_trait',
    question_ids: ['core_beliefs'],
  },
  {
    id: 'values.non_negotiables',
    layer: 'L1',
    importance: 'high',
    label: '底线原则',
    hint: '用户绝对不能接受的事',
    episode_type: 'personal_trait',
    question_ids: ['non_negotiables'],
  },
  {
    id: 'experience.pivotal_events',
    layer: 'L3',
    importance: 'high',
    label: '关键经历',
    hint: '塑造用户的成功/失败/转折点经历',
    episode_type: 'key_event',
    question_ids: ['pivotal_success', 'pivotal_failure', 'pivotal_turning'],
  },
  {
    id: 'relationships.important_people',
    layer: 'L3',
    importance: 'core',
    label: '重要关系',
    hint: '对用户最重要的人（家人/伴侣/导师/挚友）',
    episode_type: 'relationship_event',
    question_ids: ['important_people', 'relationship_notes'],
  },
  {
    id: 'capabilities.life_wheel',
    layer: 'L3',
    importance: 'high',
    label: '能力地图',
    hint: '八维生命之花自评与能力证据',
    episode_type: 'important_info',
    question_ids: ['life_wheel_self_score', 'capability_evidence'],
  },
  {
    id: 'context.challenges',
    layer: 'L2',
    importance: 'high',
    label: '当前挑战',
    hint: '用户当下最焦虑/最想解决的问题',
    episode_type: 'important_info',
    question_ids: ['top_3_challenges', 'why_now'],
  },
  {
    id: 'vision.north_star',
    layer: 'L1',
    importance: 'core',
    label: '长期愿景',
    hint: '用户的 5/10 年愿景与一句话 north star',
    episode_type: 'personal_trait',
    question_ids: ['future_5y', 'future_10y', 'north_star'],
  },
  {
    id: 'preferences.habits',
    layer: 'L2',
    importance: 'normal',
    label: '偏好与习惯',
    hint: '作息、沟通偏好、做事习惯等（多由对话中渐进采集）',
    episode_type: 'personal_trait',
    question_ids: [],
  },
];

const SLOT_BY_ID = new Map(CORE_SLOTS.map(s => [s.id, s]));
const SLOT_BY_QUESTION = new Map();
for (const slot of CORE_SLOTS) {
  for (const qid of slot.question_ids) SLOT_BY_QUESTION.set(qid, slot);
}

export function getSlot(slotId) {
  return SLOT_BY_ID.get(slotId) || null;
}

export function getSlotForQuestion(questionId) {
  return SLOT_BY_QUESTION.get(questionId) || null;
}

/** Episode type for an onboarding question id (slot mapping + per-question overrides). */
export function episodeTypeForQuestion(questionId) {
  // pivotal_failure carries a lesson — store it as failure_learning, not key_event.
  if (questionId === 'pivotal_failure') return 'failure_learning';
  const slot = getSlotForQuestion(questionId);
  return slot?.episode_type || 'personal_trait';
}

// ── Fill-status checks ─────────────────────────────────────────────

function hasText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function hasItems(v) {
  return Array.isArray(v) && v.length > 0;
}

/**
 * Whether a single slot is filled, given the PCP profile (+ working memory).
 */
export function isSlotFilled(slotId, profile = {}, working = {}) {
  const ci = profile.core_identity || {};
  const sm = profile.semantic_memory || {};
  switch (slotId) {
    case 'identity.name':
      return hasText(ci.name);
    case 'identity.role':
      return hasText(ci.profession);
    case 'identity.basics':
      return hasText(ci.birthday) || hasText(ci.location);
    case 'values.core_beliefs':
      return hasItems(ci.values?.top_priorities);
    case 'values.non_negotiables':
      return hasItems(ci.values?.non_negotiables);
    case 'experience.pivotal_events':
      return hasItems(sm.milestone_events) || hasItems(sm.failure_learnings);
    case 'relationships.important_people':
      return hasItems(sm.relationship_map) || hasItems(ci.key_relationships);
    case 'capabilities.life_wheel': {
      const dims = sm.dimensions || {};
      return Object.values(dims).some(d => d && (d.self_score != null || hasText(d.summary)));
    }
    case 'context.challenges':
      return hasItems(working?.current_context?.challenges);
    case 'vision.north_star':
      return hasText(ci.vision?.north_star) || hasText(ci.vision?.five_year);
    case 'preferences.habits':
      return hasItems(working?.habits?.productive_hours)
        || hasText(ci.preferences?.communication_style)
        || hasText(ci.communication?.preferred_tone);
    default:
      return false;
  }
}

/**
 * Completeness summary for the whole template.
 * Returns { total, filled, percent, slots: [{ id, label, layer, importance, filled, filled_via }] }
 *
 * When `episodes` are provided, each filled slot also gets a provenance
 * heuristic `filled_via`: 'chat' when only non-onboarding episodes carry its
 * slot:<id> tag (对话自动补全), otherwise 'onboarding'. Cheap but good enough
 * for the beta provenance pill.
 */
export function getSlotFillStatus(profile = {}, working = {}, episodes = null) {
  const slotSources = new Map(); // slotId → { onboarding: bool, chat: bool }
  if (Array.isArray(episodes)) {
    for (const ep of episodes) {
      const tags = Array.isArray(ep.tags) ? ep.tags : [];
      for (const t of tags) {
        if (typeof t === 'string' && t.startsWith('slot:')) {
          const sid = t.slice(5);
          const cur = slotSources.get(sid) || { onboarding: false, chat: false };
          if (tags.includes('onboarding')) cur.onboarding = true;
          else cur.chat = true;
          slotSources.set(sid, cur);
        }
      }
    }
  }
  const slots = CORE_SLOTS.map(s => {
    const filled = isSlotFilled(s.id, profile, working);
    const src = slotSources.get(s.id);
    const filled_via = !filled ? null : (src?.chat && !src?.onboarding ? 'chat' : 'onboarding');
    return {
      id: s.id,
      label: s.label,
      layer: s.layer,
      importance: s.importance,
      hint: s.hint,
      filled,
      filled_via,
    };
  });
  const filled = slots.filter(s => s.filled).length;
  return {
    total: slots.length,
    filled,
    percent: Math.round((filled / slots.length) * 100),
    slots,
  };
}

/** Unfilled slots — used to steer the conversation extractor. */
export function getUnfilledSlots(profile = {}, working = {}) {
  return CORE_SLOTS.filter(s => !isSlotFilled(s.id, profile, working));
}

/**
 * Best-effort profile backfill when a conversation extraction hits a slot.
 * Only touches simple, append-safe targets; never overwrites existing values.
 * Returns a { profilePatch, workingPatch } pair (either may be null).
 */
export function buildSlotPatches(slotId, content, profile = {}, working = {}) {
  const text = String(content || '').trim();
  if (!text) return { profilePatch: null, workingPatch: null };
  const ci = profile.core_identity || {};
  const sm = profile.semantic_memory || {};

  switch (slotId) {
    case 'identity.role':
      if (hasText(ci.profession)) return { profilePatch: null, workingPatch: null };
      return { profilePatch: { core_identity: { profession: text.slice(0, 100) } }, workingPatch: null };
    case 'values.core_beliefs': {
      const existing = ci.values?.top_priorities || [];
      if (existing.includes(text) || existing.length >= 10) return { profilePatch: null, workingPatch: null };
      return {
        profilePatch: { core_identity: { values: { top_priorities: [...existing, text.slice(0, 120)] } } },
        workingPatch: null,
      };
    }
    case 'vision.north_star':
      if (hasText(ci.vision?.north_star)) return { profilePatch: null, workingPatch: null };
      return { profilePatch: { core_identity: { vision: { north_star: text.slice(0, 200) } } }, workingPatch: null };
    case 'experience.pivotal_events': {
      const events = sm.milestone_events || [];
      return {
        profilePatch: {
          semantic_memory: {
            milestone_events: [...events, { event: text.slice(0, 300), impact: null, ts: new Date().toISOString(), tags: ['auto_extract'] }],
          },
        },
        workingPatch: null,
      };
    }
    case 'context.challenges': {
      const existing = working?.current_context?.challenges || [];
      if (existing.includes(text)) return { profilePatch: null, workingPatch: null };
      return {
        profilePatch: null,
        workingPatch: { current_context: { challenges: [...existing, text.slice(0, 200)].slice(0, 10) } },
      };
    }
    default:
      // Other slots (name/relationships/life-wheel/...) need structured input;
      // they are filled by onboarding or consolidation, not free-text hits.
      return { profilePatch: null, workingPatch: null };
  }
}

export default {
  CORE_SLOTS,
  getSlot,
  getSlotForQuestion,
  episodeTypeForQuestion,
  isSlotFilled,
  getSlotFillStatus,
  getUnfilledSlots,
  buildSlotPatches,
};
