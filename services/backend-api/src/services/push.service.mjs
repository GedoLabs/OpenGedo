/**
 * Web Push Service (P2-C)
 *
 * 基于 VAPID + Web Push Protocol 向订阅了推送的用户投递通知。
 * 依赖 `web-push` npm 包（需在 package.json 添加）。
 *
 * 环境变量：
 *   VAPID_PUBLIC_KEY   — 公钥（前端订阅时需要）
 *   VAPID_PRIVATE_KEY  — 私钥
 *   VAPID_SUBJECT      — mailto: 或 https: 联系地址
 *
 * 用法：
 *   import { sendPush, saveSubscription, getVapidPublicKey } from './push.service.mjs';
 */

let _webPush = null;
let _vapidReady = false;

async function getWebPush() {
  if (_webPush) return _webPush;
  try {
    const mod = await import('web-push');
    _webPush = mod.default ?? mod;
    if (
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
    ) {
      _webPush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      _vapidReady = true;
      console.log('[push] VAPID configured — Web Push ready');
    } else {
      console.warn('[push] VAPID keys not set — push notifications disabled (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT)');
    }
    return _webPush;
  } catch {
    console.warn('[push] web-push module not installed — push notifications disabled');
    return null;
  }
}

// In-memory subscription store (dev fallback).
// Phase 3: replace with DB table push_subscriptions.
const _subscriptions = new Map(); // userId → PushSubscription[]

/**
 * Save or update a push subscription for a user.
 * Idempotent: keyed by subscription.endpoint.
 */
export function saveSubscription(userId, subscription) {
  if (!userId || !subscription?.endpoint) return;
  const list = _subscriptions.get(userId) || [];
  const existing = list.findIndex(s => s.endpoint === subscription.endpoint);
  if (existing >= 0) {
    list[existing] = subscription;
  } else {
    list.push(subscription);
  }
  _subscriptions.set(userId, list);
  console.log(`[push] subscription saved for user ${userId} (total: ${list.length})`);
}

/**
 * Remove a push subscription (user unsubscribed or endpoint expired).
 */
export function removeSubscription(userId, endpoint) {
  const list = _subscriptions.get(userId) || [];
  _subscriptions.set(userId, list.filter(s => s.endpoint !== endpoint));
}

/**
 * Get VAPID public key for client-side subscription.
 */
export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Send a push notification to all subscriptions of a user.
 *
 * @param {string} userId
 * @param {{ title: string, body: string, icon?: string, data?: object }} payload
 * @returns {Promise<{ sent: number, failed: number }>}
 */
export async function sendPush(userId, payload) {
  const wp = await getWebPush();
  if (!wp || !_vapidReady) {
    console.log(`[push] skipping push for user ${userId} — VAPID not ready`);
    return { sent: 0, failed: 0 };
  }

  const subs = _subscriptions.get(userId) || [];
  if (!subs.length) return { sent: 0, failed: 0 };

  const notification = JSON.stringify({
    title: String(payload.title || 'GEDO.AI').slice(0, 50),
    body:  String(payload.body  || '').slice(0, 200),
    icon:  payload.icon || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data:  payload.data || {},
  });

  let sent = 0, failed = 0;
  const toRemove = [];

  await Promise.allSettled(
    subs.map(async sub => {
      try {
        await wp.sendNotification(sub, notification);
        sent++;
      } catch (err) {
        // 410 Gone / 404 = subscription expired → remove
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          toRemove.push(sub.endpoint);
        }
        failed++;
        console.warn(`[push] failed to send to ${sub.endpoint?.slice(0, 40)}…: ${err?.message}`);
      }
    })
  );

  for (const ep of toRemove) removeSubscription(userId, ep);

  console.log(`[push] user ${userId}: sent=${sent} failed=${failed}`);
  return { sent, failed };
}

/**
 * Broadcast a proactive message to push after it's written to DB.
 * Called by cron / agent workers after store.createProactiveMessage().
 */
export async function pushProactiveMessage(userId, message) {
  return sendPush(userId, {
    title: message.title,
    body:  message.body,
    data:  { type: message.type, message_id: message.id },
  });
}

// Pre-warm on import
getWebPush().catch(() => {});
