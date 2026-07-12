/**
 * 转化层分块（RAG 式原始层）：
 *   - 文档类（博客/文章/粘贴/PDF/DOCX）：按段落聚合到目标长度，带重叠、保留最近标题前缀
 *   - 对话类（AI 平台导出）：一个会话一块，超长会话按长度硬切
 *
 * 纯函数、无 IO；嵌入与持久化在 source-pipeline.service。
 */

const DOC_TARGET_CHARS = 1800;   // 文档块目标长度
const DOC_OVERLAP_CHARS = 200;   // 相邻块重叠
export const DOC_MAX_CHUNKS = 400;      // 单来源文档块硬上限（≈50 万字符，对齐 NotebookLM"单来源体积恒定"哲学）
const CONV_MAX_CHARS = 6000;     // 单会话块上限（对齐现有 memory.import 的 CHUNK_CHARS）
export const CONV_MAX_COUNT = 100;      // 单来源最多提取的会话数（旧管线 50 → 新管线 100）

/** markdown/纯文本标题行（# 前缀或短独立行不判定，宁缺毋滥只认 #）。 */
function headingOf(line) {
  const m = /^#{1,4}\s+(.{1,80})$/.exec(line.trim());
  return m ? m[1].trim() : null;
}

/** 超长段落按句读硬切（。！？.!? 换行），兜底按长度切。 */
function splitLongParagraph(para, maxLen) {
  const out = [];
  let rest = para;
  while (rest.length > maxLen) {
    let cut = -1;
    for (const re of [/[。！？!?]\s*/g, /[.;]\s+/g, /\n/g]) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(rest.slice(0, maxLen))) !== null) cut = Math.max(cut, m.index + m[0].length);
    }
    if (cut < maxLen * 0.3) cut = maxLen; // 找不到合适句读 → 按长度切
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

/**
 * 文档正文 → 块数组。
 * @param {string} text
 * @returns {Array<{ i: number, text: string, meta: { heading?: string } }>}
 */
export function chunkDocument(text, {
  target = DOC_TARGET_CHARS,
  overlap = DOC_OVERLAP_CHARS,
  maxChunks = DOC_MAX_CHUNKS,
} = {}) {
  const clean = String(text || '').replace(/\r\n?/g, '\n');
  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';
  let heading = null;      // 当前块所属的最近标题
  let bufHeading = null;   // 进入 buf 时的标题
  const flush = () => {
    if (!buf.trim()) return;
    chunks.push({ i: chunks.length, text: buf.trim(), meta: bufHeading ? { heading: bufHeading } : {} });
    buf = buf.slice(-overlap); // 尾部重叠带入下一块
    bufHeading = heading;
  };
  for (const para of paragraphs) {
    if (chunks.length >= maxChunks) break;
    const h = headingOf(para);
    if (h) heading = h;
    const pieces = para.length > target * 1.5 ? splitLongParagraph(para, target) : [para];
    for (const piece of pieces) {
      if (buf.length + piece.length + 2 > target && buf.trim()) flush();
      if (chunks.length >= maxChunks) break;
      if (!buf.trim()) bufHeading = heading;
      buf = buf ? `${buf}\n\n${piece}` : piece;
    }
  }
  if (chunks.length < maxChunks) flush();
  return chunks.slice(0, maxChunks);
}

/**
 * 会话数组 → 块数组（一个会话一块，超长切段；总量截断到 maxCount）。
 * @param {Array<{ title?: string, text: string, updated_at?: number }>} convs
 * @returns {Array<{ i: number, text: string, meta: { conv_title?: string, part?: number } }>}
 */
export function chunkConversations(convs, { maxChars = CONV_MAX_CHARS, maxCount = CONV_MAX_COUNT } = {}) {
  const chunks = [];
  const list = (convs || [])
    .filter((c) => c && String(c.text || '').trim())
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, maxCount);
  for (const conv of list) {
    const text = String(conv.text).trim();
    const metaBase = conv.title ? { conv_title: String(conv.title).slice(0, 120) } : {};
    if (text.length <= maxChars) {
      chunks.push({ i: chunks.length, text, meta: metaBase });
      continue;
    }
    const parts = splitLongParagraph(text, maxChars);
    parts.forEach((part, idx) => {
      chunks.push({ i: chunks.length, text: part, meta: { ...metaBase, part: idx + 1 } });
    });
  }
  return chunks;
}

/** 正文清洗：统一换行、去控制符、压缩 3+ 连续空行。 */
export function cleanText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
