/**
 * Review Service — 周期复盘 (periodic review)
 *
 * Turns a user's real activity in a weekly/monthly window into a structured,
 * evidence-grounded review: 概览 / 亮点 / 待提升 / 下期聚焦. Mirrors the
 * insight-engine architecture (evidence packing → task-registry LLM call →
 * validate/clamp → rule-based fallback) but is lighter (single call, no
 * gating/cooldown/versioning — reviews are cheap and repeatable).
 *
 * Consumed by conversation.service.generateReview(), which is shared by the
 * REST route POST /v1/reviews/generate and the `generate_review` chat tool.
 *
 * Unlike the old thin generator (5 aggregate numbers → one LLM call), this
 * feeds the model the actual reflection text, task titles, active goals,
 * salient episodes and the user's self-insight summary, and honors
 * settings.language via lib/language.mjs.
 */

import { Store } from '../lib/store.mjs';
import { getMemoryStore } from '../memory/store/index.mjs';
import { getLLMRouter } from '../llm/router.mjs';
import { outputLanguageDirective, normalizeLang } from '../lib/language.mjs';

const store = Store();
const memStore = getMemoryStore();

// Evidence caps (mirrors insight-engine's truncation discipline).
const REFLECTION_CAP = { weekly: 10, monthly: 14 };
const TASK_CAP = 20;
const GOAL_CAP = 12;
const EPISODE_CAP = 15;
const ECS_TREND_CAP = 14;

// Episode salience weights — same table insight-engine uses.
const TYPE_WEIGHTS = {
  personal_trait: 3, decision: 2.5, failure_learning: 2.5, milestone: 2,
  key_event: 1.5, relationship_event: 1.5, important_info: 1, date_reminder: 0,
};

const safe = (fn, dflt) => { try { const v = fn(); return v == null ? dflt : v; } catch { return dflt; } };
const dateOf = (v) => String(v || '').slice(0, 10);

// ══════════════════════════════════════════════════════════════════
//  Evidence collection
// ══════════════════════════════════════════════════════════════════

/**
 * Single pass that gathers everything the review needs. Returns the compact
 * `payload` fed to the LLM plus `stats`/`obstacleStats` (so callers don't
 * re-query) and the resolved period window.
 */
export function collectReviewEvidence(userId, periodType = 'weekly') {
  const resolved = periodType === 'monthly' ? 'monthly' : 'weekly';
  const daysBack = resolved === 'monthly' ? 30 : 7;
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - daysBack);
  const periodStart = start.toISOString().split('T')[0];
  const periodEnd = now.toISOString().split('T')[0];

  const stats = safe(() => store.getInsightStats(userId, { periodType: resolved }), {}) || {};
  const obstacleStats = safe(() => store.getObstacleStats(userId), {}) || {};

  // Reflections in-window (listReflections has no date filter, only a limit).
  const reflections = (safe(() => store.listReflections(userId, { limit: 60 }), []) || [])
    .filter(r => dateOf(r.date) >= periodStart)
    .slice(0, REFLECTION_CAP[resolved])
    .map(r => ({
      d: dateOf(r.date),
      obstacle: r.q1_obstacle_tag || null,
      adjust: r.q3_adjustment_tag || null,
      note: String(r.q2_most_valuable || '').slice(0, 120),
    }));

  // Tasks touched in-window — keep titles, split done vs still-open.
  const windowed = (safe(() => store.listAllTasks(userId), []) || []).filter(t => {
    const d = dateOf(t.completed_at || t.scheduled_date || t.due_date || t.created_at);
    return d && d >= periodStart;
  });
  const title = (t) => String(t.title || '').slice(0, 60);
  const tasksDone = windowed.filter(t => t.status === 'done').map(title).filter(Boolean).slice(0, TASK_CAP);
  const tasksOpen = windowed
    .filter(t => t.status !== 'done' && t.status !== 'skipped' && t.status !== 'cancelled')
    .map(title).filter(Boolean).slice(0, TASK_CAP);

  const goals = (safe(() => store.listGoals(userId), []) || [])
    .filter(g => g.status === 'active')
    .slice(0, GOAL_CAP)
    .map(g => ({ title: String(g.title || '').slice(0, 40), progress: g.progress ?? 0, dim: g.life_wheel_dimension || null }));

  // Salient episodes — same recency×impact scoring as insight-engine.
  const episodes = safe(() => memStore.listEpisodes(userId, { limit: 200 }), []) || [];
  const nowMs = now.getTime();
  const salient = episodes
    .filter(e => e && (e.content_raw || e.contentRaw))
    .map(e => {
      const ageDays = Math.max(0, (nowMs - new Date(e.created_at || nowMs).getTime()) / 86400000);
      const w = TYPE_WEIGHTS[e.type] ?? 1;
      const impact = 1 + (Number(e.impact_score ?? e.impactScore) || 0);
      return { e, score: w * Math.pow(0.5, ageDays / 90) * impact };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, EPISODE_CAP)
    .map(({ e }) => ({ d: dateOf(e.created_at), ty: e.type, x: String(e.content_raw || e.contentRaw || '').slice(0, 80) }));

  const profile = safe(() => memStore.getProfile(userId), {}) || {};
  const selfInsight = safe(() => String(profile.core_identity.self_insight.summary || '').slice(0, 200), '') || null;

  const ecsTrend = (safe(() => store.getECSHistory(userId, { days: daysBack }), []) || [])
    .slice(-ECS_TREND_CAP)
    .map(e => e.total ?? null)
    .filter(v => v != null);

  const payload = {
    period: resolved,
    metrics: {
      completion_rate: stats.completionRate ?? 0,
      completed_tasks: stats.completedTasks ?? 0,
      total_tasks: stats.totalTasks ?? 0,
      active_goals: stats.activeGoals ?? 0,
      new_memories: stats.newMemories ?? 0,
      reflection_count: stats.reflectionCount ?? 0,
      avg_ecs: stats.avgECS ?? 0,
      obstacle_hit_rate: obstacleStats.hitRate ?? 0,
      obstacle_execute_rate: obstacleStats.executeRate ?? 0,
    },
    reflections,
    tasks_done: tasksDone,
    tasks_open: tasksOpen,
    goals,
    episodes: salient,
    self_insight: selfInsight,
    ecs_trend: ecsTrend,
  };

  return { stats, obstacleStats, payload, periodStart, periodEnd, periodType: resolved };
}

