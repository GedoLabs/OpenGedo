'use client';

// 自我认知报告入口卡（画像页）。自加载状态、自带弹窗：
// locked（了解度不足）/ ready（可生成）/ draft（继续答题）/ report（查看+刷新）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import type { InsightState } from '@/lib/apiClient';
import { primaryBtnStyle } from '@/app/components/gedo/primitives';
import { fontVars } from '@/app/components/gedo/typography';
import { IconSpark } from '@/app/components/gedo/icons';
import { SelfInsightModal } from './SelfInsightModal';

const BIG5_ORDER = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;

export function SelfInsightCard() {
  const { api } = useAuth();
  const t = useTranslations('app.memory.insight');
  const locale = useLocale();

  const [state, setState] = useState<InsightState | null>(null);
  const [open, setOpen] = useState(false);
  const [autoStart, setAutoStart] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    api.getInsightState().then(s => { if (!cancelled) setState(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api]);
  useEffect(() => load(), [load]);

  const openModal = (start: boolean) => { setAutoStart(start); setOpen(true); };

  const date = useMemo(() => (
    state?.latest ? new Date(state.latest.finalized_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : ''
  ), [state, locale]);

  if (!state) return null;
  const { eligibility, latest, cooldown, draft } = state;

  return (
    <>
      {!eligibility.unlocked ? (
        <section style={{ ...cardStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IconSpark size={14} style={{ color: 'var(--g-text-faint)' }} />
            <span style={{ fontSize: fontVars.base, fontWeight: 600 }}>{t('title')}</span>
            <span style={{ marginLeft: 'auto', fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
              {t('lockedProgress', { p: eligibility.percent, r: eligibility.required_percent })}
            </span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--g-surface-2)', overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ width: `${Math.min(100, (eligibility.percent / Math.max(1, eligibility.required_percent)) * 100)}%`, height: '100%', background: 'var(--g-dim-insight)', opacity: 0.6 }} />
          </div>
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.6 }}>{t('lockedHint')}</p>
        </section>
      ) : latest ? (
        <section style={{ ...cardStyle, cursor: 'pointer' }} onClick={() => openModal(false)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IconSpark size={14} style={{ color: 'var(--g-dim-insight)' }} />
            <span style={{ fontSize: fontVars.base, fontWeight: 600 }}>{t('title')}</span>
            <span style={{ marginLeft: 'auto', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('updated', { v: latest.version, date })}</span>
          </div>
          <div style={{ fontSize: fontVars.lead, fontWeight: 600, lineHeight: 1.4 }}>{latest.headline}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 22 }}>
              {BIG5_ORDER.map(k => {
                const s = latest.big5?.[k]?.score ?? 0;
                return <div key={k} style={{ width: 8, height: 5 + 16 * s, borderRadius: 3, background: 'var(--g-dim-insight)', opacity: 0.75 }} />;
              })}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: fontVars.sm, color: 'var(--g-accent)', fontWeight: 600 }}>
              {draft.active ? t('continueDraft', { n: draft.questions_count })
                : cooldown.active ? t('cooldown', { n: cooldown.days_left })
                : `${t('view')} →`}
            </span>
          </div>
        </section>
      ) : (
        <section style={{ ...cardStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <IconSpark size={14} style={{ color: 'var(--g-dim-insight)' }} />
            <span style={{ fontSize: fontVars.base, fontWeight: 600 }}>{t('title')}</span>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6 }}>{t('readyBody')}</p>
          <button type="button" style={primaryBtnStyle()} onClick={() => openModal(true)}>
            {draft.active ? t('continueDraft', { n: draft.questions_count }) : t('generate')}
          </button>
        </section>
      )}

      <SelfInsightModal
        open={open}
        onClose={() => setOpen(false)}
        state={state}
        autoStart={autoStart || (open && !latest)}
        onChanged={load}
      />
    </>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', borderRadius: 16, padding: '16px 20px',
};
