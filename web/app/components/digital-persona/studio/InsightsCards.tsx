'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useTranslations } from 'next-intl';
import type { PersonaStats } from '@/lib/apiClient';
import { SectionTitle } from './shared';

export function InsightsCards({ stats }: { stats: PersonaStats | null }) {
  const t = useTranslations('app');
  const matchRate = stats && stats.sessions.total > 0
    ? Math.round((stats.sessions.matched / stats.sessions.total) * 100)
    : 0;

  const tiles: { label: string; value: string | number; sub?: string; accent?: boolean }[] = [
    { label: t('avatar.insights.views'), value: stats?.view_count ?? 0, sub: 'PV' },
    {
      label: t('avatar.insights.sessions'),
      value: stats?.sessions.total ?? 0,
      sub: stats ? t('avatar.insights.sessionsSub', { matched: stats.sessions.matched, anon: stats.sessions.anonymous }) : undefined,
    },
    { label: t('avatar.insights.matchRate'), value: `${matchRate}%`, sub: t('avatar.insights.matchRateSub') },
    { label: t('avatar.insights.avgMsgs'), value: stats?.messages.avg_per_session ?? 0, sub: t('avatar.insights.avgMsgsSub', { n: stats?.messages.total ?? 0 }) },
    {
      label: t('avatar.insights.approved'),
      value: stats?.inbox.approved ?? 0,
      sub: stats ? t('avatar.insights.approvedSub', { n: stats.inbox.pending }) : undefined,
      accent: true,
    },
  ];

  const topQ = stats?.top_questions ?? [];
  const maxCount = topQ.reduce((m, q) => Math.max(m, q.count), 0) || 1;

  return (
    <section>
      <SectionTitle title={t('avatar.insights.title')} mono="INSIGHTS" />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tiles.map(tile => (
          <div
            key={tile.label}
            style={{ flex: '1 1 120px', background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 12, padding: '12px 14px' }}
          >
            <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>{tile.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: tile.accent ? 'var(--g-dim-persona)' : 'var(--g-text)', marginTop: 4, fontFeatureSettings: '"tnum"' }}>
              {tile.value}
            </div>
            {tile.sub && <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', marginTop: 3 }}>{tile.sub}</div>}
          </div>
        ))}
      </div>

      {topQ.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', marginBottom: 8 }}>{t('avatar.insights.topQuestionsTitle')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {topQ.map((q, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    flex: 1, minWidth: 0, position: 'relative',
                    background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)',
                    borderRadius: 8, padding: '6px 10px', overflow: 'hidden',
                  }}
                >
                  <div style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: `${(q.count / maxCount) * 100}%`, background: 'color-mix(in oklch, var(--g-dim-insight) 16%, transparent)' }} />
                  <span style={{ position: 'relative', fontSize: fontVars.sm, color: 'var(--g-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                    {q.q}
                  </span>
                </div>
                <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', flexShrink: 0, minWidth: 16, textAlign: 'right' }}>{q.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
