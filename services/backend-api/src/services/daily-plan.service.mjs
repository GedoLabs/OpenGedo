/**
 * Daily Plan Service (Sprint 0 MVP — S0-4)
 *
 * Wires the in-process LLMRouter + Store + ConversationService into the
 * pure DailyPlanner agent (`services/agent/src/agents/DailyPlanner.mjs`)
 * and posts the resulting brief into the user's chat thread via
 * conversation.service.postSystemMessage.
 *
 * Two entry points:
 *   - runDailyPlanForUser(userId)   — generate + post for one user.
 *   - runDailyPlanForAllUsers()     — iterate active users (used by cron).
 *
 * Phase 2 will replace the iteration with pg-boss fan-out and add per-user
 * timezone awareness; for now everyone runs at the same server-local time.
 */

import { getLLMRouter } from '../llm/router.mjs';
import { Store } from '../lib/store.mjs';
import { generateDailyPlan, renderPlanText } from '../../../agent/src/agents/DailyPlanner.mjs';
import { postSystemMessage } from './conversation.service.mjs';

const store = Store();

function buildContextForUser(userId) {
  // Active goals
  const allGoals = store.listGoals ? store.listGoals(userId) : [];
  const activeGoals = (allGoals || [])
    .filter(g => g && g.status === 'active')
    .slice(0, 8)
    .map(g => ({
      id: g.id,
      title: g.title,
      status: g.status,
      life_wheel_dimension: g.life_wheel_dimension || g.lifeWheelDimension || null,
    }));

  // Today's tasks
  const todayTasks = (store.listTodayTasks ? store.listTodayTasks(userId) : [])
    .slice(0, 12)
    .map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
    }));

  // Yesterday's check-ins
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const checkIns = (store.listCheckIns ? store.listCheckIns(userId, { since }) : [])
    .slice(0, 12)
    .map(c => ({
      task_id: c.task_id,
      status: c.status,
      mood_rating: c.mood_rating,
      reason_code: c.reason_code,
    }));

  return {
    activeGoals,
    todayTasks,
    yesterdayCheckIns: checkIns,
    moodTrend: null, // populated in Phase 2 once mood detector lands
    identity: null,  // populated in Phase 1 once identity_profile lands
    language: store.getSettings(userId)?.language,
  };
}

/**
 * Generate today's plan for a single user and post it into their chat.
 *
 * @param {string} userId
 * @param {object} [options]
 * @param {boolean} [options.skipPost]   When true, return the plan but don't write to the conversation.
 * @returns {Promise<{ plan: object, source: 'llm'|'fallback', conversationId?: string, messageId?: string }>}
 */
export async function runDailyPlanForUser(userId, options = {}) {
  if (!userId) throw new Error('runDailyPlanForUser: userId required');

  const ctx = buildContextForUser(userId);
  const llm = getLLMRouter();

  const { plan, source } = await generateDailyPlan({ ctx, llm });
  const text = renderPlanText(plan);

  if (options.skipPost) {
    return { plan, source };
  }

  const { conversationId, messageId } = postSystemMessage(userId, {
    text,
    kind: 'daily_plan',
    source: 'daily_planner',
    extraMetadata: {
      planner_source: source,
      task_count: plan.tasks.length,
      has_care_message: Boolean(plan.care_message),
    },
  });

  return { plan, source, conversationId, messageId };
}

/**
 * Iterate all known users and run the daily plan for each.
 * Errors per-user are logged and do not stop the loop.
 */
export async function runDailyPlanForAllUsers() {
  // store.listUsers 被 admin 分页版覆盖（返回 { items, total } 且默认 limit 50）——
  // 兼容两种形状，否则全员晨间计划 cron 会直接 TypeError。
  const raw = store.listUsers ? store.listUsers({ limit: 100000 }) : [];
  const users = Array.isArray(raw) ? raw : (raw?.items || []);
  let ok = 0;
  let failed = 0;
  for (const u of users) {
    try {
      await runDailyPlanForUser(u.id);
      ok++;
    } catch (error) {
      failed++;
      console.error(`[daily-plan] user=${u.id} failed:`, error?.stack || error);
    }
  }
  console.log(`[daily-plan] batch done — ok=${ok} failed=${failed} total=${users.length}`);
  return { ok, failed, total: users.length };
}

export default { runDailyPlanForUser, runDailyPlanForAllUsers };
