/**
 * Edition: oss (self-hosted app) vs cloud (official site + SaaS).
 *
 * Open-core 双仓制：开源仓 Gedolabs/gedo 与闭源仓共享本文件，默认 cloud；
 * 自托管构建经 docker compose 注入 NEXT_PUBLIC_GEDO_EDITION=oss。
 */

export type GedoEdition = 'oss' | 'cloud';

export function getEdition(): GedoEdition {
  const v = String(process.env.NEXT_PUBLIC_GEDO_EDITION || 'cloud').toLowerCase();
  return v === 'oss' ? 'oss' : 'cloud';
}

export function isOSS(): boolean {
  return getEdition() === 'oss';
}

export function isCloud(): boolean {
  return getEdition() === 'cloud';
}

const LOCALES = ['zh', 'ja'] as const;

/** Marketing / site-only path segments (without locale prefix). */
export const SITE_ONLY_SEGMENTS = new Set([
  'about',
  'features',
  'why-gedo',
  'pricing',
  'blog',
  'changelog',
  'help',
  'security',
  'sim',
]);

/**
 * Strip optional locale prefix and return { locale, segments }.
 * English uses as-needed routing (no /en prefix).
 */
export function parsePathname(pathname: string): { locale: string | null; segments: string[] } {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { locale: null, segments: [] };
  const maybeLocale = parts[0];
  if (LOCALES.includes(maybeLocale as (typeof LOCALES)[number])) {
    return { locale: maybeLocale, segments: parts.slice(1) };
  }
  return { locale: null, segments: parts };
}

/** True when the path is a marketing/site route (blocked in OSS app builds). */
export function isSiteOnlyPath(pathname: string): boolean {
  const { segments } = parsePathname(pathname);
  if (segments.length === 0) return true; // landing /
  if (segments.length === 1 && SITE_ONLY_SEGMENTS.has(segments[0])) return true;
  return false;
}

/** True when the path belongs to the product app (allowed in OSS). */
export function isAppPath(pathname: string): boolean {
  const { segments } = parsePathname(pathname);
  if (segments.length === 0) return false;
  const head = segments[0];
  return head === 'app' || head === 'auth' || head === 'p' || head === 'embed';
}

/** Default redirect for OSS builds hitting site-only URLs. */
export const OSS_DEFAULT_PATH = '/auth/login';
