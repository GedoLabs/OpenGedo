'use client';

// Minimal full-bleed chat for embedding the digital persona in a third-party
// site via <iframe>. Reuses PublicChat (self-bootstraps an anonymous session
// for public/hybrid personas). For passcode-gated personas PublicChat shows a
// hint to open the full /p/[slug] page.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { getPathname } from '@/i18n/navigation';
import { getPublicPersona, type PublicPersonaProfile } from '@/lib/apiClient';
import { PersonaAvatar } from '@/app/components/digital-persona/PersonaAvatar';
import { PublicChat } from '@/app/components/digital-persona/PublicChat';
import { fontVars } from '@/app/components/gedo/typography';

export default function EmbedPage() {
  const params = useParams();
  const locale = useLocale();
  const slug = Array.isArray(params?.slug) ? params.slug[0] : (params?.slug as string | undefined);
  const [profile, setProfile] = useState<PublicPersonaProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    getPublicPersona(slug)
      .then(p => { if (!cancelled) { setProfile(p); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [slug]);

  if (state !== 'ready' || !profile) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--g-bg)', color: 'var(--g-text-faint)', fontSize: fontVars.sm }}>
        {state === 'error' ? '找不到这个数字人' : '正在加载…'}
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--g-bg)', color: 'var(--g-text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--g-border)', flexShrink: 0 }}>
        <PersonaAvatar avatarKind={profile.avatar_kind} avatarUrl={profile.avatar_url} presetId={profile.preset_id} theme={profile.theme} size={34} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: fontVars.sm, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.display_name} 的智能助理</div>
          {profile.tagline && <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.tagline}</div>}
        </div>
        <a
          href={getPathname({ locale, href: `/p/${profile.slug}` })}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', textDecoration: 'none', fontFamily: 'var(--g-font-mono)', flexShrink: 0 }}
        >
          GEDO ↗
        </a>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <PublicChat profile={profile} />
      </div>
    </div>
  );
}
