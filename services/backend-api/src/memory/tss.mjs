/**
 * Temporal Salience Score (TSS)
 *
 * Replaces simple recency decay with a composite score:
 *   TSS = α · sem_sim + β · recency_decay(t) + γ · importance + δ · access_freq
 *
 * Weights (α, β, γ, δ) shift by intent type to prioritize different
 * signal dimensions per retrieval scenario.
 */

import { TSS_WEIGHTS } from './types.mjs';

// ── Recency decay half-life in days per intent ────────────────────
const HALF_LIFE_DAYS = {
  default: 30,
  goal_planning: 60,
  task_check: 7,
  reflection: 90,
  emotional: 14,
  casual: 30,
};

/**
 * Compute Temporal Salience Score for a single episode.
 *
 * @param {object} episode - Episode object with created_at, impact_score, usage_count
 * @param {object} params
 * @param {number} params.semanticSimilarity - Cosine similarity (0-1) between query and episode
 * @param {string} [params.intentType='default'] - Intent type for weight selection
 * @param {number} [params.maxUsageCount=1] - Max usage_count across candidate set (for normalization)
 * @param {Date}   [params.now] - Current time (for testing)
 * @returns {{ score: number, components: object }}
 */
export function computeTSS(episode, params = {}) {
  const {
    semanticSimilarity = 0,
    intentType = 'default',
    maxUsageCount = 1,
    now = new Date(),
  } = params;

  const weights = TSS_WEIGHTS[intentType] || TSS_WEIGHTS.default;
  const halfLife = HALF_LIFE_DAYS[intentType] || HALF_LIFE_DAYS.default;

  // α · semantic_similarity
  const semSim = Math.max(0, Math.min(1, semanticSimilarity));

  // β · recency_decay(t) — exponential decay with configurable half-life
  const createdAt = episode.created_at ? new Date(episode.created_at) : now;
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const recencyDecay = Math.exp(-0.693 * ageDays / halfLife);

  // γ · importance_score — LLM-rated significance (1-5 → normalized 0-1)
  const rawImpact = episode.impact_score ?? 0.5;
  const importance = typeof rawImpact === 'number'
    ? Math.max(0, Math.min(1, rawImpact))
    : 0.5;

  // δ · access_freq_norm — normalized retrieval count with compounding bonus
  const usageCount = episode.usage_count || 0;
  const normalizedMax = Math.max(1, maxUsageCount);
  const accessFreq = Math.min(1, usageCount / normalizedMax);

  // Composite score
  const score =
    weights.alpha * semSim +
    weights.beta * recencyDecay +
    weights.gamma * importance +
    weights.delta * accessFreq;

  return {
    score: Math.round(score * 10000) / 10000,
    components: {
      semantic: Math.round(weights.alpha * semSim * 10000) / 10000,
      recency: Math.round(weights.beta * recencyDecay * 10000) / 10000,
      importance: Math.round(weights.gamma * importance * 10000) / 10000,
      access: Math.round(weights.delta * accessFreq * 10000) / 10000,
    },
  };
}

/**
 * Rank a list of episodes by TSS.
 *
 * @param {object[]} episodes - Array of episode objects
 * @param {object} params
 * @param {number[]} [params.similarities] - Per-episode cosine similarities (same order)
 * @param {string}  [params.intentType]
 * @param {number}  [params.limit]
 * @returns {object[]} Episodes sorted by TSS desc, with tss field added
 */
export function rankByTSS(episodes, params = {}) {
  const {
    similarities = [],
    intentType = 'default',
    limit = episodes.length,
  } = params;

  const maxUsageCount = Math.max(1, ...episodes.map(ep => ep.usage_count || 0));
  const now = new Date();

  const scored = episodes.map((ep, i) => {
    const { score, components } = computeTSS(ep, {
      semanticSimilarity: similarities[i] || 0,
      intentType,
      maxUsageCount,
      now,
    });
    return { ...ep, tss: score, tss_components: components };
  });

  scored.sort((a, b) => b.tss - a.tss);
  return scored.slice(0, limit);
}

/**
 * Goal-Scoped Cone Search
 *
 * When user is deep in a specific goal, search narrows progressively:
 *   r1 — Goal cluster: episodes tagged with the active goal
 *   r2 — Skill adjacency: episodes matching required skill domains
 *   r3 — Global fallback: full semantic search if r1+r2 < k
 *
 * @param {object[]} episodes - All candidate episodes
 * @param {object} activeGoal - The active goal object { id, title, phase }
 * @param {object} params
 * @param {number} [params.k=5] - Target number of results
 * @param {number[]} [params.similarities] - Per-episode similarities
 * @param {string[]} [params.skillDomains] - User's expertise domains
 * @param {string}  [params.intentType]
 * @returns {object[]}
 */
export function coneSearch(episodes, activeGoal, params = {}) {
  const {
    k = 5,
    similarities = [],
    skillDomains = [],
    intentType = 'goal_planning',
  } = params;

  if (!activeGoal || episodes.length === 0) {
    return rankByTSS(episodes, { similarities, intentType, limit: k });
  }

  const goalTitle = (activeGoal.title || '').toLowerCase();
  const goalTags = [activeGoal.id, goalTitle.slice(0, 10)].filter(Boolean);

  // r1 — Goal cluster
  const r1Indices = [];
  const r1Episodes = [];
  episodes.forEach((ep, i) => {
    const tags = (ep.tags || []).map(t => t.toLowerCase());
    const content = (ep.content_raw || '').toLowerCase();
    const isGoalRelated =
      tags.some(t => goalTags.some(gt => t.includes(gt))) ||
      content.includes(goalTitle.slice(0, 8));
    if (isGoalRelated) {
      r1Indices.push(i);
      r1Episodes.push(ep);
    }
  });

  const r1Sims = r1Indices.map(i => similarities[i] || 0);
  const r1Ranked = rankByTSS(r1Episodes, { similarities: r1Sims, intentType, limit: k });

  if (r1Ranked.length >= k) return r1Ranked;

  // r2 — Skill adjacency
  const r1Ids = new Set(r1Episodes.map(ep => ep.id));
  const r2Indices = [];
  const r2Episodes = [];
  episodes.forEach((ep, i) => {
    if (r1Ids.has(ep.id)) return;
    const tags = (ep.tags || []).map(t => t.toLowerCase());
    const content = (ep.content_raw || '').toLowerCase();
    const isSkillRelated = skillDomains.some(domain =>
      tags.some(t => t.includes(domain.toLowerCase())) ||
      content.includes(domain.toLowerCase())
    );
    if (isSkillRelated) {
      r2Indices.push(i);
      r2Episodes.push(ep);
    }
  });

  const r2Sims = r2Indices.map(i => similarities[i] || 0);
  const r2Ranked = rankByTSS(r2Episodes, { similarities: r2Sims, intentType, limit: k - r1Ranked.length });
  const combined = [...r1Ranked, ...r2Ranked];

  if (combined.length >= k) return combined.slice(0, k);

  // r3 — Global fallback
  const usedIds = new Set(combined.map(ep => ep.id));
  const remaining = episodes.filter(ep => !usedIds.has(ep.id));
  const remSims = [];
  episodes.forEach((ep, i) => {
    if (!usedIds.has(ep.id)) remSims.push(similarities[i] || 0);
  });
  const r3Ranked = rankByTSS(remaining, { similarities: remSims, intentType, limit: k - combined.length });

  return [...combined, ...r3Ranked].slice(0, k);
}

export default {
  computeTSS,
  rankByTSS,
  coneSearch,
};
