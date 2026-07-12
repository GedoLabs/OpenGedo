/**
 * Social login (Google / Apple) — backend contract test.
 *
 * Verification runs fully offline: we mint a local RSA keypair, sign fake ID
 * tokens with `jose`, and feed the matching public JWKS straight into the
 * verifier (opts.jwks / opts.audiences) — no network, no Google/Apple.
 *
 * Locks the security-sensitive bits:
 *   - signature / aud / iss are actually enforced (tampered + wrong-aud rejected)
 *   - resolveSocialLogin: returning-login, email-link, invite gate, anti-takeover
 *
 * Run: npx vitest run test/social-auth.test.mjs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { Store } from '../src/lib/store.mjs';
import { verifyGoogleIdToken, verifyAppleIdToken, resolveSocialLogin, canUnlinkIdentity } from '../src/lib/oauth.mjs';

const store = Store();

const GOOGLE_AUD = 'test-web.apps.googleusercontent.com';
const APPLE_AUD = 'ai.gedo.app';

let privateKey;
let googleJwks;
let appleJwks;

// Mint a signed ID token for `iss` with the given claims.
async function mintToken(iss, claims) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer(iss)
    .sign(privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const pubJwk = { ...(await exportJWK(kp.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  // Both providers share the same local key here — the verifier still enforces
  // the correct issuer per provider, which is what we're testing.
  googleJwks = createLocalJWKSet({ keys: [pubJwk] });
  appleJwks = createLocalJWKSet({ keys: [pubJwk] });
});

const createdUsers = [];
afterAll(() => { for (const id of createdUsers) store.wipeUser(id); });

describe('verifyGoogleIdToken', () => {
  it('accepts a well-formed Google token and normalizes the identity', async () => {
    const token = await mintToken('https://accounts.google.com', {
      sub: 'g-sub-1', aud: GOOGLE_AUD,
      email: 'Alice@Gmail.com', email_verified: true, name: 'Alice', picture: 'https://x/y.png',
    });
    const id = await verifyGoogleIdToken(token, { jwks: googleJwks, audiences: [GOOGLE_AUD] });
    expect(id).toMatchObject({
      provider: 'google', subject: 'g-sub-1',
      email: 'alice@gmail.com', email_verified: true, name: 'Alice',
    });
  });

  it('coerces string email_verified="true"', async () => {
    const token = await mintToken('https://accounts.google.com', {
      sub: 'g-sub-str', aud: GOOGLE_AUD, email: 'b@gmail.com', email_verified: 'true',
    });
    const id = await verifyGoogleIdToken(token, { jwks: googleJwks, audiences: [GOOGLE_AUD] });
    expect(id.email_verified).toBe(true);
  });

  it('rejects a wrong audience', async () => {
    const token = await mintToken('https://accounts.google.com', { sub: 'x', aud: 'someone-else', email: 'c@gmail.com', email_verified: true });
    await expect(verifyGoogleIdToken(token, { jwks: googleJwks, audiences: [GOOGLE_AUD] }))
      .rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('rejects a wrong issuer (Apple token on Google endpoint)', async () => {
    const token = await mintToken('https://appleid.apple.com', { sub: 'x', aud: GOOGLE_AUD, email: 'c@gmail.com', email_verified: true });
    await expect(verifyGoogleIdToken(token, { jwks: googleJwks, audiences: [GOOGLE_AUD] }))
      .rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('rejects a tampered signature', async () => {
    const token = await mintToken('https://accounts.google.com', { sub: 'x', aud: GOOGLE_AUD, email: 'c@gmail.com', email_verified: true });
    const tampered = token.slice(0, -3) + (token.endsWith('AAA') ? 'BBB' : 'AAA');
    await expect(verifyGoogleIdToken(tampered, { jwks: googleJwks, audiences: [GOOGLE_AUD] }))
      .rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('throws provider_not_configured when no audiences are set', async () => {
    const token = await mintToken('https://accounts.google.com', { sub: 'x', aud: GOOGLE_AUD, email: 'c@gmail.com', email_verified: true });
    await expect(verifyGoogleIdToken(token, { jwks: googleJwks, audiences: [] }))
      .rejects.toMatchObject({ code: 'provider_not_configured' });
  });
});

describe('verifyAppleIdToken', () => {
  it('accepts a well-formed Apple token; name is never from the token', async () => {
    const token = await mintToken('https://appleid.apple.com', {
      sub: 'a-sub-1', aud: APPLE_AUD, email: 'user@privaterelay.appleid.com', email_verified: 'true',
    });
    const id = await verifyAppleIdToken(token, { jwks: appleJwks, audiences: [APPLE_AUD] });
    expect(id).toMatchObject({ provider: 'apple', subject: 'a-sub-1', email: 'user@privaterelay.appleid.com', email_verified: true, name: null });
  });
});

describe('resolveSocialLogin', () => {
  const cfg = { store, requireInvite: true, staticCodes: ['EVERGREEN'] };

  it('creates a brand-new user with a valid static invite code and links the identity', () => {
    const verified = { provider: 'google', subject: 'new-1', email: 'newuser1@example.com', email_verified: true, name: 'New One' };
    const r = resolveSocialLogin({ ...cfg, verified, inviteCode: 'EVERGREEN' });
    expect(r.isNew).toBe(true);
    expect(r.user.email).toBe('newuser1@example.com');
    expect(r.user.password_hash).toBeNull();
    expect(r.user.email_verified).toBe(true);
    expect(r.user.display_name).toBe('New One');
    createdUsers.push(r.user.id);
    // identity persisted → resolvable next time
    expect(store.getUserByProviderSubject('google', 'new-1')?.id).toBe(r.user.id);
  });

  it('blocks a brand-new user without an invite code', () => {
    const verified = { provider: 'google', subject: 'new-2', email: 'newuser2@example.com', email_verified: true };
    const r = resolveSocialLogin({ ...cfg, verified, inviteCode: '' });
    expect(r).toMatchObject({ error: 'invite_required', status: 403 });
    expect(store.getUserByEmail('newuser2@example.com')).toBeNull();
  });

  it('logs a RETURNING identity straight in — no invite needed', () => {
    const verified = { provider: 'google', subject: 'new-1', email: 'newuser1@example.com', email_verified: true };
    const r = resolveSocialLogin({ ...cfg, verified, inviteCode: '' });
    expect(r.isNew).toBe(false);
    expect(r.user.email).toBe('newuser1@example.com');
  });

  it('links a verified-email match onto an existing password account — no invite needed', () => {
    const pw = store.createUser({ email: 'existing@example.com', password_hash: { algo: 'scrypt', salt: 'x', hash: 'y' } });
    createdUsers.push(pw.id);
    const verified = { provider: 'apple', subject: 'apple-link-1', email: 'existing@example.com', email_verified: true };
    const r = resolveSocialLogin({ ...cfg, verified, inviteCode: '' });
    expect(r.isNew).toBe(false);
    expect(r.user.id).toBe(pw.id);
    expect(store.getUserByProviderSubject('apple', 'apple-link-1')?.id).toBe(pw.id);
  });

  it('refuses to auto-link an existing account when the provider email is UNverified (anti-takeover)', () => {
    const pw = store.createUser({ email: 'victim@example.com', password_hash: { algo: 'scrypt', salt: 'x', hash: 'y' } });
    createdUsers.push(pw.id);
    const verified = { provider: 'google', subject: 'attacker-sub', email: 'victim@example.com', email_verified: false };
    const r = resolveSocialLogin({ ...cfg, verified, inviteCode: 'EVERGREEN' });
    expect(r).toMatchObject({ error: 'email_exists', status: 409 });
    expect(store.getUserByProviderSubject('google', 'attacker-sub')).toBeNull();
  });

  it('bypasses the invite gate entirely when requireInvite=false', () => {
    const verified = { provider: 'google', subject: 'noinvite-1', email: 'noinvite1@example.com', email_verified: true };
    const r = resolveSocialLogin({ store, requireInvite: false, staticCodes: [], verified, inviteCode: '' });
    expect(r.isNew).toBe(true);
    createdUsers.push(r.user.id);
  });

  it('rejects a token with no email on a new account (400, no invite burned)', () => {
    const verified = { provider: 'apple', subject: 'no-email-1', email: null, email_verified: false };
    const r = resolveSocialLogin({ ...cfg, verified, inviteCode: 'EVERGREEN' });
    expect(r).toMatchObject({ error: 'email_required', status: 400 });
  });
});

// Linking a provider onto the already-signed-in account (settings → "bind Google/Apple").
describe('store.upsertAuthIdentity / deleteAuthIdentity round-trip', () => {
  it('links then unlinks a provider, scoped to the owning user', () => {
    const u = store.createUser({ email: 'binder@example.com', password_hash: { algo: 'scrypt', salt: 's', hash: 'h' } });
    createdUsers.push(u.id);
    const row = store.upsertAuthIdentity({ user_id: u.id, provider: 'google', provider_subject: 'bind-sub-1', email: 'binder@example.com' });
    expect(store.listAuthIdentities(u.id).some((i) => i.id === row.id)).toBe(true);
    // A stranger can't delete it; the owner can.
    expect(store.deleteAuthIdentity('someone-else', row.id).ok).toBe(false);
    expect(store.deleteAuthIdentity(u.id, row.id).ok).toBe(true);
    expect(store.listAuthIdentities(u.id).some((i) => i.id === row.id)).toBe(false);
  });

  it('upsert is idempotent for the same provider+subject', () => {
    const u = store.createUser({ email: 'idem@example.com', password_hash: { algo: 'scrypt', salt: 's', hash: 'h' } });
    createdUsers.push(u.id);
    const a = store.upsertAuthIdentity({ user_id: u.id, provider: 'apple', provider_subject: 'idem-sub', email: 'idem@example.com' });
    const b = store.upsertAuthIdentity({ user_id: u.id, provider: 'apple', provider_subject: 'idem-sub', email: 'idem@example.com' });
    expect(a.id).toBe(b.id);
    expect(store.listAuthIdentities(u.id).filter((i) => i.provider === 'apple').length).toBe(1);
  });
});

describe('canUnlinkIdentity guard', () => {
  const pw = { id: 'p1', provider: 'password' };
  const g = { id: 'g1', provider: 'google' };
  const a = { id: 'a1', provider: 'apple' };

  it('404s an unknown identity', () => {
    expect(canUnlinkIdentity({ identities: [pw, g], targetId: 'nope', hasPassword: true }))
      .toMatchObject({ ok: false, error: 'not_found' });
  });

  it('refuses to remove the password method via this path', () => {
    expect(canUnlinkIdentity({ identities: [pw, g], targetId: 'p1', hasPassword: true }))
      .toMatchObject({ ok: false, error: 'cannot_unlink_password' });
  });

  it('allows removing a social provider when a password backs the account', () => {
    expect(canUnlinkIdentity({ identities: [pw, g], targetId: 'g1', hasPassword: true }))
      .toMatchObject({ ok: true });
  });

  it('allows removing one social provider when another remains', () => {
    expect(canUnlinkIdentity({ identities: [g, a], targetId: 'g1', hasPassword: false }))
      .toMatchObject({ ok: true });
  });

  it('blocks removing the last usable method on a password-less (social-only) account', () => {
    expect(canUnlinkIdentity({ identities: [g], targetId: 'g1', hasPassword: false }))
      .toMatchObject({ ok: false, error: 'last_login_method' });
    // A lingering password row with no real hash must NOT count as usable.
    expect(canUnlinkIdentity({ identities: [pw, g], targetId: 'g1', hasPassword: false }))
      .toMatchObject({ ok: false, error: 'last_login_method' });
  });
});
