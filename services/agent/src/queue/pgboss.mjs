/**
 * pg-boss 队列封装 (P2-A)
 *
 * 两种运行模式：
 *   - 有 DATABASE_URL → 使用真实 pg-boss（生产/staging）
 *   - 无 DATABASE_URL → 降级为内存队列（本地开发/测试）
 *
 * 导出统一 API：
 *   getBoss()               — 获取初始化好的实例
 *   scheduleRecurring()     — 注册 cron 触发的循环任务
 *   sendOnce()              — 发送单次任务
 *   work()                  — 注册 worker 处理函数
 */

let _boss = null;
let _inMemory = null;

// ─── 内存降级实现 ───────────────────────────────────────────────────────────

class InMemoryBoss {
  constructor() {
    this._workers   = new Map();   // jobName → handler
    this._schedules = new Map();   // jobName → { cron, timer }
    this._queue     = [];
    console.log('[pgboss] DATABASE_URL not set — using in-memory queue (dev mode)');
  }

  async start() { return this; }
  async stop()  {}

  async schedule(name, cron, data = {}) {
    // Parse minimal cron: handle "0 H * * *" pattern → fire once per day
    const existing = this._schedules.get(name);
    if (existing) clearInterval(existing.timer);
    // In dev, fire after 5 s delay so server starts before first tick
    const timer = setInterval(async () => {
      await this._dispatch(name, data);
    }, 24 * 60 * 60 * 1000); // once/day in dev
    this._schedules.set(name, { cron, timer });
    console.log(`[pgboss:mem] scheduled "${name}" (${cron})`);
  }

  async work(name, handler) {
    this._workers.set(name, handler);
    console.log(`[pgboss:mem] worker registered for "${name}"`);
  }

  async send(name, data = {}, opts = {}) {
    await this._dispatch(name, data);
  }

  async _dispatch(name, data) {
    const handler = this._workers.get(name);
    if (!handler) return;
    try {
      await handler({ name, data, id: `mem-${Date.now()}` });
    } catch (err) {
      console.error(`[pgboss:mem] job "${name}" failed:`, err?.message);
    }
  }

  async getSchedules() {
    return Array.from(this._schedules.entries()).map(([name, m]) => ({ name, cron: m.cron }));
  }
}

// ─── 真实 pg-boss ───────────────────────────────────────────────────────────

async function createRealBoss(connectionString) {
  // Dynamic import so the module loads fine even without pg-boss installed
  const { default: PgBoss } = await import('pg-boss');
  const boss = new PgBoss({
    connectionString,
    retentionDays: 7,
    archiveCompletedAfterSeconds: 3600,
    deleteAfterDays: 14,
  });
  boss.on('error', err => console.error('[pgboss] error', err?.message));
  await boss.start();
  console.log('[pgboss] started (real pg-boss)');
  return boss;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns the initialized boss instance (singleton).
 * Call once at server startup.
 */
export async function getBoss() {
  if (_boss) return _boss;

  const db = process.env.DATABASE_URL;
  if (db) {
    try {
      _boss = await createRealBoss(db);
    } catch (err) {
      console.warn('[pgboss] real pg-boss failed, falling back to in-memory:', err?.message);
      _boss = new InMemoryBoss();
      await _boss.start();
    }
  } else {
    if (!_inMemory) {
      _inMemory = new InMemoryBoss();
      await _inMemory.start();
    }
    _boss = _inMemory;
  }
  return _boss;
}

/**
 * Register a cron-based recurring job.
 * @param {string} name      — stable job name
 * @param {string} cron      — cron expression, e.g. '0 7 * * *'
 * @param {object} [data]    — static data passed to each job invocation
 */
export async function scheduleRecurring(name, cron, data = {}) {
  const boss = await getBoss();
  await boss.schedule(name, cron, data);
}

/**
 * Register a handler for a job type.
 * @param {string}   name
 * @param {Function} handler  — async fn({ id, name, data }) → void
 */
export async function work(name, handler) {
  const boss = await getBoss();
  await boss.work(name, handler);
}

/**
 * Enqueue a single one-shot job immediately.
 * @param {string} name
 * @param {object} [data]
 * @param {object} [opts]   — pg-boss send options (startAfter, retryLimit…)
 */
export async function sendOnce(name, data = {}, opts = {}) {
  const boss = await getBoss();
  await boss.send(name, data, opts);
}

export async function stopBoss() {
  if (_boss) { await _boss.stop?.(); _boss = null; }
}
