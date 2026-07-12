/**
 * Daily Planner Agent (Sprint 0 MVP — S0-4)
 *
 * Generates a JSON-shaped morning brief for a single user. Pure logic:
 * the caller injects an LLM client and the user's context object.
 *
 * Output schema:
 *   {
 *     greeting:     string,    // 1 short sentence (≤25 chars)
 *     opener:       string,    // 1-2 sentence morning brief that mentions today's focus
 *     tasks:        Array<{ title: string, why?: string, energy?: 'low'|'medium'|'high' }>,
 *     care_message: string | null  // optional 1-sentence care touch (or null)
 *   }
 *
 * The schema is enforced by `validatePlan()`. If the LLM returns malformed
 * JSON the agent falls back to a deterministic local plan so the cron
 * never silently fails.
 */

// 纯 agent 包不依赖 backend-api，这里就地放一份极简的语言指令映射
// （完整版见 backend-api/src/lib/language.mjs，两边保持同样的 3 语支持）。
function outputLanguageLine(lang) {
  if (lang === 'en') return 'Write all output text in English.';
  if (lang === 'ja') return 'すべての出力テキストを日本語で書いてください。';
  return '请用简体中文撰写所有输出文本。';
}

function buildPrompt(lang) {
  return `你是 GEDO.AI 的智能助理「智伴」。每天早晨 7 点，你为用户生成一条简短的"早安简报"。

要求：
- 温和、直接、不啰嗦。${outputLanguageLine(lang)}
- 必须只输出符合 JSON Schema 的纯 JSON，不要 markdown 围栏，不要解释。
- 如果用户当天暂无任务，你也要给出 1-2 个高 ROI 的建议任务作为 tasks 字段。
- care_message 仅在你检测到用户最近情绪低落 / 任务连续未完成 / 重要日期临近时填写；否则为 null。

JSON Schema:
{
  "type": "object",
  "required": ["greeting", "opener", "tasks", "care_message"],
  "properties": {
    "greeting":     { "type": "string", "maxLength": 40 },
    "opener":       { "type": "string", "maxLength": 280 },
    "tasks": {
      "type": "array",
      "minItems": 1,
      "maxItems": 5,
      "items": {
        "type": "object",
        "required": ["title"],
        "properties": {
          "title":  { "type": "string", "maxLength": 80 },
          "why":    { "type": "string", "maxLength": 120 },
          "energy": { "type": "string", "enum": ["low","medium","high"] }
        }
      }
    },
    "care_message": { "type": ["string","null"], "maxLength": 240 }
  }
}`;
}

const ENERGY_VALUES = new Set(['low', 'medium', 'high']);

function clampStr(value, max) {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const greeting = clampStr(plan.greeting, 40);
  const opener = clampStr(plan.opener, 280);
  if (!greeting || !opener) return null;
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) return null;

  const tasks = plan.tasks.slice(0, 5).map(t => {
    if (!t || typeof t !== 'object') return null;
    const title = clampStr(t.title, 80);
    if (!title) return null;
    const out = { title };
    if (t.why) out.why = clampStr(t.why, 120);
    if (t.energy && ENERGY_VALUES.has(t.energy)) out.energy = t.energy;
    return out;
  }).filter(Boolean);
  if (tasks.length === 0) return null;

  const care = plan.care_message == null
    ? null
    : clampStr(plan.care_message, 240) || null;

  return { greeting, opener, tasks, care_message: care };
}

