/**
 * 统一收件箱服务（IA v2 批次0）。
 *
 * 三个确认队列的聚合门面：来源导入候选 + 聊天新发现（同为 pendingCaptures）
 * + 画像变更（profile conflicts）。单条 decide、批量 decide-batch、收件箱
 * decide、undo/undo-batch 全部复用这里的实现，保证配额门与部分失败语义只有
 * 一个口径。
 *
 * 存储适配刻意收口在本模块：底层是双存储（store.mjs 全局 JSON 的 captures +
 * per-user 文件树的 episodes/profile），PG 迁移时只需重写此处。
 */

import { Store } from '../lib/store.mjs';
import { createBillingService } from '../services/billing.service.mjs';
import { captureToCandidate } from '../services/conversation.service.mjs';
import { getMemoryStore } from './store/index.mjs';
import { markDirty as markEntitySummaryDirty } from './entity-summary.service.mjs';
import { getPendingConflicts } from './conflict-resolver.mjs';
import { classifyDimensions } from './dimension-classifier.mjs';
import { embedEpisode } from './embedding.mjs';
import { EPISODE_TYPES } from './types.mjs';
import * as SourceStore from './source-store.mjs';

const store = Store();
const billing = createBillingService(store);
const MemoryFileService = getMemoryStore();

// ── 高置信自动收下（IA v2 批次1）────────────────────────────────────────
export const AUTO_ACCEPT_MIN_CONFIDENCE = 0.8;
export const AUTO_ACCEPT_MAX_PER_SOURCE = 50;

/**
 * 自动收下三道闸（纯判定，导入管线调用）。任一不过即留在收件箱转人工：
 *   disabled          — 用户设置关闭（默认开）
 *   memory_paused     — 暂停记忆期间冻结落库（候选生成豁免、落库不豁免）
 *   confidence_missing— 模型漏 confidence 字段（0.8 缺省值不得参与判定）
 *   low_confidence    — 显式置信 < 0.8
 *   per_source_cap    — 单来源自动收下超上限（防大导入一次吞几百条）
 *   quota_exceeded    — memory 配额闸（ENTITLEMENT_MODE=warn 只记不拦）
 */
export function autoAcceptGate({ enabled, paused, confExplicit, confidence, acceptedCount, quotaGate, warnMode }) {
  if (!enabled) return { ok: false, reason: 'disabled' };
  if (paused) return { ok: false, reason: 'memory_paused' };
  if (!confExplicit) return { ok: false, reason: 'confidence_missing' };
  if (!(confidence >= AUTO_ACCEPT_MIN_CONFIDENCE)) return { ok: false, reason: 'low_confidence' };
  if (acceptedCount >= AUTO_ACCEPT_MAX_PER_SOURCE) return { ok: false, reason: 'per_source_cap' };
  if (quotaGate && !warnMode) return { ok: false, reason: 'quota_exceeded' };
  return { ok: true };
}

/**
 * Approve 一条 capture：套用户行内编辑 + materialise 到对应存储。
 * memory → memoryItems(旧) + episodes(新，带 source_id 回链)；task → tasks；
 * entity_fact / entity_suggest → 图鉴卡。返回要写回 capture 的 patch。
 */
