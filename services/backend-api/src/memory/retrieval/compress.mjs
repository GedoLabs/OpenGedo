/**
 * Memory Compressor (P3-B)
 *
 * Top-K 原文 → 压缩摘要，减少注入 LLM system prompt 的 token 量。
 *
 * 输出格式（计划 §3.4.1）：
 *   "用户在 {时间} {做过/提到/经历了} {事件摘要}（详情可索引）"
 *
 * 两个入口：
 *   compressByLLM   — 用 LLM 生成结构化摘要（质量高，有延迟）
 *   compressLocal   — 纯本地截断拼接（零延迟，LLM 不可用时降级）
 *   compress        — 自动选择
 */

const MAX_RAW_CHARS = 120; // 每条记忆原文截断长度

/**
 * 本地压缩（无 LLM）— 格式化每条记忆为一行描述。
 */
export function compressLocal(memories, opts = {}) {
  const { maxItems = 8 } = opts;
  return memories.slice(0, maxItems).map(m => {
    const when  = formatDate(m.created_at);
    const what  = (m.content_raw || '').slice(0, MAX_RAW_CHARS).replace(/\n/g, ' ');
    const decay = m.decay_class === 'permanent' ? '【核心】' :
                  m.decay_class === 'slow'      ? '【重要】' : '';
    return `${decay}${when}：${what}`;
  }).join('\n');
}

/**
 * LLM 压缩 — 生成结构化摘要字符串（适合注入 system prompt）。
 */
export async function compressByLLM(memories, query, llm, opts = {}) {
  const { maxItems = 8, maxOutputChars = 600 } = opts;

  if (!llm?.chat || memories.length === 0) {
    return compressLocal(memories, opts);
  }

  const snippets = memories.slice(0, maxItems).map((m, i) => {
    const when = formatDate(m.created_at);
    const text = (m.content_raw || '').slice(0, 200);
    return `[${i}] ${when} | ${m.type} | ${text}`;
  }).join('\n');

  try {
    const messages = [
      {
        role: 'system',
        content: '你是用户记忆摘要助手。输出纯文本，不加 markdown，每条一行，不超过给定总字数。',
      },
      {
        role: 'user',
        content: `用户查询：「${query}」\n\n以下是相关记忆原文：\n${snippets}\n\n` +
          `请将这些记忆压缩为简洁的摘要，每条格式为：\n` +
          `"用户在[时间][做过/提到/经历了][事件]（详情可索引）"\n` +
          `总字数不超过 ${maxOutputChars} 字。`,
      },
    ];
    // 任务路由可用时走 memory.compress（gedo 优先）；兼容传入裸 provider 的旧路径
    const resp = llm.runTask
      ? await llm.runTask('memory.compress', messages)
      : await llm.chat(messages);

    const text = typeof resp === 'string' ? resp : (resp.content || '');
    return text.slice(0, maxOutputChars * 2) || compressLocal(memories, opts);
  } catch {
    return compressLocal(memories, opts);
  }
}

/**
 * Auto-select compressor.
 * @param {object[]} memories
 * @param {string}   query
 * @param {object}   [llm]
 * @param {object}   [opts]
 * @param {boolean}  [opts.useLLM=false]    — 是否启用 LLM 压缩（有额外延迟）
 * @param {number}   [opts.maxItems=8]
 * @returns {Promise<string>}
 */
export async function compress(memories, query, llm, opts = {}) {
  const { useLLM = false, ...rest } = opts;
  if (!memories?.length) return '';
  if (useLLM && llm) {
    return compressByLLM(memories, query, llm, rest);
  }
  return compressLocal(memories, rest);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '某时';
  try {
    const d     = new Date(dateStr);
    const now   = new Date();
    const diffMs = now - d;
    const days   = Math.floor(diffMs / 86400000);
    if (days === 0)   return '今天';
    if (days === 1)   return '昨天';
    if (days <= 7)    return `${days} 天前`;
    if (days <= 30)   return `${Math.floor(days / 7)} 周前`;
    if (days <= 365)  return `${Math.floor(days / 30)} 个月前`;
    return `${Math.floor(days / 365)} 年前`;
  } catch {
    return '某时';
  }
}
