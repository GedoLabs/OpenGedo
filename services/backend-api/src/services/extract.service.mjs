/**
 * Extract Agent Service
 * 
 * Automatically extracts structured information from conversations:
 * - Important facts about the user
 * - Skills and traits mentioned
 * - Key events and experiences
 * - Date-based reminders
 * - Goal intentions
 */

import { getLLMRouter } from '../llm/router.mjs';
import { getMemoryStore } from '../memory/store/index.mjs';
import { embedEpisode } from '../memory/embedding.mjs';
import { ENTITY_TYPES } from '../memory/entity-registry.mjs';
import { LIFE_DIMENSIONS } from '../memory/types.mjs';
import { classifyDimensions } from '../memory/dimension-classifier.mjs';
const { addEpisode } = getMemoryStore();

/**
 * Analyze a conversation message for extractable information.
 * Uses LLM to detect and structure information worth remembering.
 *
 * @param {string} message
 * @param {Array}  conversationContext
 * @param {object} [opts]
 * @param {Array}  [opts.unfilledSlots] — core memory slots not yet filled for
 *   this user ({ id, label, hint }); the extractor is steered to proactively
 *   capture them and tag hits with slot_id.
 *
 * Each extraction item:
 *   { kind: 'memory'|'todo', type, content, title, due_date, tags,
 *     confidence: 0-1, importance: 'core'|'high'|'normal'|'low',
 *     slot_id: string|null, reminder_date }
 */
