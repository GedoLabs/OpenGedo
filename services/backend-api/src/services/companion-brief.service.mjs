/**
 * Companion Home Brief — 智伴首页的智能引导。
 *
 * getBrief(user, lang) 返回 { greeting, suggestions }：
 *   - suggestions：纯规则拼装（真实目标/任务/会话数据 + 三语模板，零 LLM、
 *     毫秒级），按优先级取前 3；数据不足时用不编造具体内容的 cold_start 兜底。
 *   - greeting：命中当日缓存时返回 LLM 个性化开场白（source:'llm'），否则先回
 *     时段模板（source:'template'）并 fire-and-forget 异步生成落缓存——首页每次
 *     focus 会重拉 brief，下一次即可看到升级版。无会话且无目标的用户不调 LLM。
 *
 * 前端契约（web/mobile 共用）：
 *   suggestion.action = 'chat'（prompt 直接发送）
 *                     | 'open_conversation'（带 conversation_id 原地打开）
 *                     | 'open_pending'（跳待确认列表）
 */

import crypto from 'node:crypto';
import { getLLMRouter } from '../llm/router.mjs';
import { Store } from '../lib/store.mjs';
import { normalizeLang, outputLanguageDirective } from '../lib/language.mjs';
import { parseLLMJson } from '../llm/json-utils.mjs';
import { getCloudHook } from '../lib/cloud-hooks.mjs';

const store = Store();

// 同一用户同一天只允许一个在途生成，防止首页反复 focus 打出并发 LLM 调用。
const greetingInFlight = new Set();

const T = {
  zh: {
    greetLate: '夜深了', greetMorning: '早上好', greetNoon: '中午好', greetAfternoon: '下午好', greetEvening: '晚上好',
    plan_day: { label: '今天还没安排，帮我排个计划', prompt: '今天还没有安排任务，结合我的目标和精力，帮我排一个今天的计划吧。' },
    mit_focus: { label: '「{title}」现在开始？', prompt: '今天最重要的事是「{title}」，帮我拆出接下来 25 分钟就能动手的第一步。' },
    goal_nudge: { label: '聊聊「{title}」的进展', prompt: '「{title}」这个目标有几天没动静了，帮我看看卡在哪、接下来怎么推进？' },
    continue_thread: { label: '继续聊「{title}」' },
    insight_ready: { label: '生成我的自我认知报告', prompt: '我的数据应该够了，帮我生成一份自我认知报告吧。' },
    review_pending: { label: '有 {n} 条记忆待确认' },
    checkin: { label: '今天过得怎么样？记一笔', prompt: '陪我复盘一下今天：发生了什么、感觉怎么样、明天想怎么调整。' },
    cold_start: [
      { label: '和我聊聊你最近在忙什么', prompt: '我最近在忙：' },
      { label: '有什么想记下来的？', prompt: '帮我记一下：' },
      { label: '立一个目标，我帮你拆成计划', prompt: '我想立一个目标——' },
    ],
  },
  en: {
    greetLate: 'Still up', greetMorning: 'Good morning', greetNoon: 'Good afternoon', greetAfternoon: 'Good afternoon', greetEvening: 'Good evening',
    plan_day: { label: 'Nothing planned yet — build my day', prompt: 'I have no tasks scheduled today. Based on my goals and energy, help me plan the day.' },
    mit_focus: { label: 'Start "{title}" now?', prompt: 'My most important task today is "{title}". Break me off a first step I can start in the next 25 minutes.' },
    goal_nudge: { label: 'Check in on "{title}"', prompt: '"{title}" has been quiet for days. Help me see where it is stuck and how to move it forward.' },
    continue_thread: { label: 'Continue "{title}"' },
    insight_ready: { label: 'Generate my self-insight report', prompt: 'I think there is enough data now — generate my self-insight report.' },
    review_pending: { label: '{n} memories waiting for review' },
    checkin: { label: 'How was today? Jot it down', prompt: 'Walk me through a quick review of today: what happened, how I felt, what to adjust tomorrow.' },
    cold_start: [
      { label: 'Tell me what you have been up to', prompt: 'Lately I have been busy with: ' },
      { label: 'Anything worth writing down?', prompt: 'Note this down for me: ' },
      { label: 'Set a goal — I will break it down', prompt: 'I want to set a goal — ' },
    ],
  },
  ja: {
    greetLate: '夜更かし中', greetMorning: 'おはよう', greetNoon: 'こんにちは', greetAfternoon: 'こんにちは', greetEvening: 'こんばんは',
    plan_day: { label: '今日はまだ予定なし。計画を立てる', prompt: '今日はまだタスクがありません。目標とエネルギーに合わせて、今日の計画を立ててください。' },
    mit_focus: { label: '「{title}」今から始める？', prompt: '今日いちばん大事なのは「{title}」。次の25分で着手できる最初の一歩に分解してください。' },
    goal_nudge: { label: '「{title}」の進捗を話す', prompt: '「{title}」がここ数日止まっています。どこで詰まっているか、どう進めるか一緒に見てください。' },
    continue_thread: { label: '「{title}」の続きを話す' },
    insight_ready: { label: '自己認知レポートを生成', prompt: 'データが揃ってきたはず。自己認知レポートを生成してください。' },
    review_pending: { label: '確認待ちの記憶が {n} 件' },
    checkin: { label: '今日はどうだった？ひとこと記録', prompt: '今日の振り返りに付き合って：何があったか、どう感じたか、明日どう調整するか。' },
    cold_start: [
      { label: '最近何をしているか話して', prompt: '最近やっていること：' },
      { label: '書き留めたいことは？', prompt: 'メモして：' },
      { label: '目標を立てる。分解は任せて', prompt: '目標を立てたい——' },
    ],
  },
};