// ══════════════════════════════════════════════════════════════════
//  LLM compose
// ══════════════════════════════════════════════════════════════════

function buildReviewPrompt(lang, periodType) {
  const unit = periodType === 'monthly' ? '月' : '周';
  return `你是 GEDO 的"周期复盘"助手——基于用户本${unit}的真实执行数据与反思，产出一份结构化复盘。你温和、具体、就事论事，不是心理医生，不做诊断。

硬性规则：
1. 只能依据下方提供的证据（metrics / reflections / tasks / goals / episodes / self_insight）推断，禁止编造任何数字、事件或引用。某板块证据不足时可少写一条或留空。
2. 语气温和、第二人称"你"，具体到行为与数据，不说教、不贴标签。
3. 输出四个板块：
   - summary：120-180 字整体概览，点出完成率 / 执行力 / 反思的总体态势。
   - highlights：本${unit}做得好的 2-4 条，每条尽量引用一处具体证据（某任务 / 某目标进展 / 某条反思）。
   - lowlights：可提升的 2-4 条，聚焦模式而非自责。
   - next_period_focus：下${unit}可执行的 2-4 条具体建议。
4. highlights / lowlights / next_period_focus 的每个元素是一句短句（≤40 字），不要编号、不要嵌套。
5. 只输出一个紧凑 JSON 对象，不要缩进换行、不要代码围栏、不要任何额外文字。字符串内部若需引用，请用中文引号「」，不要使用英文双引号（避免破坏 JSON）。

输出格式：{"summary":"…","highlights":["…"],"lowlights":["…"],"next_period_focus":["…"]}
${outputLanguageDirective(lang)}`;
}

/**
 * Compose the review body via the task registry. Throws on LLM/parse/schema
 * failure so the caller can fall back to `ruleBasedReview`.
 */
export async function composeReviewBody(lang, evidence) {
  const router = getLLMRouter();
  const res = await router.runTask('review.generate', [
    { role: 'system', content: buildReviewPrompt(lang, evidence.periodType) },
    { role: 'user', content: JSON.stringify(evidence.payload) },
  ]);
  // runTask with an outputSchema returns parsed+validated JSON on `.json`.
  const body = validateReview(res.json);
  if (!body.summary && !body.highlights.length) throw new Error('empty review body');
  return body;
}

/** Clamp/normalize LLM output to the persisted shape. */
export function validateReview(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { summary: '', highlights: [], lowlights: [], next_period_focus: [] };
  }
  const arr = (v) => (Array.isArray(v) ? v : [])
    .map(x => String(x || '').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 5);
  return {
    summary: String(parsed.summary || '').trim().slice(0, 600),
    highlights: arr(parsed.highlights),
    lowlights: arr(parsed.lowlights),
    next_period_focus: arr(parsed.next_period_focus),
  };
}

// ══════════════════════════════════════════════════════════════════
//  Rule-based fallback (no LLM) — still fills all four sections
// ══════════════════════════════════════════════════════════════════

