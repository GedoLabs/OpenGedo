/**
 * Narrative Engine (P4) — periodic growth-trajectory narratives.
 *
 * Answers "what stage am I in, what changed, what to watch, what's next" over a
 * 7 / 30 / 90 day window — the layer that makes the product feel like it's
 * accompanying the user's growth rather than storing rows.
 *
 * Reuses signals already computed by other engines (State + Identity) plus
 * windowed episodes/goals/tasks, so it adds understanding without re-deriving
 * everything. Rule-based backbone (always works, testable, no LLM); an optional
 * low-frequency Claude pass writes the prose ("strong model, low frequency").
 *
 * Reports are stored latest-per-window via the MemoryStore interface and surfaced
 * on the memory homepage, in growth reports, and as a compact chat hint.
 */

import { Store } from '../../lib/store.mjs';
import { getMemoryStore } from '../store/index.mjs';
import { computeState } from './state-engine.mjs';
import { getIdentity } from './identity-engine.mjs';
import { getLLMRouter } from '../../llm/router.mjs';
import { outputLanguageDirective } from '../../lib/language.mjs';

const store = Store();
const memStore = getMemoryStore();

export const NARRATIVE_WINDOWS = [7, 30, 90];

const safe = (fn, dflt) => { try { const v = fn(); return v == null ? dflt : v; } catch { return dflt; } };
// Upper bound inclusive so an event created in the same ms as `now` still counts.
const inWindow = (ts, fromMs, toMs) => { const t = ts ? new Date(ts).getTime() : 0; return t >= fromMs && t <= toMs; };

function normalizeWindow(w) {
  const n = parseInt(w, 10);
  return NARRATIVE_WINDOWS.includes(n) ? n : 30;
}

// ══════════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Generate, persist, and return a narrative report for a window.
 * @param {string} userId
 * @param {number} windowDays  7 | 30 | 90
 * @param {object} [opts] {useLLM=false, trigger='manual'}
 */
export async function generateNarrative(userId, windowDays, { useLLM = false, trigger = 'manual' } = {}) {
  const w = normalizeWindow(windowDays);
  const ctx = gather(userId, w);
  ctx.identity = await getIdentity(userId).catch(() => null);

  let report = buildRuleNarrative(ctx);
  report.method = 'rule';

  if (useLLM) {
    const lang = store.getSettings(userId)?.language;
    const refined = await refineWithLLM(ctx, report, lang).catch(() => null);
    if (refined) { report = { ...report, ...refined, method: 'llm' }; }
  }

  report.trigger = trigger;
  // 卡片级证据回溯（IA v2）：叙事的证据=窗口内被总结的记忆本身。
  report.evidence_episode_ids = (ctx.episodes || []).slice(0, 50).map(e => e.id).filter(Boolean);
  memStore.saveNarrative(userId, w, report);
  return report;
}

/**
 * Return the stored narrative for a window; generate a rule-based one if missing
 * (so the homepage/API always has something without forcing an LLM call).
 */
export async function getNarrative(userId, windowDays, { generateIfMissing = true, useLLM = false } = {}) {
  const w = normalizeWindow(windowDays);
  const stored = safe(() => memStore.getNarrative(userId, w), null);
  if (stored) return stored;
  if (!generateIfMissing) return null;
  return generateNarrative(userId, w, { useLLM, trigger: 'on_demand' });
}

/** Compact block for chat context injection (reads stored only — never generates). */
export function renderNarrativeContext(report) {
  if (!report) return '';
  const lines = [];
  if (report.stage) lines.push(`近${report.window_days}天：${report.stage}`);
  if (report.next_steps?.length) lines.push(`下一步：${report.next_steps[0]}`);
  if (!lines.length) return '';
  return `## 成长阶段\n${lines.join('\n')}`;
}

// ══════════════════════════════════════════════════════════════════
//  Signal gathering
// ══════════════════════════════════════════════════════════════════

function gather(userId, windowDays) {
  const now = Date.now();
  const fromMs = now - windowDays * 86400000;
  const priorFromMs = now - 2 * windowDays * 86400000;

  const profile = safe(() => memStore.getProfile(userId), {}) || {};
  const allEpisodes = safe(() => memStore.listEpisodes(userId, { limit: 1000 }), []) || [];
  const episodes = allEpisodes.filter(e => inWindow(e.created_at, fromMs, now));
  const priorEpisodes = allEpisodes.filter(e => inWindow(e.created_at, priorFromMs, fromMs));
  const goals = (safe(() => store.listGoals(userId), []) || []).filter(g => g && (g.status === 'active' || g.status === 'in_progress'));
  const tasks = safe(() => store.listAllTasks(userId), []) || [];
  const windowTasks = tasks.filter(t => inWindow(t.updated_at || t.created_at, fromMs, now));
  const state = safe(() => computeState(userId), null);

  return { userId, windowDays, now, fromMs, profile, episodes, priorEpisodes, goals, windowTasks, state, identity: null };
}

// ══════════════════════════════════════════════════════════════════
//  Rule-based narrative
// ══════════════════════════════════════════════════════════════════

