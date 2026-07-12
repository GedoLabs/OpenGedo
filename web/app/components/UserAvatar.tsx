'use client';

import type { CSSProperties } from 'react';
import type { MembershipTier } from '@/lib/membershipDisplay';
import { resolveAvatarUrl } from '@/app/components/digital-persona/PersonaAvatar';

// Free tier stays a plain initial circle (no badge, no ring) — tier is signaled
// by a colored/gradient ring on paid plans instead of a blunt "Free" text tag
// plastered next to every avatar in the app.
const AVATAR_PALETTE = [
  'var(--g-dim-exec)',
  'var(--g-dim-goal)',
  'var(--g-dim-insight)',
  'var(--g-dim-persona)',
  'var(--g-dim-memory)',
];

function paletteIndex(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

export function UserAvatar({
  seed,
  displayName,
  email,
  avatarUrl,
  tier,
  size = 40,
  style,
}: {
  /** Stable id (e.g. user.id) to derive the deterministic fill color from — not email, which can change. */
  seed: string;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  tier: MembershipTier;
  size?: number;
  style?: CSSProperties;
}) {
  const initial = (displayName?.trim() || email || 'G').slice(0, 1).toUpperCase();
  const fill = AVATAR_PALETTE[paletteIndex(seed || email || 'G', AVATAR_PALETTE.length)];
  // avatar_url from the backend is host-relative (/public/v1/uploads/...) —
  // resolve it against the API origin, same as the digital-persona avatar.
  const resolvedUrl = resolveAvatarUrl(avatarUrl);

  const ring =
    tier === 'ultra'
      ? { pad: 2, bg: 'linear-gradient(135deg, var(--g-dim-memory), var(--g-dim-goal), var(--g-dim-exec))', glow: '0 0 0 3px color-mix(in oklch, var(--g-dim-memory) 18%, transparent)' }
      : tier === 'pro'
        ? { pad: 2, bg: 'var(--g-dim-exec)', glow: '0 0 0 2px color-mix(in oklch, var(--g-dim-exec) 14%, transparent)' }
        : { pad: 0, bg: 'transparent', glow: 'none' };

  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        padding: ring.pad, background: ring.bg, boxShadow: ring.glow,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...style,
      }}
    >
      <div
        style={{
          width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
          background: resolvedUrl ? 'var(--g-surface-2)' : fill,
          border: tier === 'free' ? '1px solid var(--g-border-hi)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 700, fontSize: Math.round(size * 0.4),
          fontFamily: 'var(--g-font-sans)',
        }}
      >
        {resolvedUrl
          // eslint-disable-next-line @next/next/no-img-element -- small dynamic user upload, not a next/image candidate (matches PersonaAvatar's own pattern)
          ? <img src={resolvedUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initial}
      </div>
    </div>
  );
}
