/**
 * Cron Triggers (P2-B)
 *
 * 注册所有定时触发的 Agent 任务到 pg-boss。
 * 替换 S0-4 的 node-cron scheduler（保留 scheduler.mjs 作为纯 node-cron 备用）。
 *
 * 任务表：
 *   daily-plan      — 每日 07:00，遍历活跃用户投递早安简报
 *   stuck-detector  — 每日 09:00，检测过去 3 天卡壳用户
 *   care-agent      — 每日 10:00，情绪/日期关怀检测
 *   reflector-week  — 每周日 20:00，周复盘
 *   reflector-month — 每月最后一天 20:00，月复盘（pg-boss cron 语法）
 */

import { scheduleRecurring, work, getBoss } from '../queue/pgboss.mjs';
import { getLLMRouter } from '../../../backend-api/src/llm/router.mjs';
import { Store } from '../../../backend-api/src/lib/store.mjs';
import { generateDailyPlan } from '../agents/DailyPlanner.mjs';
import { runStuckDetector } from '../agents/StuckDetector.mjs';
import { runCareAgent } from '../agents/CareAgent.mjs';
import { runReflector } from '../agents/Reflector.mjs';
import { postSystemMessage } from '../../../backend-api/src/services/conversation.service.mjs';
import { renderPlanText } from '../agents/DailyPlanner.mjs';

const store = Store();

function makeLLMAdapter() {
  const router = getLLMRouter();
  return {
    isAvailable: () => true,
    async chat(messages) {
      try {
        const reply = await router.chat(messages);
        return { content: reply?.content || reply || '' };
      } catch {
        return { content: '' };
      }
    },
  };
}

async function getActiveUsers() {
  return (store.listAllUsers?.() ?? []).filter(u => {
    if (!u || !u.id) return false;
    // Phase 2: filter by last_active_at < 30 days
    return true;
  });
}

/**
 * Build the context object expected by the various agents. Field names here
 * must match what the agents read (e.g. DailyPlanner expects
 * `activeGoals` / `todayTasks`, not bare `goals` / `tasks`).
 */
function buildUserContext(userId) {
  const activeGoals = (store.listGoals?.(userId) ?? [])
    .filter(g => g && g.status === 'active')
    .slice(0, 8);
  const todayTasks = (store.listTodayTasks?.(userId) ?? []).slice(0, 12);
  const yesterdayCheckIns = (store.listCheckIns?.(userId, { days: 1 }) ?? []).slice(0, 12);
  const memories = (store.listRecentMemories?.(userId, { days: 7 }) ?? []).slice(0, 10);
  return {
    activeGoals,
    todayTasks,
    yesterdayCheckIns,
    memories,
    moodTrend: null,
    identity: null,
  };
}

// ─── Worker registrations ────────────────────────────────────────────────────

export async function registerCronTriggers() {
  const llm = makeLLMAdapter();

  // Daily plan is registered separately via node-cron in
  // backend-api/src/server.mjs to avoid two schedulers racing on the same
  // job. We skip registering it here unless explicitly opted-in via env so
  // the pg-boss path doesn't fan out a second (possibly stale) brief.
  if (process.env.ENABLE_PGBOSS_DAILY_PLAN === 'true') {
    await scheduleRecurring('daily-plan', '0 7 * * *');
    await work('daily-plan', async () => {
      const users = await getActiveUsers();
      console.log(`[cron] daily-plan: ${users.length} users`);
      for (const user of users) {
        try {
          const ctx  = buildUserContext(user.id);
          const { plan } = await generateDailyPlan({ ctx, llm });
          const text = renderPlanText(plan);
          await postSystemMessage(user.id, {
            text,
            kind: 'daily_plan',
            source: 'daily_planner',
          });
        } catch (err) {
          console.error(`[cron] daily-plan failed for ${user.id}:`, err?.message);
        }
      }
    });
  } else {
    console.log('[cron] daily-plan handled by node-cron in server.mjs; skipping pg-boss registration');
  }

  // Stuck detector — 09:00 every day
  await scheduleRecurring('stuck-detector', '0 9 * * *');
  await work('stuck-detector', async () => {
    const users = await getActiveUsers();
    console.log(`[cron] stuck-detector: ${users.length} users`);
    for (const user of users) {
      try {
        const ctx = buildUserContext(user.id);
        await runStuckDetector({ userId: user.id, store, llm, context: ctx });
      } catch (err) {
        console.error(`[cron] stuck-detector failed for ${user.id}:`, err?.message);
      }
    }
  });

  // Care agent — 10:00 every day
  await scheduleRecurring('care-agent', '0 10 * * *');
  await work('care-agent', async () => {
    const users = await getActiveUsers();
    for (const user of users) {
      try {
        const careEnabled = user.preferences?.care_enabled === true;
        const ctx = { ...buildUserContext(user.id), displayName: user.display_name };
        await runCareAgent({ userId: user.id, store, llm, context: ctx, careEnabled });
      } catch (err) {
        console.error(`[cron] care-agent failed for ${user.id}:`, err?.message);
      }
    }
  });

  // Weekly reflector — Sunday 20:00
  await scheduleRecurring('reflector-week', '0 20 * * 0');
  await work('reflector-week', async () => {
    const users = await getActiveUsers();
    for (const user of users) {
      try {
        const ctx = buildUserContext(user.id);
        await runReflector({ userId: user.id, period: 'week', store, llm, context: ctx });
      } catch (err) {
        console.error(`[cron] reflector-week failed for ${user.id}:`, err?.message);
      }
    }
  });

  // Monthly reflector — last day of month 20:00
  await scheduleRecurring('reflector-month', '0 20 28-31 * *');
  await work('reflector-month', async () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Only fire on actual last day of month
    if (tomorrow.getDate() !== 1) return;

    const users = await getActiveUsers();
    for (const user of users) {
      try {
        const ctx = buildUserContext(user.id);
        await runReflector({ userId: user.id, period: 'month', store, llm, context: ctx });
      } catch (err) {
        console.error(`[cron] reflector-month failed for ${user.id}:`, err?.message);
      }
    }
  });

  console.log('[cron] all pg-boss cron triggers registered');
}
