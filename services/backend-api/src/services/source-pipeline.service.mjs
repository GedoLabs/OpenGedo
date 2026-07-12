/**
 * 来源导入管线（来源中心 v2）：
 *   queued → fetching(仅url) → parsing(解析+清洗+分块+本地嵌入) → extracting(LLM 提取)
 *          → review(有候选待确认) | done(无候选) ；旁路 failed / canceled
 *
 * 与旧 memory-import 管线的关键差异：
 *   1. 原始数据持久化为 Source（raw/text/chunks 落盘，可再提取，二期接检索）
 *   2. 提取产物一律进 captures 待确认队列（kind memory / entity_fact），
 *      不再直接写 episodes——用户确认制；entity_fact 无 entity_id 时确认路由会
 *      自动建图鉴卡（补齐"导入建卡"缺口，同样确认制）
 *   3. 由持久队列调度（job-queue.mjs），块间响应取消
 *
 * 保留旧管线的既有教训：中文长 JSON 走 viaText 流式聚合；≤6000 字/块；
 * 置信 ≥0.6；isNearDuplicate 0.66 双重去重；Twin 语料收割（仅对话类，failure 不致命）。
 */

import { getLLMRouter } from '../llm/router.mjs';
import { Store } from '../lib/store.mjs';
import { createBillingService } from './billing.service.mjs';
import { approveCaptureWithEdits, autoAcceptGate, AUTO_ACCEPT_MAX_PER_SOURCE } from '../memory/inbox.service.mjs';
import { getMemoryStore } from '../memory/store/index.mjs';
import { EPISODE_TYPES } from '../memory/types.mjs';
import { isNearDuplicate } from '../lib/dedup.mjs';
import { outputLanguageDirective } from '../lib/language.mjs';
import { harvestImportedUserTurns } from '../persona/twin.mjs';
import { embedText } from '../memory/embedding.mjs';
import * as SourceStore from '../memory/source-store.mjs';
import * as EmailService from './email.service.mjs';
import { chunkDocument, chunkConversations, cleanText } from '../memory/chunking.mjs';
import { parseSourceInput } from './source-parsers/index.mjs';
import { fetchPublicUrl } from '../lib/web-fetch.mjs';
import { parseHtml } from './source-parsers/doc/html.mjs';

const store = Store();
const memStore = getMemoryStore();
const billing = createBillingService(store);

const MAX_EXTRACT_PER_CHUNK = 8;
const DEDUP_SCAN_LIMIT = 500;
const MIN_CONFIDENCE = 0.6;
const TEXT_PERSIST_CAP = 500_000;   // text.txt 落盘上限（单来源体积恒定哲学）
const EMBED_BATCH = 4;              // 本地 bge-m3 并发（embedText 失败返回 null，非致命）
const ENTITY_TYPES = ['person', 'pet', 'object', 'place', 'event', 'org', 'other'];

class CanceledError extends Error {
  constructor() { super('canceled'); this.code = 'CANCELED'; }
}

// ── 提取 prompt：对话类沿用旧管线措辞（含既有教训），文档类为新变体 ─────────

function conversationSystemPrompt(lang, existingSample) {
  return [
    '你在帮用户把一段与其他 AI 的历史对话，提炼成用户的长期记忆碎片。',
    '只提炼「关于用户本人」的稳定事实/经历/特质/偏好/关系/重要事件；忽略 AI 的建议内容、一次性闲聊、代码与技术求助细节。',
    '关于用户本人的信息一律用 kind="memory" 输出（即使 TA 自报了姓名）；entity_fact 只用于用户之外「具体的」人/宠物/地点/组织——饮品、习惯、作品、活动等抽象事物不是实体，写进 memory 的 content 即可。',
    existingSample
      ? `用户已有以下记忆（语义重复的绝对不要再输出，即使措辞不同）：\n${existingSample}`
      : '',
    '输出 JSON 数组（无其他文字），每项：',
    '{ "kind": "memory"|"entity_fact", "type": "important_info"|"personal_trait"|"key_event"|"date_reminder", "content": "一句话（≤80字）", "entity_name": "仅 entity_fact：人物/宠物/地点名", "entity_type": "仅 entity_fact，可选: person|pet|object|place|event|org", "fact_key": "仅 entity_fact", "fact_value": "仅 entity_fact", "confidence": 0.0-1.0 }',
    `每项都必须带 confidence 字段。最多输出 ${MAX_EXTRACT_PER_CHUNK} 项；没有可提炼内容就输出 []。`,
    outputLanguageDirective(lang),
  ].filter(Boolean).join('\n');
}

