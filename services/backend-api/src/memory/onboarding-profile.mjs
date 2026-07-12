/**
 * Onboarding → PCP profile ingestion
 *
 * Turns "人生快照" (initial-portrait questionnaire) answers into:
 *   1. readable text (rating grids / multi-line lists → human-readable strings)
 *   2. immediate profile.json / working.json backfill, mapped via core-slots
 *
 * This is the file-store counterpart of
 * scripts/migrations/backfill_onboarding_to_identity.mjs (Postgres path).
 */

import { getMemoryStore } from './store/index.mjs';
const { getProfile, getWorkingMemory, updateProfile, updateWorkingMemory } = getMemoryStore();

const DIMENSION_LABELS = {
  health: '健康', career: '事业', family: '家庭', finance: '财务',
  growth: '成长', social: '社交', hobby: '兴趣', self_realization: '自我实现',
};

// ── Answer normalisation ───────────────────────────────────────────

/** Parse a value that may arrive as a raw object/array or a JSON string. */
export function normalizeAnswerValue(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^[[{]/.test(trimmed)) {
    try { return JSON.parse(trimmed); } catch { /* keep string */ }
  }
  return value;
}

/**
 * Human-readable text for an answer (instead of raw JSON.stringify).
 *   - rating grid object  → "健康 7/10、事业 5/10、…"
 *   - string array        → "1. …\n2. …"
 *   - plain string        → as-is
 */
export function formatAnswerText(questionId, value) {
  const v = normalizeAnswerValue(value);
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    const items = v.map(x => String(x ?? '').trim()).filter(Boolean);
    if (items.length === 0) return '';
    return items.map((x, i) => `${i + 1}. ${x}`).join('\n');
  }
  if (typeof v === 'object') {
    if (questionId === 'life_wheel_self_score') {
      const parts = Object.entries(v)
        .filter(([, score]) => score != null && score !== '')
        .map(([dim, score]) => `${DIMENSION_LABELS[dim] || dim} ${score}/10`);
      return parts.length ? `生命之花自评：${parts.join('、')}` : '';
    }
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v).trim();
}

// ── Helpers ────────────────────────────────────────────────────────

