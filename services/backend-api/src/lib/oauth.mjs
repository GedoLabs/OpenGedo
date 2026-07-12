// Social login (Google / Apple "Sign in with X") — ID-token verification.
//
// Both providers hand the CLIENT a signed OIDC ID token (JWT). The client POSTs
// it here; we verify the signature against the provider's published JWKS and the
// standard claims (iss / aud / exp), then map it to a GEDO user. No provider
// secrets live in this file — verification is public-key only. The `aud` allow-
// lists come from env (every client ID that may mint a token we accept).
//
// `resolveSocialLogin` is intentionally a PURE function (store + config injected)
// so it unit-tests without spinning the HTTP server. The endpoints in server.mjs
// are thin wrappers that supply the module-level store / invite config.

import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

// Small skew tolerance so a token minted a moment ago isn't rejected on `iat`/`nbf`.
const CLOCK_TOLERANCE = '30s';

function parseIds(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Accepted `aud` values for Google — web + iOS + Android client IDs (comma-separated env). */
export function googleAudiences() {
  return parseIds(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID);
}

/** Accepted `aud` values for Apple — the app bundle ID (native) + Services ID (web). */
export function appleAudiences() {
  return parseIds(process.env.APPLE_CLIENT_IDS || process.env.APPLE_CLIENT_ID);
}

// Lazily-built remote key sets. `jose` caches the fetched keys internally and
// refreshes on rotation, so one instance per provider process-wide is correct.
let _googleJwks = null;
let _appleJwks = null;
function googleJwks() {
  return (_googleJwks ||= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)));
}
function appleJwks() {
  return (_appleJwks ||= createRemoteJWKSet(new URL(APPLE_JWKS_URL)));
}

function oauthError(code, cause) {
  const err = new Error(code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

// Core OIDC verify. `jwks` is a key-resolver (remote in prod, local in tests).
async function verifyOidc(idToken, { jwks, issuer, audience, nonce }) {
  if (!Array.isArray(audience) || audience.length === 0) {
    throw oauthError('provider_not_configured');
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, jwks, {
      issuer,
      audience,
      clockTolerance: CLOCK_TOLERANCE,
    }));
  } catch (e) {
    throw oauthError('invalid_token', e);
  }
  // Optional replay defense: enforce the nonce claim only when the caller supplies
  // an expected value (client-driven; off by default in v1).
  if (nonce !== undefined && nonce !== null && nonce !== '') {
    if (payload.nonce !== nonce) throw oauthError('nonce_mismatch');
  }
  return payload;
}

function normEmailVerified(v) {
  return v === true || v === 'true';
}

/**
 * Verify a Google ID token (from Google Identity Services on web, or the native
 * google-signin SDK on mobile). Returns a normalized identity or throws
 * {code:'provider_not_configured'|'invalid_token'|'nonce_mismatch'}.
 */
export async function verifyGoogleIdToken(idToken, opts = {}) {
  const audience = opts.audiences || googleAudiences();
  const jwks = opts.jwks || googleJwks();
  const p = await verifyOidc(idToken, { jwks, issuer: GOOGLE_ISSUERS, audience, nonce: opts.nonce });
  return {
    provider: 'google',
    subject: String(p.sub),
    email: p.email ? String(p.email).trim().toLowerCase() : null,
    email_verified: normEmailVerified(p.email_verified),
    name: p.name ? String(p.name).slice(0, 120) : null,
    picture: p.picture ? String(p.picture).slice(0, 500) : null,
  };
}

/**
 * Verify an Apple ID token (from Sign in with Apple JS on web, or
 * expo-apple-authentication on iOS). Apple only sends the user's name to the
 * CLIENT on the first authorization — never in the token — so `name` here is
 * always null; the endpoint grafts a client-supplied name at create time.
 */