function documentSystemPrompt(lang, existingSample) {
  return [
    '你在帮用户把一段 TA 提供的资料（博客文章/个人文档/网页正文）提炼成用户的长期记忆碎片。',
    '资料默认由用户本人撰写或与其密切相关。只提炼「关于用户本人」的稳定信息：身份/经历/特质/偏好/价值观/人际关系/重要事件；忽略科普性内容、转载观点、与用户无关的叙述。',
    '第一人称叙述者（"我"）就是用户本人：TA 的信息一律用 kind="memory" 输出（即使自报了姓名），不要把用户本人当作 entity_fact 的实体；entity_fact 只用于用户之外「具体的」人/宠物/地点/组织——饮品、习惯、作品、活动等抽象事物不是实体，写进 memory 的 content 即可。',
    existingSample
      ? `用户已有以下记忆（语义重复的绝对不要再输出，即使措辞不同）：\n${existingSample}`
      : '',
    '输出 JSON 数组（无其他文字），每项：',
    '{ "kind": "memory"|"entity_fact", "type": "important_info"|"personal_trait"|"key_event"|"date_reminder", "content": "一句话（≤80字）", "entity_name": "仅 entity_fact：人物/宠物/地点名", "entity_type": "仅 entity_fact，可选: person|pet|object|place|event|org", "fact_key": "仅 entity_fact", "fact_value": "仅 entity_fact", "confidence": 0.0-1.0 }',
    `每项都必须带 confidence 字段。最多输出 ${MAX_EXTRACT_PER_CHUNK} 项；没有可提炼内容就输出 []。`,
    outputLanguageDirective(lang),
  ].filter(Boolean).join('\n');
}

async function extractFromChunk(kind, chunkText, lang, existingSample) {
  const llm = getLLMRouter();
  const system = kind === 'conversations'
    ? conversationSystemPrompt(lang, existingSample)
    : documentSystemPrompt(lang, existingSample);
  const taskId = kind === 'conversations' ? 'memory.import' : 'memory.import.doc';
  const response = await llm.runTask(taskId, [
    { role: 'system', content: system },
    { role: 'user', content: chunkText.slice(0, 6000) },
  ]);
  const parsed = response.json;
  return Array.isArray(parsed) ? parsed.slice(0, MAX_EXTRACT_PER_CHUNK) : [];
}

// ── 阶段实现 ────────────────────────────────────────────────────────────────

/** url 来源：抓取并转成"文件等价物"（html/纯文本 buffer + 标题）。 */
async function stageFetch(userId, sourceId, meta) {
  SourceStore.updateSource(userId, sourceId, { status: 'fetching' });
  const { content, contentType, finalUrl, truncated } = await fetchPublicUrl(meta.origin?.url);
  if (/html/.test(contentType)) {
    const { text, title } = await parseHtml(content, { url: finalUrl });
    return { parsed: { kind: 'doc', text, title }, originPatch: { final_url: finalUrl, truncated } };
  }
  if (/json/.test(contentType)) {
    return {
      parsed: await parseSourceInput({ buffer: Buffer.from(content, 'utf8'), text: undefined, type: meta.type, platform: meta.platform, mime: contentType, filename: 'remote.json' }),
      originPatch: { final_url: finalUrl, truncated },
    };
  }
  return { parsed: { kind: 'doc', text: content, title: null }, originPatch: { final_url: finalUrl, truncated } };
}

/** 解析+清洗+分块+嵌入。返回 { kind, chunks }。 */
async function stageTransform(userId, sourceId, meta, preParsed) {
  SourceStore.updateSource(userId, sourceId, { status: 'parsing' });
  let parsed = preParsed;
  if (!parsed) {
    const raw = SourceStore.readRaw(userId, sourceId);
    if (!raw || !raw.length) {
      const e = new Error('来源没有原始数据'); e.code = 'EMPTY_INPUT'; throw e;
    }
    parsed = await parseSourceInput({
      buffer: raw,
      type: meta.type,
      platform: meta.platform,
      mime: meta.origin?.mime || '',
      filename: meta.origin?.filename || '',
    });
  }

  let chunks;
  let fullText;
  let convCount = 0;
  if (parsed.kind === 'conversations') {
    chunks = chunkConversations(parsed.convs);
    convCount = new Set(chunks.map((c) => c.meta?.conv_title || c.i)).size;
    fullText = parsed.convs
      .map((c) => `### ${c.title || '(untitled)'}\n${c.text}`)
      .join('\n\n')
      .slice(0, TEXT_PERSIST_CAP);
  } else {
    const cleaned = cleanText(parsed.text).slice(0, TEXT_PERSIST_CAP);
    if (!cleaned) { const e = new Error('正文为空'); e.code = 'NO_CONTENT'; throw e; }
    chunks = chunkDocument(cleaned);
    fullText = cleaned;
  }
  if (!chunks.length) { const e = new Error('没有可提取的内容块'); e.code = 'NO_CONTENT'; throw e; }

  SourceStore.saveText(userId, sourceId, fullText);

  // 本地嵌入（RAG 原始层）：小并发批量，失败置 null 不阻塞
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vecs = await Promise.all(batch.map((c) => embedText(c.text)));
    vecs.forEach((v, j) => { batch[j].embedding = v || null; });
  }
  SourceStore.saveChunks(userId, sourceId, chunks);

  const titlePatch = (!meta.title && parsed.title) ? { title: String(parsed.title).slice(0, 160) } : {};
  SourceStore.updateSource(userId, sourceId, {
    ...titlePatch,
    stats: { char_count: fullText.length, chunk_count: chunks.length, conv_count: convCount },
    progress: { chunks_total: chunks.length, chunks_done: 0 },
  });
  return { kind: parsed.kind, chunks };
}

