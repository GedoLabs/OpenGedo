/**
 * 轻量文件持久化任务队列（导入管线专用，单进程）。
 *
 * 设计取舍（方案已定）：不引入 Redis/Postgres——每个任务一个 JSON 文件落
 * data/jobs/，重启扫描恢复（running → 重新排队，管线阶段幂等：candidates 经
 * captures 去重，重跑不重复）。全局并发默认 1（保护本机 Ollama），会员按
 * tier 权重插队 + 等待时间老化防饿死。
 *
 * 用法：
 *   registerJobHandler('source_ingest', async (job, ctx) => {...});
 *   initJobQueue();                          // server 启动时调一次
 *   enqueueJob({ type, user_id, source_id, priority });
 *   getQueuePosition(jobId) / cancelJob / cancelJobsBySource
 *
 * handler ctx: { isCanceled(): boolean } —— 长任务应在块间检查，及时退出。
 */

import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './fs-atomic.mjs';
import { randomId, nowIso } from './crypto.mjs';
import { dataPath } from './data-dir.mjs';

const JOBS_DIR = dataPath('jobs');
const CONCURRENCY = Math.max(1, Number(process.env.IMPORT_QUEUE_CONCURRENCY || 1));
const AGING_PER_MINUTE = 0.5; // 每等待 1 分钟 +0.5 优先级（free 追平 pro 需 20 分钟）

/** @type {Map<string, any>} 内存镜像（文件是持久层，内存是工作集） */
const jobs = new Map();
/** @type {Map<string, Function>} */
const handlers = new Map();
const cancelFlags = new Set();
let running = 0;
let initialized = false;

function jobPath(id) {
  return path.join(JOBS_DIR, `${id}.json`);
}

function persist(job) {
  try {
    writeJsonAtomic(jobPath(job.id), job);
  } catch (e) {
    console.error('[job-queue] persist failed:', e?.message);
  }
}

export function registerJobHandler(type, fn) {
  handlers.set(type, fn);
}

/** 启动：建目录、加载存量任务、把中断的 running 拉回队列，然后开泵。 */
export function initJobQueue() {
  if (initialized) return;
  initialized = true;
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  for (const name of fs.readdirSync(JOBS_DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, name), 'utf8'));
      if (job.state === 'running') { // 进程中断的遗留任务 → 重新排队
        job.state = 'queued';
        job.attempts = (job.attempts || 0);
        persist(job);
      }
      jobs.set(job.id, job);
    } catch { /* 坏文件跳过 */ }
  }
  setTimeout(pump, 50);
}

/**
 * @param {{ type: string, user_id: string, source_id?: string, priority?: number, payload?: object }} spec
 */
export function enqueueJob(spec) {
  const job = {
    id: `job_${randomId()}`,
    type: spec.type,
    user_id: spec.user_id,
    source_id: spec.source_id || null,
    payload: spec.payload || {},
    priority: Number(spec.priority || 0),
    state: 'queued',
    attempts: 0,
    error: null,
    enqueued_at: nowIso(),
    started_at: null,
    finished_at: null,
  };
  jobs.set(job.id, job);
  persist(job);
  setTimeout(pump, 10);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

function effectivePriority(job) {
  const waitedMin = (Date.now() - new Date(job.enqueued_at).getTime()) / 60_000;
  return job.priority + Math.max(0, waitedMin) * AGING_PER_MINUTE;
}

function queuedJobs() {
  return [...jobs.values()].filter((j) => j.state === 'queued');
}

/** 1-based 排队位次（含正在跑的算第 0 位之前，即 queued 中的序）；非排队状态返回 null。 */
export function getQueuePosition(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.state !== 'queued') return null;
  const sorted = queuedJobs().sort((a, b) => effectivePriority(b) - effectivePriority(a)
    || new Date(a.enqueued_at) - new Date(b.enqueued_at));
  return sorted.findIndex((j) => j.id === jobId) + 1;
}

export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.state === 'queued') {
    job.state = 'canceled';
    job.finished_at = nowIso();
    persist(job);
    return true;
  }
  if (job.state === 'running') {
    cancelFlags.add(jobId); // handler 在块间检查后自行收尾
    return true;
  }
  return false;
}

export function cancelJobsBySource(userId, sourceId) {
  let hit = false;
  for (const job of jobs.values()) {
    if (job.user_id === userId && job.source_id === sourceId
      && (job.state === 'queued' || job.state === 'running')) {
      hit = cancelJob(job.id) || hit;
    }
  }
  return hit;
}

/** 供 janitor 清理：已终结且超过 maxAgeMs 的任务文件。 */
export function sweepFinishedJobs(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const job of [...jobs.values()]) {
    const done = job.state === 'done' || job.state === 'failed' || job.state === 'canceled';
    if (done && new Date(job.finished_at || job.enqueued_at).getTime() < cutoff) {
      jobs.delete(job.id);
      try { fs.unlinkSync(jobPath(job.id)); removed += 1; } catch { /* 已无文件 */ }
    }
  }
  return removed;
}

async function runOne(job) {
  const handler = handlers.get(job.type);
  if (!handler) { // handler 未注册（比如功能下线）→ 失败落盘，不空转
    job.state = 'failed';
    job.error = `no handler for ${job.type}`;
    job.finished_at = nowIso();
    persist(job);
    return;
  }
  job.state = 'running';
  job.attempts += 1;
  job.started_at = nowIso();
  persist(job);
  const ctx = { isCanceled: () => cancelFlags.has(job.id) };
  try {
    await handler(job, ctx);
    job.state = cancelFlags.has(job.id) ? 'canceled' : 'done';
  } catch (e) {
    job.state = cancelFlags.has(job.id) ? 'canceled' : 'failed';
    job.error = e?.message || String(e);
    if (job.state === 'failed') console.error(`[job-queue] ${job.type} ${job.id} failed:`, job.error);
  } finally {
    cancelFlags.delete(job.id);
    job.finished_at = nowIso();
    persist(job);
  }
}

function pump() {
  if (!initialized) return;
  while (running < CONCURRENCY) {
    const next = queuedJobs().sort((a, b) => effectivePriority(b) - effectivePriority(a)
      || new Date(a.enqueued_at) - new Date(b.enqueued_at))[0];
    if (!next) return;
    running += 1;
    void runOne(next).finally(() => {
      running -= 1;
      setTimeout(pump, 10);
    });
  }
}