const TONE = {
  plan_day: 'exec', mit_focus: 'exec', goal_nudge: 'goal',
  continue_thread: 'memory', review_pending: 'memory',
  insight_ready: 'insight', checkin: 'insight', cold_start: 'goal',
};

function fill(tpl, vars = {}) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

function localHour(tz) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date())) % 24;
  } catch { return new Date().getHours(); }
}

function localDate(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); // YYYY-MM-DD
  } catch { return new Date().toISOString().slice(0, 10); }
}

function timeGreeting(copy, hour) {
  if (hour < 6) return copy.greetLate;
  if (hour < 12) return copy.greetMorning;
  if (hour < 14) return copy.greetNoon;
  if (hour < 18) return copy.greetAfternoon;
  return copy.greetEvening;
}

function displayName(user) {
  const n = (user?.display_name || '').trim();
  if (n) return n;
  return (user?.email || '').split('@')[0] || '';
}

const safe = (fn, dflt) => { try { const v = fn(); return v == null ? dflt : v; } catch { return dflt; } };

/** 规则候选：按计划表优先级排列，取前 3（每类至多一条，天然多样）。 */
function buildSuggestions(user, lang, copy, hour, data) {
  const { todayTasks, goals, conversations, pendingCount, insightState } = data;
  const out = [];
  const push = (type, label, extra = {}) => out.push({
    id: `${type}_${out.length}`, type, tone: TONE[type], label, action: 'chat', ...extra,
  });

  const openTasks = todayTasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'skipped');
  if (todayTasks.length === 0) {
    push('plan_day', copy.plan_day.label, { prompt: copy.plan_day.prompt });
  }

  const mit = openTasks.find(t => t.is_mit);
  if (mit?.title) {
    const vars = { title: mit.title };
    push('mit_focus', fill(copy.mit_focus.label, vars), { prompt: fill(copy.mit_focus.prompt, vars) });
  }

  const staleMs = 7 * 24 * 60 * 60 * 1000;
  const staleGoal = goals.find(g =>
    g.status === 'active' && g.title &&
    Date.now() - new Date(g.updated_at || g.created_at || 0).getTime() > staleMs
  );
  if (staleGoal) {
    const vars = { title: staleGoal.title };
    push('goal_nudge', fill(copy.goal_nudge.label, vars), { prompt: fill(copy.goal_nudge.prompt, vars) });
  }

  const latestConv = conversations[0];
  const freshMs = 48 * 60 * 60 * 1000;
  if (
    latestConv?.title && latestConv.title !== '新对话' &&
    Date.now() - new Date(latestConv.updated_at || 0).getTime() < freshMs
  ) {
    const shortTitle = latestConv.title.replace(/\s+/g, ' ').slice(0, 24);
    push('continue_thread', fill(copy.continue_thread.label, { title: shortTitle }), {
      action: 'open_conversation', conversation_id: latestConv.id,
    });
  }

  if (
    insightState?.eligibility?.unlocked &&
    !insightState?.cooldown?.active &&
    !insightState?.draft?.active
  ) {
    push('insight_ready', copy.insight_ready.label, { prompt: copy.insight_ready.prompt });
  }

  if (pendingCount > 0) {
    push('review_pending', fill(copy.review_pending.label, { n: pendingCount }), { action: 'open_pending' });
  }

  if (hour >= 20) {
    push('checkin', copy.checkin.label, { prompt: copy.checkin.prompt });
  }

  for (const c of copy.cold_start) {
    if (out.length >= 3) break;
    push('cold_start', c.label, { prompt: c.prompt });
  }
  return out.slice(0, 3);
}