/** LLM 提取 → captures 候选。 */
async function stageExtract(userId, sourceId, meta, kind, chunks, isCanceled) {
  SourceStore.updateSource(userId, sourceId, { status: 'extracting' });
  const lang = store.getSettings(userId)?.language || 'zh';
  const existing = (memStore.listEpisodes(userId, { limit: DEDUP_SCAN_LIMIT, includeExcluded: true }) || [])
    .map((e) => String(e.content_raw || ''));
  const existingSample = existing.slice(0, 150).join('\n').slice(0, 5000);
  const sourceTag = meta.platform || meta.type;

  const importedContents = [];
  const seenCaptureIds = new Set();
  let candidatesCreated = 0;
  let entitiesSuggested = 0;
  let extractFailures = 0;
  let chunksDone = 0;

  // 自动收下开关与冻结态在提取开始时读一次（管线为分钟级任务，可接受）
  const userSettings = store.getSettings(userId);
  const autoAcceptEnabled = userSettings?.memory_settings?.auto_accept_imports !== false; // 默认开
  const memoryPaused = userSettings?.privacy_settings?.pause_memory === true;
  const warnMode = process.env.ENTITLEMENT_MODE === 'warn';
  let autoAccepted = 0;

  /** 高置信自动收下（仅 memory 类；entity_fact 动图鉴卡一律人工）。
   *  三道闸判定在 autoAcceptGate（inbox.service）；任何失败静默转人工。 */
  const tryAutoAccept = (capture, confExplicit, confidence) => {
    if (autoAccepted >= AUTO_ACCEPT_MAX_PER_SOURCE) return false; // 短路，免每条打配额
    const verdict = autoAcceptGate({
      enabled: autoAcceptEnabled,
      paused: memoryPaused,
      confExplicit,
      confidence,
      acceptedCount: autoAccepted,
      quotaGate: billing.checkEntitlement(userId, 'memory'),
      warnMode,
    });
    if (!verdict.ok) return false;
    try {
      const patch = approveCaptureWithEdits({ id: userId }, capture, {});
      // status 'saved'（自动收下、可撤销）而非 'confirmed'，对齐对话高置信
      // 自动保存的既有生命周期：saved → undone。
      store.updateCapture(userId, capture.id, { ...patch, status: 'saved' });
      autoAccepted += 1;
      return true;
    } catch (e) {
      console.warn('[source-pipeline] auto-accept failed, left for review:', e?.message || e);
      return false;
    }
  };

  const isDup = (content) =>
    importedContents.some((c) => isNearDuplicate(c, content, 0.66))
    || existing.some((c) => isNearDuplicate(c, content, 0.66));

  for (const chunk of chunks) {
    if (isCanceled()) throw new CanceledError();

    if (kind === 'conversations') {
      // Twin 语料收割（仅已签独立同意时生效），失败绝不影响导入
      try { harvestImportedUserTurns(userId, chunk.text); } catch { /* non-fatal */ }
    }

    try {
      const sample = [existingSample, ...importedContents].join('\n').slice(0, 6000);
      const items = await extractFromChunk(kind, chunk.text, lang, sample);
      for (const it of items) {
        // 模型偶发漏掉 confidence 字段（qwen3 实测）：缺省视为 0.8（正常置信），
        // 只过滤"显式低置信"——否则整批被 0 分误杀。
        const rawConf = Number(it?.confidence);
        const confidence = Number.isFinite(rawConf) ? rawConf : 0.8;
        if (!it || confidence < MIN_CONFIDENCE) continue;

        if (it.kind === 'entity_fact') {
          const name = String(it.entity_name || '').trim();
          const k = String(it.fact_key || '').trim();
          const v = String(it.fact_value || '').trim();
          if (!name || !k || !v) continue;
          const matched = store.matchEntityByName(userId, name);
          if (matched && (matched.facts || []).some((f) => f.k === k)) continue; // 已有同键事实
          const capture = store.createCapture(userId, {
            kind: 'entity_fact',
            source: 'import',
            source_id: sourceId,
            confidence,
            payload: {
              entity_id: matched?.id || null,
              entity_name: name,
              // 模型漏 entity_type 时不默认 person：错标"人物"比"其他"更误导（实测乌龙茶被标人物）
              entity_type: ENTITY_TYPES.includes(it.entity_type) ? it.entity_type : (matched?.entity_type || 'other'),
              k, v,
            },
          });
          if (capture && !seenCaptureIds.has(capture.id) && capture.source_id === sourceId) {
            seenCaptureIds.add(capture.id);
            candidatesCreated += 1;
            if (!matched) entitiesSuggested += 1;
          }
          continue;
        }

        const content = String(it.content || '').trim().slice(0, 300);
        if (!content || isDup(content)) continue;
        const type = EPISODE_TYPES.includes(it.type) ? it.type : 'important_info';
        const capture = store.createCapture(userId, {
          kind: 'memory',
          source: 'import',
          source_id: sourceId,
          confidence,
          payload: {
            type,
            content,
            tags: ['import', sourceTag],
            conv_title: chunk.meta?.conv_title || chunk.meta?.heading || null,
          },
        });
        if (capture && !seenCaptureIds.has(capture.id) && capture.source_id === sourceId) {
          seenCaptureIds.add(capture.id);
          candidatesCreated += 1;
          importedContents.push(content);
          if (capture.status === 'pending') tryAutoAccept(capture, Number.isFinite(rawConf), confidence);
        }
      }
    } catch (e) {
      if (e instanceof CanceledError) throw e;
      extractFailures += 1;
      console.warn(`[source-pipeline] chunk extract failed (${extractFailures}):`, e?.message || e);
    }

    chunksDone += 1;
    SourceStore.updateSource(userId, sourceId, {
      progress: {
        chunks_done: chunksDone,
        candidates_created: candidatesCreated,
        entities_suggested: entitiesSuggested,
        auto_accepted: autoAccepted,
      },
    });
  }

  return { candidatesCreated, entitiesSuggested, extractFailures, autoAccepted };
}

