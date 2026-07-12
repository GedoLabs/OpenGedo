/**
 * 任务自动化执行器（P14）— 待办从「记录」变「可操作」。
 *
 * 消费 P5 约定的 task.metadata.action（见 docs/task-automation.md）：
 *   { kind: 'mcp_tool', server_id, tool, args, on: 'checkin' | 'scheduled' }
 *
 * 触发点：
 *   ① checkin 链路：状态推进到 in_progress/done 且 on==='checkin'；
 *   ② task-actions cron：每日扫描 scheduled_date=今天 且 on==='scheduled' 的任务。
 *
 * 执行走 McpClientManager（复用 P5 的超时/私网护栏/输出截断）；结果写回
 * metadata.action_result 留痕即审计；失败单次重试，仍失败经 postSystemMessage
 * 通知用户（成功也发一条简短告知，用户能看见"系统替我做了什么"）。
 */

import { Store } from '../lib/store.mjs';
import * as McpClientManager from '../mcp/client-manager.mjs';
import { postSystemMessage } from './conversation.service.mjs';

const store = Store();

function validAction(action) {
  return action && action.kind === 'mcp_tool'
    && typeof action.server_id === 'string' && typeof action.tool === 'string';
}

/** 单任务执行（幂等由调用方控制）；返回 action_result。 */
export async function runTaskAction(userId, task) {
  const action = task?.metadata?.action;
  if (!validAction(action)) return null;

  const server = store.getMcpServer(userId, action.server_id);
  if (!server || server.enabled === false) {
    return finish(userId, task, { status: 'failed', output_summary: 'mcp server not found or disabled' });
  }

  const namespaced = `mcp__${server.slug}__${action.tool}`;
  let result = await McpClientManager.callNamespacedTool(userId, namespaced, action.args || {});
  if (!result?.success) {
    // 单次重试（连接类抖动最常见；callNamespacedTool 失败已 dropConn，重试即重连）
    result = await McpClientManager.callNamespacedTool(userId, namespaced, action.args || {});
  }

  return finish(userId, task, {
    status: result?.success ? 'ok' : 'failed',
    output_summary: String(result?.output || result?.message || '').slice(0, 500),
  });
}

function finish(userId, task, { status, output_summary }) {
  const action_result = { status, output_summary, executed_at: new Date().toISOString() };
  try {
    store.updateTask(userId, task.id, {
      metadata: { ...(task.metadata || {}), action_result },
    });
  } catch (e) {
    console.error('[task-action] result write-back failed', e?.message || e);
  }
  try {
    const ok = status === 'ok';
    postSystemMessage(userId, {
      text: ok
        ? `✅ 自动化待办「${task.title}」已执行：${output_summary.slice(0, 120)}`
        : `⚠️ 自动化待办「${task.title}」执行失败：${output_summary.slice(0, 120)}`,
      kind: 'task_action',
      source: 'task_action',
      extraMetadata: { task_id: task.id, status },
    });
  } catch (e) {
    console.error('[task-action] notify failed', e?.message || e);
  }
  console.log(`[task-action] task=${task.id} ${status}`);
  return action_result;
}

/** checkin 触发：状态推进到 in_progress/done 且 on==='checkin' 且当天未执行过。 */
export function maybeRunOnCheckin(userId, task, newStatus) {
  const action = task?.metadata?.action;
  if (!validAction(action) || action.on !== 'checkin') return;
  if (newStatus !== 'in_progress' && newStatus !== 'done') return;
  const last = task.metadata?.action_result?.executed_at;
  if (last && last.slice(0, 10) === new Date().toISOString().slice(0, 10)) return; // 当日幂等
  void runTaskAction(userId, task).catch(e => console.error('[task-action] checkin run failed', e));
}

/** cron 触发：全用户扫描今天到期的 scheduled 动作（当日幂等）。 */
export async function runScheduledForAllUsers() {
  // store.listUsers 被 admin 分页版覆盖（返回 { items, total }），两种形状都兼容。
  const raw = store.listUsers ? store.listUsers({ limit: 100000 }) : [];
  const users = Array.isArray(raw) ? raw : (raw?.items || []);
  const today = new Date().toISOString().slice(0, 10);
  let ran = 0;
  for (const u of users) {
    const tasks = (store.listAllTasks ? store.listAllTasks(u.id) : []) || [];
    for (const task of tasks) {
      const action = task?.metadata?.action;
      if (!validAction(action) || action.on !== 'scheduled') continue;
      if (task.scheduled_date !== today) continue;
      if (task.status === 'done' || task.status === 'cancelled') continue;
      const last = task.metadata?.action_result?.executed_at;
      if (last && last.slice(0, 10) === today) continue;
      try {
        await runTaskAction(u.id, task);
        ran += 1;
      } catch (e) {
        console.error(`[task-action] scheduled run failed task=${task.id}:`, e?.message || e);
      }
    }
  }
  console.log(`[task-action] scheduled sweep done — ran=${ran}`);
  return { ran };
}

export default { runTaskAction, maybeRunOnCheckin, runScheduledForAllUsers };
