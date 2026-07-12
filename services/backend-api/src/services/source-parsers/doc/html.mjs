/**
 * HTML → 正文文本。首选 @mozilla/readability + linkedom（比 jsdom 轻、无 native 依赖）
 * 抽正文；依赖缺失或抽取失败时降级为启发式去标签（宁可粗糙不可失败——
 * 抓取到手的页面必须能出文本）。
 */

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ');
}

/** @returns {Promise<{ text: string, title: string|null }>} */
export async function parseHtml(html, { url = '' } = {}) {
  const raw = String(html || '');
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  const fallbackTitle = titleMatch ? stripTags(titleMatch[1]).trim().slice(0, 160) || null : null;
  try {
    const [{ Readability }, { parseHTML }] = await Promise.all([
      import('@mozilla/readability'),
      import('linkedom'),
    ]);
    const { document } = parseHTML(raw);
    const article = new Readability(document, { charThreshold: 200 }).parse();
    const text = String(article?.textContent || '').trim();
    if (text.length >= 120) {
      return { text, title: (article?.title || fallbackTitle || '').slice(0, 160) || null };
    }
  } catch { /* 依赖缺失或解析异常 → 走启发式兜底 */ }
  const text = stripTags(raw).trim();
  if (!text || text.length < 40) {
    const e = new Error('网页正文为空或过短');
    e.code = 'PARSE_FAILED';
    throw e;
  }
  return { text, title: fallbackTitle };
}