// ── 队列 handler 入口 ───────────────────────────────────────────────────────

/**
 * @param {{ id:string, user_id:string, source_id:string }} job
 * @param {{ isCanceled: () => boolean }} ctx
 */
export async function runSourceIngest(job, ctx) {
  const userId = job.user_id;
  const sourceId = job.source_id;
  const meta = SourceStore.getSource(userId, sourceId);
  if (!meta) return; // 排队期间来源已被删除 → 静默结束
  SourceStore.updateSource(userId, sourceId, { job_id: job.id, error: null });

  try {
    let preParsed = null;
    if (meta.type === 'url') {
      const { parsed, originPatch } = await stageFetch(userId, sourceId, meta);
      preParsed = parsed;
      SourceStore.updateSource(userId, sourceId, { origin: { ...meta.origin, ...originPatch } });
    }
    if (ctx.isCanceled()) throw new CanceledError();

    const { kind, chunks } = await stageTransform(userId, sourceId, meta, preParsed);
    if (ctx.isCanceled()) throw new CanceledError();

    const { candidatesCreated, extractFailures, autoAccepted } = await stageExtract(
      userId, sourceId, SourceStore.getSource(userId, sourceId), kind, chunks, ctx.isCanceled,
    );

    // 自动收下的（saved）不待确认：只有仍 pending 的候选才让来源停在 review
    SourceStore.updateSource(userId, sourceId, {
      status: candidatesCreated - autoAccepted > 0 ? 'review' : 'done',
      stats: { extract_failures: extractFailures, accepted: autoAccepted },
    });
    try {
      const user = store.getUserById(userId);
      if (user) {
        EmailService.sendImportComplete(user, { kind: 'source', candidatesCreated })
          .catch((e) => console.warn('[email] import-complete failed:', e?.message));
      }
    } catch (e) { console.warn('[email] import-complete skipped:', e?.message); }
  } catch (e) {
    if (e instanceof CanceledError || ctx.isCanceled()) {
      SourceStore.updateSource(userId, sourceId, { status: 'canceled' });
      return;
    }
    SourceStore.updateSource(userId, sourceId, {
      status: 'failed',
      error: { code: e?.code || 'PIPELINE_ERROR', message: String(e?.message || e).slice(0, 300) },
    });
    throw e; // 让队列把 job 记为 failed（保留错误链路）
  }
}
