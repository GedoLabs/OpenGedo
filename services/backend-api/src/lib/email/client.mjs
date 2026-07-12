/**
 * Resend transport (P0).
 *
 * Modeled on push.service.mjs: env-gated, graceful no-op when unconfigured, so
 * dev/OSS without keys simply skips instead of throwing.
 *
 * Proxy policy (important): Resend's api.resend.com is directly reachable — it
 * is NOT region-blocked like Anthropic. So we connect DIRECT by default and
 * only route through a proxy when RESEND_PROXY_URL is explicitly set. We do NOT
 * fall back to HTTPS_PROXY (unlike llm/proxy.mjs), because a dev shell exporting
 * a system proxy (Clash) would silently force email through it and time out —
 * the exact trap documented in mcp/client-manager.mjs.
 *
 * Env:
 *   RESEND_API_KEY   — required to actually send
 *   EMAIL_FROM       — e.g. "GEDO <no-reply@mail.gedo.ai>" (verified domain)
 *   EMAIL_REPLY_TO   — optional, e.g. support@gedo.ai
 *   EMAIL_ENABLED    — set "false" to hard-disable (kill switch)
 *   RESEND_PROXY_URL — optional; explicit-only, never inherits HTTPS_PROXY
 */

import { fetch as undiciFetch, ProxyAgent } from 'undici';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

let _dispatcher;
let _dispatcherInit = false;

function maskProxy(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; }
  catch { return 'configured'; }
}

function getDispatcher() {
  if (_dispatcherInit) return _dispatcher;
  _dispatcherInit = true;
  const proxy = (process.env.RESEND_PROXY_URL || '').trim(); // explicit-only, no HTTPS_PROXY fallback
  _dispatcher = proxy ? new ProxyAgent(proxy) : null;
  if (proxy) console.log(`[email] routing via proxy ${maskProxy(proxy)}`);
  return _dispatcher;
}

/** Mask an address for logs: a***@example.com */
function redact(to) {
  const addr = Array.isArray(to) ? to[0] : to;
  const s = String(addr || '');
  const at = s.indexOf('@');
  if (at <= 1) return s ? `${s[0] || ''}***` : '?';
  return `${s[0]}***${s.slice(at)}`;
}

export function isEmailConfigured() {
  return (
    process.env.EMAIL_ENABLED !== 'false' &&
    Boolean(process.env.RESEND_API_KEY) &&
    Boolean(process.env.EMAIL_FROM)
  );
}

/**
 * Low-level send. Returns { ok, id?, skipped?, error?, status? } — never throws.
 *
 * @param {object} msg
 * @param {string|string[]} msg.to
 * @param {string} msg.subject
 * @param {string} msg.html
 * @param {string} msg.text
 * @param {string} [msg.replyTo]
 * @param {Record<string,string>} [msg.headers]        HTTP request headers, e.g. { 'Idempotency-Key': '...' }
 * @param {Record<string,string>} [msg.emailHeaders]   custom EMAIL headers, e.g. List-Unsubscribe
 * @param {Array<{name:string,value:string}>} [msg.tags]
 */
export async function sendEmail({ to, subject, html, text, replyTo, headers = {}, emailHeaders, tags }) {
  if (!isEmailConfigured()) {
    console.warn(`[email] skipped "${subject}" → ${redact(to)} (email not configured: set RESEND_API_KEY + EMAIL_FROM)`);
    return { ok: false, skipped: true };
  }
  if (!to) {
    console.warn(`[email] skipped "${subject}" — no recipient`);
    return { ok: false, skipped: true };
  }

  const payload = {
    from: process.env.EMAIL_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  };
  const reply_to = replyTo || process.env.EMAIL_REPLY_TO;
  if (reply_to) payload.reply_to = reply_to;
  if (Array.isArray(tags) && tags.length) payload.tags = tags;
  if (emailHeaders && Object.keys(emailHeaders).length) payload.headers = emailHeaders;

  const dispatcher = getDispatcher();
  try {
    const resp = await undiciFetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
      ...(dispatcher ? { dispatcher } : {}),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error(`[email] send failed (${resp.status}) "${subject}" → ${redact(to)}: ${data?.message || resp.statusText}`);
      return { ok: false, error: data?.message || `http_${resp.status}`, status: resp.status };
    }
    console.log(`[email] sent "${subject}" → ${redact(to)} (id=${data?.id || '?'})`);
    return { ok: true, id: data?.id || null };
  } catch (err) {
    console.error(`[email] send error "${subject}" → ${redact(to)}: ${err?.message}`);
    return { ok: false, error: err?.message || 'send_error' };
  }
}