// ── brief v2（P12，env COMPANION_BRIEF_V2=1 开启）────────────────────────────
// 数据指纹：今日任务集/MIT/最新会话/活跃目标最近更新/待确认数 有任一变化 → 指纹变
// → 缓存失效重新生成；数据不变则复用（比"每日一次"更省也更活）。

const briefV2Enabled = () => process.env.COMPANION_BRIEF_V2 === '1';

/** tier 分层预留（P12）：free 可限每日一次、付费随数据变化——当前统一放行。 */
function briefRegenAllowed(/* userId */) { return true; }

function briefFingerprint(data, lang) {
  const active = data.goals.filter(g => g.status === 'active');
  const src = JSON.stringify([
    lang,
    data.todayTasks.map(t => [t.id, t.status]).sort(),
    data.conversations[0]?.id || null,
    data.conversations[0]?.updated_at || null,
    active.map(g => g.updated_at || '').sort().slice(-1)[0] || null,
    data.pendingCount > 0,
  ]);
  return crypto.createHash('sha1').update(src).digest('hex').slice(0, 16);
}

/**
 * v2 生成：LLM 基于规则候选重写 greeting + 建议文案（保持 id/action 语义不变，
 * 只润色 label/prompt），整包按指纹缓存。fire-and-forget，绝不阻塞首屏。
 */
async function generateBriefV2(user, lang, briefDate, fingerprint, data, ruleSuggestions) {
  const key = `${user.id}:${briefDate}:${lang}:${fingerprint}`;
  if (greetingInFlight.has(key)) return;
  greetingInFlight.add(key);
  try {
    const material = {
      name: displayName(user) || null,
      local_hour: localHour(store.getSettings(user.id)?.timezone),
      active_goals: data.goals.filter(g => g.status === 'active').slice(0, 3).map(g => g.title),
      today_open_tasks: data.todayTasks.filter(t => t.status !== 'done').slice(0, 5).map(t => t.title),
      today_done_count: data.todayTasks.filter(t => t.status === 'done').length,
      last_conversation_topic: data.conversations[0]?.title && data.conversations[0].title !== '新对话' ? data.conversations[0].title : null,
      candidates: ruleSuggestions.map(s => ({ id: s.id, type: s.type, label: s.label, prompt: s.prompt || null })),
    };
    const system = [
      '你是用户的 AI 伙伴「智伴」。根据素材，为首页生成：',
      '1) greeting：一句开场白（≤40字，英文≤25词），自然温暖、只引用素材事实、无 emoji 无引号；',
      '2) suggestions：对候选建议逐条润色 label（≤18字，口语、有画面感）与 prompt（发送给智伴的完整话，保持原意）。不得增删候选、不得改 id。',
      '只输出 JSON 对象：{ "greeting": "...", "suggestions": [{ "id": "...", "label": "...", "prompt": "..." }] }',
      outputLanguageDirective(lang),
    ].join('\n');
    const llm = getLLMRouter();
    const { content } = await llm.chatToText([
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(material) },
    ], { temperature: 0.7, maxTokens: 1500 });
    const parsed = parseLLMJson(content);
    const greeting = String(parsed?.greeting || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const byId = new Map((Array.isArray(parsed?.suggestions) ? parsed.suggestions : []).map(s => [s?.id, s]));
    const suggestions = ruleSuggestions.map(s => {
      const re = byId.get(s.id);
      if (!re) return s;
      return {
        ...s,
        label: String(re.label || s.label).slice(0, 60),
        ...(s.prompt ? { prompt: String(re.prompt || s.prompt).slice(0, 300) } : {}),
      };
    });
    if (greeting) {
      store.setCompanionBrief(user.id, briefDate, lang, { greeting_text: greeting, fingerprint, suggestions });
    }
  } catch (e) {
    console.error('[companion-brief] v2 generation failed', e?.message || e);
  } finally {
    greetingInFlight.delete(key);
  }
}