function buildLocalFallbackPlan(ctx) {
  const hour = new Date().getHours();
  const greeting = hour < 11 ? '早上好 ☀️' : hour < 18 ? '下午好' : '晚上好';

  const goalTitles = (ctx.activeGoals || [])
    .map(g => g?.title)
    .filter(Boolean)
    .slice(0, 2);

  const yesterdayTaskCount = (ctx.yesterdayCheckIns || []).length;

  const opener = goalTitles.length
    ? `继续推进 ${goalTitles.join(' / ')}。${yesterdayTaskCount ? `昨天打卡 ${yesterdayTaskCount} 项，` : ''}今天先抓 1-2 个最关键的。`
    : `今天先选一件能让你晚上回想起来"做对了"的事。`;

  const fromGoals = goalTitles.slice(0, 2).map(title => ({
    title: `推进：${title}`,
    why: '保持连续投入',
    energy: 'medium',
  }));
  const tasks = fromGoals.length > 0 ? fromGoals : [
    { title: '记录 3 件今天最想做的事', why: '把模糊的早晨变具体', energy: 'low' },
    { title: '给最重要的目标推进 30 分钟', why: '复利在于天天动一点', energy: 'medium' },
  ];

  return {
    greeting,
    opener,
    tasks,
    care_message: null,
  };
}

function tryParseJson(text) {
  if (!text) return null;
  // Strip common LLM artifacts: ```json fences and prefix prose.
  const trimmed = String(text).trim();
  // Try direct parse first.
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  // Extract first {...} block.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

/**
 * Render a validated plan object as the chat-channel text the user sees.
 * Kept here (not in scheduler) so server / tests render identically.
 */
export function renderPlanText(plan) {
  if (!plan) return '';
  const lines = [];
  lines.push(`${plan.greeting} ${plan.opener}`);
  lines.push('');
  lines.push('今日聚焦：');
  for (const t of plan.tasks) {
    const energy = t.energy ? ` · ${t.energy === 'high' ? '高能量' : t.energy === 'low' ? '低能量' : '中等'}` : '';
    lines.push(`• ${t.title}${energy}${t.why ? `\n   _${t.why}_` : ''}`);
  }
  if (plan.care_message) {
    lines.push('');
    lines.push(`💡 ${plan.care_message}`);
  }
  return lines.join('\n');
}

/**
 * Generate today's plan for a user.
 *
 * @param {object} options
 * @param {object} options.ctx           Pre-fetched context (see fields below).
 * @param {object} options.llm           LLMRouter-shaped object with `.chat(messages, opts)`. Optional — if absent the fallback runs.
 * @param {function} [options.now]       Returns Date — for testing.
 * @returns {Promise<{plan: object, source: 'llm' | 'fallback'}>}
 *
 * `ctx` may include:
 *   - identity:         { name?, life_stage?, north_star?, ... }
 *   - activeGoals:      [{ id, title, status, life_wheel_dimension }, ...]
 *   - todayTasks:       [{ id, title, status, ... }, ...]
 *   - yesterdayCheckIns:[{ task_id, status, mood_rating?, reason_code? }, ...]
 *   - moodTrend:        string e.g. 'positive' | 'neutral' | 'stressed'
 */
export async function generateDailyPlan({ ctx = {}, llm, now = () => new Date() }) {
  if (!llm || typeof llm.chat !== 'function' || (typeof llm.isAvailable === 'function' && !llm.isAvailable())) {
    return { plan: buildLocalFallbackPlan(ctx), source: 'fallback' };
  }

  let raw;
  try {
    raw = await llm.chat(
      [
        { role: 'system', content: buildPrompt(ctx.language) },
        {
          role: 'user',
          content: JSON.stringify({
            now: now().toISOString(),
            identity: ctx.identity || null,
            active_goals: (ctx.activeGoals || []).slice(0, 8),
            today_tasks: (ctx.todayTasks || []).slice(0, 12),
            yesterday_check_ins: (ctx.yesterdayCheckIns || []).slice(0, 12),
            mood_trend: ctx.moodTrend || null,
          }),
        },
      ],
      { temperature: 0.4, maxTokens: 700, json: true }
    );
  } catch (error) {
    console.error('[DailyPlanner] LLM error, falling back:', error?.message || error);
    return { plan: buildLocalFallbackPlan(ctx), source: 'fallback' };
  }

  const parsed = tryParseJson(raw?.content);
  const plan = validatePlan(parsed);
  if (plan) return { plan, source: 'llm' };

  console.warn('[DailyPlanner] LLM output failed validation; falling back.');
  return { plan: buildLocalFallbackPlan(ctx), source: 'fallback' };
}

export default { generateDailyPlan, renderPlanText };
