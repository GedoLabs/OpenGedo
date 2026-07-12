/**
 * Agent Scheduler (Sprint 0 MVP — S0-4)
 *
 * Wraps node-cron with the minimum surface needed by S0-4:
 *   - One named job per agent (e.g. 'daily-plan').
 *   - All jobs are passive: they call a runner function, which is the
 *     caller's job to wire up to LLM + store + system_message channel.
 *   - Jobs respect ENABLE_SCHEDULER=false to allow tests / dev to opt out.
 *
 * Phase 2 will swap node-cron for pg-boss to support multi-instance
 * deployments and event-triggered (LISTEN/NOTIFY) Stuck Detector / Care
 * Agent. Until then this stays single-instance only.
 */

import cron from 'node-cron';

const _registered = new Map(); // jobName → { task, schedule, options }

function isEnabled() {
  // Default ON so the cron actually runs in production. Tests set ENABLE_SCHEDULER=false.
  const flag = process.env.ENABLE_SCHEDULER;
  if (flag === undefined || flag === null || flag === '') return true;
  return !['false', '0', 'no', 'off'].includes(String(flag).toLowerCase());
}

/**
 * Register a recurring job.
 *
 * @param {string} name           Stable identifier, used for logs and idempotent re-registration.
 * @param {string} schedule       node-cron expression (e.g. '0 7 * * *'). Validated.
 * @param {() => Promise<void>} runner   Async function to invoke at each tick. Must not throw uncaught.
 * @param {object} [options]
 * @param {string} [options.timezone]    IANA TZ. Defaults to server TZ.
 * @returns {{ stop: () => void }}
 */
export function registerJob(name, schedule, runner, options = {}) {
  if (typeof runner !== 'function') {
    throw new Error(`registerJob(${name}): runner must be a function`);
  }
  if (!cron.validate(schedule)) {
    throw new Error(`registerJob(${name}): invalid cron expression "${schedule}"`);
  }

  // Idempotent: re-register destroys the previous task so we don't double-fire.
  const prior = _registered.get(name);
  if (prior) {
    prior.task.stop();
    _registered.delete(name);
  }

  if (!isEnabled()) {
    console.log(`[scheduler] ${name} not started (ENABLE_SCHEDULER=false)`);
    return { stop() {} };
  }

  const task = cron.schedule(schedule, async () => {
    const startedAt = Date.now();
    try {
      await runner();
      console.log(`[scheduler] ${name} ok (${Date.now() - startedAt}ms)`);
    } catch (error) {
      console.error(`[scheduler] ${name} failed:`, error?.stack || error);
    }
  }, {
    scheduled: true,
    timezone: options.timezone || process.env.SCHEDULER_TZ || undefined,
  });

  _registered.set(name, { task, schedule, options });
  console.log(`[scheduler] ${name} registered (${schedule}${options.timezone ? ` TZ=${options.timezone}` : ''})`);
  return {
    stop() {
      task.stop();
      _registered.delete(name);
    },
  };
}

export function listJobs() {
  return Array.from(_registered.entries()).map(([name, meta]) => ({
    name,
    schedule: meta.schedule,
    timezone: meta.options.timezone || null,
  }));
}

export function stopAll() {
  for (const { task } of _registered.values()) task.stop();
  _registered.clear();
}

export default { registerJob, listJobs, stopAll };