/** 每日一次的个性化开场白：素材全部来自已取到的真实数据，一句话，异步落缓存。 */
async function generateLlmGreeting(user, lang, briefDate, data) {
  const key = `${user.id}:${briefDate}:${lang}`;
  if (greetingInFlight.has(key)) return;
  greetingInFlight.add(key);
  try {
    const goalTitles = data.goals.filter(g => g.status === 'active').slice(0, 3).map(g => g.title).filter(Boolean);
    const openTasks = data.todayTasks.filter(t => t.status !== 'done').slice(0, 5).map(t => t.title).filter(Boolean);
    const doneCount = data.todayTasks.filter(t => t.status === 'done').length;
    const lastTopic = data.conversations[0]?.title && data.conversations[0].title !== '新对话'
      ? data.conversations[0].title : null;

    const system = [
      '你是用户的 AI 伙伴「智伴」。根据下面的真实素材，为用户写一句今天的开场白。',
      '要求：只输出这一句话本身；不超过 40 个字（英文不超过 25 个词）；语气自然温暖、像了解 TA 的朋友，不要口号、不要 emoji、不要引号；',
      '只能引用素材里出现的事实，绝不编造目标、事件或数字。',
      outputLanguageDirective(lang),
    ].join('\n');
    const material = JSON.stringify({
      name: displayName(user) || null,
      active_goals: goalTitles,
      today_open_tasks: openTasks,
      today_done_count: doneCount,
      last_conversation_topic: lastTopic,
      local_hour: localHour(store.getSettings(user.id)?.timezone),
    });

    const llm = getLLMRouter();
    const { content } = await llm.chatToText([
      { role: 'system', content: system },
      { role: 'user', content: `素材：${material}` },
    ], { temperature: 0.7, maxTokens: 200 });

    const text = String(content || '').replace(/\s+/g, ' ').replace(/^["'「『]|["'」』]$/g, '').trim().slice(0, 80);
    if (text) store.setCompanionBrief(user.id, briefDate, lang, text);
  } catch (e) {
    console.error('[companion-brief] greeting generation failed', e?.message || e);
  } finally {
    greetingInFlight.delete(key);
  }
}

export function getBrief(user, langRaw) {
  const lang = normalizeLang(langRaw || store.getSettings(user.id)?.language);
  const copy = T[lang] || T.zh;
  const settings = store.getSettings(user.id);
  const tz = settings?.timezone;
  const hour = localHour(tz);
  const briefDate = localDate(tz);

  const data = {
    todayTasks: safe(() => store.listTodayTasks(user.id), []),
    goals: safe(() => store.listGoals(user.id), []),
    conversations: safe(() => store.listConversations(user.id), []),
    pendingCount: safe(() => store.listCaptures(user.id, { status: 'pending' }).length, 0),
    // 测评引擎属 cloud 模块（open-core）：OSS 构建 hook 为 null，简报建议自动缺省该维度。
    insightState: safe(() => getCloudHook('assessment.getState')?.(user.id) ?? null, null),
  };

  const suggestions = buildSuggestions(user, lang, copy, hour, data);

  const name = displayName(user);
  const base = timeGreeting(copy, hour);
  const sep = lang === 'en' ? ', ' : '，';
  const templateGreeting = name ? `${base}${sep}${name}` : base;

  const cached = store.getCompanionBrief(user.id, briefDate, lang);
  // 数据太少（没有任何会话与目标）就不值得个性化，纯模板即可。
  const hasSubstance = data.conversations.length > 0 || data.goals.length > 0;

  // ── v2：整包（greeting+建议文案）按数据指纹缓存，指纹变了才重新生成 ──
  if (briefV2Enabled() && hasSubstance) {
    const fingerprint = briefFingerprint(data, lang);
    if (cached?.fingerprint === fingerprint && cached.greeting_text) {
      const cachedSugs = Array.isArray(cached.suggestions) && cached.suggestions.length
        ? cached.suggestions : suggestions;
      return { greeting: { text: cached.greeting_text, source: 'llm' }, suggestions: cachedSugs };
    }
    if (briefRegenAllowed(user.id)) {
      void generateBriefV2(user, lang, briefDate, fingerprint, data, suggestions);
    }
    // 指纹不匹配：旧开场白仍可先用（避免降级成模板），建议用最新规则版。
    return {
      greeting: cached?.greeting_text
        ? { text: cached.greeting_text, source: 'llm' }
        : { text: templateGreeting, source: 'template' },
      suggestions,
    };
  }

  // ── v1：每日一次 LLM 开场白 ──
  let greeting;
  if (cached?.greeting_text) {
    greeting = { text: cached.greeting_text, source: 'llm' };
  } else {
    greeting = { text: templateGreeting, source: 'template' };
    if (hasSubstance) void generateLlmGreeting(user, lang, briefDate, data);
  }

  return { greeting, suggestions };
}

export default { getBrief };
