/**
 * LISTEN/NOTIFY Triggers (P2-B)
 *
 * 监听 PostgreSQL NOTIFY 事件，实现事件驱动的 Agent 触发。
 *
 * 当前频道：
 *   check_in_done — check_in 写入后 pg_notify；Stuck Detector 接收并立即分析
 *
 * 当 DATABASE_URL 未设置时（本地开发）降级为 EventEmitter 内存总线，
 * 服务端 check-in endpoint 直接 emit 事件。
 */

import { EventEmitter } from 'node:events';

// 内存总线：dev 环境 fallback
export const memoryBus = new EventEmitter();
memoryBus.setMaxListeners(50);

let _pgClient = null;

/**
 * 初始化 LISTEN 连接（生产：pg Client；dev：no-op）
 */
export async function startListening() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log('[listenNotify] DATABASE_URL not set — using in-memory event bus');
    return;
  }

  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    await client.query('LISTEN check_in_done');
    _pgClient = client;

    client.on('notification', msg => {
      if (msg.channel === 'check_in_done') {
        const userId = msg.payload;
        console.log(`[listenNotify] check_in_done for user ${userId}`);
        memoryBus.emit('check_in_done', userId);
      }
    });

    client.on('error', err => {
      console.error('[listenNotify] pg client error:', err?.message);
    });

    console.log('[listenNotify] LISTEN check_in_done — OK');
  } catch (err) {
    console.warn('[listenNotify] could not connect to Postgres for LISTEN:', err?.message);
  }
}

export async function stopListening() {
  if (_pgClient) {
    await _pgClient.query('UNLISTEN *').catch(() => {});
    await _pgClient.end().catch(() => {});
    _pgClient = null;
  }
}

/**
 * Register a handler that fires whenever check_in_done fires.
 * Works in both pg-LISTEN and in-memory modes.
 *
 * @param {(userId: string) => Promise<void>} handler
 */
export function onCheckInDone(handler) {
  memoryBus.on('check_in_done', async (userId) => {
    try {
      await handler(userId);
    } catch (err) {
      console.error('[listenNotify] check_in_done handler error:', err?.message);
    }
  });
}

/**
 * Dev helper: manually emit check_in_done (used by server when no pg available).
 */
export function emitCheckInDone(userId) {
  memoryBus.emit('check_in_done', userId);
}
