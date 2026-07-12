/**
 * CareAgent (P2-B)
 *
 * 主动关怀投递：基于 L4 记忆关键词 / 重要日期触发一句温暖推送。
 * 使用 procedural_rules 表自学"被拒绝 3 次的关怀类型不再推"。
 *
 * 触发条件（按优先级）：
 *   1. reminder_date 今天或明天（日期提醒型记忆）
 *   2. L4 记忆关键词匹配（焦虑/压力/失眠/低落/疲惫）
 *   3. 最近 7 天无任何互动（沉默关怀）
 *
 * 频次约束：每用户每日 ≤ 1 条 CareAgent 消息（叠加全局 ≤2 限制）
 * 隐私优先：always-on 开关默认 OFF，用户主动开启才投递。
 */

const CARE_KEYWORDS = ['焦虑', '压力', '失眠', '难受', '低落', '疲惫', '烦', '崩了', '撑不住', '好累'];
const SILENCE_DAYS  = 7;   // 超过此天数无互动 → 沉默关怀
const MAX_DISMISS   = 3;   // 同类型被拒绝 N 次后停推

/** 检测 L4 记忆中是否存在情绪关键词 */
function detectEmotionSignal(memories = []) {
  for (const m of memories) {
    const text = (m.content_raw || '') + ' ' + JSON.stringify(m.content_struct || {});
    for (const kw of CARE_KEYWORDS) {
      if (text.includes(kw)) return { keyword: kw, memory_id: m.id };
    }
  }
  return null;
}

/** 检测今明两天的提醒型记忆 */
function detectDateReminders(memories = [], now = new Date()) {
  const todayStr    = now.toISOString().slice(0, 10);
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  return memories.filter(m =>
    m.type === 'date_reminder' &&
    (m.reminder_date === todayStr || m.reminder_date === tomorrowStr)
  );
}

/** 检查 procedural_rules — 某关怀类型是否因被反复拒绝而停推 */
async function isRuleBlocked(userId, careType, store) {
  const rules = await store.listProceduralRules?.(userId) ?? [];
  const rule  = rules.find(r => r.rule_type === 'suppress_care' && r.context?.care_type === careType);
  if (!rule) return false;
  return rule.active === false || (rule.evidence_count ?? 0) >= MAX_DISMISS;
}

/** 更新 procedural_rules：用户 dismiss 后累加 evidence_count */
export async function recordCareDismiss(userId, careType, store) {
  const rules = await store.listProceduralRules?.(userId) ?? [];
  const existing = rules.find(r => r.rule_type === 'suppress_care' && r.context?.care_type === careType);
  if (existing) {
    const newCount = (existing.evidence_count ?? 1) + 1;
    await store.updateProceduralRule?.(existing.id, {
      evidence_count: newCount,
      active: newCount < MAX_DISMISS,
    });
  } else {
    await store.createProceduralRule?.({
      userId,
      rule_type:      'suppress_care',
      description:    `用户多次拒绝 ${careType} 类关怀`,
      context:        { care_type: careType },
      evidence_count: 1,
      active:         true,
    });
  }
}

/** 用 LLM 生成个性化关怀文案 */
async function generateCareText(trigger, userContext, llm) {
  if (!llm || typeof llm.chat !== 'function') {
    return buildFallbackCare(trigger);
  }
  const prompt = buildCarePrompt(trigger, userContext);
  try {
    const resp = await llm.chat([
      { role: 'system', content: '你是 GEDO.AI 的智伴。只输出纯 JSON，不加 markdown 围栏。' },
      { role: 'user',   content: prompt },
    ]);
    const text = typeof resp === 'string' ? resp : (resp.content || '');
    const json = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    return {
      title: String(json.title || '').slice(0, 40) || '智伴想到了你',
      body:  String(json.body  || '').slice(0, 160) || buildFallbackCare(trigger).body,
    };
  } catch {
    return buildFallbackCare(trigger);
  }
}

function buildCarePrompt(trigger, ctx) {
  const name = ctx.displayName || '你';
  let context = '';
  if (trigger.type === 'date_reminder') {
    context = `用户有一条日期提醒：「${trigger.reminder?.content_raw || trigger.title}」即将到来。`;
  } else if (trigger.type === 'emotion') {
    context = `用户的记忆中出现了关键词「${trigger.keyword}」，可能有些情绪压力。`;
  } else {
    context = `用户已经 ${SILENCE_DAYS} 天没有打开 GEDO.AI 了。`;
  }
  return `
${context}
请以「智伴」身份，用中文写一条温暖但不过度的关怀推送消息给 ${name}。
格式要求（纯 JSON）：
{
  "title": "≤20字，手机通知标题，不要疑问句",
  "body":  "≤80字，正文，温暖直接，结尾可以带一个小问题邀请互动"
}`.trim();
}

function buildFallbackCare(trigger) {
  if (trigger.type === 'date_reminder') {
    return { title: '有件事快到了', body: `记得你有个提醒：${trigger.title || '重要日期即将到来'}，提前做好准备。` };
  }
  if (trigger.type === 'emotion') {
    return { title: '智伴想到了你', body: '最近有些压力？先深呼吸三次，然后告诉我现在最让你烦心的一件事。' };
  }
  return { title: '好久不见', body: '你有一段时间没来了，最近还好吗？随时来聊聊。' };
}

/**
 * 主入口
 * @param {object} p
 * @param {string}   p.userId
 * @param {object}   p.store
 * @param {object}   p.llm
 * @param {object}   [p.context]   — { memories, goals, displayName, lastActiveAt }
 * @param {boolean}  [p.careEnabled] — users.preferences.care_enabled（默认 false）
 */
export async function runCareAgent({ userId, store, llm, context = {}, careEnabled = false }) {
  if (!careEnabled) {
    // 隐私优先：always-on 默认关闭
    return null;
  }

  const todayCount = (await store.countProactiveToday?.(userId)) ?? 0;
  if (todayCount >= 2) return null;

  const memories = context.memories || [];
  let trigger = null;

  // 1. 日期提醒
  const reminders = detectDateReminders(memories);
  if (reminders.length > 0) {
    trigger = { type: 'date_reminder', title: reminders[0].content_raw, reminder: reminders[0] };
  }

  // 2. 情绪关键词
  if (!trigger) {
    const signal = detectEmotionSignal(memories);
    if (signal) trigger = { type: 'emotion', keyword: signal.keyword, memory_id: signal.memory_id };
  }

  // 3. 沉默关怀
  if (!trigger) {
    const lastActive = context.lastActiveAt ? new Date(context.lastActiveAt) : null;
    const daysSince  = lastActive ? (Date.now() - lastActive.getTime()) / 86400000 : 0;
    if (daysSince >= SILENCE_DAYS) {
      trigger = { type: 'silence', daysSince: Math.round(daysSince) };
    }
  }

  if (!trigger) return null;

  // procedural_rules 检查：是否因被多次拒绝而停推
  if (await isRuleBlocked(userId, trigger.type, store)) {
    console.log(`[CareAgent] skip user ${userId} — care type "${trigger.type}" blocked by rule`);
    return null;
  }

  const { title, body } = await generateCareText(trigger, context, llm);

  const message = {
    userId,
    type:    `care_${trigger.type}`,
    title,
    body,
    payload: { trigger },
  };

  const saved = await store.createProactiveMessage?.(message);
  console.log(`[CareAgent] wrote care message for user ${userId} (trigger: ${trigger.type})`);
  return saved;
}

export default { runCareAgent, recordCareDismiss };