export function approveCaptureWithEdits(user, capture, editsInput) {
  const edits = editsInput && typeof editsInput === 'object' ? editsInput : {};
  const payload = { ...capture.payload };
  if (typeof edits.content === 'string' && edits.content.trim()) payload.content = edits.content.trim();
  if (typeof edits.title === 'string' && edits.title.trim()) payload.title = edits.title.trim().slice(0, 120);
  if (edits.due_date !== undefined) payload.due_date = edits.due_date || null;
  if (Array.isArray(edits.tags)) payload.tags = edits.tags.map(String).slice(0, 8);
  // 来源中心确认界面允许改类型与维度（旧调用方不传即无影响）
  if (typeof edits.type === 'string' && EPISODE_TYPES.includes(edits.type)) payload.type = edits.type;
  if (Array.isArray(edits.dimensions)) payload.dimensions = edits.dimensions.map(String).slice(0, 8);

  const patch = { status: 'confirmed', payload, decided_at: new Date().toISOString() };
  if (capture.kind === 'task') {
    const created = store.createTasks(user.id, [{
      title: payload.title || payload.content || '对话中提到的待办',
      due_date: payload.due_date || null,
      priority: 'medium',
    }]);
    patch.task_id = created[0]?.id || null;
  } else if (capture.kind === 'entity_fact') {
    // 实体事实：落到图鉴卡（没有卡先建卡），payload.prev 供 undo 还原。
    // upsertEntity 只认 id：无 id 时必须先按名字匹配复用，否则同名实体的多条
    // 事实（批量导入确认的常态）会各建一张重复卡。
    let entityId = payload.entity_id || null;
    if (!entityId) {
      const matched = store.matchEntityByName(user.id, payload.entity_name || '');
      const entity = matched || store.upsertEntity(user.id, {
        entity_type: payload.entity_type || 'person',
        name: payload.entity_name || '',
        source: 'auto_suggest',
      });
      entityId = entity.id;
      payload.entity_id = entityId;
    }
    const applied = store.upsertEntityFact(user.id, entityId, { k: payload.k, v: payload.v });
    if (!applied) throw new Error('entity_fact_apply_failed');
    payload.prev = applied.prev;
    markEntitySummaryDirty(user.id, entityId);
  } else if (capture.kind === 'entity_suggest') {
    // 建卡建议：创建卡片并把证据碎片回链到卡上（合并式，不清空既有关联）。
    const matchedSuggest = store.matchEntityByName(user.id, payload.name || payload.entity_name || '');
    const createdEntity = matchedSuggest || store.upsertEntity(user.id, {
      entity_type: payload.entity_type || 'person',
      name: payload.name || payload.entity_name || '',
      source: 'auto_suggest',
    });
    payload.entity_id = createdEntity.id;
    for (const epId of (payload.episode_ids || []).slice(0, 20)) {
      try { MemoryFileService.setEpisodeFlag(user.id, epId, { add_entity_ids: [createdEntity.id] }); } catch { /* best-effort */ }
    }
    markEntitySummaryDirty(user.id, createdEntity.id);
  } else {
    const content_raw = payload.content || '';
    const type = payload.type || 'important_info';
    const tags = payload.tags || [];
    const item = store.createMemoryItem(user.id, {
      type, content_raw, tags,
      source: capture.source === 'import' ? 'import' : 'auto_extract',
      content_struct: { summary: content_raw.slice(0, 80) },
    });
    patch.memory_item_id = item.id;
    const ep = MemoryFileService.addEpisode(user.id, {
      type, contentRaw: content_raw, tags,
      source: capture.source === 'import' || capture.source_id ? 'import' : 'auto_extract',
      // 来源回链：episode 记住产出它的导入 Source，支撑记忆流「按来源过滤」。
      sourceId: capture.source_id || null,
      contentStruct: { summary: content_raw.slice(0, 80) },
      reminderDate: payload.reminder_date || null,
      confidence: capture.confidence,
      entityIds: Array.isArray(payload.entity_ids) ? payload.entity_ids : [],
      dimensions: Array.isArray(payload.dimensions) && payload.dimensions.length
        ? payload.dimensions
        : classifyDimensions(content_raw, tags),
    });
    patch.episode_id = ep.id;
    void embedEpisode(user.id, ep).catch(() => {});
    // 新碎片挂到了卡上 → 相关卡的总结素材变了
    for (const eid of (Array.isArray(payload.entity_ids) ? payload.entity_ids : [])) {
      markEntitySummaryDirty(user.id, eid);
    }
  }
  return patch;
}