export async function analyzeMessage(message, conversationContext = [], opts = {}) {
  const router = getLLMRouter();
  const unfilledSlots = Array.isArray(opts.unfilledSlots) ? opts.unfilledSlots : [];

  if (!router.isAvailable()) {
    return normalizeExtraction(ruleBasedExtraction(message));
  }

  const slotBlock = unfilledSlots.length > 0
    ? `\n\n该用户的核心画像中以下"核心记忆点"尚未填充，请优先留意捕获（命中时在 slot_id 填对应 id，importance 至少为 high）：\n${unfilledSlots.map(s => `- ${s.id}：${s.label}（${s.hint}）`).join('\n')}\n其中 id 以 entity: 开头的对应图鉴卡片的待补事实——命中时 kind 用 entity_fact，slot_id 照填，entity_name/fact_key 按该行提示填写。`
    : '';

  // Dedup steering: tell the model what the user already has on record so it
  // stops re-emitting the same goal/todo/memory turn after turn.
  const knownItems = Array.isArray(opts.knownItems) ? opts.knownItems.filter(Boolean) : [];
  const knownBlock = knownItems.length > 0
    ? `\n\n以下目标/待办/记忆该用户已经记录在案，请不要重复抽取（同一目标的措辞变体、加空格、改标点都算重复）；只有当用户这次明确提出一个全新的、不同的事项时才抽取：\n${knownItems.map(t => `- ${t}`).join('\n')}`
    : '';

  try {
    // 任务路由（K4）：默认 gedo 自有模型端点（本地 Qwen3 / 训练后的 Gedo Persona），
    // 失败降级外部主/备链；参数与 schema 在 llm/tasks.mjs 的 memory.extract 条目
    const response = await router.runTask('memory.extract', [
      {
        role: 'system',
        content: `你是一个信息抽取助手。分析用户的对话消息，判断是否包含值得长期记忆的信息或需要跟进的待办事项。

如果包含，返回 JSON:
{
  "should_extract": true,
  "extractions": [
    {
      "kind": "memory|todo|entity_fact",
      "type": "important_info|personal_trait|key_event|date_reminder (仅 kind=memory)",
      "content": "结构化的记忆内容",
      "title": "待办标题 (仅 kind=todo)",
      "due_date": "YYYY-MM-DD (仅 kind=todo，可选)",
      "entity_name": "实体名字，如 妈妈/球球/我的车 (仅 kind=entity_fact)",
      "entity_type": "person|pet|object|place|event|org|other (仅 kind=entity_fact)",
      "fact_key": "事实键 (仅 kind=entity_fact)",
      "fact_value": "事实值 (仅 kind=entity_fact)",
      "entity_names": ["该记忆提到的人/物名字"] (仅 kind=memory，可选),
      "dimensions": ["health|career|family|finance|growth|social|hobby|self_realization"] (仅 kind=memory，该记忆触及的生命之花维度，0-2 个，都不沾则空数组),
      "tags": ["标签1", "标签2"],
      "confidence": 0.0-1.0,
      "importance": "core|high|normal|low",
      "slot_id": "命中的核心记忆点 id，未命中则 null",
      "reminder_date": "YYYY-MM-DD (仅 date_reminder 类型)"
    }
  ]
}

如果没有值得记录的信息，返回:
{ "should_extract": false, "extractions": [] }

memory 类型判断标准：
- important_info: 用户分享的重要事实、偏好、习惯
- personal_trait: 用户展现的能力、性格特点、价值观、身份信息
- key_event: 重要经历、成就、转折点
- date_reminder: 提到的具体日期和相关事件

entity_fact 判断标准（优先于 memory）：
- 关于用户身边某个具体的人/宠物/物品/地点/组织的**稳定属性**（如"妈妈的生日是3月8日"、"我的车是特斯拉 Model 3"、"同事老王特别靠谱"）→ 输出 entity_fact，不要作为 memory 重复输出
- 发生的**事件**（"昨天陪妈妈去医院"）仍是 memory，不是 entity_fact；事件里提到的名字放进 entity_names
- fact_key 优先用这些固定键：birthday/personality/likes/how_we_met/breed/brand/model/acquired_at/meaning/city/period/when/my_role/joined_at；都不贴切时用简短中文键（≤6字）
- 关于用户**自己**的信息不是 entity_fact（那是 memory 或核心记忆点）

importance 分级标准：
- core: 身份级事实（称呼、角色、价值观、重要的人、长期愿景），或命中下方核心记忆点
- high: 对理解用户有持续价值（关键经历、能力证据、当前重大挑战）
- normal: 有价值但非关键（一般偏好、近况）
- low: 价值存疑，宁可不记

todo 判断标准：
- 用户提到自己要做、要交、要去、别忘了的具体事项（如"下周三要交报名表"）
- 输出简洁的 title；能推断日期时填 due_date（今天是 ${new Date().toISOString().slice(0, 10)}）
- 用户向 AI 发出的当下指令不算待办

不要记录：
- 日常闲聊（你好、谢谢等）
- 已经在对话中直接处理的操作请求
- 模糊或无实质的内容${slotBlock}${knownBlock}`,
      },
      {
        role: 'user',
        content: `用户消息：${message}\n\n${conversationContext.length > 0 ? `最近对话上下文：\n${conversationContext.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n')}` : ''}`,
      },
    ]);

    // 路由层已完成 JSON 宽容解析 + schema 校验，此处直接拿结构化结果
    const normalized = normalizeExtraction(response.json);
    normalized.provenance = response.provenance || null; // 溯源：哪个端点/模型抽取的
    return normalized;
  } catch (error) {
    console.error('[ExtractService] analyzeMessage error:', error);
    return normalizeExtraction(ruleBasedExtraction(message));
  }
}

const IMPORTANCE_LEVELS = ['core', 'high', 'normal', 'low'];

/** Defensive normalisation of LLM / rule output to the unified shape. */
function normalizeExtraction(result) {
  if (!result || typeof result !== 'object') return { should_extract: false, extractions: [] };
  const extractions = (Array.isArray(result.extractions) ? result.extractions : [])
    .filter(e => e && typeof e === 'object')
    .map(e => {
      const kind = e.kind === 'todo' ? 'todo' : e.kind === 'entity_fact' ? 'entity_fact' : 'memory';
      if (kind === 'entity_fact') {
        // 三字段缺一即丢弃（防御 LLM 幻觉输出半截事实）。
        const entityName = String(e.entity_name || '').trim();
        const factKey = String(e.fact_key || '').trim().slice(0, 40);
        const factValue = String(e.fact_value || '').trim().slice(0, 200);
        if (!entityName || !factKey || !factValue) return null;
        return {
          kind,
          entity_name: entityName,
          entity_type: ENTITY_TYPES.includes(e.entity_type) ? e.entity_type : 'person',
          fact_key: factKey,
          fact_value: factValue,
          content: `${entityName}：${factKey} = ${factValue}`,
          tags: [],
          confidence: typeof e.confidence === 'number' ? Math.max(0, Math.min(1, e.confidence)) : 0.5,
          importance: IMPORTANCE_LEVELS.includes(e.importance) ? e.importance : 'high',
          slot_id: typeof e.slot_id === 'string' && e.slot_id ? e.slot_id : null,
        };
      }
      const content = String(e.content || e.title || '').trim();
      return {
        kind,
        type: kind === 'memory' ? (e.type || 'important_info') : null,
        content,
        title: kind === 'todo' ? String(e.title || content).trim().slice(0, 120) : null,
        due_date: kind === 'todo' ? (e.due_date || null) : null,
        entity_names: kind === 'memory' && Array.isArray(e.entity_names)
          ? e.entity_names.map(String).slice(0, 5)
          : [],
        // 维度：LLM 显式给了（含空数组）就钳制采纳；缺失（规则兜底/旧模型输出）
        // 才用关键词分类器补——两条路径都可能合法地得出"空"。
        dimensions: kind !== 'memory' ? []
          : Array.isArray(e.dimensions)
            ? e.dimensions.filter(d => LIFE_DIMENSIONS.includes(d)).slice(0, 2)
            : classifyDimensions(content, Array.isArray(e.tags) ? e.tags.map(String) : []),
        tags: Array.isArray(e.tags) ? e.tags.map(String).slice(0, 8) : [],
        confidence: typeof e.confidence === 'number' ? Math.max(0, Math.min(1, e.confidence)) : 0.5,
        importance: IMPORTANCE_LEVELS.includes(e.importance) ? e.importance : 'normal',
        slot_id: typeof e.slot_id === 'string' && e.slot_id ? e.slot_id : null,
        reminder_date: e.reminder_date || null,
      };
    })
    .filter(e => e && e.content);
  return { should_extract: extractions.length > 0, extractions };
}

/**
 * Rule-based extraction as fallback
 */
function ruleBasedExtraction(message) {
  const extractions = [];
  const lower = message.toLowerCase();

  // Detect personal traits
  const traitPatterns = [
    { pattern: /我擅长(.+)/g, type: 'personal_trait', tag: 'skill' },
    { pattern: /我喜欢(.+)/g, type: 'personal_trait', tag: 'preference' },
    { pattern: /我的专业是(.+)/g, type: 'personal_trait', tag: 'profession' },
  ];

  for (const { pattern, type, tag } of traitPatterns) {
    const match = pattern.exec(message);
    if (match) {
      extractions.push({
        type,
        content: match[0],
        tags: [tag],
        confidence: 0.6,
      });
    }
  }

  // Detect key events
  const eventPatterns = ['刚刚', '今天我', '昨天', '上周', '最近', '终于'];
  if (eventPatterns.some(p => lower.includes(p)) && message.length > 15) {
    extractions.push({
      type: 'key_event',
      content: message,
      tags: ['experience'],
      confidence: 0.5,
    });
  }

  // Detect date reminders
  const dateMatch = message.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1]);
    const day = parseInt(dateMatch[2]);
    const year = new Date().getFullYear();
    const date = new Date(year, month - 1, day);
    if (date < new Date()) date.setFullYear(year + 1);

    extractions.push({
      type: 'date_reminder',
      content: message,
      tags: ['reminder'],
      confidence: 0.7,
      reminder_date: date.toISOString().split('T')[0],
    });
  }

  // Detect todo candidates ("记得/别忘了/要交/得做…")
  const todoPatterns = [
    /(?:别忘了|记得|提醒我)(.{2,60})/,
    /(?:明天|后天|今晚|本周|下周[一二三四五六日天]?|周[一二三四五六日天]|下个?月)[^，。！？]{0,20}?(?:要|得|去|交|做|完成|提交|报名|准备)[^，。！？]{0,40}/,
  ];
  for (const pattern of todoPatterns) {
    const match = pattern.exec(message);
    if (match) {
      const title = (match[1] || match[0]).trim().slice(0, 80);
      if (title.length >= 2) {
        extractions.push({
          kind: 'todo',
          title,
          content: title,
          tags: ['todo'],
          confidence: 0.6,
          importance: 'normal',
        });
      }
      break;
    }
  }

  return {
    should_extract: extractions.length > 0,
    extractions,
  };
}

