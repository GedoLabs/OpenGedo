/**
 * Bidirectional translation between the on-disk PCP profile shape
 * (services/backend-api/src/memory/types.mjs) and the open .gmp v0.1
 * format. PCP is GEDO-specific; .gmp is the portable interchange format.
 *
 * Both directions are intentionally lossy in well-defined ways:
 *  - PCP → .gmp: drops L3 working memory (transient by design) and
 *    fields without a counterpart in the v0.1 schema (e.g. legacy
 *    `preferences.communication_style` which is captured in
 *    `communication.preferred_tone` instead).
 *  - .gmp → PCP: drops fields PCP doesn't yet model (e.g. north_star
 *    is preserved in core_identity.values.top_priorities[0] when missing).
 */

import { LIFE_DIMENSIONS, EPISODE_TYPES, EPISODE_SOURCES } from '../memory/types.mjs';
import { GMP_SCHEMA_VERSION } from './schemas.mjs';

const VALID_TYPES = new Set(EPISODE_TYPES);
const VALID_SOURCES = new Set(EPISODE_SOURCES);

// ════════════════════════════════════════════════════════════════════
//  PCP → .gmp
// ════════════════════════════════════════════════════════════════════

/**
 * Convert a PCP profile to a .gmp identity.json document (L1).
 */
export function pcpProfileToGmpIdentity(profile) {
  const ci = profile?.core_identity || {};
  const out = { version: `${GMP_SCHEMA_VERSION}.0` };

  if (ci.name) out.name = ci.name;
  if (ci.profession) out.profession = ci.profession;

  // Values
  const values = {};
  if (ci.values?.top_priorities?.length) values.top_priorities = ci.values.top_priorities.slice(0, 12);
  if (ci.values?.non_negotiables?.length) values.non_negotiables = ci.values.non_negotiables.slice(0, 12);
  if (Object.keys(values).length) out.values = values;

  // North star — synthesised: prefer explicit, fall back to first priority.
  if (ci.north_star) out.north_star = ci.north_star;
  else if (ci.values?.top_priorities?.[0]) out.north_star = ci.values.top_priorities[0];

  // Personality
  const personality = {};
  if (ci.personality?.big5) personality.big5 = sanitizeBig5(ci.personality.big5);
  if (ci.personality?.mbti_proxy) personality.mbti_proxy = ci.personality.mbti_proxy;
  if (Object.keys(personality).length) out.personality = personality;

  // Cognition
  const cognition = {};
  if (ci.cognition?.learning_style) cognition.learning_style = ci.cognition.learning_style;
  if (ci.cognition?.reasoning_mode) cognition.reasoning_mode = ci.cognition.reasoning_mode;
  if (typeof ci.cognition?.decision_speed === 'number') cognition.decision_speed = ci.cognition.decision_speed;
  if (Object.keys(cognition).length) out.cognition = cognition;

  // Communication
  const communication = {};
  if (ci.communication?.preferred_tone) communication.preferred_tone = ci.communication.preferred_tone;
  else if (ci.preferences?.communication_style) communication.preferred_tone = ci.preferences.communication_style;
  if (typeof ci.communication?.verbosity === 'number') communication.verbosity = ci.communication.verbosity;
  if (Array.isArray(ci.communication?.languages)) communication.languages = ci.communication.languages.slice(0, 6);
  if (Object.keys(communication).length) out.communication = communication;

  // Expertise
  if (Array.isArray(ci.expertise?.domains) && ci.expertise.domains.length) {
    out.expertise = {
      domains: ci.expertise.domains.slice(0, 32).map(d => ({
        domain: String(d.domain || d.name || '').slice(0, 64),
        ...(d.level ? { level: d.level } : {}),
      })).filter(d => d.domain),
    };
  }

  // Key relationships
  if (Array.isArray(ci.key_relationships) && ci.key_relationships.length) {
    out.key_relationships = ci.key_relationships.slice(0, 32).map(r => ({
      name: String(r.name || '').slice(0, 128),
      role: String(r.role || 'relationship').slice(0, 64),
      ...(typeof r.trust === 'number' ? { trust: clamp01(r.trust) } : {}),
    })).filter(r => r.name);
  }

  // Traits
  if (Array.isArray(ci.traits) && ci.traits.length) {
    out.traits = ci.traits.slice(0, 32).map(t => String(t).slice(0, 64));
  }

  // life_stage isn't tracked in PCP yet; leave undefined.

  return out;
}

/**
 * Convert PCP semantic_memory to a .gmp semantic.json document (L2).
 */
