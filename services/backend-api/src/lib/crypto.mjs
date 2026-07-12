import crypto from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function randomId() {
  return crypto.randomUUID();
}

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const derivedKey = crypto.scryptSync(password, salt, 32);
  return {
    algo: 'scrypt',
    salt: salt.toString('base64'),
    hash: derivedKey.toString('base64'),
  };
}

export function verifyPassword(password, stored) {
  if (!stored || stored.algo !== 'scrypt') return false;
  const salt = Buffer.from(stored.salt, 'base64');
  const derivedKey = crypto.scryptSync(password, salt, 32);
  const a = Buffer.from(stored.hash, 'base64');
  const b = Buffer.from(derivedKey.toString('base64'), 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── PAT（个人访问令牌，能力开放 E2）────────────────────────────────────────
// 高熵随机串仅存 sha256（无需加盐慢哈希）；明文只在创建响应回显一次。

export function generatePatToken() {
  return `gedo_pat_${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashPatToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

// ── Opaque single-use tokens (email verify / password reset)──────────────────
// High-entropy random string; only the sha256 is stored, plaintext lives solely
// in the emailed link. Reuse hashToken for lookup.

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlJson(obj) {
  return base64url(Buffer.from(JSON.stringify(obj)));
}

export function signJwt(payload, secret, { expiresInSec = 60 * 60 * 24 * 7 } = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };
  const h = base64urlJson(header);
  const p = base64urlJson(fullPayload);
  const input = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', secret).update(input).digest();
  return `${input}.${base64url(sig)}`;
}

export function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'bad_token' };
  const [h, p, s] = parts;
  const input = `${h}.${p}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(input)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  if (expected !== s) return { ok: false, error: 'bad_signature' };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return { ok: false, error: 'bad_payload' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return { ok: false, error: 'expired' };
  return { ok: true, payload };
}























