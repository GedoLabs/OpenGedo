/**
 * DOCX → 纯文本。依赖 mammoth（纯 JS），动态 import 同 pdf.mjs 的理由。
 */

export async function parseDocx(buffer) {
  let mammoth;
  try {
    mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
  } catch {
    const e = new Error('DOCX 解析器未安装（mammoth）');
    e.code = 'PARSER_UNAVAILABLE';
    throw e;
  }
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = String(result?.value || '').trim();
    if (!text) {
      const e = new Error('DOCX 内容为空');
      e.code = 'PARSE_FAILED';
      throw e;
    }
    return text;
  } catch (err) {
    if (err.code) throw err;
    const e = new Error(`DOCX 解析失败: ${err?.message || err}`);
    e.code = 'PARSE_FAILED';
    throw e;
  }
}
