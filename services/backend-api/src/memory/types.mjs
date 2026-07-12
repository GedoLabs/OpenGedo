/**
 * PCP (Persistent Cognitive Profile) Type Definitions & Constants
 *
 * Three-layer PCP file model (on disk, 5–50 KB):
 *   L1 Core Identity     – stable personality, values, cognition, expertise
 *   L2 Working Memory    – active goals, context, recent decisions, habits
 *   L3 Episodic Archive  – compressed summaries, milestones, failure learnings
 *
 * Five-layer runtime memory stack:
 *   L0 In-Context Flash  – live conversation window (ephemeral)
 *   L1 Core Identity     – from PCP file
 *   L2 Working Memory    – from PCP file
 *   L3 Semantic Long-Term – from PCP file
 *   L4 Vector Index      – external DB (pgvector)
 */

// ── PCP file version (semver) ─────────────────────────────────────
export const PCP_VERSION = '2.0.0';

// ── Life-wheel dimensions ─────────────────────────────────────────
export const LIFE_DIMENSIONS = [
  'health', 'career', 'family', 'finance',
  'growth', 'social', 'hobby', 'self_realization',
];

// ── Personality enums ─────────────────────────────────────────────
export const LEARNING_STYLES = ['visual', 'verbal', 'kinesthetic'];
export const REASONING_MODES = ['systematic', 'intuitive', 'mixed'];
export const COMMUNICATION_TONES = ['direct', 'nurturing', 'analytical'];

// ── Episode types ─────────────────────────────────────────────────
export const EPISODE_TYPES = [
  'important_info',
  'personal_trait',
  'key_event',
  'date_reminder',
  'milestone',
  'failure_learning',
  'decision',
  'relationship_event',
];

// ── Episode sources ───────────────────────────────────────────────
// 'import' = 来源中心导入候选确认落库（此类 episode 同时带 source_id 回链）。
export const EPISODE_SOURCES = [
  'text', 'chat', 'auto_extract', 'voice',
  'image', 'reflection', 'system', 'consolidation', 'import',
];

// ── Intent types (for retrieval gate) ─────────────────────────────
export const INTENT_TYPES = [
  'goal_planning',
  'task_check',
  'reflection',
  'emotional',
  'casual',
];

// ── Emotional trend labels ────────────────────────────────────────
export const EMOTIONAL_TRENDS = [
  'very_positive', 'positive', 'neutral',
  'slightly_stressed', 'stressed', 'anxious',
];

// ── Goal phases ───────────────────────────────────────────────────
export const GOAL_PHASES = [
  'planning', 'in_progress', 'review', 'completed', 'paused', 'abandoned',
];

// ── Token budgets ─────────────────────────────────────────────────
export const TOKEN_BUDGET = {
  l0_flash: 2000,
  l1_core_identity: 800,
  l2_working_memory: 1200,
  l3_semantic: 2000,
  // 图鉴实体卡事实块（提及"妈妈/那辆车"时注入的结构化事实）
  l35_entities: 400,
  l4_episodic: 1500,
  total_context: 6000,
};

// ── TSS weights (α, β, γ, δ) ─────────────────────────────────────
export const TSS_WEIGHTS = {
  default:        { alpha: 0.4, beta: 0.25, gamma: 0.2, delta: 0.15 },
  goal_planning:  { alpha: 0.3, beta: 0.15, gamma: 0.4, delta: 0.15 },
  task_check:     { alpha: 0.3, beta: 0.4,  gamma: 0.15, delta: 0.15 },
  reflection:     { alpha: 0.35, beta: 0.1, gamma: 0.3, delta: 0.25 },
  emotional:      { alpha: 0.45, beta: 0.3, gamma: 0.15, delta: 0.1 },
  casual:         { alpha: 0.5, beta: 0.2,  gamma: 0.2, delta: 0.1 },
};

// ── Consolidation schedule thresholds ─────────────────────────────
export const CONSOLIDATION_SCHEDULE = {
  session_end: { delay_ms: 0 },
  nightly:     { cron: '0 3 * * *', max_episodes: 100 },
  weekly:      { cron: '0 4 * * 1', propagate_to_l1: true },
  quarterly:   { cron: '0 5 1 1,4,7,10 *', re_summarize: true },
};

