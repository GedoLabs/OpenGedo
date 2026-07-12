/**
 * Reflector Agent (P2-B)
 *
 * 周末/月末复盘：汇总执行数据 → LLM 生成结构化复盘 → 写入 proactive_messages。
 *
 * 触发时机（由 triggers/cron.mjs 控制）：
 *   - 每周日 20:00 — 周复盘
 *   - 每月最后一天 20:00 — 月复盘
 *
 * 输出结构：
 *   {
 *     period:    'week' | 'month',
 *     highlight: string,      // 最大亮点（≤80字）
 *     challenge: string,      // 最大挑战（≤80字）
 *     insight:   string,      // 一条新洞察（≤120字）
 *     next_focus:string,      // 下周/下月一个专注点（≤60字）
 *     stats:     { done, skipped, rate, newMemories, completedGoals }
 *   }
 */

const PERIOD_DAYS = { week: 7, month: 30 };

/** 汇总统计数据 */
async function gatherStats(userId, period, store) {
  const days   = PERIOD_DAYS[period] ?? 7;
  const ci     = await store.listCheckIns?.(userId, { days }) ?? [];
  const done   = ci.filter(c => c.status === 'done').length;
  const skip   = ci.filter(c => c.status === 'skipped').length;
  const total  = ci.length;
  const rate   = total > 0 ? Math.round((done / total) * 100) : 0;

  const mems   = await store.listRecentMemories?.(userId, { days }) ?? [];
  const goals  = await store.listGoals?.(userId) ?? [];
  const completedGoals = goals.filter(g => {
    if (g.status !== 'completed') return false;
    const updated = new Date(g.updated_at || 0).getTime();
    return Date.now() - updated <= days * 86400000;
  }).length;

  return { done, skipped: skip, total, rate, newMemories: mems.length, completedGoals };
}

/** LLM 复盘生成 */
async function generateReflection(period, stats, context, llm) {
  if (!llm || typeof llm.chat !== 'function') {
    return buildFallbackReflection(period, stats);
  }
  const prompt = buildReflectionPrompt(period, stats, context);
  try {
    const resp = await llm.chat([
      { role: 'system', content: '你是 GEDO.AI 的复盘助手。只输出纯 JSON，不加 markdown 围栏。' },
      { role: 'user',   content: prompt },
    ]);
    const text = typeof resp === 'string' ? resp : (resp.content || '');
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    return normalizeReflection(json, period, stats);
  } catch {
    return buildFallbackReflection(period, stats);
  }
}

function buildReflectionPrompt(period, stats, ctx) {
  const label        = period === 'week' ? '本周' : '本月';
  const nextLabel    = period === 'week' ? '下周' : '下月';
  const activeGoals  = (ctx.goals || []).filter(g => g.status === 'active').slice(0, 3).map(g => g.title).join('、') || '(暂无)';
  const recentMems   = (ctx.memories || []).slice(0, 5).map(m => `- ${m.content_raw?.slice(0, 60)}`).join('\n') || '(暂无)';

  return `
${label}执行数据：
- 完成 ${stats.done} 次任务，跳过 ${stats.skipped} 次，完成率 ${stats.rate}%
- 新增记忆 ${stats.newMemories} 条，完成目标 ${stats.completedGoals} 个
- 活跃目标：${activeGoals}
最近记忆片段：
${recentMems}

请生成${label}复盘（纯 JSON）：
{
  "highlight":   "≤80字，${label}最大亮点，具体有画面感",
  "challenge":   "≤80字，${label}最大挑战，不评判，描述现象",
  "insight":     "≤120字，一条新洞察或规律，用「我发现」开头",
  "next_focus":  "≤60字，${nextLabel}一个最重要的专注点，具体可行"
}`.trim();
}

function normalizeReflection(json, period, stats) {
  return {
    period,
    highlight:  String(json.highlight  || '').slice(0, 160),
    challenge:  String(json.challenge  || '').slice(0, 160),
    insight:    String(json.insight    || '').slice(0, 240),
    next_focus: String(json.next_focus || '').slice(0, 120),
    stats,
  };
}

function buildFallbackReflection(period, stats) {
  const label = period === 'week' ? '本周' : '本月';
  return {
    period,
    highlight:  `${label}完成了 ${stats.done} 次任务，新增 ${stats.newMemories} 条记忆`,
    challenge:  `跳过了 ${stats.skipped} 次任务，完成率 ${stats.rate}%`,
    insight:    '我发现保持规律比追求完美更重要，哪怕每天只做一件小事也在积累复利',
    next_focus: '下个周期专注做好最重要的一件事，其余顺其自然',
    stats,
  };
}

/** 格式化为用户可读的消息体 */
function formatMessageBody(reflection) {
  return [
    `✨ ${reflection.highlight}`,
    `⚡ ${reflection.challenge}`,
    `💡 ${reflection.insight}`,
    `🎯 ${reflection.next_focus}`,
  ].join('\n');
}

/**
 * 主入口
 * @param {object} p
 * @param {string}   p.userId
 * @param {'week'|'month'} p.period
 * @param {object}   p.store
 * @param {object}   p.llm
 * @param {object}   [p.context]  — { goals, memories }
 */
export async function runReflector({ userId, period = 'week', store, llm, context = {} }) {
  const todayCount = (await store.countProactiveToday?.(userId)) ?? 0;
  if (todayCount >= 2) {
    console.log(`[Reflector] skip user ${userId} — daily limit reached`);
    return null;
  }

  const stats      = await gatherStats(userId, period, store);
  const reflection = await generateReflection(period, stats, context, llm);

  const label = period === 'week' ? '本周复盘' : '本月复盘';
  const message = {
    userId,
    type:    `reflector_${period}`,
    title:   `${label}来了 — 完成率 ${stats.rate}%`,
    body:    formatMessageBody(reflection),
    payload: { reflection },
  };

  const saved = await store.createProactiveMessage?.(message);
  console.log(`[Reflector] wrote ${period} reflection for user ${userId}`);
  return saved;
}

export default { runReflector };
