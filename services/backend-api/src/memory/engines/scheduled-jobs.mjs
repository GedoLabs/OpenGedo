/**
 * Scheduled memory jobs (P3) — periodic consolidation + identity refresh.
 *
 * Closes diagnosis #8 ("compression never runs on a schedule"): the existing
 * consolidation engines used to fire only when the user clicked "一键梳理".
 * These run them per-user on a cadence, wired into server.mjs's node-cron
 * (registerScheduledJob), which runs in-process whenever backend-api runs — so
 * it works in the dev setup without the separate agent service.
 *
 *   nightly   → fold new episodes into semantic memory (cheap; skips if none)
 *   weekly    → weekly consolidation + recompute the dynamic identity model
 *   quarterly → re-summarize the period
 *
 * Best-effort per user: one user's failure never blocks the rest.
 */

import { Store } from '../../lib/store.mjs';
import { consolidate, consolidateWeekly, consolidateQuarterly } from '../consolidation.service.mjs';
import { computeIdentity } from './identity-engine.mjs';
import { computeDimensionAssessment } from './dimension-engine.mjs';
import { generateNarrative, NARRATIVE_WINDOWS } from './narrative-engine.mjs';
import { sweep as sweepEntitySummaries } from '../entity-summary.service.mjs';

const store = Store();

// Identity refinement uses the strong chat model; honour the global LLM switch.
const llmEnabled = () => process.env.ENABLE_LLM !== 'false';

function activeUsers() {
  return (store.listAllUsers?.() ?? []).filter(u => u && u.id);
}

export async function runNightlyForAll() {
  const users = activeUsers();
  console.log(`[memory-cron] nightly: ${users.length} user(s)`);
  for (const u of users) {
    try { await consolidate(u.id, { level: 'nightly' }); }
    catch (e) { console.error(`[memory-cron] nightly ${u.id}:`, e?.message); }
    // 图鉴卡面 AI 总结兜底补齐（指纹未变的卡零成本跳过）
    try { await sweepEntitySummaries(u.id); }
    catch (e) { console.error(`[memory-cron] entity-summary ${u.id}:`, e?.message); }
  }
}

export async function runWeeklyForAll() {
  const users = activeUsers();
  console.log(`[memory-cron] weekly: ${users.length} user(s)`);
  for (const u of users) {
    try {
      await consolidateWeekly(u.id);
      await computeIdentity(u.id, { useLLM: llmEnabled(), trigger: 'weekly' });
      // 生命之花八维评估：排在 consolidateWeekly（写维度 summary）之后读取
      await computeDimensionAssessment(u.id, { useLLM: llmEnabled(), trigger: 'weekly' });
      for (const w of NARRATIVE_WINDOWS) {
        await generateNarrative(u.id, w, { useLLM: llmEnabled(), trigger: 'weekly' });
      }
    } catch (e) { console.error(`[memory-cron] weekly ${u.id}:`, e?.message); }
  }
}

export async function runQuarterlyForAll() {
  const users = activeUsers();
  console.log(`[memory-cron] quarterly: ${users.length} user(s)`);
  for (const u of users) {
    try { await consolidateQuarterly(u.id); }
    catch (e) { console.error(`[memory-cron] quarterly ${u.id}:`, e?.message); }
  }
}

export default { runNightlyForAll, runWeeklyForAll, runQuarterlyForAll };
