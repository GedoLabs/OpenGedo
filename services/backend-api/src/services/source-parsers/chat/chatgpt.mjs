/**
 * ChatGPT 官方导出解析（自 memory-import.service 迁入，逻辑原样）。
 * 导出路径：设置 → 数据控制 → 导出数据 → 邮件收 zip（内含 conversations.json）。
 * conversations.json = 会话数组，消息存 mapping 树（编辑/重答产生分支），按 create_time 线性化。
 */

/** @returns {Array<{title:string,updated_at:number,text:string}>} */
export function parseChatGPTConversations(json) {
  const arr = Array.isArray(json) ? json : [];
  return arr.map(conv => {
    const nodes = Object.values(conv.mapping || {})
      .map(n => n?.message)
      .filter(m => m && (m.author?.role === 'user' || m.author?.role === 'assistant'))
      .filter(m => Array.isArray(m.content?.parts))
      .sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
    const text = nodes
      .map(m => {
        const body = m.content.parts.filter(p => typeof p === 'string').join('\n').trim();
        return body ? `${m.author.role === 'user' ? '我' : 'AI'}: ${body}` : null;
      })
      .filter(Boolean)
      .join('\n');
    return {
      title: String(conv.title || '').slice(0, 120),
      updated_at: (conv.update_time || conv.create_time || 0) * 1000,
      text,
    };
  }).filter(c => c.text);
}

/** 形状探测：数组元素带 mapping 树即视为 ChatGPT 导出。 */
export function looksLikeChatGPT(json) {
  const first = Array.isArray(json) ? json.find(Boolean) : null;
  return !!(first && typeof first === 'object' && first.mapping && typeof first.mapping === 'object');
}
