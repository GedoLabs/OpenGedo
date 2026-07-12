import { ImageResponse } from 'next/og';
import { resolveApiBaseUrl } from '@/lib/apiClient';

// Node runtime so we can reach the backend (localhost in dev) for the profile.
export const runtime = 'nodejs';
export const alt = 'GEDO 数字分身';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const THEME_HEX: Record<string, [string, string]> = {
  emerald: ['#10b981', '#14b8a6'],
  blue: ['#3b82f6', '#06b6d4'],
  violet: ['#8b5cf6', '#d946ef'],
  rose: ['#f43f5e', '#ec4899'],
  amber: ['#f59e0b', '#f97316'],
};

// Dynamically fetch just the glyphs we render (so CJK display names work in
// Satori without bundling a multi-MB font). Best-effort: returns null offline.
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const api = `https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@600&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(api, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!url) return null;
    return await (await fetch(url)).arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let profile: { display_name?: string; tagline?: string; theme?: string } | null = null;
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/public/v1/persona/${slug}`, { cache: 'no-store' });
    if (res.ok) profile = await res.json();
  } catch {
    /* fall back to brand defaults */
  }

  const name = (profile?.display_name || 'GEDO').trim();
  const tagline = profile?.tagline || '';
  const [c1, c2] = THEME_HEX[profile?.theme || 'emerald'] || THEME_HEX.emerald;
  const initial = (name[0] || 'G').toUpperCase();

  const fontData = await loadFont(`${name}${tagline}的智能助理由 GEDO 数字分身驱动`);

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%', width: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', background: '#101116', color: '#fff',
          fontFamily: fontData ? 'Noto Sans SC' : 'sans-serif',
        }}
      >
        <div
          style={{
            width: 176, height: 176, borderRadius: 9999, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: `linear-gradient(135deg, ${c1}, ${c2})`,
            fontSize: 92, fontWeight: 600,
          }}
        >
          {initial}
        </div>
        <div style={{ marginTop: 40, fontSize: 60, fontWeight: 600 }}>{`${name} 的智能助理`}</div>
        {tagline ? <div style={{ marginTop: 18, fontSize: 30, color: '#9aa3b2', maxWidth: 900, textAlign: 'center' }}>{tagline}</div> : null}
        <div style={{ marginTop: 46, fontSize: 24, color: '#6b7280', letterSpacing: 2 }}>由 GEDO 数字分身驱动</div>
      </div>
    ),
    {
      ...size,
      fonts: fontData ? [{ name: 'Noto Sans SC', data: fontData, weight: 600 as const, style: 'normal' as const }] : undefined,
    },
  );
}
