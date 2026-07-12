/**
 * 三方记忆导入（P6）— 把 ChatGPT / Claude 的导出对话分解为 Gedo 记忆碎片。
 *
 * 链路：上传（zip/json/纯文本）→ 解析成统一会话结构 → 按会话（最近优先，
 * 上限 IMPORT_MAX_CONVS）分块喂 LLM 批量抽取 → 近重复过滤（isNearDuplicate，
 * 对库内近期碎片 + 本次已入库内容双重比对）→ episodes 落库（source 打
 * import_chatgpt|import_claude|import_text 标）；entity_fact 对既有图鉴卡
 * 直接上卡（不自动建新卡，避免垃圾卡），计入 entities_touched。
 *
 * 任务模型：store.importJobs（单实例进程内异步跑，前端轮询
 * GET /v1/memory/import/jobs/:id）。既有坑已规避：中文长 JSON 给足
 * max_tokens、输出用 insight-engine 的 parseLLMJson 清洗（含内嵌引号碎 JSON）。
 */

import JSZip from 'jszip';
import { getLLMRouter } from '../llm/router.mjs';
import { Store } from '../lib/store.mjs';
import { getMemoryStore } from '../memory/store/index.mjs';
import { EPISODE_TYPES } from '../memory/types.mjs';
import { isNearDuplicate } from '../lib/dedup.mjs';
import * as EmailService from './email.service.mjs';
import { outputLanguageDirective } from '../lib/language.mjs';
import { harvestImportedUserTurns } from '../persona/twin.mjs';
// 解析函数已迁至来源中心解析注册表（source-parsers/），此处引回保持旧管线行为不变
import { parseChatGPTConversations } from './source-parsers/chat/chatgpt.mjs';
import { parseClaudeConversations } from './source-parsers/chat/claude.mjs';

const store = Store();
const memStore = getMemoryStore();

export const IMPORT_MAX_CONVS = 50;
const CHUNK_CHARS = 6000;           // 每会话喂给 LLM 的文本上限
const MAX_EXTRACT_PER_CONV = 8;     // 单会话最多落多少条碎片
const DEDUP_SCAN_LIMIT = 500;       // 与库内最近 N 条碎片比对近重复

// ── 解析：三种来源 → 统一 [{ title, updated_at, text }] ────────────────────
// parseChatGPTConversations / parseClaudeConversations 本体在 source-parsers/chat/。

/** 上传体 → 会话数组。zip 则取内部 conversations.json。 */
export async function parseUpload(buffer, format) {
  if (format === 'text') {
    const text = buffer.toString('utf8').trim().slice(0, 60_000);
    if (!text) return [];
    return [{ title: 'pasted_text', updated_at: Date.now(), text }];
  }
  let json;
  const head = buffer.subarray(0, 2).toString('latin1');
  if (head === 'PK') {
    const zip = await JSZip.loadAsync(buffer);
    const entry = zip.file(/(^|\/)conversations\.json$/i)[0];
    if (!entry) { const e = new Error('zip 里没找到 conversations.json'); e.code = 'NO_CONVERSATIONS_JSON'; throw e; }
    json = JSON.parse(await entry.async('string'));
  } else {
    json = JSON.parse(buffer.toString('utf8'));
  }
  return format === 'claude' ? parseClaudeConversations(json) : parseChatGPTConversations(json);
}

// ── LLM 批量抽取：一段会话 → 若干结构化碎片 ────────────────────────────────

async function extractFromConversation(convText, lang, existingSample) {
  const llm = getLLMRouter();
  const system = [
    '你在帮用户把一段与其他 AI 的历史对话，提炼成用户的长期记忆碎片。',
    '只提炼「关于用户本人」的稳定事实/经历/特质/偏好/关系/重要事件；忽略 AI 的建议内容、一次性闲聊、代码与技术求助细节。',
    existingSample
      ? `用户已有以下记忆（语义重复的绝对不要再输出，即使措辞不同）：\n${existingSample}`
      : '',
    '输出 JSON 数组（无其他文字），每项：',
    '{ "kind": "memory"|"entity_fact", "type": "important_info"|"personal_trait"|"key_event"|"date_reminder", "content": "一句话（≤80字）", "entity_name": "仅 entity_fact：人物/宠物/地点名", "fact_key": "仅 entity_fact", "fact_value": "仅 entity_fact", "confidence": 0.0-1.0 }',
    `最多输出 ${MAX_EXTRACT_PER_CONV} 项；没有可提炼内容就输出 []。`,
    outputLanguageDirective(lang),
  ].filter(Boolean).join('\n');
  // memory.import 任务：gedo 优先；primary 车道带 viaText（长 JSON 流式聚合防代理断流）
  const response = await llm.runTask('memory.import', [
    { role: 'system', content: system },
    { role: 'user', content: convText.slice(0, CHUNK_CHARS) },
  ]);
  const parsed = response.json;
  return Array.isArray(parsed) ? parsed.slice(0, MAX_EXTRACT_PER_CONV) : [];
}

