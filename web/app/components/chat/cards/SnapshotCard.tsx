'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { SnapshotCard } from '@/lib/genui/schemas';

const TrendIcon = ({ trend }: { trend?: 'up' | 'down' | 'flat' }) => {
  if (trend === 'up')   return <TrendingUp  style={{ width: 12, height: 12, color: 'var(--g-accent)' }} />;
  if (trend === 'down') return <TrendingDown style={{ width: 12, height: 12, color: 'var(--g-danger)' }} />;
  if (trend === 'flat') return <Minus       style={{ width: 12, height: 12, color: 'var(--g-text-muted)' }} />;
  return null;
};

export default function SnapshotCard({ card }: { card: SnapshotCard }) {
  const t = useTranslations('app');
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 380,
        padding: 14,
        borderRadius: 12,
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: 'var(--g-font-sans)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: fontVars.sm,
            fontWeight: 500,
            color: 'var(--g-text-faint)',
            fontFamily: 'var(--g-font-mono)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {card.title ?? t('companion.cards.snapshot.fallbackTitle', { period: card.period })}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {card.stats.map((s, i) => (
          <div
            key={i}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--g-bg-raised)',
              border: '1px solid var(--g-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--g-text)', lineHeight: 1 }}>
                {s.value}
                {s.unit && <span style={{ fontSize: fontVars.sm, fontWeight: 400, color: 'var(--g-text-muted)', marginLeft: 2 }}>{s.unit}</span>}
              </span>
              <TrendIcon trend={s.trend} />
            </div>
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {card.summary && (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.55, borderTop: '1px solid var(--g-border)', paddingTop: 10 }}>
          {card.summary}
        </p>
      )}
    </div>
  );
}
