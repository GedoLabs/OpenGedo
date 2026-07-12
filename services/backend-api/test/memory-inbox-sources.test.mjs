/**
 * IA v2 批次0 契约测试 — episode 来源回链 + 统一收件箱。
 *
 * 覆盖：
 *   - episode.source_id 回链：addEpisode 写入、listEpisodes 按来源/固定项过滤、
 *     setEpisodeFlag 回填原语（backfill-episode-sources.mjs 的构件）
 *   - source 白名单钳制：枚举外脏值（chat_extract）落 'text'
 *   - approveCaptureWithEdits：导入候选确认落库时透传 capture.source_id
 *   - processCaptureDecisions / undoCapturesBatch：批量收下 → 按来源批量撤销闭环
 *   - buildInboxSnapshot / decideInboxBatch：三队列聚合计数 + 画像冲突收下/跳过
 *
 * Run: npx vitest run test/memory-inbox-sources.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';

import {
  addEpisode, listEpisodes, setEpisodeFlag,
  getProfile, updateProfile, addConflict, getConflicts,
  wipeUserMemory,
} from '../src/memory/memory-file.service.mjs';
import { Store } from '../src/lib/store.mjs';
import {
  approveCaptureWithEdits,
  processCaptureDecisions,
  undoCapturesBatch,
  buildInboxSnapshot,
  decideInboxBatch,
  autoAcceptGate,
  AUTO_ACCEPT_MAX_PER_SOURCE,
} from '../src/memory/inbox.service.mjs';

const store = Store();
const U = `inbox-src-test-${Date.now()}`;
const user = { id: U };

afterAll(() => {
  store.wipeUser(U);
  wipeUserMemory(U);
});

describe('episode 来源回链原语', () => {
  it('addEpisode 持久化 sourceId，listEpisodes 按 source_id 过滤', () => {
    const ep = addEpisode(U, {
      type: 'important_info', contentRaw: 'LINK_ 来自导入A的记忆',
      source: 'import', sourceId: 'src_alpha',
    });
    expect(ep.source_id).toBe('src_alpha');

    addEpisode(U, { type: 'important_info', contentRaw: 'LINK_ 普通聊天记忆', source: 'chat' });

    const hits = listEpisodes(U, { sourceId: 'src_alpha', includeExcluded: true, limit: 100 });
    expect(hits.map(e => e.id)).toEqual([ep.id]);
    expect(listEpisodes(U, { sourceId: 'src_nope', includeExcluded: true, limit: 100 })).toHaveLength(0);
  });

  it('origin 固定项口径：chat=对话、manual=手动、import=导入', () => {
    addEpisode(U, { type: 'important_info', contentRaw: 'ORIGIN_ 自动抽取', source: 'auto_extract' });
    addEpisode(U, { type: 'important_info', contentRaw: 'ORIGIN_ 手动语音', source: 'voice' });
    addEpisode(U, { type: 'important_info', contentRaw: 'ORIGIN_ 手动文本', source: 'text' });

    const chat = listEpisodes(U, { origin: 'chat', includeExcluded: true, limit: 100 });
    const manual = listEpisodes(U, { origin: 'manual', includeExcluded: true, limit: 100 });
    const imported = listEpisodes(U, { origin: 'import', includeExcluded: true, limit: 100 });

    // chat: 'LINK_ 普通聊天记忆'(chat) + 'ORIGIN_ 自动抽取'(auto_extract 无 source_id)
    expect(chat.every(e => !e.source_id && ['chat', 'auto_extract'].includes(e.source))).toBe(true);
    expect(chat.length).toBe(2);
    // manual: voice + text
    expect(manual.length).toBe(2);
    expect(manual.every(e => ['text', 'voice', 'image'].includes(e.source))).toBe(true);
    // import: 只有带 source_id 的那条
    expect(imported.length).toBe(1);
    expect(imported[0].source_id).toBe('src_alpha');
  });

  it('source 白名单钳制：枚举外脏值落 text', () => {
    const ep = addEpisode(U, { type: 'important_info', contentRaw: 'CLAMP_ 脏值来源', source: 'chat_extract' });
    expect(ep.source).toBe('text');
  });

  it('setEpisodeFlag 支持回填 source_id 与修正 source（白名单内）', () => {
    const ep = addEpisode(U, { type: 'important_info', contentRaw: 'PATCH_ 待回填', source: 'auto_extract' });
    const patched = setEpisodeFlag(U, ep.id, { source_id: 'src_backfill', source: 'import' });
    expect(patched.source_id).toBe('src_backfill');
    expect(patched.source).toBe('import');
    // 枚举外的 source 修正被忽略
    const again = setEpisodeFlag(U, ep.id, { source: 'chat_extract' });
    expect(again.source).toBe('import');
  });
});

describe('capture 确认落库透传 source_id', () => {
  it('approveCaptureWithEdits 把导入候选的 source_id 写上 episode', () => {
    const capture = store.createCapture(U, {
      kind: 'memory', source: 'import', source_id: 'src_beta',
      payload: { type: 'important_info', content: 'APPROVE_ 每周三晚上有羽毛球训练' },
      confidence: 0.9,
    });
    const patch = approveCaptureWithEdits(user, capture, {});
    expect(patch.episode_id).toBeTruthy();

    const eps = listEpisodes(U, { sourceId: 'src_beta', includeExcluded: true, limit: 10 });
    expect(eps.map(e => e.id)).toContain(patch.episode_id);
    expect(eps[0].source).toBe('import');
    store.updateCapture(U, capture.id, patch);
  });

  it('capture 带 source_id 但 source 缺省时仍按导入落库', () => {
    const capture = store.createCapture(U, {
      kind: 'memory', source_id: 'src_gamma',
      payload: { type: 'important_info', content: 'APPROVE_ 计划十月去京都看红叶' },
    });
    const patch = approveCaptureWithEdits(user, capture, {});
    const eps = listEpisodes(U, { sourceId: 'src_gamma', includeExcluded: true, limit: 10 });
    expect(eps).toHaveLength(1);
    expect(eps[0].source).toBe('import');
    store.updateCapture(U, capture.id, patch);
  });
});

describe('批量收下 → 按来源批量撤销闭环', () => {
  it('processCaptureDecisions 收下、undoCapturesBatch 按来源整体还原', () => {
    const c1 = store.createCapture(U, {
      kind: 'memory', source: 'import', source_id: 'src_undo',
      payload: { type: 'important_info', content: 'UNDO_ 今天完成了季度预算表格整理' },
    });
    const c2 = store.createCapture(U, {
      kind: 'memory', source: 'import', source_id: 'src_undo',
      payload: { type: 'important_info', content: 'UNDO_ 周末去森林公园徒步了十公里' },
    });

    const result = processCaptureDecisions(user, [
      { id: c1.id, decision: 'approve' },
      { id: c2.id, decision: 'approve' },
    ]);
    expect(result.confirmed.sort()).toEqual([c1.id, c2.id].sort());
    expect(result.failed).toHaveLength(0);
    expect(listEpisodes(U, { sourceId: 'src_undo', includeExcluded: true, limit: 10 })).toHaveLength(2);

    const undo = undoCapturesBatch(user, { sourceId: 'src_undo' });
    expect(undo.undone.sort()).toEqual([c1.id, c2.id].sort());
    expect(undo.failed).toHaveLength(0);
    expect(listEpisodes(U, { sourceId: 'src_undo', includeExcluded: true, limit: 10 })).toHaveLength(0);
    expect(store.getCapture(U, c1.id).status).toBe('undone');
  });

  it('undoCapturesBatch 无选择器时报 no_selector', () => {
    expect(undoCapturesBatch(user, {}).error).toBe('no_selector');
  });
});

describe('统一收件箱：聚合 + 裁决', () => {
  it('buildInboxSnapshot 聚合三队列并给全量计数', () => {
    const chatCap = store.createCapture(U, {
      kind: 'memory',
      payload: { type: 'important_info', content: 'INBOX_ 聊天候选' },
    });
    const importCap = store.createCapture(U, {
      kind: 'memory', source: 'import', source_id: 'src_inbox',
      payload: { type: 'important_info', content: 'INBOX_ 导入候选' },
    });
    updateProfile(U, { core_identity: { name: '旧名字' } });
    addConflict(U, { field: 'core_identity.name', old_value: '旧名字', new_value: '新名字' });

    const snap = buildInboxSnapshot(user, { itemsLimit: 50 });
    expect(snap.counts.chat).toBe(1);
    expect(snap.counts.import).toBe(1);
    expect(snap.counts.consolidation).toBe(1);
    expect(snap.counts.total).toBe(3);
    expect(snap.counts.by_source).toEqual([{ source_id: 'src_inbox', name: null, count: 1 }]);

    const kinds = snap.items.map(i => i.kind).sort();
    expect(kinds).toEqual(['memory', 'memory', 'profile_change']);
    const conflictItem = snap.items.find(i => i.origin === 'consolidation');
    expect(conflictItem.id.startsWith('conflict_')).toBe(true);
    expect(conflictItem.conflict.field).toBe('core_identity.name');

    // 留给下一个用例裁决
    globalThis.__inboxFixture = { chatCap, importCap, conflictItemId: conflictItem.id };
  });

  it('decideInboxBatch：冲突收下写画像、capture 收下落库、跳过保留原值', () => {
    const { chatCap, importCap, conflictItemId } = globalThis.__inboxFixture;

    const result = decideInboxBatch(user, [
      { id: conflictItemId, decision: 'approve' },
      { id: chatCap.id, decision: 'approve' },
      { id: importCap.id, decision: 'reject' },
    ]);

    expect(result.conflicts.applied).toEqual([conflictItemId]);
    expect(result.confirmed).toEqual([chatCap.id]);
    expect(result.rejected).toEqual([importCap.id]);
    expect(getProfile(U).core_identity.name).toBe('新名字');

    // 收件箱清空（该用户）
    const after = buildInboxSnapshot(user, { itemsLimit: 10 });
    expect(after.counts.total).toBe(0);
  });

  it('decideInboxBatch：跳过冲突时保留原画像值', () => {
    addConflict(U, { field: 'core_identity.profession', old_value: '工程师', new_value: '画家' });
    updateProfile(U, { core_identity: { profession: '工程师' } });
    const snap = buildInboxSnapshot(user, { itemsLimit: 10 });
    const item = snap.items.find(i => i.origin === 'consolidation');

    const result = decideInboxBatch(user, [{ id: item.id, decision: 'reject' }]);
    expect(result.conflicts.kept).toEqual([item.id]);
    expect(getProfile(U).core_identity.profession).toBe('工程师');
    expect(getConflicts(U).find(c => `conflict_${c.id}` === item.id).resolved).toBe(true);
  });
});

describe('自动收下三道闸（autoAcceptGate 纯判定）', () => {
  const base = {
    enabled: true, paused: false, confExplicit: true,
    confidence: 0.9, acceptedCount: 0, quotaGate: null, warnMode: false,
  };
  it.each([
    [{}, true, undefined],
    [{ enabled: false }, false, 'disabled'],
    [{ paused: true }, false, 'memory_paused'],
    [{ confExplicit: false }, false, 'confidence_missing'],
    [{ confidence: 0.79 }, false, 'low_confidence'],
    [{ confidence: 0.8 }, true, undefined],
    [{ acceptedCount: AUTO_ACCEPT_MAX_PER_SOURCE }, false, 'per_source_cap'],
    [{ quotaGate: { error: 'quota' } }, false, 'quota_exceeded'],
    [{ quotaGate: { error: 'quota' }, warnMode: true }, true, undefined],
  ])('override %o → ok=%s', (override, ok, reason) => {
    const v = autoAcceptGate({ ...base, ...override });
    expect(v.ok).toBe(ok);
    if (!ok) expect(v.reason).toBe(reason);
  });

  it('缺显式置信时，0.8 缺省值不得触发自动收下（0.8 但 confExplicit=false）', () => {
    expect(autoAcceptGate({ ...base, confExplicit: false, confidence: 0.8 }).reason).toBe('confidence_missing');
  });
});

describe('收件箱摘要与临期字段', () => {
  it('items 带 expires_at：聊天候选 14 天、导入候选 90 天', () => {
    const chatCap = store.createCapture(U, {
      kind: 'memory', payload: { type: 'important_info', content: 'EXPIRE_ 聊天候选过期时钟检查' },
    });
    const importCap = store.createCapture(U, {
      kind: 'memory', source: 'import', source_id: 'src_expire',
      payload: { type: 'important_info', content: 'EXPIRE_ 导入候选过期时钟检查' },
    });
    const snap = buildInboxSnapshot(user, { itemsLimit: 20 });
    const chatItem = snap.items.find(i => i.id === chatCap.id);
    const importItem = snap.items.find(i => i.id === importCap.id);
    const days = (item) => Math.round(
      (new Date(item.expires_at) - new Date(item.created_at)) / (24 * 60 * 60 * 1000));
    expect(days(chatItem)).toBe(14);
    expect(days(importItem)).toBe(90);
    decideInboxBatch(user, [
      { id: chatCap.id, decision: 'reject' },
      { id: importCap.id, decision: 'reject' },
    ]);
  });

  it('auto_saved 摘要：近 7 天导入自动收下按来源分组，可一键撤销', () => {
    const cap = store.createCapture(U, {
      kind: 'memory', source: 'import', source_id: 'src_auto',
      payload: { type: 'important_info', content: 'AUTO_ 高置信自动入库的一条记忆' },
      confidence: 0.92,
    });
    // 模拟管线自动收下：materialise + status saved
    const patch = approveCaptureWithEdits(user, cap, {});
    store.updateCapture(U, cap.id, { ...patch, status: 'saved' });

    const snap = buildInboxSnapshot(user, { itemsLimit: 10 });
    const row = snap.auto_saved.find(r => r.source_id === 'src_auto');
    expect(row).toBeTruthy();
    expect(row.count).toBe(1);
    expect(row.latest_decided_at).toBeTruthy();
    // saved 不进待确认列表
    expect(snap.items.find(i => i.id === cap.id)).toBeUndefined();

    // 一键撤销闭环
    const undo = undoCapturesBatch(user, { sourceId: 'src_auto' });
    expect(undo.undone).toEqual([cap.id]);
    expect(buildInboxSnapshot(user, { itemsLimit: 10 }).auto_saved.find(r => r.source_id === 'src_auto')).toBeUndefined();
  });
});
