/**
 * State Engine (P2) — computes the user's *current* cognitive state on demand.
 *
 * The old system only ever STORED a working-memory snapshot (emotional_state
 * defaulted to "neutral" and nobody updated it). This engine COMPUTES state
 * from live signals — recent episodes + tasks + goals + working memory — every
 * time it's asked, so chat and the memory homepage reflect "where the user is
 * right now", not a stale field.
 *
 * Rule-based and synchronous: NO LLM call (the cheap/high-frequency tier of the
 * model split), so it's safe to run on every chat turn. Each derived field
 * carries an evidence `signal` so the UI can explain "why" — part of making the
 * product feel like a cognitive mirror rather than a database.
 *
 * Reads go through the MemoryStore interface (episodes/working) and the app
 * Store (goals/tasks/check-ins). Best-effort: missing data → low-confidence
 * idle/neutral state, and renderStateContext() emits nothing so we never
 * fabricate a state for a brand-new user.
 */

import { Store } from '../../lib/store.mjs';
import { getMemoryStore } from '../store/index.mjs';

const store = Store();
const memStore = getMemoryStore();

const WINDOW_DAYS = 14;
const RECENT_DAYS = 3;
const TTL_MS = 60 * 1000; // recompute at most once a minute per user
const _cache = new Map(); // userId -> { at, snapshot }

const DIM_LABELS = {
  health: '健康', career: '事业', family: '家庭', finance: '财务',
  growth: '成长', social: '社交', hobby: '兴趣', self_realization: '自我实现',
};
const MODE_LABELS = {
  planning: '规划中', executing: '专注执行', reflecting: '复盘中',
  exploring: '探索中', idle: '暂歇',
};
const ENERGY_LABELS = { high: '精力充沛', medium: '状态平稳', low: '精力偏低' };
const EMOTION_LABELS = {
  very_positive: '状态很好', positive: '状态不错', neutral: '平稳',
  slightly_stressed: '略有压力', stressed: '压力较大', anxious: '比较焦虑',
};
const TREND_LABELS = { up: '上升', flat: '平稳', down: '放缓' };

// ── helpers ────────────────────────────────────────────────────────
const safe = (fn, dflt) => { try { const v = fn(); return v == null ? dflt : v; } catch { return dflt; } };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round2 = (n) => Math.round(n * 100) / 100;
const daysAgoIso = (d) => new Date(Date.now() - d * 86400000).toISOString();
const within = (ts, days) => ts && new Date(ts).getTime() >= Date.now() - days * 86400000;

// ══════════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Compute (or return cached) current-state snapshot for a user.
 * @param {string} userId
 * @param {object} [opts] {force} - force bypasses the 60s cache
 * @returns {object} StateSnapshot
 */
export function computeState(userId, { force = false } = {}) {
  const cached = _cache.get(userId);
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;
  const snapshot = _compute(userId);
  _cache.set(userId, { at: Date.now(), snapshot });
  return snapshot;
}

/** Invalidate the cache for a user (e.g. after a capture/check-in). */
export function invalidateState(userId) { _cache.delete(userId); }

