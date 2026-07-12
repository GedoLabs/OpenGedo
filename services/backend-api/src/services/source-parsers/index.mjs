/**
 * 来源解析注册表：任意来源输入 → 统一转化产物。
 *
 *   parseSourceInput({ buffer?|text?, type, platform?, mime?, filename? })
 *     → { kind:'conversations', convs:[{title,updated_at,text}], title? }
 *     | { kind:'doc', text, title? }
 *
 * 路由顺序：平台提示（用户选的入口）→ JSON 形状自动探测 → 文件扩展/魔数 → 纯文本兜底。
 * 所有错误带 e.code，路由层据此回 4xx/5xx 与 i18n 错误键。
 */

import JSZip from 'jszip';
import { parseChatGPTConversations, looksLikeChatGPT } from './chat/chatgpt.mjs';
import { parseClaudeConversations, looksLikeClaude } from './chat/claude.mjs';
import { parseGeminiActivity, looksLikeGemini } from './chat/gemini.mjs';
import { detectConversations } from './chat/generic.mjs';
import { parsePdf } from './doc/pdf.mjs';
import { parseDocx } from './doc/docx.mjs';
import { parseHtml } from './doc/html.mjs';

// zip 炸弹防护上限
const ZIP_MAX_ENTRIES = 200;
const ZIP_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = 128 * 1024 * 1024;

function err(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** 带解压体积防护的 zip 加载。 */
export async function loadZipSafely(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > ZIP_MAX_ENTRIES) throw err(`zip 条目过多（>${ZIP_MAX_ENTRIES}）`, 'ZIP_GUARD');
  let total = 0;
  for (const e of entries) {
    const size = Number(e?._data?.uncompressedSize ?? 0);
    if (size > ZIP_MAX_ENTRY_BYTES) throw err('zip 内单文件解压后过大', 'ZIP_GUARD');
    total += Math.max(0, size);
    if (total > ZIP_MAX_TOTAL_BYTES) throw err('zip 解压后总体积过大', 'ZIP_GUARD');
  }
  return zip;
}

/** zip 内挑出最可能的数据文件：conversations.json 优先，其次任意 .json，最后最大的文本文件。 */
async function extractFromZip(buffer) {
  const zip = await loadZipSafely(buffer);
  const conv = zip.file(/(^|\/)conversations\.json$/i)[0];
  if (conv) return { kind: 'json', name: conv.name, content: await conv.async('string') };
  const jsons = zip.file(/\.json$/i);
  if (jsons.length) {
    // 取最大的 json（Takeout 里往往混着说明文件）
    const best = jsons.sort((a, b) => (b?._data?.uncompressedSize || 0) - (a?._data?.uncompressedSize || 0))[0];
    return { kind: 'json', name: best.name, content: await best.async('string') };
  }
  const texts = zip.file(/\.(txt|md|markdown|html?)$/i);
  if (texts.length) {
    const best = texts.sort((a, b) => (b?._data?.uncompressedSize || 0) - (a?._data?.uncompressedSize || 0))[0];
    return { kind: /html?$/i.test(best.name) ? 'html' : 'text', name: best.name, content: await best.async('string') };
  }
  throw err('zip 里没找到可解析的数据文件', 'NO_DATA_IN_ZIP');
}

/** JSON → 会话（平台提示优先，其次形状探测；全不中返回 null）。 */
function convsFromJson(json, platform) {
  const byPlatform = {
    chatgpt: parseChatGPTConversations,
    claude: parseClaudeConversations,
    gemini: parseGeminiActivity,
  };
  if (byPlatform[platform]) {
    const convs = byPlatform[platform](json);
    if (convs.length) return convs;
  }
  if (looksLikeChatGPT(json)) { const c = parseChatGPTConversations(json); if (c.length) return c; }
  if (looksLikeClaude(json)) { const c = parseClaudeConversations(json); if (c.length) return c; }
  if (looksLikeGemini(json)) { const c = parseGeminiActivity(json); if (c.length) return c; }
  return detectConversations(json); // Kimi / 豆包 / DeepSeek 插件导出 / 未知平台
}

/** JSON 兜底：收集所有字符串值拼成文档文本（宁可粗糙不丢信息）。 */
function flattenJsonToText(json, depth = 0, out = []) {
  if (out.length > 5000 || depth > 6) return out;
  if (typeof json === 'string') {
    const s = json.trim();
    if (s.length >= 4) out.push(s);
  } else if (Array.isArray(json)) {
    for (const v of json) flattenJsonToText(v, depth + 1, out);
  } else if (json && typeof json === 'object') {
    for (const v of Object.values(json)) flattenJsonToText(v, depth + 1, out);
  }
  return out;
}

function extOf(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * 主入口。
 * @param {{ buffer?: Buffer, text?: string, type: string, platform?: string|null, mime?: string, filename?: string }} input
 */
export async function parseSourceInput(input) {
  const { buffer, text, platform = null, mime = '', filename = '' } = input;

  // 纯文本（粘贴）：平台提示了对话平台也先试 JSON（用户可能贴的是导出内容）
  if (typeof text === 'string' && !buffer) {
    return routeString(text, { platform, hint: 'text' });
  }
  if (!buffer || !buffer.length) throw err('空内容', 'EMPTY_INPUT');

  const ext = extOf(filename);
  const head = buffer.subarray(0, 4).toString('latin1');

  // docx 本质是 zip（PK 魔数），必须先于 zip 分支用扩展名/mime 判断
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { kind: 'doc', text: await parseDocx(buffer), title: null };
  }
  if (head.startsWith('PK')) { // zip（ChatGPT/Claude/Kimi/Takeout 导出）
    const inner = await extractFromZip(buffer);
    if (inner.kind === 'json') return routeString(inner.content, { platform, hint: 'json', filename: inner.name });
    if (inner.kind === 'html') return docFromHtml(inner.content);
    return routeString(inner.content, { platform, hint: 'text', filename: inner.name });
  }
  if (head.startsWith('%PDF') || ext === 'pdf' || mime === 'application/pdf') {
    return { kind: 'doc', text: await parsePdf(buffer), title: null };
  }
  const utf8 = buffer.toString('utf8');
  if (ext === 'html' || ext === 'htm' || /text\/html/.test(mime) || /^\s*<(!doctype|html)/i.test(utf8)) {
    return docFromHtml(utf8);
  }
  return routeString(utf8, { platform, hint: ext === 'json' ? 'json' : 'text', filename });
}

async function docFromHtml(html) {
  const { text, title } = await parseHtml(html);
  return { kind: 'doc', text, title };
}

/** 字符串内容路由：JSON 试对话解析 → 兜底文档。 */
function routeString(content, { platform, hint }) {
  const s = String(content || '').trim();
  if (!s) throw err('空内容', 'EMPTY_INPUT');
  const looksJson = hint === 'json' || /^[[{]/.test(s);
  if (looksJson) {
    let json = null;
    try { json = JSON.parse(s); } catch { /* 非法 JSON → 当纯文本 */ }
    if (json !== null) {
      const convs = convsFromJson(json, platform);
      if (convs?.length) return { kind: 'conversations', convs, title: null };
      const flat = flattenJsonToText(json).join('\n');
      if (flat.trim()) return { kind: 'doc', text: flat, title: null };
      throw err('JSON 里没有可提取的文本', 'NO_CONTENT');
    }
  }
  return { kind: 'doc', text: s, title: null };
}