// ── Working memory TTL (days) ─────────────────────────────────────
export const WORKING_MEMORY_TTL_DAYS = 7;

// ── Low-confidence threshold ──────────────────────────────────────
// Memories at/below this confidence should be hedged ("⚠低置信") when
// surfaced, and the model is instructed not to treat them as hard fact.
// Aligns with the episode `confidence ?? 1.0` default.
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

// ══════════════════════════════════════════════════════════════════
//  L1 Core Identity — Defaults & Factories
// ══════════════════════════════════════════════════════════════════

export function createDefaultCoreIdentity() {
  return {
    personality: {
      big5: null,             // { O, C, E, A, N } floats 0-1
      mbti_proxy: null,       // string e.g. "INTJ"
    },
    cognition: {
      learning_style: null,   // visual | verbal | kinesthetic
      reasoning_mode: null,   // systematic | intuitive | mixed
      decision_speed: null,   // float 0-1
    },
    values: {
      top_priorities: [],     // string[]
    },
    communication: {
      preferred_tone: null,   // direct | nurturing | analytical
      verbosity: null,        // float 0-1
    },
    expertise: {
      domains: [],            // [{ domain, level }]
      skill_graph: [],        // [{ from, to, strength }]
    },
    // Legacy compatibility fields
    name: null,
    profession: null,
    traits: [],
    key_relationships: [],
    preferences: {
      communication_style: null,
      motivation_type: null,
    },
  };
}

// ══════════════════════════════════════════════════════════════════
//  L2 Working Memory — Defaults & Factories
// ══════════════════════════════════════════════════════════════════

