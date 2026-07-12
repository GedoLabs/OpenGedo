/**
 * LLM 输出 JSON 清洗 — 从 insight-engine 抽出的共享工具。
 *
 * 模型输出常见三种脏形态：代码围栏包裹、JSON 前后带解说文字、
 * 中文长文本内嵌英文引号导致的碎 JSON。这里做「剥围栏 → 截取最外层
 * 花括号区间 → parse」，失败抛带 status/code 的类型化错误，
 * 路由层可直接翻译成 HTTP 响应。
 */

function fail(status, code, extra = {}) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  e.extra = extra;
  return e;
}

export function parseLLMJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw fail(502, 'llm_failed', { detail: 'no JSON object in response' });
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    throw fail(502, 'llm_failed', { detail: `JSON parse: ${e.message}` });
  }
}
