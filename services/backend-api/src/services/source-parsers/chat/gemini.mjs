/**
 * Gemini（Google Takeout）解析。
 * 导出路径：takeout.google.com → 取消全选 → 勾"我的活动(My Activity)" → 内容选项里只勾
 * "Gemini Apps" → JSON 格式导出。⚠️ 直接勾"Gemini"产品导出的是 Gems 配置，不是聊天记录。
 *
 * MyActivity JSON = 活动数组：
 *   { header:'Gemini Apps', title:'Prompted <用户输入>', time:ISO, subtitles?:[{name}], ... }
 * 记录以"用户提问"为主（回答不一定在导出里），按天聚合成会话——提问本身已足够
 * 提炼用户关注点/事实。宽容解析：字段缺失就跳过。
 */

const PROMPT_PREFIXES = [/^Prompted\s+/i, /^已输入提示\s*/, /^プロンプト:?\s*/];

function stripPromptPrefix(title) {
  let t = String(title || '');
  for (const re of PROMPT_PREFIXES) t = t.replace(re, '');
  return t.trim();
}

/** @returns {Array<{title:string,updated_at:number,text:string}>} */
export function parseGeminiActivity(json) {
  const arr = Array.isArray(json) ? json : [];
  const items = arr
    .filter((it) => it && typeof it === 'object' && /gemini/i.test(String(it.header || '')))
    .map((it) => {
      const prompt = stripPromptPrefix(it.title);
      const extras = []
        .concat(Array.isArray(it.subtitles) ? it.subtitles.map((s) => s?.name) : [])
        .concat(Array.isArray(it.details) ? it.details.map((d) => d?.name) : [])
        .filter((s) => typeof s === 'string' && s.trim());
      const when = Date.parse(it.time || '') || 0;
      return prompt ? { prompt, extras, when } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.when - b.when);
  if (!items.length) return [];

  // 按天聚合为"会话"
  const byDay = new Map();
  for (const it of items) {
    const day = new Date(it.when || Date.now()).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(it);
  }
  return [...byDay.entries()].map(([day, list]) => ({
    title: `Gemini ${day}`,
    updated_at: Math.max(...list.map((x) => x.when || 0)),
    text: list
      .map((x) => [`我: ${x.prompt}`, ...x.extras.map((e) => `（${e}）`)].join('\n'))
      .join('\n'),
  })).filter((c) => c.text.trim());
}

/** 形状探测：数组元素 header 含 Gemini 即视为 Takeout MyActivity。 */
export function looksLikeGemini(json) {
  const first = Array.isArray(json) ? json.find(Boolean) : null;
  return !!(first && typeof first === 'object' && /gemini/i.test(String(first.header || '')));
}
