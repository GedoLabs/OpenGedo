/**
 * Transactional email service (P0).
 *
 * Domain-level send functions used by route handlers. Each one resolves the
 * recipient's language, builds any links, renders the template, and sends via
 * the Resend client. All are safe to fire-and-forget: they never throw and
 * return the client result ({ ok, id?, skipped?, error? }).
 *
 * Language: en by default. See lib/email/lang.mjs — we deliberately do NOT
 * treat the synthesized settings default (zh) as an explicit choice.
 */

import { Store } from '../lib/store.mjs';
import { renderEmail } from '../lib/email/render.mjs';
import { sendEmail } from '../lib/email/client.mjs';
import { resolveEmailLang } from '../lib/email/lang.mjs';
import { signJwt, verifyJwt } from '../lib/crypto.mjs';

const store = Store();

const JWT_SECRET_FINAL = process.env.JWT_SECRET || 'dev-secret-change-me-in-production';
const SUPPORT_EMAIL = 'support@gedo.ai';

/** Base URL for user-facing links (verify/reset/manage). */
function appBaseUrl() {
  const explicit = (process.env.APP_PUBLIC_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const cors = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',')[0].trim();
  return cors.replace(/\/+$/, '');
}

function appUrl(pathAndQuery) {
  return `${appBaseUrl()}${pathAndQuery}`;
}

/** Where "manage/update/resubscribe" buttons point. Override with BILLING_MANAGE_URL. */
function billingManageUrl() {
  return (process.env.BILLING_MANAGE_URL || '').trim() || appUrl('/app/account');
}

/** Backend's own public base for one-click unsubscribe links. Empty → no https unsub URL. */
function apiBaseUrl() {
  return (process.env.API_PUBLIC_URL || '').trim().replace(/\/+$/, '');
}

// ── Email preferences / unsubscribe (P1 engagement mail) ─────────────────────

/** Long-lived signed token so an unsubscribe link keeps working. */
export function unsubscribeToken(userId) {
  return signJwt({ sub: userId, scope: 'email_unsub' }, JWT_SECRET_FINAL, { expiresInSec: 60 * 60 * 24 * 365 * 5 });
}

/** Verify an unsubscribe token → userId or null. Used by the /v1/email/unsubscribe route. */
export function verifyUnsubscribeToken(token) {
  const v = verifyJwt(String(token || ''), JWT_SECRET_FINAL);
  if (!v.ok || v.payload?.scope !== 'email_unsub' || !v.payload?.sub) return null;
  return v.payload.sub;
}

/** P1 "updates" category opt-in check (default true when unset). */
function updatesAllowed(user) {
  const row = store.getSettingsRow ? store.getSettingsRow(user?.id) : null;
  return row?.email_prefs?.updates !== false;
}

