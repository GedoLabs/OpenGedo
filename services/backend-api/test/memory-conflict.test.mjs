/**
 * Memory conflict-resolution tests — A3 智能分流的「确认即写入画像」。
 *
 * The reorganize pipeline routes uncertain changes into conflicts.json; when the
 * user confirms (accept_new) the endpoint must actually write the value into the
 * profile via applyConflictResolution. This covers that apply step + dot-path
 * handling, independent of the LLM.
 *
 * Run: npx vitest run test/memory-conflict.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  getProfile, updateProfile,
  addConflict, getConflicts, resolveConflict, applyConflictResolution,
  wipeUserMemory,
} from '../src/memory/memory-file.service.mjs';

const U = `conflict-test-${Date.now()}`;
afterAll(() => wipeUserMemory(U));

describe('Memory conflict apply — A3 智能分流确认', () => {
  it('applyConflictResolution 把采用的新值写入画像（core_identity）', () => {
    updateProfile(U, { core_identity: { name: '旧名' } });
    expect(getProfile(U).core_identity.name).toBe('旧名');

    const p = applyConflictResolution(U, 'core_identity.name', '新名');
    expect(p.core_identity.name).toBe('新名');
    expect(getProfile(U).core_identity.name).toBe('新名');
  });

  it('applyConflictResolution 写嵌套语义维度字段', () => {
    applyConflictResolution(U, 'semantic_memory.dimensions.health.summary', '坚持晨跑半年');
    expect(getProfile(U).semantic_memory.dimensions.health.summary).toBe('坚持晨跑半年');
  });

  it('非法 / 不支持的路径返回 null 且不抛错', () => {
    expect(applyConflictResolution(U, '', 'x')).toBeNull();
    expect(applyConflictResolution(U, 'core_identity', 'x')).toBeNull(); // 不足两段
    expect(applyConflictResolution(U, 'unknown_top.foo', 'x')).toBeNull();
  });

  it('resolveConflict 把冲突标记为已解决', () => {
    addConflict(U, { field: 'core_identity.profession', old_value: 'A', new_value: 'B' });
    const list = getConflicts(U);
    const c = list[list.length - 1];
    expect(c.resolved).toBe(false);
    resolveConflict(U, c.id, { resolution: 'accept_new' });
    expect(getConflicts(U).find(x => x.id === c.id).resolved).toBe(true);
  });
});
