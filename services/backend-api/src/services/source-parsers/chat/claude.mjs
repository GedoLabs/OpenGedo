/**
 * Claude 官方导出解析（自 memory-import.service 迁入，逻辑原样）。
 * 导出路径：设置 → 隐私 → 导出数据 → 邮件链接（24h 过期）→ zip 内 conversations.json。
 * 结构：会话数组，chat_messages 平铺 [{sender:'human'|'assistant', text|content[]}]。
 */

/** @returns {Array<{title:string,updated_at:number,text:string}>} */
export function parseClaudeConversations(json) {
  const arr = Array.isArray(json) ? json : [];
  return arr.map(conv => {
    const msgs = Array.isArray(conv.chat_messages) ? conv.chat_messages : [];
    const text = msgs
      .map(m => {
        const body = String(m.text || (Array.isArray(m.content) ? m.content.map(c => c?.text || '').join('\n') : '')).trim();
        return body ? `${m.sender === 'human' ? '我' : 'AI'}: ${body}` : null;
      })
      .filter(Boolean)
      .join('\n');
    return {
      title: String(conv.name || '').slice(0, 120),
      updated_at: Date.parse(conv.updated_at || conv.created_at || '') || 0,
      text,
    };
  }).filter(c => c.text);
}

/** 形状探测：数组元素带 chat_messages 即视为 Claude 导出。 */
export function looksLikeClaude(json) {
  const first = Array.isArray(json) ? json.find(Boolean) : null;
  return !!(first && typeof first === 'object' && Array.isArray(first.chat_messages));
}
