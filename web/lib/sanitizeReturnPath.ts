/**
 * Allow only same-origin relative paths to prevent open redirects.
 * Returns null if unsafe or empty.
 */
export function sanitizeReturnPath(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  return trimmed;
}