function splitList(text, max = 10) {
  return String(text || '')
    .split(/[\n;；]|(?:^|\s)\d+[.、]\s*/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** "伴侣 张三" → { role: '伴侣', name: '张三' }; single token → name only. */
function parsePersonEntry(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const tokens = t.split(/\s+/);
  if (tokens.length >= 2) {
    return { name: tokens.slice(1).join(' ').slice(0, 60), role: tokens[0].slice(0, 30) };
  }
  return { name: t.slice(0, 60), role: '' };
}

function toArray(value) {
  const v = normalizeAnswerValue(value);
  if (Array.isArray(v)) return v.map(x => String(x ?? '').trim()).filter(Boolean);
  if (typeof v === 'string') return splitList(v);
  return [];
}

// ── Profile backfill ───────────────────────────────────────────────

/**
 * Apply one day's onboarding answers to profile.json / working.json.
 * Append-only for array fields; scalar fields are set (last write wins —
 * the user is restating their own identity, so that's correct).
 * Returns { profileUpdated, workingUpdated }.
 */
export function applyOnboardingAnswers(userId, day, answers = {}) {
  const get = (qid) => normalizeAnswerValue(answers[qid]);
  const getText = (qid) => {
    const v = get(qid);
    return typeof v === 'string' ? v.trim() : '';
  };

  const profilePatch = { core_identity: {}, semantic_memory: {} };
  let workingPatch = null;
  const profile = getProfile(userId);

  switch (Number(day)) {
    case 1: {
      if (getText('name')) profilePatch.core_identity.name = getText('name').slice(0, 60);
      if (getText('role')) profilePatch.core_identity.profession = getText('role').slice(0, 100);
      if (getText('birthday')) profilePatch.core_identity.birthday = getText('birthday').slice(0, 20);
      if (getText('location')) profilePatch.core_identity.location = getText('location').slice(0, 60);
      break;
    }
    case 2: {
      const beliefs = toArray(answers.core_beliefs);
      const nonNegotiables = toArray(answers.non_negotiables);
      const values = {};
      if (beliefs.length) {
        const existing = profile.core_identity?.values?.top_priorities || [];
        values.top_priorities = [...new Set([...existing, ...beliefs])].slice(0, 10);
      }
      if (nonNegotiables.length) {
        const existing = profile.core_identity?.values?.non_negotiables || [];
        values.non_negotiables = [...new Set([...existing, ...nonNegotiables])].slice(0, 10);
      }
      if (Object.keys(values).length) profilePatch.core_identity.values = values;
      break;
    }
    case 3: {
      const now = new Date().toISOString();
      const milestones = [...(profile.semantic_memory?.milestone_events || [])];
      const failures = [...(profile.semantic_memory?.failure_learnings || [])];
      if (getText('pivotal_success')) {
        milestones.push({ event: getText('pivotal_success').slice(0, 300), impact: 'high', ts: now, tags: ['onboarding', 'success'] });
      }
      if (getText('pivotal_turning')) {
        milestones.push({ event: getText('pivotal_turning').slice(0, 300), impact: 'high', ts: now, tags: ['onboarding', 'turning_point'] });
      }
      if (getText('pivotal_failure')) {
        failures.push({ context: getText('pivotal_failure').slice(0, 300), lesson: '', applied: false });
      }
      if (milestones.length !== (profile.semantic_memory?.milestone_events || []).length) {
        profilePatch.semantic_memory.milestone_events = milestones;
      }
      if (failures.length !== (profile.semantic_memory?.failure_learnings || []).length) {
        profilePatch.semantic_memory.failure_learnings = failures;
      }
      break;
    }
    case 4: {
      const people = toArray(answers.important_people).map(parsePersonEntry).filter(Boolean);
      if (people.length) {
        const existing = profile.semantic_memory?.relationship_map || [];
        const known = new Set(existing.map(r => String(r.name || '').toLowerCase()));
        const added = people.filter(p => p.name && !known.has(p.name.toLowerCase()))
          .map(p => ({ name: p.name, role: p.role, trust: 'high', last_interaction: null }));
        if (added.length) {
          profilePatch.semantic_memory.relationship_map = [...existing, ...added];
          const kr = profile.core_identity?.key_relationships || [];
          profilePatch.core_identity.key_relationships = [
            ...new Set([...kr, ...added.map(p => (p.role ? `${p.role} ${p.name}` : p.name))]),
          ].slice(0, 15);
        }
      }
      break;
    }
    case 5: {
      const scores = get('life_wheel_self_score');
      if (scores && typeof scores === 'object' && !Array.isArray(scores)) {
        const dimensions = {};
        for (const [dim, score] of Object.entries(scores)) {
          const n = Number(score);
          if (!Number.isFinite(n)) continue;
          dimensions[dim] = { self_score: Math.max(0, Math.min(10, n)) };
        }
        if (Object.keys(dimensions).length) profilePatch.semantic_memory.dimensions = dimensions;
      }
      break;
    }
    case 6: {
      const challenges = toArray(answers.top_3_challenges);
      if (challenges.length) {
        const wm = getWorkingMemory(userId);
        const existing = wm.current_context?.challenges || [];
        const merged = [...new Set([...existing, ...challenges])].slice(0, 10);
        workingPatch = { current_context: { challenges: merged } };
      }
      break;
    }
    case 7: {
      const vision = {};
      if (getText('future_5y')) vision.five_year = getText('future_5y').slice(0, 500);
      if (getText('future_10y')) vision.ten_year = getText('future_10y').slice(0, 500);
      if (getText('north_star')) vision.north_star = getText('north_star').slice(0, 200);
      if (Object.keys(vision).length) profilePatch.core_identity.vision = vision;
      break;
    }
    default:
      break;
  }

  let profileUpdated = false;
  let workingUpdated = false;

  const hasCi = Object.keys(profilePatch.core_identity).length > 0;
  const hasSm = Object.keys(profilePatch.semantic_memory).length > 0;
  if (hasCi || hasSm) {
    const patch = {};
    if (hasCi) patch.core_identity = profilePatch.core_identity;
    if (hasSm) patch.semantic_memory = profilePatch.semantic_memory;
    updateProfile(userId, patch);
    profileUpdated = true;
  }
  if (workingPatch) {
    updateWorkingMemory(userId, workingPatch);
    workingUpdated = true;
  }
  return { profileUpdated, workingUpdated };
}

export default {
  normalizeAnswerValue,
  formatAnswerText,
  applyOnboardingAnswers,
};