export function pcpProfileToGmpSemantic(profile) {
  const sm = profile?.semantic_memory || {};
  const dimensions = {};
  for (const dim of LIFE_DIMENSIONS) {
    const src = sm.dimensions?.[dim] || {};
    const out = {};
    if (src.summary) out.summary = String(src.summary).slice(0, 1024);
    if (Array.isArray(src.skills) && src.skills.length) out.skills = src.skills.slice(0, 32).map(s => String(s).slice(0, 64));
    if (Array.isArray(src.patterns) && src.patterns.length) out.patterns = src.patterns.slice(0, 16).map(s => String(s).slice(0, 256));
    if (Array.isArray(src.key_traits) && src.key_traits.length) out.key_traits = src.key_traits.slice(0, 16);
    if (src.recent_insight) out.recent_insight = String(src.recent_insight).slice(0, 512);
    dimensions[dim] = out;
  }

  const result = {
    version: `${GMP_SCHEMA_VERSION}.0`,
    dimensions,
  };

  if (Array.isArray(sm.cross_dimension_patterns) && sm.cross_dimension_patterns.length) {
    result.cross_dimension_patterns = sm.cross_dimension_patterns.slice(0, 64).map(p => {
      const out = { pattern: String(p.pattern || p).slice(0, 512) };
      if (Array.isArray(p.dimensions)) out.dimensions = p.dimensions.filter(d => LIFE_DIMENSIONS.includes(d));
      return out;
    }).filter(p => p.pattern);
  }
  if (Array.isArray(sm.milestone_events) && sm.milestone_events.length) {
    result.milestone_events = sm.milestone_events.slice(0, 64).map(m => ({
      event: String(m.event || '').slice(0, 256),
      ...(m.impact ? { impact: m.impact } : {}),
      ...(m.ts ? { ts: m.ts } : {}),
      ...(Array.isArray(m.tags) ? { tags: m.tags.slice(0, 8) } : {}),
      ...(Array.isArray(m.dimensions) ? { dimensions: m.dimensions.filter(d => LIFE_DIMENSIONS.includes(d)) } : {}),
    })).filter(m => m.event);
  }
  if (Array.isArray(sm.failure_learnings) && sm.failure_learnings.length) {
    result.failure_learnings = sm.failure_learnings.slice(0, 64).map(f => ({
      lesson: String(f.lesson || '').slice(0, 512),
      ...(f.context ? { context: String(f.context).slice(0, 512) } : {}),
      ...(typeof f.applied === 'boolean' ? { applied: f.applied } : {}),
    })).filter(f => f.lesson);
  }
  if (Array.isArray(sm.relationship_map) && sm.relationship_map.length) {
    result.relationship_map = sm.relationship_map.slice(0, 64).map(r => ({
      name: String(r.name || '').slice(0, 128),
      role: String(r.role || 'relationship').slice(0, 64),
      ...(typeof r.trust === 'number' ? { trust: clamp01(r.trust) } : {}),
      ...(r.last_interaction ? { last_interaction: r.last_interaction } : {}),
    })).filter(r => r.name);
  }
  if (Array.isArray(sm.long_term_summaries) && sm.long_term_summaries.length) {
    result.long_term_summaries = sm.long_term_summaries.slice(0, 32).map(s => ({
      period: String(s.period || '').slice(0, 32),
      summary: String(s.summary || '').slice(0, 4096),
      ...(Array.isArray(s.tags) ? { tags: s.tags } : {}),
    })).filter(s => s.period && s.summary);
  }
  if (sm.growth_trajectory?.skill_delta?.length) {
    result.growth_trajectory = {
      skill_delta: sm.growth_trajectory.skill_delta.map(d => ({
        skill: String(d.skill || '').slice(0, 64),
        ...(typeof d.delta === 'number' ? { delta: d.delta } : {}),
        ...(d.period ? { period: String(d.period).slice(0, 32) } : {}),
      })).filter(d => d.skill),
    };
  }

  return result;
}

/**
 * Convert PCP raw episode (createEpisode shape) to a .gmp episode line.
 * Episodes are NDJSON in the file; this returns the per-line object.
 */