function _compute(userId) {
  const working = safe(() => memStore.getWorkingMemory(userId), {}) || {};
  const episodes = safe(() => memStore.listEpisodes(userId, { since: daysAgoIso(WINDOW_DAYS), limit: 200 }), []) || [];
  const goals = (safe(() => store.listGoals(userId), []) || [])
    .filter(g => g && (g.status === 'active' || g.status === 'in_progress'));
  const tasks = safe(() => store.listAllTasks(userId), []) || [];
  const checkIns = safe(() => store.listCheckIns(userId, { days: WINDOW_DAYS }), []) || [];

  const signals = [];
  const ctx = { working, episodes, goals, tasks, checkIns, signals };

  const focus = computeFocus(ctx);
  const activeGoal = computeActiveGoal(ctx);
  const cognitiveMode = computeCognitiveMode(ctx);
  const energy = computeEnergy(ctx);
  const emotion = computeEmotion(ctx);
  const momentum = computeMomentum(ctx);

  const workingSignals = (working?.active_goals?.length || 0)
    + (working?.current_context?.focus_domain ? 1 : 0)
    + (working?.current_context?.emotional_state && working.current_context.emotional_state !== 'neutral' ? 1 : 0)
    + (working?.recent_decisions?.length || 0);
  const dataPoints = episodes.length + tasks.length + goals.length + checkIns.length + workingSignals;
  const confidence = round2(clamp(dataPoints / 20, 0, 1));

  return {
    computed_at: new Date().toISOString(),
    window_days: WINDOW_DAYS,
    focus,
    active_goal: activeGoal,
    cognitive_mode: cognitiveMode,
    cognitive_mode_label: MODE_LABELS[cognitiveMode],
    energy,
    energy_label: ENERGY_LABELS[energy],
    emotion,
    emotion_label: EMOTION_LABELS[emotion] || emotion,
    momentum,
    confidence,
    signals,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Field computations (each pushes an evidence signal)
// ══════════════════════════════════════════════════════════════════

function computeFocus({ working, episodes, goals, signals }) {
  // 1) explicit focus in working memory
  const fd = working?.current_context?.focus_domain;
  if (fd) {
    signals.push({ field: 'focus', from: 'working_memory', detail: `focus_domain=${fd}` });
    return { domain: fd, label: DIM_LABELS[fd] || fd, source: 'working_memory' };
  }
  // 2) most frequent tag among recent episodes
  const tagCounts = {};
  for (const ep of episodes) {
    for (const t of (ep.tags || [])) {
      if (typeof t === 'string' && !t.includes(':')) tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
  const topTag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
  if (topTag && topTag[1] >= 2) {
    signals.push({ field: 'focus', from: 'episodes', detail: `top tag "${topTag[0]}" ×${topTag[1]}` });
    return { domain: topTag[0], label: topTag[0], source: 'recent_episodes' };
  }
  // 3) most recently touched active goal's dimension
  const g = [...goals].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0];
  if (g?.life_wheel_dimension) {
    signals.push({ field: 'focus', from: 'active_goal', detail: `goal "${g.title}" dim=${g.life_wheel_dimension}` });
    return { domain: g.life_wheel_dimension, label: DIM_LABELS[g.life_wheel_dimension] || g.life_wheel_dimension, source: 'active_goal' };
  }
  return null;
}

function computeActiveGoal({ goals, signals }) {
  if (!goals.length) return null;
  // prefer the most recently updated active goal
  const g = [...goals].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0];
  signals.push({ field: 'active_goal', from: 'goals', detail: `${goals.length} active; latest "${g.title}"` });
  return {
    id: g.id,
    title: g.title,
    progress: typeof g.progress === 'number' ? g.progress : null,
    dimension: g.life_wheel_dimension || null,
  };
}

function computeCognitiveMode({ episodes, tasks, working, signals }) {
  const recentEps = episodes.filter(e => within(e.created_at, 7));
  const recentTasks = tasks.filter(t => within(t.updated_at || t.created_at, RECENT_DAYS));

  const executing = recentTasks.filter(t => t.status === 'done' || t.status === 'in_progress').length;
  const planning = recentEps.filter(e => e.type === 'decision').length
    + recentEps.filter(e => (e.tags || []).some(t => String(t).includes('goal'))).length
    + (working?.recent_decisions || []).filter(d => within(d.ts || d.date, 7)).length;
  const reflecting = recentEps.filter(e => e.type === 'failure_learning' || e.source === 'reflection').length;
  const exploring = recentEps.filter(e => e.type === 'important_info' || e.type === 'key_event').length;

  const scores = { executing, planning, reflecting, exploring };
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  let mode = 'idle';
  if (top && top[1] > 0) mode = top[0];
  signals.push({ field: 'cognitive_mode', from: 'episodes+tasks', detail: `executing=${executing} planning=${planning} reflecting=${reflecting} exploring=${exploring}` });
  return mode;
}

function computeEnergy({ tasks, checkIns, signals }) {
  // 1) check-in mood (1-5) if present
  const moods = checkIns.map(c => Number(c.mood_rating)).filter(n => Number.isFinite(n));
  if (moods.length) {
    const avg = moods.reduce((a, b) => a + b, 0) / moods.length;
    const level = avg >= 4 ? 'high' : avg <= 2 ? 'low' : 'medium';
    signals.push({ field: 'energy', from: 'check_ins', detail: `avg mood ${round2(avg)} over ${moods.length}` });
    return level;
  }
  // 2) recent task completion vs skips
  const recent = tasks.filter(t => within(t.updated_at || t.created_at, RECENT_DAYS));
  const done = recent.filter(t => t.status === 'done').length;
  const skipped = recent.filter(t => t.status === 'skipped').length;
  if (done + skipped > 0) {
    const rate = done / (done + skipped);
    const level = rate > 0.6 ? 'high' : rate < 0.3 ? 'low' : 'medium';
    signals.push({ field: 'energy', from: 'tasks', detail: `${done} done / ${skipped} skipped (3d)` });
    return level;
  }
  return 'medium';
}

function computeEmotion({ working, tasks, episodes, signals }) {
  const es = working?.current_context?.emotional_state;
  if (es && es !== 'neutral') {
    signals.push({ field: 'emotion', from: 'working_memory', detail: `emotional_state=${es}` });
    return es;
  }
  // infer mild stress from skips / failure-learnings
  const recent = tasks.filter(t => within(t.updated_at || t.created_at, 7));
  const done = recent.filter(t => t.status === 'done').length;
  const skipped = recent.filter(t => t.status === 'skipped').length;
  const failures = episodes.filter(e => e.type === 'failure_learning' && within(e.created_at, 7)).length;
  if ((done + skipped > 0 && skipped / (done + skipped) > 0.5) || failures >= 2) {
    signals.push({ field: 'emotion', from: 'tasks+episodes', detail: `skipped=${skipped} done=${done} failures=${failures}` });
    return 'slightly_stressed';
  }
  return 'neutral';
}

function computeMomentum({ tasks, episodes, signals }) {
  const recentEps = episodes.filter(e => within(e.created_at, 7)).length;
  const priorEps = episodes.filter(e => {
    const t = e.created_at ? new Date(e.created_at).getTime() : 0;
    return t < Date.now() - 7 * 86400000 && t >= Date.now() - 14 * 86400000;
  }).length;

  const windowTasks = tasks.filter(t => within(t.updated_at || t.created_at, WINDOW_DAYS));
  const done = windowTasks.filter(t => t.status === 'done').length;
  const skipped = windowTasks.filter(t => t.status === 'skipped').length;
  const completionRate = done + skipped > 0 ? done / (done + skipped) : null;

  let trend = 'flat';
  if ((completionRate != null && completionRate > 0.6) || recentEps > priorEps * 1.2) trend = 'up';
  else if ((completionRate != null && completionRate < 0.3) || (priorEps > 0 && recentEps < priorEps * 0.6)) trend = 'down';

  // score blends completion + activity (0-1)
  const activityScore = clamp((recentEps) / 8, 0, 1);
  const score = round2(clamp(((completionRate ?? 0.4) * 0.6) + (activityScore * 0.4), 0, 1));

  signals.push({ field: 'momentum', from: 'tasks+episodes', detail: `done=${done} skipped=${skipped} recentEps=${recentEps} priorEps=${priorEps}` });
  return { score, trend, trend_label: TREND_LABELS[trend], completion_rate: completionRate == null ? null : round2(completionRate) };
}

// ══════════════════════════════════════════════════════════════════
//  Rendering — compact markdown block for LLM context injection
// ══════════════════════════════════════════════════════════════════

/**
 * Render a snapshot into a compact "## 当前状态" block for the system prompt.
 * Returns '' when there isn't enough real signal (don't fabricate state).
 * @param {object} snapshot
 * @returns {string}
 */
export function renderStateContext(snapshot) {
  if (!snapshot || snapshot.confidence < 0.1) return '';
  const lines = [];
  if (snapshot.focus?.label) lines.push(`当前关注：${snapshot.focus.label}`);
  if (snapshot.active_goal?.title) {
    const p = snapshot.active_goal.progress != null ? `（${snapshot.active_goal.progress}%）` : '';
    lines.push(`正在推进：${snapshot.active_goal.title}${p}`);
  }
  const mood = [];
  if (snapshot.cognitive_mode_label) mood.push(`认知模式：${snapshot.cognitive_mode_label}`);
  if (snapshot.energy_label) mood.push(`精力：${snapshot.energy_label}`);
  if (snapshot.emotion_label && snapshot.emotion !== 'neutral') mood.push(`情绪：${snapshot.emotion_label}`);
  if (snapshot.momentum?.trend_label) mood.push(`近期势头：${snapshot.momentum.trend_label}`);
  if (mood.length) lines.push(mood.join(' ｜ '));

  if (!lines.length) return '';
  return `## 当前状态\n${lines.join('\n')}`;
}

export default { computeState, invalidateState, renderStateContext };
