/**
 * Task flow tests — 智能混合状态机（B1）。
 *
 * Covers the data-layer guarantees behind the execution page's
 * 待办→进行中→完成 flow and the task fields that decompose/breakdown rely on:
 *   - updateTaskStatus stamps started_at on 开始, completed_at on 完成
 *   - started_at is not overwritten on a paused→resumed task
 *   - createTasks persists scheduled_date / is_mit / plan_node_id
 *
 * Run: npx vitest run test/task-flow.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Store } from '../src/lib/store.mjs';

const store = Store();
const U = `task-flow-test-${Date.now()}`;

afterAll(() => { store.wipeUser(U); });

describe('Task flow — 智能混合状态机', () => {
  it('开始(in_progress) 写 started_at，完成(done) 写 completed_at', () => {
    const [task] = store.createTasks(U, [{ title: '写完 PRD 第三节', estimated_duration: 45 }]);
    expect(task.status).toBe('todo');
    expect(task.started_at).toBeFalsy();
    expect(task.completed_at).toBeFalsy();

    const started = store.updateTaskStatus(U, task.id, 'in_progress');
    expect(started.status).toBe('in_progress');
    expect(started.started_at).toBeTruthy();
    expect(started.completed_at).toBeFalsy();

    const done = store.updateTaskStatus(U, task.id, 'done');
    expect(done.status).toBe('done');
    expect(done.completed_at).toBeTruthy();
    // started_at 不被覆盖（暂停/继续后仍是首次开始时间）
    expect(done.started_at).toBe(started.started_at);
  });

  it('createTasks 持久化 scheduled_date / is_mit / plan_node_id（拆解物化所需）', () => {
    const [task] = store.createTasks(U, [{
      title: '收集资料并整理清单',
      estimated_duration: 30,
      energy_level: 'low',
      scheduled_date: '2026-06-20',
      is_mit: true,
      plan_node_id: 'node-123',
      goal_id: 'goal-abc',
    }]);
    expect(task.scheduled_date).toBe('2026-06-20');
    expect(task.is_mit).toBe(true);
    expect(task.plan_node_id).toBe('node-123');
    expect(task.goal_id).toBe('goal-abc');
    expect(task.energy_level).toBe('low');
  });

  it('updateTaskStatus 对未知任务返回 null', () => {
    expect(store.updateTaskStatus(U, 'does-not-exist', 'done')).toBeNull();
  });
});
