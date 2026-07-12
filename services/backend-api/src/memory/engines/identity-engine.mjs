/**
 * Identity Engine (P3) — a *dynamic, versioned* model of who the user is.
 *
 * The old system only had a static, mostly hand-filled core_identity (big5/MBTI
 * usually null). This engine COMPUTES an identity model from accumulated
 * semantic memory + long-term behaviour, and crucially:
 *   - versions it (append-only history in identity/versions.jsonl)
 *   - attaches per-field confidence
 *   - DAMPS change so it doesn't swing wildly turn-to-turn (enums only flip with
 *     enough confidence; lists merge by evidence)
 *   - explains every change (each version carries a `changes[]` with the why)
 *
 * Tiering: the rule-based derivation is the always-on backbone (no LLM, so it's
 * testable and works without API keys). When useLLM is set and a chat provider
 * is available, a single low-frequency Claude pass refines wording + writes a
 * natural-language summary — the "strong model, low frequency" tier.
 *
 * Reads go through the MemoryStore interface (profile/semantic/identity) and the
 * app Store (goals/tasks); state comes from the State Engine.
 */

import { Store } from '../../lib/store.mjs';
import { getMemoryStore } from '../store/index.mjs';
import { computeState } from './state-engine.mjs';
import { getLLMRouter } from '../../llm/router.mjs';
import { outputLanguageDirective } from '../../lib/language.mjs';

const store = Store();
const memStore = getMemoryStore();

const DIM_LABELS = {
  health: '健康', career: '事业', family: '家庭', finance: '财务',
  growth: '成长', social: '社交', hobby: '兴趣', self_realization: '自我实现',
};
const STAGE_LABELS = {
  exploring: '探索期', building: '建设期', consolidating: '沉淀期',
  plateau: '平台期', transition: '转折期',
};
const STYLE_LABELS = { decisive: '果断', deliberate: '审慎', balanced: '均衡' };
const RISK_LABELS = { cautious: '稳健', balanced: '均衡', bold: '进取' };

const ADOPT_CONFIDENCE = 0.5; // enum only changes if the new read is at least this confident
const MAX_LIST = 6;

const safe = (fn, dflt) => { try { const v = fn(); return v == null ? dflt : v; } catch { return dflt; } };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round2 = (n) => Math.round(n * 100) / 100;

// ══════════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Compute a fresh identity version (rule-based, optionally LLM-refined), damp it
 * against the previous version, persist it, and return it.
 * @param {string} userId
 * @param {object} [opts] {useLLM=false, trigger='manual'}
 * @returns {Promise<object>} the new version record
 */
export async function computeIdentity(userId, { useLLM = false, trigger = 'manual' } = {}) {
  const profile = safe(() => memStore.getProfile(userId), {}) || {};
  const goals = (safe(() => store.listGoals(userId), []) || []).filter(g => g && (g.status === 'active' || g.status === 'in_progress'));
  const tasks = safe(() => store.listAllTasks(userId), []) || [];
  const episodes = safe(() => memStore.listEpisodes(userId, { limit: 300 }), []) || [];
  const state = safe(() => computeState(userId), null);

  const { model, confidence, evidence } = buildRuleModel({ profile, goals, tasks, episodes, state });

  let method = 'rule';
  if (useLLM) {
    const lang = store.getSettings(userId)?.language;
    const refined = await refineWithLLM({ model, profile, state, lang }).catch(() => null);
    if (refined) { Object.assign(model, refined); method = 'llm'; }
  }

  const prev = safe(() => memStore.getLatestIdentity(userId), null);
  const { model: damped, changes } = applyDamping(prev?.model || null, model, confidence, prev?.confidence || null);

  const version = {
    version: (prev?.version || 0) + 1,
    computed_at: new Date().toISOString(),
    method,
    trigger,
    model: damped,
    confidence,
    changes,
    evidence,
    // 卡片级证据回溯（IA v2）：本次推导消费的最近记忆（listEpisodes 时间
    // 降序）。「来自这 N 条记忆」下钻用；存量旧版本无此字段走降级文案。
    evidence_episode_ids: episodes.slice(0, 30).map(e => e.id).filter(Boolean),
  };
  memStore.appendIdentityVersion(userId, version);
  return version;
}

