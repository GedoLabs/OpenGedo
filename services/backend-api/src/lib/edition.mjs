/**
 * Edition switch: oss (self-hosted) vs cloud (official SaaS).
 *
 * STATUS (2026-07): Open-source split DEFERRED until post-beta (open registration).
 * Production and invite-only beta MUST use default cloud — do not set GEDO_EDITION=oss.
 *
 *   GEDO_EDITION=oss    — reserved for future self-hosted builds (not in use)
 *   GEDO_EDITION=cloud  — default; Stripe, waitlist, tier limits
 */

/** @typedef {'oss' | 'cloud'} GedoEdition */

/** @returns {GedoEdition} */
export function getEdition() {
  const v = String(process.env.GEDO_EDITION || 'cloud').toLowerCase();
  return v === 'oss' ? 'oss' : 'cloud';
}

export function isOSS() {
  return getEdition() === 'oss';
}

export function isCloud() {
  return getEdition() === 'cloud';
}

/** Routes/endpoints only registered in cloud edition. */
export function isCloudOnlyRoute(pathname) {
  if (!pathname) return false;
  if (pathname === '/v1/waitlist') return true;
  if (pathname.startsWith('/v1/billing/')) return true;
  return false;
}