export function pcpEpisodeToGmpEpisode(ep) {
  const out = {
    id: ep.id,
    type: VALID_TYPES.has(ep.type) ? ep.type : 'important_info',
    content_raw: String(ep.content_raw || ''),
    created_at: ep.created_at || new Date().toISOString(),
  };
  if (ep.content_struct && typeof ep.content_struct === 'object') {
    const cs = {};
    for (const k of ['people', 'dates', 'skills', 'traits', 'emotions', 'conclusions', 'locations']) {
      const v = ep.content_struct[k];
      if (Array.isArray(v) && v.length) cs[k] = v.map(x => String(x));
    }
    if (Object.keys(cs).length) out.content_struct = cs;
  }
  if (Array.isArray(ep.tags) && ep.tags.length) out.tags = ep.tags.slice(0, 32).map(t => String(t).slice(0, 64));
  if (Array.isArray(ep.system_tags) && ep.system_tags.length) out.system_tags = ep.system_tags.slice(0, 8);
  if (ep.source && VALID_SOURCES.has(ep.source)) out.source = ep.source;
  if (ep.reminder_date) out.reminder_date = String(ep.reminder_date);
  if (typeof ep.confidence === 'number') out.confidence = clamp01(ep.confidence);
  if (typeof ep.impact_score === 'number') out.impact_score = clamp01(ep.impact_score);
  if (typeof ep.usage_count === 'number') out.usage_count = Math.max(0, Math.floor(ep.usage_count));
  if (typeof ep.consolidated === 'boolean') out.consolidated = ep.consolidated;
  if (ep.decay_class) out.decay_class = ep.decay_class;
  if (ep.superseded_by) out.superseded_by = ep.superseded_by;
  if (Array.isArray(ep.relations) && ep.relations.length) out.relations = ep.relations.slice(0, 16);
  return out;
}

// ════════════════════════════════════════════════════════════════════
//  .gmp → PCP
// ════════════════════════════════════════════════════════════════════

/**
 * Translate .gmp identity + semantic into a PCP profile shape suitable
 * for memory-file.service.replaceProfile().
 */
export function gmpToPcpProfile(identity, semantic, opts = {}) {
  const conflictLog = opts.conflictLog || [];
  const profile = {
    version: '2.0.0',
    core_identity: {
      personality: {
        big5: identity?.personality?.big5 ? sanitizeBig5(identity.personality.big5) : null,
        mbti_proxy: identity?.personality?.mbti_proxy || null,
      },
      cognition: {
        learning_style: identity?.cognition?.learning_style || null,
        reasoning_mode: identity?.cognition?.reasoning_mode || null,
        decision_speed: typeof identity?.cognition?.decision_speed === 'number' ? identity.cognition.decision_speed : null,
      },
      values: {
        top_priorities: identity?.values?.top_priorities || [],
        non_negotiables: identity?.values?.non_negotiables || [],
      },
      communication: {
        preferred_tone: identity?.communication?.preferred_tone || null,
        verbosity: typeof identity?.communication?.verbosity === 'number' ? identity.communication.verbosity : null,
        languages: Array.isArray(identity?.communication?.languages) ? identity.communication.languages : [],
      },
      expertise: {
        domains: Array.isArray(identity?.expertise?.domains) ? identity.expertise.domains : [],
        skill_graph: [],
      },
      name: identity?.name || null,
      profession: identity?.profession || null,
      north_star: identity?.north_star || null,
      traits: Array.isArray(identity?.traits) ? identity.traits : [],
      key_relationships: Array.isArray(identity?.key_relationships) ? identity.key_relationships : [],
      preferences: { communication_style: null, motivation_type: null },
    },
    semantic_memory: {
      dimensions: {},
      cross_dimension_patterns: semantic?.cross_dimension_patterns || [],
      long_term_summaries: semantic?.long_term_summaries || [],
      milestone_events: semantic?.milestone_events || [],
      failure_learnings: semantic?.failure_learnings || [],
      relationship_map: semantic?.relationship_map || [],
      growth_trajectory: semantic?.growth_trajectory || { skill_delta: [] },
    },
    last_consolidated: null,
    conflict_log: conflictLog,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Hydrate dimensions; .gmp keys mirror PCP LIFE_DIMENSIONS.
  for (const dim of LIFE_DIMENSIONS) {
    const src = semantic?.dimensions?.[dim] || {};
    profile.semantic_memory.dimensions[dim] = {
      summary: src.summary || '',
      skills: Array.isArray(src.skills) ? src.skills : [],
      patterns: Array.isArray(src.patterns) ? src.patterns : [],
      key_traits: Array.isArray(src.key_traits) ? src.key_traits : [],
      recent_insight: src.recent_insight || null,
    };
  }

  return profile;
}

// ════════════════════════════════════════════════════════════════════
//  helpers
// ════════════════════════════════════════════════════════════════════

function sanitizeBig5(big5) {
  const out = {};
  for (const k of ['O', 'C', 'E', 'A', 'N']) {
    const v = big5?.[k];
    if (typeof v === 'number' && v >= 0 && v <= 1) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function clamp01(v) {
  if (typeof v !== 'number') return 0;
  return Math.max(0, Math.min(1, v));
}

export default {
  pcpProfileToGmpIdentity,
  pcpProfileToGmpSemantic,
  pcpEpisodeToGmpEpisode,
  gmpToPcpProfile,
};