// ── 任务执行（异步，进度写 store.importJobs）────────────────────────────────

export async function runImportJob(userId, jobId, conversations, source) {
  const lang = store.getSettings(userId)?.language || 'zh';
  const convs = conversations
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, IMPORT_MAX_CONVS);

  const existing = (memStore.listEpisodes(userId, { limit: DEDUP_SCAN_LIMIT, includeExcluded: true }) || [])
    .map(e => String(e.content_raw || ''));
  const importedContents = [];
  let episodesCreated = 0;
  let entitiesTouched = 0;
  let convsDone = 0;
  let extractFailures = 0;

  // 导入场景阈值更严（0.66）：宁可少存一条，不给库里堆语义重复。
  const isDup = (content) =>
    importedContents.some(c => isNearDuplicate(c, content, 0.66)) ||
    existing.some(c => isNearDuplicate(c, content, 0.66));

  // 已有记忆样本注入 prompt 做语义级去重（LLM 比字符串比对更懂"换了措辞的同一件事"）。
  const existingSample = existing.slice(0, 150).join('\n').slice(0, 5000);

  for (const conv of convs) {
    // Twin 语料收割（仅已签 Twin 独立同意时生效）：导入对话中的用户发言
    // 是分身风格的一手语料——GMP 导入通道的又一次复利。失败绝不影响导入。
    try { harvestImportedUserTurns(userId, conv.text); } catch { /* non-fatal */ }

    try {
      const sample = [existingSample, ...importedContents].join('\n').slice(0, 6000);
      const items = await extractFromConversation(conv.text, lang, sample);
      for (const it of items) {
        // 与来源中心管线同步的修复：模型偶发漏 confidence 字段，缺省按 0.8 计
        const rawConf = Number(it?.confidence);
        const confidence = Number.isFinite(rawConf) ? rawConf : 0.8;
        if (!it || confidence < 0.6) continue;
        if (it.kind === 'entity_fact') {
          const name = String(it.entity_name || '').trim();
          const k = String(it.fact_key || '').trim();
          const v = String(it.fact_value || '').trim();
          if (!name || !k || !v) continue;
          const entity = store.matchEntityByName(userId, name);
          if (entity && store.upsertEntityFact) {
            const already = (entity.facts || []).some(f => f.k === k);
            if (!already) {
              store.upsertEntityFact(userId, entity.id, { k, v });
              entitiesTouched += 1;
            }
          }
          continue;
        }
        const content = String(it.content || '').trim().slice(0, 300);
        if (!content || isDup(content)) continue;
        const type = EPISODE_TYPES.includes(it.type) ? it.type : 'important_info';
        memStore.addEpisode(userId, {
          type,
          contentRaw: content,
          tags: ['import', source.replace('import_', '')],
          source,
          dimensions: [],
        });
        importedContents.push(content);
        episodesCreated += 1;
      }
    } catch (e) {
      extractFailures += 1;
      console.warn(`[memory-import] conv extract failed (${extractFailures}):`, e?.message || e);
    }
    convsDone += 1;
    store.updateImportJob(userId, jobId, {
      progress: { convs_done: convsDone, convs_total: convs.length, episodes_created: episodesCreated, entities_touched: entitiesTouched },
    });
  }

  store.updateImportJob(userId, jobId, {
    status: 'done',
    progress: { convs_done: convsDone, convs_total: convs.length, episodes_created: episodesCreated, entities_touched: entitiesTouched },
    report: {
      episodes_created: episodesCreated,
      entities_touched: entitiesTouched,
      convs_processed: convsDone,
      convs_skipped: Math.max(0, conversations.length - convs.length),
      extract_failures: extractFailures,
    },
  });

  try {
    const user = store.getUserById(userId);
    if (user) {
      EmailService.sendImportComplete(user, { kind: 'memory', episodesCreated, entitiesTouched })
        .catch((e) => console.warn('[email] import-complete failed:', e?.message));
    }
  } catch (e) { console.warn('[email] import-complete skipped:', e?.message); }
}

export default { parseUpload, runImportJob, IMPORT_MAX_CONVS };