/**
 * Return the current identity (latest version). If none exists yet, compute a
 * rule-based one (no LLM) so callers always get something.
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getIdentity(userId) {
  const latest = safe(() => memStore.getLatestIdentity(userId), null);
  if (latest) return latest;
  return computeIdentity(userId, { useLLM: false, trigger: 'first_read' });
}

// ══════════════════════════════════════════════════════════════════
//  Rule-based derivation
// ══════════════════════════════════════════════════════════════════

function buildRuleModel({ profile, goals, tasks, episodes, state }) {
  const ci = profile.core_identity || {};
  const sm = profile.semantic_memory || {};
  const dims = sm.dimensions || {};

  const strengths = deriveStrengths(ci, sm, dims);
  const weaknesses = deriveWeaknesses(sm, dims);
  const goalPrefs = deriveGoalPreferences(goals, dims);
  const decisionStyle = deriveDecisionStyle(ci, tasks);
  const riskTendency = deriveRiskTendency(goals, sm);
  const growthStage = deriveGrowthStage(state, sm, episodes);

  const filledDims = Object.values(dims).filter(d => d && (d.summary || (d.skills || []).length)).length;
  const evidence = {
    filled_dimensions: filledDims,
    milestones: (sm.milestone_events || []).length,
    failure_learnings: (sm.failure_learnings || []).length,
    active_goals: goals.length,
    episodes: episodes.length,
  };

  const volume = filledDims + evidence.milestones + evidence.failure_learnings + evidence.active_goals + Math.min(episodes.length, 10);
  const overall = round2(clamp(volume / 20, 0, 1));
  const confidence = {
    overall,
    growth_stage: growthStage.confidence,
    decision_style: decisionStyle.confidence,
    risk_tendency: riskTendency.confidence,
  };

  const model = {
    growth_stage: growthStage.value,
    growth_stage_label: STAGE_LABELS[growthStage.value],
    decision_style: decisionStyle.value,
    decision_style_label: STYLE_LABELS[decisionStyle.value],
    risk_tendency: riskTendency.value,
    risk_tendency_label: RISK_LABELS[riskTendency.value],
    strengths,            // [{label, evidence_count}]
    weaknesses,           // [{label, evidence_count}]
    goal_preferences: goalPrefs, // [label]
    summary: null,        // filled by LLM refinement, if any
  };
  return { model, confidence, evidence };
}

function deriveStrengths(ci, sm, dims) {
  const out = [];
  for (const [dim, d] of Object.entries(dims)) {
    if (!d) continue;
    const score = typeof d.self_score === 'number' ? d.self_score : 0;
    const skills = d.skills || [];
    if (score >= 7 || skills.length >= 2) {
      const skillStr = skills.length ? `（${skills.slice(0, 2).join('、')}）` : '';
      out.push({ label: `${DIM_LABELS[dim] || dim}${skillStr}`, evidence_count: skills.length + (score >= 7 ? 1 : 0) });
    }
  }
  for (const d of (ci.expertise?.domains || [])) {
    if ((d.level || 0) >= 0.6) out.push({ label: d.domain, evidence_count: 2 });
  }
  for (const p of (sm.cross_dimension_patterns || [])) {
    out.push({ label: String(p), evidence_count: 1 });
  }
  return dedupeByLabel(out).slice(0, MAX_LIST);
}

function deriveWeaknesses(sm, dims) {
  const out = [];
  for (const f of (sm.failure_learnings || [])) {
    if (f?.lesson) out.push({ label: String(f.lesson).slice(0, 40), evidence_count: 1 });
  }
  for (const [dim, d] of Object.entries(dims)) {
    const score = d && typeof d.self_score === 'number' ? d.self_score : null;
    if (score != null && score > 0 && score <= 4) {
      out.push({ label: `${DIM_LABELS[dim] || dim}待加强`, evidence_count: 1 });
    }
  }
  return dedupeByLabel(out).slice(0, MAX_LIST);
}

function deriveGoalPreferences(goals, dims) {
  const counts = {};
  for (const g of goals) {
    const dim = g.life_wheel_dimension;
    if (dim) counts[dim] = (counts[dim] || 0) + 1;
  }
  // also weight dimensions the user invests in (has skills/summary)
  for (const [dim, d] of Object.entries(dims)) {
    if (d && (d.summary || (d.skills || []).length)) counts[dim] = (counts[dim] || 0) + 0.5;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([dim]) => DIM_LABELS[dim] || dim);
}

function deriveDecisionStyle(ci, tasks) {
  const rm = ci.cognition?.reasoning_mode;
  if (rm) {
    const map = { systematic: 'deliberate', intuitive: 'decisive', mixed: 'balanced' };
    return { value: map[rm] || 'balanced', confidence: 0.7 };
  }
  const done = tasks.filter(t => t.status === 'done').length;
  const skipped = tasks.filter(t => t.status === 'skipped').length;
  if (done + skipped >= 4) {
    const rate = done / (done + skipped);
    if (rate > 0.7) return { value: 'decisive', confidence: 0.5 };
    if (rate < 0.4) return { value: 'deliberate', confidence: 0.45 };
  }
  return { value: 'balanced', confidence: 0.3 };
}

function deriveRiskTendency(goals, sm) {
  const active = goals.length;
  const failuresEmbraced = (sm.failure_learnings || []).length;
  let value = 'balanced';
  let confidence = 0.3;
  if (active >= 3 || failuresEmbraced >= 3) { value = 'bold'; confidence = 0.5; }
  else if (active === 0 && failuresEmbraced === 0) { value = 'cautious'; confidence = 0.25; }
  return { value, confidence };
}

function deriveGrowthStage(state, sm, episodes) {
  const milestones = (sm.milestone_events || []).length;
  const trend = state?.momentum?.trend || 'flat';
  const recent = episodes.filter(e => {
    const t = e.created_at ? new Date(e.created_at).getTime() : 0;
    return t >= Date.now() - 14 * 86400000;
  }).length;

  let value = 'building';
  let confidence = 0.35;
  if (recent === 0) { value = 'plateau'; confidence = 0.4; }
  else if (milestones >= 3 && trend === 'flat') { value = 'consolidating'; confidence = 0.45; }
  else if (trend === 'up') { value = 'building'; confidence = 0.5; }
  else if (recent >= 6 && milestones <= 1) { value = 'exploring'; confidence = 0.45; }
  else if (trend === 'down') { value = 'transition'; confidence = 0.4; }
  return { value, confidence };
}

// ══════════════════════════════════════════════════════════════════
//  Damping — keep the model stable + explain every change
// ══════════════════════════════════════════════════════════════════

function applyDamping(prevModel, nextModel, nextConfidence, prevConfidence) {
  const changes = [];
  if (!prevModel) {
    changes.push('首次建立人格模型');
    return { model: nextModel, changes };
  }

  const out = { ...nextModel };

  // Enums: only adopt a change when the new read is confident enough; else keep prior.
  for (const [field, labelField, dict] of [
    ['growth_stage', 'growth_stage_label', STAGE_LABELS],
    ['decision_style', 'decision_style_label', STYLE_LABELS],
    ['risk_tendency', 'risk_tendency_label', RISK_LABELS],
  ]) {
    const prevVal = prevModel[field];
    const nextVal = nextModel[field];
    if (prevVal && nextVal && prevVal !== nextVal) {
      const conf = nextConfidence?.[field] ?? 0;
      if (conf >= ADOPT_CONFIDENCE) {
        changes.push(`${fieldName(field)}：${dict[prevVal] || prevVal} → ${dict[nextVal] || nextVal}（置信 ${Math.round(conf * 100)}%）`);
      } else {
        out[field] = prevVal; // damp: hold previous value
        out[labelField] = dict[prevVal] || prevVal;
      }
    }
  }

  // Lists: merge by label, accumulate evidence, record additions/removals.
  for (const field of ['strengths', 'weaknesses']) {
    const { merged, added, removed } = mergeList(prevModel[field] || [], nextModel[field] || []);
    out[field] = merged;
    if (added.length) changes.push(`${fieldName(field)}新增：${added.slice(0, 3).join('、')}`);
    if (removed.length) changes.push(`${fieldName(field)}淡出：${removed.slice(0, 3).join('、')}`);
  }

  // goal_preferences (plain string list)
  const prevGP = prevModel.goal_preferences || [];
  const nextGP = nextModel.goal_preferences || [];
  const addedGP = nextGP.filter(x => !prevGP.includes(x));
  if (addedGP.length) changes.push(`目标偏好新增：${addedGP.join('、')}`);

  if (!changes.length) changes.push('无显著变化');
  return { model: out, changes };
}

function mergeList(prev, next) {
  const byLabel = new Map();
  for (const it of prev) byLabel.set(it.label, { ...it });
  const added = [];
  for (const it of next) {
    if (byLabel.has(it.label)) {
      const cur = byLabel.get(it.label);
      cur.evidence_count = (cur.evidence_count || 1) + (it.evidence_count || 1);
    } else {
      byLabel.set(it.label, { ...it });
      added.push(it.label);
    }
  }
  // removals: prior labels not re-seen this round AND with weak evidence drop off
  const nextLabels = new Set(next.map(i => i.label));
  const removed = [];
  for (const [label, it] of [...byLabel]) {
    if (!nextLabels.has(label) && (it.evidence_count || 1) <= 1) {
      byLabel.delete(label);
      removed.push(label);
    }
  }
  const merged = [...byLabel.values()]
    .sort((a, b) => (b.evidence_count || 0) - (a.evidence_count || 0))
    .slice(0, MAX_LIST);
  return { merged, added, removed };
}

function fieldName(f) {
  return { growth_stage: '成长阶段', decision_style: '决策风格', risk_tendency: '风险倾向', strengths: '优势', weaknesses: '待提升' }[f] || f;
}

function dedupeByLabel(list) {
  const seen = new Set();
  const out = [];
  for (const it of list) {
    if (seen.has(it.label)) continue;
    seen.add(it.label);
    out.push(it);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  Optional LLM refinement (strong model, low frequency)
// ══════════════════════════════════════════════════════════════════

function buildIdentityRefinePrompt(lang) {
  return `你是一个用户人格建模助手。基于给定的"规则草稿"和用户的语义记忆，输出对用户的精炼理解。
要求：
- 不要编造证据之外的结论；
- strengths/weaknesses 用更自然、具体的措辞（各 ≤5 条）；
- summary：2-3 句话，描述"这个人是谁、正在成为什么样的人"，温和、具体、不夸张。
只输出 JSON：{"strengths":["..."],"weaknesses":["..."],"summary":"..."}
${outputLanguageDirective(lang)}`;
}

async function refineWithLLM({ model, profile, state, lang }) {
  const router = getLLMRouter();
  if (!router?.isAvailable?.()) return null;

  const sm = profile.semantic_memory || {};
  const draft = {
    growth_stage: model.growth_stage_label,
    decision_style: model.decision_style_label,
    risk_tendency: model.risk_tendency_label,
    strengths: (model.strengths || []).map(s => s.label),
    weaknesses: (model.weaknesses || []).map(w => w.label),
    goal_preferences: model.goal_preferences,
    dimensions: Object.fromEntries(Object.entries(sm.dimensions || {}).map(([k, v]) => [k, v?.summary]).filter(([, v]) => v)),
    momentum: state?.momentum?.trend_label,
  };

  const res = await router.chat([
    { role: 'system', content: buildIdentityRefinePrompt(lang) },
    { role: 'user', content: JSON.stringify(draft) },
  ], { json: true, temperature: 0.4, maxTokens: 700 });

  const text = res?.content || res || '';
  let parsed;
  try { parsed = typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;

  const refined = {};
  if (parsed.summary) refined.summary = String(parsed.summary).slice(0, 400);
  if (Array.isArray(parsed.strengths) && parsed.strengths.length) {
    refined.strengths = parsed.strengths.slice(0, MAX_LIST).map(s => ({ label: String(s).slice(0, 50), evidence_count: 1 }));
  }
  if (Array.isArray(parsed.weaknesses) && parsed.weaknesses.length) {
    refined.weaknesses = parsed.weaknesses.slice(0, MAX_LIST).map(s => ({ label: String(s).slice(0, 50), evidence_count: 1 }));
  }
  return Object.keys(refined).length ? refined : null;
}

export default { computeIdentity, getIdentity };
