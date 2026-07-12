/**
 * StuckDetector Agent (P2-B)
 *
 * Reflexion 范式：检测用户连续 N 次未完成某类任务 → 根因诊断 → 生成调整方案
 * 写入 proactive_messages 表，Care Agent / Web Push 负责投递。
 *
 * 触发条件（任一满足）：
 *   1. 同一任务或同类任务连续 3 次 skipped
 *   2. 用户 3 天内完成率 < 30%
 *
 * 频次约束：每用户每日最多 1 条 StuckDetector 消息（叠加全局 ≤2 条限制）
 */

const STUCK_THRESHOLD     = 3;   // 连续跳过次数阈值
const LOW_RATE_THRESHOLD  = 0.3; // 3 日完成率低于此值视为 stuck
const REFLECTION_WINDOW   = 3;   // 天

/** 分析 check-in 历史，返回 stuck 的任务/类别信息 */
function analyzeCheckIns(checkIns = []) {
  if (!checkIns.length) return null;

  const now = Date.now();
  const windowMs = REFLECTION_WINDOW * 24 * 60 * 60 * 1000;
  const recent = checkIns.filter(c => {
    const t = new Date(c.created_at || c.checkedAt || 0).getTime();
    return now - t <= windowMs;
  });

  if (!recent.length) return null;

  const done    = recent.filter(c => c.status === 'done').length;
  const skipped = recent.filter(c => c.status === 'skipped').length;
  const total   = recent.length;
  const rate    = total > 0 ? done / total : 1;

  // 找连续跳过最多的任务/理由
  const reasonCounts = {};
  for (const c of recent.filter(c => c.status === 'skipped')) {
    const key = c.reason_code || 'no_reason';
    reasonCounts[key] = (reasonCounts[key] || 0) + 1;
  }
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

  // 连续跳过检测：按 created_at 排序后看最后 N 条
  const sorted = [...recent].sort((a, b) =>
    new Date(a.created_at || 0) - new Date(b.created_at || 0));
  const lastN = sorted.slice(-STUCK_THRESHOLD);
  const consecutiveSkip = lastN.length === STUCK_THRESHOLD &&
    lastN.every(c => c.status === 'skipped');

  const isStuck = consecutiveSkip || rate < LOW_RATE_THRESHOLD;
  if (!isStuck) return null;

  return {
    isStuck: true,
    doneCount: done,
    skippedCount: skipped,
    total,
    completionRate: rate,
    consecutiveSkip,
    topReason: topReason ? { code: topReason[0], count: topReason[1] } : null,
  };
}

/** 用 LLM 进行 Reflexion — 生成根因 + 调整方案 */
async function reflexion(stuckInfo, userContext, llm) {
  if (!llm || typeof llm.chat !== 'function') {
    return buildFallbackReflexion(stuckInfo, userContext);
  }

  const prompt = buildReflexionPrompt(stuckInfo, userContext);
  try {
    const resp = await llm.chat([
      { role: 'system', content: '你是 GEDO.AI 的执行教练。只输出纯 JSON，不加 markdown 围栏。' },
      { role: 'user',   content: prompt },
    ]);
    const text = typeof resp === 'string' ? resp : (resp.content || '');
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    return normalizeReflexion(json);
  } catch {
    return buildFallbackReflexion(stuckInfo, userContext);
  }
}

function buildReflexionPrompt(stuck, ctx) {
  const activeGoals = (ctx.goals || []).slice(0, 3).map(g => g.title).join('、') || '(无)';
  const topReason   = stuck.topReason ? `最常见跳过原因：${stuck.topReason.code}（${stuck.topReason.count}次）` : '';
  return `
用户过去 ${REFLECTION_WINDOW} 天任务执行情况：
- 完成 ${stuck.doneCount} 次，跳过 ${stuck.skippedCount} 次，完成率 ${Math.round(stuck.completionRate * 100)}%
- 连续跳过 ${stuck.consecutiveSkip ? '是' : '否'}
- ${topReason}
- 活跃目标：${activeGoals}

请用 Reflexion 框架分析并输出：
{
  "root_cause": "string，≤60字，用第一人称视角点出核心障碍",
  "adjustment": "string，≤120字，具体可行的调整建议（非说教）",
  "suggested_tasks": [
    { "title": "string", "energy": "low|medium|high", "why": "string≤60字" }
  ],
  "empathy_line": "string，≤40字，1句共情开场"
}
suggested_tasks 1-2 条即可，能量等级与用户当前状态匹配。`.trim();
}

function normalizeReflexion(json) {
  return {
    root_cause:      String(json.root_cause      || '').slice(0, 120),
    adjustment:      String(json.adjustment      || '').slice(0, 240),
    suggested_tasks: (json.suggested_tasks || []).slice(0, 2).map(t => ({
      title:  String(t.title  || '').slice(0, 80),
      energy: ['low','medium','high'].includes(t.energy) ? t.energy : 'medium',
      why:    String(t.why    || '').slice(0, 120),
    })),
    empathy_line: String(json.empathy_line || '').slice(0, 80),
  };
}

function buildFallbackReflexion(stuck, ctx) {
  const rate = Math.round(stuck.completionRate * 100);
  return {
    root_cause:      `最近 ${REFLECTION_WINDOW} 天完成率只有 ${rate}%，可能任务量设置偏高或精力不足`,
    adjustment:      '建议先减少今日任务数量到 1-2 件，专注最重要的那件事，其余挪到明天',
    suggested_tasks: [],
    empathy_line:    '有时候慢一点，反而更稳',
  };
}

/**
 * 主入口：检测并写入 proactive_messages
 *
 * @param {object} p
 * @param {string}   p.userId
 * @param {object}   p.store      — Store 实例（listCheckIns, createProactiveMessage, countProactiveToday）
 * @param {object}   p.llm        — LLM client（{ chat }）
 * @param {object}   [p.context]  — { goals, memories }
 */
export async function runStuckDetector({ userId, store, llm, context = {} }) {
  // 频次检查：全局 ≤2 条/天
  const todayCount = (await store.countProactiveToday?.(userId)) ?? 0;
  if (todayCount >= 2) {
    console.log(`[StuckDetector] skip user ${userId} — daily limit reached`);
    return null;
  }

  const checkIns = await store.listCheckIns?.(userId, { days: REFLECTION_WINDOW }) ?? [];
  const stuckInfo = analyzeCheckIns(checkIns);
  if (!stuckInfo) return null;

  const reflexionResult = await reflexion(stuckInfo, context, llm);

  const message = {
    userId,
    type:    'stuck_reflexion',
    title:   reflexionResult.empathy_line || '你最近遇到一些阻力',
    body:    reflexionResult.adjustment,
    payload: {
      root_cause:      reflexionResult.root_cause,
      suggested_tasks: reflexionResult.suggested_tasks,
      stuck_info:      stuckInfo,
    },
  };

  const saved = await store.createProactiveMessage?.(message);
  console.log(`[StuckDetector] wrote proactive_message for user ${userId}`);
  return saved;
}

export default { runStuckDetector };
