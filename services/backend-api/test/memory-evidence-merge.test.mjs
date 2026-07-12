/**
 * IA v2 批次3 契约测试 — 卡片级证据回溯 + 实体合并。
 *
 * 覆盖：
 *   - narrative/identity 输出带 evidence_episode_ids（=推导消费的记忆，
 *     「来自这 N 条记忆」下钻的数据基础；存量旧版本无此字段走前端降级）
 *   - store.mergeEntities：facts 缺键补齐、aliases/维度并集、互动数相加、
 *     待确认候选回链、源卡删除
 *   - replaceEntityIdInEpisodes：碎片 entity_ids 回链改写（去重）
 *
 * Run: npx vitest run test/memory-evidence-merge.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';

import {
  addEpisode, listEpisodes, replaceEntityIdInEpisodes, wipeUserMemory,
} from '../src/memory/memory-file.service.mjs';
import { Store } from '../src/lib/store.mjs';
import { computeIdentity } from '../src/memory/engines/identity-engine.mjs';
import { generateNarrative } from '../src/memory/engines/narrative-engine.mjs';

const store = Store();
const U = `evi-merge-test-${Date.now()}`;

afterAll(() => {
  store.wipeUser(U);
  wipeUserMemory(U);
});

describe('卡片级证据回溯（evidence_episode_ids）', () => {
  it('narrative 报告带窗口内记忆的 id 列表', async () => {
    const e1 = addEpisode(U, { type: 'important_info', contentRaw: 'EVI_ 开始学习西班牙语每周三节课', source: 'chat' });
    const e2 = addEpisode(U, { type: 'key_event', contentRaw: 'EVI_ 完成了人生第一次半程马拉松', source: 'chat' });

    const report = await generateNarrative(U, 30, { useLLM: false, trigger: 'test' });
    expect(Array.isArray(report.evidence_episode_ids)).toBe(true);
    expect(report.evidence_episode_ids).toContain(e1.id);
    expect(report.evidence_episode_ids).toContain(e2.id);
    expect(report.evidence_episode_ids.length).toBeLessThanOrEqual(50);
  });

  it('identity 版本带最近记忆的 id 列表（≤30）', async () => {
    const version = await computeIdentity(U, { useLLM: false, trigger: 'test' });
    expect(Array.isArray(version.evidence_episode_ids)).toBe(true);
    expect(version.evidence_episode_ids.length).toBeGreaterThan(0);
    expect(version.evidence_episode_ids.length).toBeLessThanOrEqual(30);
    const all = listEpisodes(U, { includeExcluded: true, limit: 100 }).map(e => e.id);
    for (const id of version.evidence_episode_ids) expect(all).toContain(id);
  });
});

describe('实体合并（两张「妈妈」卡问题）', () => {
  it('mergeEntities：facts 缺键补齐 + aliases/维度并集 + 候选回链 + 删源卡', () => {
    const src = store.upsertEntity(U, {
      entity_type: 'person', name: '母亲', aliases: ['老妈'],
      facts: [{ k: 'birthday', v: '农历五月初八' }, { k: 'hobby', v: '广场舞' }],
      dimensions: ['family'],
    });
    store.upsertEntity(U, { id: src.id }); // normalize noop
    const dst = store.upsertEntity(U, {
      entity_type: 'person', name: '妈妈',
      facts: [{ k: 'hobby', v: '太极拳' }], // 同键，保留 target 的
      dimensions: ['health'],
    });

    // 指向 src 的待确认候选（合并后应改指 dst）
    const cap = store.createCapture(U, {
      kind: 'entity_fact',
      payload: { entity_id: src.id, entity_name: '母亲', entity_type: 'person', k: 'phone', v: '138xxxx' },
    });

    const merged = store.mergeEntities(U, src.id, dst.id);
    expect(merged.id).toBe(dst.id);
    expect(merged.aliases).toEqual(expect.arrayContaining(['老妈', '母亲']));
    expect(merged.facts.find(f => f.k === 'birthday')?.v).toBe('农历五月初八');
    expect(merged.facts.find(f => f.k === 'hobby')?.v).toBe('太极拳'); // target 优先
    expect(merged.dimensions.sort()).toEqual(['family', 'health']);
    expect(store.getEntity(U, src.id)).toBeNull();
    expect(store.getCapture(U, cap.id).payload.entity_id).toBe(dst.id);
  });

  it('replaceEntityIdInEpisodes：碎片回链改写并去重', () => {
    const a = store.upsertEntity(U, { entity_type: 'person', name: '合并回链A' });
    const b = store.upsertEntity(U, { entity_type: 'person', name: '合并回链B' });
    const ep1 = addEpisode(U, { type: 'important_info', contentRaw: 'LINKREW_ 只挂A', source: 'chat', entityIds: [a.id] });
    const ep2 = addEpisode(U, { type: 'important_info', contentRaw: 'LINKREW_ 同挂AB', source: 'chat', entityIds: [a.id, b.id] });

    const changed = replaceEntityIdInEpisodes(U, a.id, b.id);
    expect(changed).toBe(2);

    const eps = listEpisodes(U, { includeExcluded: true, limit: 100 });
    const r1 = eps.find(e => e.id === ep1.id);
    const r2 = eps.find(e => e.id === ep2.id);
    expect(r1.entity_ids).toEqual([b.id]);
    expect(r2.entity_ids).toEqual([b.id]); // 去重：A→B 后不留两个 B
  });

  it('mergeEntities 边界：同 id / 不存在 → null', () => {
    const e = store.upsertEntity(U, { entity_type: 'person', name: '边界卡' });
    expect(store.mergeEntities(U, e.id, e.id)).toBeNull();
    expect(store.mergeEntities(U, e.id, 'nope')).toBeNull();
    expect(store.mergeEntities(U, 'nope', e.id)).toBeNull();
  });
});
