import type { NextRequest } from 'next/server';

/**
 * Resolve backend base URL for server-side /v1/* calls (same rules as ApiClient).
 */
export function resolveBackendApiBase(req: NextRequest): string {
  const env =
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    process.env.API_INTERNAL_BASE_URL?.trim() ||
    process.env.BACKEND_ORIGIN?.trim();
  if (env) return env.replace(/\/$/, '');

  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:8787';
  }

  const origin = req.headers.get('origin')?.trim();
  if (origin?.startsWith('http')) {
    return `${origin.replace(/\/$/, '')}/api`;
  }

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  if (host) {
    return `${proto}://${host.replace(/\/$/, '')}/api`;
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    return `${site.replace(/\/$/, '')}/api`;
  }

  return 'http://localhost:8787';
}

/**
 * Validates Authorization: Bearer & loads the current user from GET /v1/me.
 */
const DEV_BEARER_TOKEN = 'dev-token-gedo-v2';

export async function getSessionUser(
  req: NextRequest
): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  if (
    process.env.NODE_ENV === 'development' &&
    token === DEV_BEARER_TOKEN
  ) {
    const email =
      process.env.NEXT_PUBLIC_DEV_MOCK_EMAIL?.trim() || 'dev-local@localhost';
    return { id: 'dev-user-001', email };
  }

  const base = resolveBackendApiBase(req);
  try {
    const res = await fetch(`${base}/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: unknown; email?: unknown };
    const id = typeof data.id === 'string' ? data.id : '';
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    if (!id || !email || !email.includes('@')) return null;
    return { id, email };
  } catch (e) {
    console.error('[authServer] /v1/me failed:', e);
    return null;
  }
}