/** 还原一条已 materialise 的 capture（undo / undo-batch 共用）。 */
export function undoCaptureMaterialised(user, capture) {
  if (capture.episode_id) {
    MemoryFileService.deleteEpisode(user.id, capture.episode_id);
    for (const eid of (Array.isArray(capture.payload?.entity_ids) ? capture.payload.entity_ids : [])) {
      markEntitySummaryDirty(user.id, eid);
    }
  }
  if (capture.memory_item_id) store.deleteMemoryItem(user.id, capture.memory_item_id);
  if (capture.task_id) store.deleteTask(user.id, capture.task_id);
  if (capture.kind === 'entity_fact' && capture.payload?.entity_id && capture.payload?.k) {
    // 还原改动的事实：prev 为 null 时表示当时是新增，撤销即删除该键。
    store.upsertEntityFact(user.id, capture.payload.entity_id, {
      k: capture.payload.k,
      v: capture.payload.prev ?? null,
    });
    markEntitySummaryDirty(user.id, capture.payload.entity_id);
  }
  if (capture.kind === 'entity_suggest' && capture.payload?.entity_id) {
    store.deleteEntity(user.id, capture.payload.entity_id);
  }
}

/**
 * 批量裁决 captures（decide-batch 与收件箱共用）。
 * memory 类逐条过记忆条数配额（ENTITLEMENT_MODE=warn 只记不拦）；
 * 部分失败语义：quota_exceeded / materialise_failed 落 failed[]，其余继续。
 * 来源统计回写；某来源再无 pending 时 review → done。
 */
export function processCaptureDecisions(user, decisions) {
  const warnMode = process.env.ENTITLEMENT_MODE === 'warn';
  const confirmed = [];
  const rejected = [];
  const failed = [];
  const bySource = new Map(); // source_id → { accepted, rejected }
  const bump = (sourceId, key) => {
    if (!sourceId) return;
    if (!bySource.has(sourceId)) bySource.set(sourceId, { accepted: 0, rejected: 0 });
    bySource.get(sourceId)[key] += 1;
  };
  for (const d of decisions) {
    const capture = store.getCapture(user.id, String(d?.id || ''));
    if (!capture) { failed.push({ id: d?.id || null, error: 'not_found' }); continue; }
    if (capture.status !== 'pending') { failed.push({ id: capture.id, error: 'already_decided' }); continue; }
    if (d?.decision !== 'approve') {
      store.updateCapture(user.id, capture.id, { status: 'rejected', decided_at: new Date().toISOString() });
      rejected.push(capture.id);
      bump(capture.source_id, 'rejected');
      continue;
    }
    if (!capture.kind || capture.kind === 'memory') {
      const gate = billing.checkEntitlement(user.id, 'memory');
      if (gate && !warnMode) { failed.push({ id: capture.id, error: 'quota_exceeded', quota: gate }); continue; }
    }
    try {
      const patch = approveCaptureWithEdits(user, capture, d?.edits);
      store.updateCapture(user.id, capture.id, patch);
      confirmed.push(capture.id);
      bump(capture.source_id, 'accepted');
    } catch (e) {
      console.error('[inbox] capture batch materialise error:', e);
      failed.push({ id: capture.id, error: 'materialise_failed', detail: e.message });
    }
  }
  for (const [sourceId, delta] of bySource) {
    const meta = SourceStore.getSource(user.id, sourceId);
    if (!meta) continue;
    const stillPending = store.listCaptures(user.id, { sourceId, status: 'pending', limit: 1 }).length > 0;
    SourceStore.updateSource(user.id, sourceId, {
      stats: {
        accepted: (meta.stats?.accepted || 0) + delta.accepted,
        rejected: (meta.stats?.rejected || 0) + delta.rejected,
      },
      ...(meta.status === 'review' && !stillPending ? { status: 'done' } : {}),
    });
  }
  return { confirmed, rejected, failed };
}