/** List-Unsubscribe headers for a logged-in user: mailto + (when configured) one-click https. */
function unsubscribeHeaders(user) {
  const parts = [`<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`];
  const api = apiBaseUrl();
  const headers = {};
  if (api && user?.id) {
    const url = `${api}/v1/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(user.id))}`;
    parts.unshift(`<${url}>`);
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  headers['List-Unsubscribe'] = parts.join(', ');
  return headers;
}

/** Resolve a user's email language from their explicitly-saved settings, else funnel locale, else en. */
function langForUser(user, funnelLocale) {
  const row = store.getSettingsRow ? store.getSettingsRow(user?.id) : null;
  return resolveEmailLang({
    settingsLanguage: row?.language,
    hasSettingsRow: Boolean(row),
    funnelLocale: funnelLocale || user?.locale || null,
  });
}

function displayName(user) {
  return user?.display_name || null;
}

async function render_and_send(templateName, lang, to, data, opts = {}) {
  try {
    const { subject, html, text } = renderEmail(templateName, lang, data);
    const headers = opts.idempotencyKey ? { 'Idempotency-Key': String(opts.idempotencyKey) } : {};
    return await sendEmail({ to, subject, html, text, headers, emailHeaders: opts.emailHeaders, tags: [{ name: 'template', value: templateName }] });
  } catch (err) {
    console.error(`[email] render/send failed for ${templateName}: ${err?.message}`);
    return { ok: false, error: err?.message || 'render_error' };
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export function sendVerifyEmail(user, token, { funnelLocale } = {}) {
  const lang = langForUser(user, funnelLocale);
  return render_and_send('verify_email', lang, user.email, {
    name: displayName(user),
    verifyUrl: appUrl(`/auth/verify?token=${encodeURIComponent(token)}`),
  });
}

/** Sent TO the new address after an email-change request. */
export function sendVerifyNewEmail(user, newEmail, token) {
  const lang = langForUser(user);
  return render_and_send('verify_new_email', lang, newEmail, {
    name: displayName(user),
    verifyUrl: appUrl(`/auth/verify?token=${encodeURIComponent(token)}`),
  });
}

export function sendPasswordReset(user, token) {
  const lang = langForUser(user);
  return render_and_send('password_reset', lang, user.email, {
    name: displayName(user),
    resetUrl: appUrl(`/auth/reset-password?token=${encodeURIComponent(token)}`),
  });
}

export function sendPasswordChanged(user) {
  const lang = langForUser(user);
  return render_and_send('password_changed', lang, user.email, { name: displayName(user) });
}

/** Security alert sent TO the previous address after an email change. */
export function sendEmailChangedAlert(user, oldEmail, newEmail) {
  const lang = langForUser(user);
  return render_and_send('email_changed', lang, oldEmail, { name: displayName(user), newEmail });
}

// ── Billing ──────────────────────────────────────────────────────────────────

export function sendSubscriptionReceipt(user, { tier, interval, periodEnd } = {}, opts = {}) {
  const lang = langForUser(user);
  return render_and_send('subscription_receipt', lang, user.email, {
    name: displayName(user),
    tier,
    interval,
    periodEnd: periodEnd ? formatDate(periodEnd, lang) : null,
    manageUrl: billingManageUrl(),
  }, opts);
}

export function sendSubscriptionCanceled(user, { endDate } = {}, opts = {}) {
  const lang = langForUser(user);
  return render_and_send('subscription_canceled', lang, user.email, {
    name: displayName(user),
    endDate: endDate ? formatDate(endDate, lang) : null,
    resubscribeUrl: billingManageUrl(),
  }, opts);
}

export function sendPaymentFailed(user, opts = {}) {
  const lang = langForUser(user);
  return render_and_send('payment_failed', lang, user.email, {
    name: displayName(user),
    updateUrl: billingManageUrl(),
  }, opts);
}

// ── Account ──────────────────────────────────────────────────────────────────

/** User row is already gone by the time this sends — pass captured email/name/lang. */
export function sendAccountDeleted({ email, name, lang } = {}) {
  return render_and_send('account_deleted', lang || 'en', email, { name: name || null });
}

// ── Growth (P1, en-first) ─────────────────────────────────────────────────────

/** Waitlist join confirmation (transactional — always sends). Pre-account. */
export function sendWaitlistConfirm({ email, name, locale } = {}) {
  const lang = resolveEmailLang({ funnelLocale: locale });
  return render_and_send('waitlist_confirm', lang, email, { name: name || null });
}

/** Invite-code delivery (transactional). For the code-distribution script / admin console. */
export function sendWaitlistInvite({ email, name, code, locale, signupUrl } = {}) {
  const lang = resolveEmailLang({ funnelLocale: locale });
  return render_and_send('waitlist_invite', lang, email, {
    name: name || null,
    code,
    signupUrl: signupUrl || appUrl(`/auth/signup?invite=${encodeURIComponent(code || '')}`),
  });
}

/** Cold nudge to a pre-account email that saved a sim pack. mailto unsubscribe only. */
export function sendSimClaimNudge({ email, locale, personaLabel } = {}) {
  const lang = resolveEmailLang({ funnelLocale: locale });
  return render_and_send('sim_claim_nudge', lang, email, {
    personaLabel: personaLabel || null,
    signupUrl: appUrl('/auth/signup'),
  }, { emailHeaders: { 'List-Unsubscribe': `<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>` } });
}

/** Owner notification: a visitor left items for review. Suppressible (updates). */
export function sendPersonaInbox(user, { count } = {}) {
  if (!updatesAllowed(user)) return Promise.resolve({ ok: false, skipped: true, reason: 'opted_out' });
  const lang = langForUser(user);
  return render_and_send('persona_inbox', lang, user.email, {
    name: displayName(user),
    count: count || 0,
    reviewUrl: appUrl('/app'),
  }, { emailHeaders: unsubscribeHeaders(user) });
}

/** Async import finished. Suppressible (updates). kind: 'memory' | 'source'. */
export function sendImportComplete(user, { kind, episodesCreated, entitiesTouched, candidatesCreated } = {}) {
  if (!updatesAllowed(user)) return Promise.resolve({ ok: false, skipped: true, reason: 'opted_out' });
  const lang = langForUser(user);
  return render_and_send('import_complete', lang, user.email, {
    name: displayName(user),
    kind, episodesCreated, entitiesTouched, candidatesCreated,
    openUrl: appUrl('/app'),
  }, { emailHeaders: unsubscribeHeaders(user) });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatDate(value, lang) {
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const locale = lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja-JP' : 'en-US';
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return String(value);
  }
}