/**
 * Generate a conversation title from messages
 */
export async function summarizeConversation(messages) {
  const router = getLLMRouter();

  if (!router.isAvailable() || messages.length < 2) {
    return messages[0]?.content?.slice(0, 30) || '新对话';
  }

  try {
    const response = await router.runTask('conversation.title', [
      {
        role: 'system',
        content: '根据对话内容，用 5-15 个字生成对话标题。直接返回标题，不要格式化。',
      },
      {
        role: 'user',
        content: messages.slice(0, 6).map(m => `${m.role}: ${m.content?.slice(0, 100)}`).join('\n'),
      },
    ]);

    return response.content.trim().replace(/^["'「]|["'」]$/g, '').slice(0, 50);
  } catch {
    return messages[0]?.content?.slice(0, 30) || '新对话';
  }
}

/**
 * Auto-extract memories from a completed conversation.
 * Writes qualifying extractions to both the legacy store and the new episodic layer.
 */
export async function autoExtractFromConversation(messages, userId) {
  const userMessages = messages.filter(m => m.role === 'user');
  const allExtractions = [];

  for (const msg of userMessages) {
    const result = await analyzeMessage(msg.content, messages);
    if (result.should_extract) {
      for (const extraction of result.extractions) {
        if (extraction.kind === 'todo') continue; // todos are not episodic memories
        if (extraction.confidence >= 0.5) {
          allExtractions.push(extraction);

          // Write to the new four-layer episodic memory
          try {
            const ep = addEpisode(userId, {
              type: extraction.type,
              contentRaw: extraction.content,
              tags: extraction.tags || [],
              source: 'auto_extract',
              contentStruct: {
                summary: extraction.content?.slice(0, 80),
                provenance: result.provenance || null,
              },
              reminderDate: extraction.reminder_date || null,
              confidence: extraction.confidence,
            });
            embedEpisode(userId, ep).catch(() => {}); // P1: embed-on-write (fire-and-forget)
          } catch (e) {
            console.error('[ExtractService] addEpisode error:', e);
          }
        }
      }
    }
  }

  return allExtractions;
}

export default {
  analyzeMessage,
  summarizeConversation,
  autoExtractFromConversation,
};
