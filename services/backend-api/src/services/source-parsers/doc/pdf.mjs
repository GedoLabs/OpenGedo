/**
 * PDF → 纯文本。依赖 pdf-parse（纯 JS，无 native 依赖），动态 import：
 * 依赖未安装时报 parser_unavailable，不拖累进程启动。
 * 扫描件（无文字层）→ no_text_layer，前端引导"转成文本再传"。
 */

export async function parsePdf(buffer) {
  let pdfParse;
  try {
    // 注意：必须引 lib 深路径——v1 包根入口在无 module.parent 时进 debug 模式去读它的测试文件
    ({ default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js'));
  } catch {
    const e = new Error('PDF 解析器未安装（pdf-parse）');
    e.code = 'PARSER_UNAVAILABLE';
    throw e;
  }
  let data;
  try {
    data = await pdfParse(buffer);
  } catch (err) {
    const e = new Error(`PDF 解析失败: ${err?.message || err}`);
    e.code = 'PARSE_FAILED';
    throw e;
  }
  const text = String(data?.text || '').trim();
  if (!text || text.length < 20) {
    const e = new Error('PDF 没有可提取的文字层（可能是扫描件）');
    e.code = 'NO_TEXT_LAYER';
    throw e;
  }
  return text;
}