const FALLBACK = {
  zh: {
    unit: (p) => (p === 'monthly' ? '月' : '周'),
    summary: (m, u) => `本${u}完成 ${m.completed_tasks}/${m.total_tasks} 项任务（完成率 ${m.completion_rate}%），活跃目标 ${m.active_goals} 个，反思 ${m.reflection_count} 次，平均执行力 ${m.avg_ecs}。`,
    hiStable: '执行力稳定，完成率保持在较高水平',
    hiReflect: '保持了不错的反思习惯',
    hiGoal: (t) => `目标「${t}」在稳步推进`,
    hiObstacle: '面对障碍时应对到位',
    loLowRate: '完成率偏低，任务可能排得偏满',
    loBacklog: '待办有一定积压，注意及时清理',
    loFewReflect: '反思偏少，复盘可以更规律',
    loObstacle: '障碍预测命中率偏低，If-Then 卡可再校准',
    nfReflect: '保持每日反思的习惯',
    nfFocus: '聚焦高优先级任务，减少并行',
    nfSteady: '给自己留一点缓冲，稳住节奏',
  },
  en: {
    unit: (p) => (p === 'monthly' ? 'month' : 'week'),
    summary: (m, u) => `This ${u} you completed ${m.completed_tasks}/${m.total_tasks} tasks (${m.completion_rate}% done), with ${m.active_goals} active goals, ${m.reflection_count} reflections, and an average execution score of ${m.avg_ecs}.`,
    hiStable: 'Execution stayed steady with a solid completion rate',
    hiReflect: 'You kept a good reflection habit',
    hiGoal: (t) => `Goal "${t}" is moving forward steadily`,
    hiObstacle: 'You handled obstacles well when they came up',
    loLowRate: 'Completion rate was low — the plan may be overloaded',
    loBacklog: 'Some tasks are piling up; clear them sooner',
    loFewReflect: 'Few reflections — a more regular review would help',
    loObstacle: 'Obstacle predictions missed often; recalibrate your If-Then cards',
    nfReflect: 'Keep the daily reflection habit',
    nfFocus: 'Focus on high-priority tasks and reduce parallel work',
    nfSteady: 'Leave a little buffer and hold a steady pace',
  },
  ja: {
    unit: (p) => (p === 'monthly' ? '月' : '週'),
    summary: (m, u) => `今${u}はタスクを ${m.completed_tasks}/${m.total_tasks} 件完了（完了率 ${m.completion_rate}%）、アクティブな目標 ${m.active_goals} 件、振り返り ${m.reflection_count} 回、平均実行スコア ${m.avg_ecs}。`,
    hiStable: '実行が安定し、完了率を高く保てました',
    hiReflect: '良い振り返りの習慣を維持できました',
    hiGoal: (t) => `目標「${t}」は着実に進んでいます`,
    hiObstacle: '障害に直面したとき、うまく対応できました',
    loLowRate: '完了率が低め。予定を詰め込みすぎかもしれません',
    loBacklog: 'タスクが少し溜まっています。早めに片づけましょう',
    loFewReflect: '振り返りが少なめ。もう少し定期的に',
    loObstacle: '障害予測の的中率が低め。If-Thenカードを再調整しましょう',
    nfReflect: '毎日の振り返りの習慣を続ける',
    nfFocus: '優先度の高いタスクに集中し、並行作業を減らす',
    nfSteady: '少し余裕を持ち、ペースを保つ',
  },
};

/** Threshold-driven review when the LLM is off or fails — fills all 4 sections. */
export function ruleBasedReview(lang, evidence) {
  const L = FALLBACK[normalizeLang(lang)] || FALLBACK.zh;
  const m = evidence.payload.metrics;
  const u = L.unit(evidence.periodType);
  const reflCap = REFLECTION_CAP[evidence.periodType] || 10;

  const highlights = [];
  if (m.completion_rate >= 70) highlights.push(L.hiStable);
  if (m.reflection_count >= Math.ceil(reflCap * 0.6)) highlights.push(L.hiReflect);
  const topGoal = evidence.payload.goals.find(g => (g.progress ?? 0) >= 50);
  if (topGoal) highlights.push(L.hiGoal(topGoal.title));
  if (m.obstacle_execute_rate >= 60) highlights.push(L.hiObstacle);

  const lowlights = [];
  if (m.completion_rate < 50) lowlights.push(L.loLowRate);
  if (evidence.payload.tasks_open.length >= 8) lowlights.push(L.loBacklog);
  if (m.reflection_count < Math.max(1, Math.floor(reflCap * 0.3))) lowlights.push(L.loFewReflect);
  if (m.obstacle_hit_rate > 0 && m.obstacle_hit_rate < 40) lowlights.push(L.loObstacle);

  const next = [L.nfReflect, L.nfFocus];
  if (lowlights.length) next.push(L.nfSteady);

  return {
    summary: L.summary(m, u),
    highlights: highlights.slice(0, 4),
    lowlights: lowlights.slice(0, 4),
    next_period_focus: next.slice(0, 3),
  };
}

export default { collectReviewEvidence, composeReviewBody, ruleBasedReview, validateReview };
