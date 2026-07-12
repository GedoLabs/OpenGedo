/**
 * 通用对话形状探测器：不认识的 JSON 导出（Kimi/豆包/DeepSeek 第三方插件导出、
 * 其他平台）里尽力找"消息数组"。递归扫描，凡是数组元素形如
 * { role|sender|author, content|text|message } 就当作一段会话。
 * 全部失败返回 null，由调用方降级为纯文本处理。
 */

const ROLE_KEYS = ['role', 'sender', 'author'];
const BODY_KEYS = ['content', 'text', 'message'];
const USER_ROLES = new Set(['user', 'human', 'me', '用户', '我']);
const TITLE_KEYS = ['title', 'name', 'topic', 'subject'];

function messageBody(m) {
  for (const k of BODY_KEYS) {
    const v = m[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const joined = v.map((p) => (typeof p === 'string' ? p : p?.text || '')).filter(Boolean).join('\n').trim();
      if (joined) return joined;
    }
  }
  return '';
}

function messageRole(m) {
  for (const k of ROLE_KEYS) {
    const v = m[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase();
    if (v && typeof v === 'object' && typeof v.role === 'string') return v.role.toLowerCase();
  }
  return '';
}

/** 数组是否像消息列表（≥2 条、多数元素有 role+body）。 */
function isMessageArray(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return false;
  const sample = arr.slice(0, 20).filter((m) => m && typeof m === 'object');
  if (!sample.length) return false;
  const hits = sample.filter((m) => messageRole(m) && messageBody(m)).length;
  return hits >= Math.max(2, Math.ceil(sample.length * 0.6));
}

function toConv(arr, title, updatedAt) {
  const text = arr
    .map((m) => {
      const body = messageBody(m);
      if (!body) return null;
      const role = messageRole(m);
      return `${USER_ROLES.has(role) ? '我' : 'AI'}: ${body}`;
    })
    .filter(Boolean)
    .join('\n');
  return text ? { title: String(title || '').slice(0, 120), updated_at: updatedAt || 0, text } : null;
}

function titleOf(obj) {
  for (const k of TITLE_KEYS) {
    if (typeof obj?.[k] === 'string' && obj[k].trim()) return obj[k].trim();
  }
  return '';
}

function timeOf(obj) {
  for (const k of ['updated_at', 'update_time', 'updatedAt', 'created_at', 'create_time', 'createdAt', 'time']) {
    const v = obj?.[k];
    if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
    if (typeof v === 'string') { const t = Date.parse(v); if (t) return t; }
  }
  return 0;
}

/**
 * @param {unknown} json
 * @returns {Array<{title:string,updated_at:number,text:string}>|null} null=没探测到对话形状
 */
export function detectConversations(json, depth = 0) {
  if (depth > 4 || !json || typeof json !== 'object') return null;
  // 情况1：本身就是消息数组 → 单会话
  if (isMessageArray(json)) {
    const conv = toConv(json, '', 0);
    return conv ? [conv] : null;
  }
  if (Array.isArray(json)) {
    // 情况2：会话数组（每个元素内含消息数组字段）
    const convs = [];
    for (const item of json.slice(0, 2000)) {
      if (!item || typeof item !== 'object') continue;
      for (const v of Object.values(item)) {
        if (isMessageArray(v)) {
          const conv = toConv(v, titleOf(item), timeOf(item));
          if (conv) convs.push(conv);
          break;
        }
      }
    }
    return convs.length ? convs : null;
  }
  // 情况3：包一层的对象 → 在值里继续找
  for (const v of Object.values(json)) {
    const found = detectConversations(v, depth + 1);
    if (found?.length) return found;
  }
  return null;
}