export function createDefaultWorkingMemory() {
  return {
    version: PCP_VERSION,
    active_goals: [],         // [{ id, title, phase, progress, created_at }]
    current_context: {
      focus_domain: null,
      emotional_state: 'neutral',
    },
    recent_decisions: [],     // [{ decision, rationale, ts }]
    habits: {
      productive_hours: [],   // int[] 24h format
    },
    conversation_continuity: {
      last_topic: null,
      unresolved: null,
    },
    pending_items: [],
    updated_at: new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════
//  L3 Episodic Archive — Defaults & Factories
// ══════════════════════════════════════════════════════════════════

export function createDefaultSemanticMemory() {
  const dimensions = {};
  for (const dim of LIFE_DIMENSIONS) {
    dimensions[dim] = {
      summary: '',
      skills: [],
      patterns: [],
      recent_insight: null,
    };
  }
  return {
    dimensions,
    cross_dimension_patterns: [],
    long_term_summaries: [],    // [{ period, summary, tags }]
    milestone_events: [],       // [{ event, impact, ts, tags }]
    failure_learnings: [],      // [{ context, lesson, applied }]
    relationship_map: [],       // [{ name, role, trust, last_interaction }]
    growth_trajectory: {
      skill_delta: [],          // [{ skill, delta, period }]
    },
  };
}

// ══════════════════════════════════════════════════════════════════
//  PCP Profile — Combined Factory
// ══════════════════════════════════════════════════════════════════

export function createDefaultProfile() {
  return {
    version: PCP_VERSION,
    core_identity: createDefaultCoreIdentity(),
    semantic_memory: createDefaultSemanticMemory(),
    last_consolidated: null,
    conflict_log: [],           // [{ field, old_value, new_value, evidence, resolved, resolution }]
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════
//  Episode Factory
// ══════════════════════════════════════════════════════════════════

export function createEpisode({
  id, userId, type, contentRaw, tags, source, sourceId,
  contentStruct, reminderDate, confidence, impactScore, aiExcluded,
  entityIds, dimensions,
}) {
  if (!EPISODE_TYPES.includes(type)) {
    throw new Error(`Invalid episode type: ${type}. Must be one of: ${EPISODE_TYPES.join(', ')}`);
  }
  return {
    id,
    user_id: userId,
    type,
    content_raw: contentRaw,
    content_struct: contentStruct || {},
    tags: tags || [],
    // 白名单钳制：脏值（如历史前端误传的 'chat_extract'）一律落 'text'，
    // 保证「与智伴的对话/手动记录」等按 source 的过滤口径稳定。
    source: EPISODE_SOURCES.includes(source) ? source : 'text',
    // 来源中心回链：由哪个导入 Source 产出（null = 对话/手动）。
    source_id: sourceId ? String(sourceId) : null,
    reminder_date: reminderDate || null,
    confidence: confidence ?? 1.0,
    impact_score: impactScore ?? 0.5,
    usage_count: 0,
    consolidated: false,
    // Privacy: when true the episode is never injected into AI context
    // (retrieval filters it out) but remains visible in the user's own
    // memory browser. Missing on legacy rows → treated as false.
    ai_excluded: aiExcluded ?? false,
    // Entity cards (图鉴) this fragment references, and the life-flower
    // dimensions it touches. Missing on legacy rows → treated as [].
    entity_ids: Array.isArray(entityIds) ? entityIds.map(String) : [],
    dimensions: Array.isArray(dimensions)
      ? dimensions.filter((d) => LIFE_DIMENSIONS.includes(d))
      : [],
    created_at: new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════
//  Validation Helpers
// ══════════════════════════════════════════════════════════════════

export function validateCoreIdentity(obj) {
  if (!obj || typeof obj !== 'object') return { valid: false, error: 'core_identity must be an object' };

  if (obj.personality?.big5) {
    const keys = ['O', 'C', 'E', 'A', 'N'];
    for (const k of keys) {
      if (obj.personality.big5[k] !== undefined && (typeof obj.personality.big5[k] !== 'number' || obj.personality.big5[k] < 0 || obj.personality.big5[k] > 1)) {
        return { valid: false, error: `Big5 ${k} must be a float between 0 and 1` };
      }
    }
  }

  if (obj.cognition?.learning_style && !LEARNING_STYLES.includes(obj.cognition.learning_style)) {
    return { valid: false, error: `Invalid learning_style: ${obj.cognition.learning_style}` };
  }

  if (obj.cognition?.reasoning_mode && !REASONING_MODES.includes(obj.cognition.reasoning_mode)) {
    return { valid: false, error: `Invalid reasoning_mode: ${obj.cognition.reasoning_mode}` };
  }

  if (obj.communication?.preferred_tone && !COMMUNICATION_TONES.includes(obj.communication.preferred_tone)) {
    return { valid: false, error: `Invalid preferred_tone: ${obj.communication.preferred_tone}` };
  }

  if (obj.traits && !Array.isArray(obj.traits)) return { valid: false, error: 'traits must be an array' };
  if (obj.key_relationships && !Array.isArray(obj.key_relationships)) return { valid: false, error: 'key_relationships must be an array' };

  return { valid: true };
}

export function validateSemanticMemory(obj) {
  if (!obj || typeof obj !== 'object') return { valid: false, error: 'semantic_memory must be an object' };
  if (obj.dimensions && typeof obj.dimensions !== 'object') return { valid: false, error: 'dimensions must be an object' };
  if (obj.dimensions) {
    for (const dim of Object.keys(obj.dimensions)) {
      if (!LIFE_DIMENSIONS.includes(dim)) return { valid: false, error: `Unknown dimension: ${dim}` };
    }
  }
  if (obj.cross_dimension_patterns && !Array.isArray(obj.cross_dimension_patterns)) {
    return { valid: false, error: 'cross_dimension_patterns must be an array' };
  }
  if (obj.milestone_events && !Array.isArray(obj.milestone_events)) {
    return { valid: false, error: 'milestone_events must be an array' };
  }
  if (obj.failure_learnings && !Array.isArray(obj.failure_learnings)) {
    return { valid: false, error: 'failure_learnings must be an array' };
  }
  if (obj.relationship_map && !Array.isArray(obj.relationship_map)) {
    return { valid: false, error: 'relationship_map must be an array' };
  }
  return { valid: true };
}

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') return { valid: false, error: 'profile must be an object' };
  const ciResult = validateCoreIdentity(profile.core_identity);
  if (!ciResult.valid) return ciResult;
  const smResult = validateSemanticMemory(profile.semantic_memory);
  if (!smResult.valid) return smResult;
  return { valid: true };
}

export function validateWorkingMemory(wm) {
  if (!wm || typeof wm !== 'object') return { valid: false, error: 'working memory must be an object' };
  if (wm.active_goals && !Array.isArray(wm.active_goals)) {
    return { valid: false, error: 'active_goals must be an array' };
  }
  if (wm.recent_decisions && !Array.isArray(wm.recent_decisions)) {
    return { valid: false, error: 'recent_decisions must be an array' };
  }
  if (wm.pending_items && !Array.isArray(wm.pending_items)) {
    return { valid: false, error: 'pending_items must be an array' };
  }
  if (wm.current_context?.emotional_state && !EMOTIONAL_TRENDS.includes(wm.current_context.emotional_state)) {
    return { valid: false, error: `Invalid emotional_state: ${wm.current_context.emotional_state}` };
  }
  return { valid: true };
}

// ══════════════════════════════════════════════════════════════════
//  Migration helper — upgrade v1.0 profile to v2.0
// ══════════════════════════════════════════════════════════════════

export function migrateProfileV1ToV2(v1Profile) {
  const v2 = createDefaultProfile();

  // Migrate L1 core identity
  const ci = v1Profile.core_identity || {};
  v2.core_identity.name = ci.name || null;
  v2.core_identity.profession = ci.profession || null;
  v2.core_identity.traits = ci.traits || [];
  v2.core_identity.key_relationships = ci.key_relationships || [];
  v2.core_identity.preferences = ci.preferences || { communication_style: null, motivation_type: null };

  if (ci.preferences?.communication_style) {
    const toneMap = { '直接': 'direct', '温和': 'nurturing', '分析': 'analytical' };
    v2.core_identity.communication.preferred_tone =
      toneMap[ci.preferences.communication_style] || ci.preferences.communication_style;
  }

  // Migrate semantic memory (L2 → L3 in PCP)
  const sm = v1Profile.semantic_memory || {};
  if (sm.dimensions) {
    v2.semantic_memory.dimensions = sm.dimensions;
  }
  if (sm.cross_dimension_patterns) {
    v2.semantic_memory.cross_dimension_patterns = sm.cross_dimension_patterns;
  }

  v2.last_consolidated = v1Profile.last_consolidated;
  v2.created_at = v1Profile.created_at || new Date().toISOString();
  v2.updated_at = new Date().toISOString();

  return v2;
}

export function migrateWorkingMemoryV1ToV2(v1Wm) {
  const v2 = createDefaultWorkingMemory();

  if (v1Wm.active_focus) {
    v2.active_goals.push({
      id: `goal_migrated_${Date.now()}`,
      title: v1Wm.active_focus,
      phase: 'in_progress',
      progress: 0,
      created_at: v1Wm.updated_at || new Date().toISOString(),
    });
    v2.current_context.focus_domain = v1Wm.active_focus;
  }

  if (v1Wm.emotional_trend) {
    v2.current_context.emotional_state = v1Wm.emotional_trend;
  }

  v2.recent_decisions = (v1Wm.recent_decisions || []).map(d => ({
    decision: d.decision,
    rationale: '',
    ts: d.date || new Date().toISOString(),
  }));

  v2.pending_items = v1Wm.pending_items || [];
  v2.conversation_continuity = v1Wm.conversation_continuity || { last_topic: null, unresolved: null };

  return v2;
}

export default {
  PCP_VERSION,
  LIFE_DIMENSIONS,
  EPISODE_TYPES,
  EPISODE_SOURCES,
  INTENT_TYPES,
  EMOTIONAL_TRENDS,
  GOAL_PHASES,
  TOKEN_BUDGET,
  TSS_WEIGHTS,
  CONSOLIDATION_SCHEDULE,
  LOW_CONFIDENCE_THRESHOLD,
  createDefaultCoreIdentity,
  createDefaultWorkingMemory,
  createDefaultSemanticMemory,
  createDefaultProfile,
  createEpisode,
  validateCoreIdentity,
  validateSemanticMemory,
  validateProfile,
  validateWorkingMemory,
  migrateProfileV1ToV2,
  migrateWorkingMemoryV1ToV2,
};
