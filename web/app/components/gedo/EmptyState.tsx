'use client';

import { fontVars, text } from './typography';

// Chat-first empty state shared by 智忆 / 智察 / 目标 / 执行.
// Principle: state the page's value in one line, then send the user back to
// the Companion conversation. All copy stays minimal. Tokens only (--g-*).

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { IconArrow } from './icons';

export function EmptyState({
  icon,
  title,
  hint,
  ctaLabel,
  ctaHref = '/app/companion',
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  ctaLabel?: string;
  ctaHref?: string;
  compact?: boolean;
}) {
  const t = useTranslations('app');
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 10,
        padding: compact ? '32px 20px' : '64px 24px',
        border: '1px dashed var(--g-border)',
        borderRadius: 16,
        background: 'var(--g-bg-raised)',
      }}
    >
      {icon && (
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--g-accent)',
            background: 'var(--g-accent-soft)',
            border: '1px solid var(--g-accent-line)',
            marginBottom: 4,
          }}
        >
          {icon}
        </div>
      )}
      <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)' }}>{title}</h3>
      {hint && (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.6, maxWidth: 320 }}>{hint}</p>
      )}
      <Link
        href={ctaHref}
        style={{
          marginTop: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '9px 18px',
          borderRadius: 999,
          background: 'var(--g-accent)',
          color: 'var(--g-accent-ink)',
          fontSize: fontVars.sm,
          fontWeight: 500,
          textDecoration: 'none',
          fontFamily: 'var(--g-font-sans)',
        }}
      >
        {ctaLabel ?? t('common.chatWithCompanion')}
        <IconArrow size={13} />
      </Link>
    </div>
  );
}