export async function verifyAppleIdToken(idToken, opts = {}) {
  const audience = opts.audiences || appleAudiences();
  const jwks = opts.jwks || appleJwks();
  const p = await verifyOidc(idToken, { jwks, issuer: APPLE_ISSUER, audience, nonce: opts.nonce });
  return {
    provider: 'apple',
    subject: String(p.sub),
    email: p.email ? String(p.email).trim().toLowerCase() : null,
    email_verified: normEmailVerified(p.email_verified),
    name: null,
    picture: null,
  };
}

/**
 * Map a verified provider identity to a GEDO user, creating or linking as needed.
 * Pure — all deps injected — so it unit-tests against a real Store() without HTTP.
 *
 * Resolution order:
 *   1. Identity already linked (returning social user)        → login, no invite
 *   2. Verified email matches an existing account             → link, no invite
 *   3. Brand-new account                                      → invite-gated create
 *
 * Anti-takeover: an existing account is only auto-linked when the provider marks
 * the email verified. (Google/Apple effectively always do.) Otherwise → 409.
 *
 * @returns {{user, isNew:boolean} | {error:string, status:number}}
 */
export function resolveSocialLogin({ store, verified, inviteCode = '', requireInvite = true, staticCodes = [] }) {
  const { provider, subject, email, email_verified } = verified;
  if (!provider || !subject) return { error: 'invalid_token', status: 401 };

  // 1) Returning social user.
  const linked = store.getUserByProviderSubject(provider, subject);
  if (linked) return { user: linked, isNew: false };

  // 2) Link onto an existing account by email — only when the provider vouches it.
  const existing = email ? store.getUserByEmail(email) : null;
  if (existing) {
    if (email_verified) {
      store.upsertAuthIdentity({ user_id: existing.id, provider, provider_subject: subject, email });
      return { user: existing, isNew: false };
    }
    // Account exists at this email but the provider didn't verify it → refuse
    // silent account takeover.
    return { error: 'email_exists', status: 409 };
  }

  // 3) Brand-new account. Check email presence BEFORE redeeming so a token that
  // genuinely lacks an email doesn't burn a single-use invite code.
  if (!email) return { error: 'email_required', status: 400 };

  if (requireInvite) {
    const code = String(inviteCode || '').trim();
    const ok = (!!code && staticCodes.includes(code)) || (!!code && store.redeemInviteCode(code).ok);
    if (!ok) return { error: 'invite_required', status: 403 };
  }

  const created = store.createUser({
    email,
    password_hash: null,
    locale: verified.locale || null,
    display_name: verified.name || null,
    avatar_url: verified.picture || null,
    email_verified: !!email_verified,
  });
  store.upsertAuthIdentity({ user_id: created.id, provider, provider_subject: subject, email });
  return { user: created, isNew: true };
}

/**
 * Guard for unlinking a sign-in method: never leave an account with no usable way
 * back in. Pure so it unit-tests without HTTP.
 *
 * `identities` is the user's full list (may include the always-present 'password'
 * row). `hasPassword` is whether a REAL password hash is set — a 'password' row can
 * linger for a social-only account with a null hash, which is not a usable login,
 * so presence of the row alone must not be trusted.
 *
 * @returns {{ok:true}|{ok:false, error:'not_found'|'cannot_unlink_password'|'last_login_method'}}
 */
export function canUnlinkIdentity({ identities = [], targetId, hasPassword = false }) {
  const target = identities.find((i) => i.id === targetId);
  if (!target) return { ok: false, error: 'not_found' };
  // The password method is managed via change-password, not this endpoint.
  if (target.provider === 'password') return { ok: false, error: 'cannot_unlink_password' };
  const otherUsableSocial = identities.filter(
    (i) => i.id !== targetId && i.provider !== 'password',
  ).length;
  if (!hasPassword && otherUsableSocial === 0) return { ok: false, error: 'last_login_method' };
  return { ok: true };
}

// Exposed for tests (verify with a local JWKS instead of hitting Google/Apple).
export { verifyOidc };
