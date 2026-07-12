'use client';

import { useTranslations } from 'next-intl';
import { fontVars } from '@/app/components/gedo/typography';

export interface UsageSlot {
  used: number;
  limit: number | null;
  kind?: 'percent' | 'status';
  percent?: number | null;
  level?: 'normal' | 'high' | 'near_limit' | null;
}

interface UsageStatusBadgeProps {
  tier: 'free' | 'pro' | 'ultra';
  smart?: UsageSlot | null;
  visitor?: UsageSlot | null;
  loading?: boolean;
}

export function UsageStatusBadge({ tier, smart, visitor, loading }: UsageStatusBadgeProps) {
  const t = useTranslations('app.settings.usage');

  if (loading) {
    return (
      <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('loading')}</p>
    );
  }

  if (!smart) {
    return (
      <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('unavailable')}</p>
    );
  }

  const level = smart.level || 'normal';
  const levelColor =
    level === 'near_limit' ? 'oklch(0.75 0.14 80)'
      : level === 'high' ? 'oklch(0.72 0.12 55)'
        : 'var(--g-accent)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tier === 'free' && smart.limit != null && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('smartUsage')}</span>
            <span style={{ fontSize: fontVars.sm, color: levelColor, fontWeight: 600 }}>
              {smart.percent ?? 0}%
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: 'var(--g-surface-2)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, smart.percent ?? 0)}%`,
                height: '100%',
                background: levelColor,
                borderRadius: 999,
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}

      {(tier === 'pro' || tier === 'ultra') && (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: levelColor }}>
          {t(`level.${level}`)}
        </p>
      )}

      {visitor?.limit != null && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('visitorUsage')}</span>
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', fontWeight: 600 }}>
              {visitor.percent ?? 0}%
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: 'var(--g-surface-2)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, visitor.percent ?? 0)}%`,
                height: '100%',
                background: 'var(--g-dim-insight)',
                borderRadius: 999,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