function buildRuleNarrative(ctx) {
  const { windowDays, profile, episodes, priorEpisodes, goals, windowTasks, state, identity } = ctx;
  const sm = profile.semantic_memory || {};
  const idModel = identity?.model || {};

  const done = windowTasks.filter(t => t.status === 'done').length;
  const skipped = windowTasks.filter(t => t.status === 'skipped').length;
  const fromMs = ctx.fromMs;
  const milestones = (sm.milestone_events || []).filter(m => m.ts && new Date(m.ts).getTime() >= fromMs);

  const stage = [idModel.growth_stage_label, state?.cognitive_mode_label].filter(Boolean).join(' · ')
    || '正在积累';

  // changes
  const changes = [];
  if (state?.momentum?.trend_label) changes.push(`近期势头${state.momentum.trend_label}`);
  if (episodes.length || priorEpisodes.length) {
    const d = episodes.length - priorEpisodes.length;
    if (d > 0) changes.push(`记录增多（本期 ${episodes.length} 条，较上期 +${d}）`);
    else if (d < 0) changes.push(`记录减少（本期 ${episodes.length} 条，较上期 ${d}）`);
  }
  for (const m of milestones.slice(0, 3)) changes.push(`里程碑：${m.event}`);
  if (identity?.changes?.length && identity.changes[0] !== '无显著变化' && identity.changes[0] !== '首次建立人格模型') {
    changes.push(...identity.changes.slice(0, 2));
  }

  // risks
  const risks = [];
  for (const w of (idModel.weaknesses || []).slice(0, 2)) risks.push(w.label);
  if (done + skipped >= 3 && skipped / (done + skipped) > 0.4) risks.push(`任务完成率偏低（完成 ${done}/跳过 ${skipped}）`);
  for (const g of goals) {
    const stale = !inWindow(g.updated_at, ctx.fromMs, ctx.now);
    if (stale && (g.progress ?? 0) < 60) risks.push(`目标"${g.title}"近期停滞`);
  }

  // opportunities
  const opportunities = [];
  for (const s of (idModel.strengths || []).slice(0, 2)) opportunities.push(`发挥${s.label}`);
  for (const g of goals) {
    if ((g.progress ?? 0) >= 60) opportunities.push(`目标"${g.title}"已推进 ${g.progress}%，可冲刺`);
  }

  // next steps
  const next_steps = [];
  for (const g of goals.slice(0, 2)) next_steps.push(`推进目标：${g.title}`);
  const pending = state && profile && safe(() => memStore.getWorkingMemory(ctx.userId)?.pending_items, []) || [];
  for (const p of (pending || []).slice(0, 2)) next_steps.push(p);
  if (!next_steps.length) next_steps.push('在对话里多记录，让智伴更懂你的方向');

  // highlights (top episodes by impact)
  const highlights = [...episodes]
    .sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0))
    .slice(0, 3)
    .map(e => (e.content_raw || '').slice(0, 40));

  const summary = `过去 ${windowDays} 天，你记录了 ${episodes.length} 条记忆`
    + (done ? `、完成 ${done} 项任务` : '')
    + (state?.focus?.label ? `，关注集中在「${state.focus.label}」` : '')
    + `。当前处于${stage}。`;

  return {
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    period: { from: new Date(ctx.fromMs).toISOString(), to: new Date(ctx.now).toISOString() },
    stage,
    summary,
    changes: dedupe(changes).slice(0, 5),
    risks: dedupe(risks).slice(0, 4),
    opportunities: dedupe(opportunities).slice(0, 4),
    next_steps: dedupe(next_steps).slice(0, 4),
    highlights,
    signals: { episodes: episodes.length, prior_episodes: priorEpisodes.length, tasks_done: done, tasks_skipped: skipped, milestones: milestones.length, active_goals: goals.length },
    confidence: Math.round(Math.min(1, (episodes.length + done + goals.length) / 12) * 100) / 100,
  };
}

function dedupe(arr) { return [...new Set(arr.filter(Boolean))]; }

// ══════════════════════════════════════════════════════════════════
//  Optional LLM refinement (strong model, low frequency)
// ══════════════════════════════════════════════════════════════════

function buildNarrativePrompt(lang) {
  return `你是一个成长教练。基于给定的"阶段数据"，写出温和、具体、不夸张的阶段性成长叙事。
不要编造数据之外的结论。只输出 JSON：
{"stage":"一句话当前阶段","summary":"2-3句话本期叙事","changes":["..."],"risks":["..."],"opportunities":["..."],"next_steps":["..."]}
每个数组 ≤4 条。${outputLanguageDirective(lang)}`;
}

async function refineWithLLM(ctx, draft, lang) {
  const router = getLLMRouter();
  if (!router?.isAvailable?.()) return null;

  const payload = {
    window_days: ctx.windowDays,
    current_state: ctx.state ? { focus: ctx.state.focus?.label, mode: ctx.state.cognitive_mode_label, momentum: ctx.state.momentum?.trend_label } : null,
    identity: ctx.identity?.model ? { stage: ctx.identity.model.growth_stage_label, strengths: (ctx.identity.model.strengths || []).map(s => s.label), weaknesses: (ctx.identity.model.weaknesses || []).map(w => w.label) } : null,
    draft: { stage: draft.stage, changes: draft.changes, risks: draft.risks, opportunities: draft.opportunities, next_steps: draft.next_steps },
    highlights: draft.highlights,
    signals: draft.signals,
  };

  const res = await router.chat([
    { role: 'system', content: buildNarrativePrompt(lang) },
    { role: 'user', content: JSON.stringify(payload) },
  ], { json: true, temperature: 0.5, maxTokens: 900 });

  const text = res?.content || res || '';
  let parsed;
  try { parsed = typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;

  const out = {};
  if (parsed.stage) out.stage = String(parsed.stage).slice(0, 120);
  if (parsed.summary) out.summary = String(parsed.summary).slice(0, 600);
  for (const k of ['changes', 'risks', 'opportunities', 'next_steps']) {
    if (Array.isArray(parsed[k]) && parsed[k].length) out[k] = parsed[k].slice(0, 4).map(s => String(s).slice(0, 120));
  }
  return Object.keys(out).length ? out : null;
}

export default { NARRATIVE_WINDOWS, generateNarrative, getNarrative, renderNarrativeContext };
