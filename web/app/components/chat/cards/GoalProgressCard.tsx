'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useTranslations } from 'next-intl';
import { CheckCircle2, AlertTriangle, XCircle, TrendingUp } from 'lucide-react';
import type { GoalProgressCard, GoalProgressItem } from '@/lib/genui/schemas';

const STATUS_CONFIG: Record<GoalProgressItem['status'], {
  color: string; Icon: React.ElementType;
}> = {
  on_track:  { color: 'var(--g-accent)',     Icon: TrendingUp },
  at_risk:   { color: 'var(--g-dim-goal)',   Icon: AlertTriangle },
  behind:    { color: 'var(--g-danger)',     Icon: XCircle },
  completed: { color: 'var(--g-dim-memory)', Icon: CheckCircle2 },
};

// LLM 偶发输出枚举外的 status（如 "active"/"pending"）——未知值兜底为
// on_track 语义，绝不能让一张卡崩掉整个应用。
const STATUS_ALIAS: Record<string, GoalProgressItem['status']> = {
  active: 'on_track', in_progress: 'on_track', pending: 'at_risk', done: 'completed',
};

function GoalItem({ goal }: { goal: GoalProgressItem }) {
  const t = useTranslations('app');
  const status = STATUS_CONFIG[goal.status] ? goal.status : (STATUS_ALIAS[goal.status as string] ?? 'on_track');
  const { color, Icon } = STATUS_CONFIG[status];
  const label = t('companion.cards.goalProgress.status', { status });
  const pct = Math.max(0, Math.min(100, goal.progress));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {goal.title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: fontVars.sm, color }}>
          <Icon style={{ width: 12, height: 12 }} />
          {label}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--g-surface-2)', overflow: 'hidden' }}>
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 999,
              background: 'linear-gradient(to right, var(--g-dim-insight), var(--g-accent))',
              transition: 'width 0.5s ease',
            }}
          />
        </div>
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)', width: 32, textAlign: 'right', fontFamily: 'var(--g-font-mono)' }}>
          {pct}%
        </span>
      </div>

      {goal.next_task && (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t('companion.cards.goalProgress.nextStep', { task: goal.next_task })}
        </p>
      )}
    </div>
  );
}

export default function GoalProgressCard({ card }: { card: GoalProgressCard }) {
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
      <div
        style={{
          fontSize: fontVars.sm,
          fontWeight: 500,
          color: 'var(--g-text-faint)',
          fontFamily: 'var(--g-font-mono)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {card.title ?? t('companion.cards.goalProgress.fallbackTitle')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(card.goals ?? []).map((g, i) => (
          <div
            key={i}
            style={{
              paddingTop: i > 0 ? 12 : 0,
              borderTop: i > 0 ? '1px solid var(--g-border)' : 'none',
            }}
          >
            <GoalItem goal={g} />
          </div>
        ))}
      </div>
    </div>
  );
}