/**
 * 批量撤销：按显式 ids 或「来源 + decided_at 时间窗」筛选已收下
 * （saved/confirmed）的 captures 逐条还原（自动收下/大导入误收的后悔药）。
 */
export function undoCapturesBatch(user, { ids, sourceId, since, until, limit = 200 } = {}) {
  const cap = Math.min(Number(limit) || 200, 500);
  let targets = [];
  if (Array.isArray(ids) && ids.length) {
    targets = ids.slice(0, cap)
      .map((id) => store.getCapture(user.id, String(id)))
      .filter(Boolean);
  } else if (sourceId || since || until) {
    targets = store.listCaptures(user.id, { limit: 100000 })
      .filter((c) => (c.status === 'saved' || c.status === 'confirmed')
        && (!sourceId || c.source_id === sourceId)
        && (!since || String(c.decided_at || '') >= String(since))
        && (!until || String(c.decided_at || '') <= String(until)))
      .slice(0, cap);
  } else {
    return { error: 'no_selector' };
  }
  const undone = [];
  const failed = [];
  for (const capture of targets) {
    if (capture.status !== 'saved' && capture.status !== 'confirmed') {
      failed.push({ id: capture.id, error: 'not_undoable' });
      continue;
    }
    try {
      undoCaptureMaterialised(user, capture);
      store.updateCapture(user.id, capture.id, { status: 'undone', decided_at: new Date().toISOString() });
      undone.push(capture.id);
    } catch (e) {
      console.error('[inbox] capture undo-batch error:', e);
      failed.push({ id: capture.id, error: 'undo_failed', detail: e.message });
    }
  }
  return { undone, failed };
}

/**
 * 统一收件箱快照：pendingCaptures（来源候选/聊天发现）+ 画像冲突聚合为
 * InboxItem，计数在服务端全量算（不受路由 200 条硬顶影响）。
 * origin: import（有 source_id）| chat（对话捕获）| consolidation（画像变更）。
 */
// 候选过期时钟（与 store 层一致）：聊天候选 14 天读时机会式过期，
// 导入候选豁免后由 janitor 90 天兜底（store.mjs _expireStaleCaptures / expireImportCaptures）。
const CHAT_EXPIRE_DAYS = 14;
const IMPORT_EXPIRE_DAYS = 90;
const AUTO_SAVED_WINDOW_DAYS = 7;

function expiresAt(capture) {
  const created = new Date(capture.created_at || Date.now()).getTime();
  const days = capture.source_id ? IMPORT_EXPIRE_DAYS : CHAT_EXPIRE_DAYS;
  return new Date(created + days * 24 * 60 * 60 * 1000).toISOString();
}

export function buildInboxSnapshot(user, { itemsLimit = 200 } = {}) {
  const pending = store.listCaptures(user.id, { status: 'pending', limit: 100000 });
  const conflicts = getPendingConflicts(user.id);

  const captureItems = pending.map((c) => ({
    id: c.id,
    origin: c.source_id ? 'import' : 'chat',
    kind: c.kind || 'memory',
    source_id: c.source_id || null,
    confidence: typeof c.confidence === 'number' ? c.confidence : null,
    created_at: c.created_at,
    expires_at: expiresAt(c),
    candidate: captureToCandidate(c),
  }));
  const conflictItems = conflicts.map((c) => ({
    id: `conflict_${c.id}`,
    origin: 'consolidation',
    kind: 'profile_change',
    source_id: null,
    confidence: null,
    created_at: c.detected_at || null,
    conflict: {
      id: c.id,
      field: c.field,
      old_value: c.old_value,
      new_value: c.new_value,
      old_evidence: c.old_evidence || null,
      new_evidence: c.new_evidence || null,
    },
  }));

  const items = [...captureItems, ...conflictItems]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const bySourceCount = new Map();
  for (const it of captureItems) {
    if (it.source_id) bySourceCount.set(it.source_id, (bySourceCount.get(it.source_id) || 0) + 1);
  }
  const by_source = [...bySourceCount.entries()].map(([sourceId, count]) => ({
    source_id: sourceId,
    name: SourceStore.getSource(user.id, sourceId)?.title || null, // Source 元数据字段是 title
    count,
  }));

  const counts = {
    total: items.length,
    import: captureItems.filter(i => i.origin === 'import').length,
    chat: captureItems.filter(i => i.origin === 'chat').length,
    consolidation: conflictItems.length,
    // 有导入在跑时前端把 badge 轮询提到 2.5s（边导边涨），否则静默
    active_sources: SourceStore.listSources(user.id)
      .filter((m) => ['queued', 'fetching', 'parsing', 'extracting'].includes(m.status)).length,
    by_source,
  };

  // 「已自动收下 N 条（可撤销）」摘要：近 7 天导入管线自动收下（saved）的
  // captures 按来源分组，供收件箱摘要行 + 一键撤销（undo-batch by source_id）。
  const windowStart = new Date(Date.now() - AUTO_SAVED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const savedRecent = store.listCaptures(user.id, { status: 'saved', limit: 100000 })
    .filter((c) => c.source_id && String(c.decided_at || '') >= windowStart);
  const autoBySource = new Map();
  for (const c of savedRecent) {
    const entry = autoBySource.get(c.source_id) || { count: 0, latest_decided_at: '' };
    entry.count += 1;
    if (String(c.decided_at || '') > entry.latest_decided_at) entry.latest_decided_at = c.decided_at;
    autoBySource.set(c.source_id, entry);
  }
  const auto_saved = [...autoBySource.entries()].map(([sourceId, v]) => ({
    source_id: sourceId,
    name: SourceStore.getSource(user.id, sourceId)?.title || null,
    count: v.count,
    latest_decided_at: v.latest_decided_at || null,
  }));

  return { counts, items: items.slice(0, itemsLimit), auto_saved };
}

/**
 * 收件箱批量裁决：id 可为 capture id 或 conflict_<id>。
 * conflict approve = 采用新值写画像（可用 edits.resolved_value 覆盖），
 * reject = 保留原值；capture 走 processCaptureDecisions（含配额门）。
 */
export function decideInboxBatch(user, decisions) {
  const conflictDecisions = decisions.filter((d) => String(d?.id || '').startsWith('conflict_'));
  const captureDecisions = decisions.filter((d) => !String(d?.id || '').startsWith('conflict_'));

  const conflicts = { applied: [], kept: [], failed: [] };
  if (conflictDecisions.length) {
    const all = MemoryFileService.getConflicts(user.id);
    for (const d of conflictDecisions) {
      const conflictId = String(d.id).slice('conflict_'.length);
      const conflict = all.find((c) => c.id === conflictId);
      if (!conflict) { conflicts.failed.push({ id: d.id, error: 'not_found' }); continue; }
      try {
        if (d.decision === 'approve') {
          const resolvedValue = d.edits?.resolved_value ?? conflict.new_value;
          MemoryFileService.resolveConflict(user.id, conflictId, {
            resolution: 'accept_new',
            resolved_value: resolvedValue,
            reasoning: 'User inbox decision',
          });
          MemoryFileService.applyConflictResolution(user.id, conflict.field, resolvedValue);
          conflicts.applied.push(d.id);
        } else {
          MemoryFileService.resolveConflict(user.id, conflictId, {
            resolution: 'keep_old',
            reasoning: 'User inbox decision',
          });
          conflicts.kept.push(d.id);
        }
      } catch (e) {
        console.error('[inbox] conflict decide error:', e);
        conflicts.failed.push({ id: d.id, error: 'resolve_failed', detail: e.message });
      }
    }
  }

  const captureResult = captureDecisions.length
    ? processCaptureDecisions(user, captureDecisions)
    : { confirmed: [], rejected: [], failed: [] };

  return { ...captureResult, conflicts };
}
