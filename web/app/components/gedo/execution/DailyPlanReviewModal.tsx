'use client';

import { fontVars, text } from '../typography';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { Modal } from '@/app/components/gedo/Modal';
import { primaryBtnStyle, ghostBtnStyle, Pill } from '@/app/components/gedo/primitives';
import { IconCheck, IconSpark, IconBolt } from '@/app/components/gedo/icons';

type PlanTask = {
  title: string;
  why?: string;
  energy?: 'low' | 'medium' | 'high';
};

type PlanResult = {
  plan: {
    greeting: string;
    opener: string;
    tasks: PlanTask[];
    care_message: string | null;
  };
  source: 'llm' | 'fallback';
};

/**
 * Daily plan review modal — calls api.runDailyPlanNow({ skipPost: true })
 * to get a fresh AI-generated daily plan, then lets the user accept it.
 * On accept, the plan tasks are merged into today's queue via applyTaskAdjust.
 */
export function DailyPlanReviewModal({
  open, onClose, onAccepted, readonly = false,
}: {
  open: boolean;
  onClose: () => void;
  onAccepted?: () => void;
  readonly?: boolean;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const id = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    setPlan(null);
    setError(null);
    setAccepted(false);
    api.runDailyPlanNow(true)
      .then(r => { if (!cancelled) setPlan(r as PlanResult); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : t('execution.dailyPlanReview.genError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(id); };
  }, [api, open]);

  const handleAccept = async () => {
    if (!plan?.plan?.tasks?.length || readonly) return;
    setApplying(true);
    setError(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      const items = plan.plan.tasks.map((t, i) => ({
        task_id: `plan-${Date.now()}-${i}`,
        task_title: t.title,
        action: 'reschedule' as const,
        new_date: today,
        reason: t.why || (t.energy ? `${t.energy} energy` : undefined),
      }));
      await api.applyTaskAdjust(items);
      setAccepted(true);
      onAccepted?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('execution.dailyPlanReview.applyError'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={readonly ? t('execution.dailyPlanReview.eyebrowPreview') : t('execution.dailyPlanReview.eyebrowPlanning')}
      title={accepted ? t('execution.dailyPlanReview.titleAccepted') : (plan?.plan?.opener || t('execution.dailyPlanReview.titlePlanning'))}
      size="lg"
      footer={
        readonly ? (
          <button type="button" style={primaryBtnStyle()} onClick={onClose}>{t('execution.dailyPlanReview.gotIt')}</button>
        ) : accepted ? (
          <button type="button" style={primaryBtnStyle()} onClick={onClose}>{t('execution.dailyPlanReview.done')}</button>
        ) : (
          <>
            <button type="button" style={ghostBtnStyle()} onClick={onClose}>{t('execution.dailyPlanReview.later')}</button>
            <button
              type="button"
              style={{
                ...primaryBtnStyle(),
                opacity: plan?.plan?.tasks?.length ? 1 : 0.5,
                cursor: plan?.plan?.tasks?.length ? 'pointer' : 'default',
              }}
              onClick={handleAccept}
              disabled={!plan?.plan?.tasks?.length || applying}
            >
              {applying ? t('execution.dailyPlanReview.addingNow') : t('execution.dailyPlanReview.acceptAdd')}
            </button>
          </>
        )
      }
    >
      {loading && !plan && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm }}>
          <IconSpark size={20} style={{ color: 'var(--g-accent)', marginBottom: 8 }} />
          <div>{t('execution.dailyPlanReview.loadingText')}</div>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'color-mix(in oklch, var(--g-danger) 12%, transparent)',
            border: '1px solid color-mix(in oklch, var(--g-danger) 32%, transparent)',
            color: 'var(--g-danger)',
            fontSize: fontVars.sm,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {plan && plan.plan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {plan.plan.greeting && (
            <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.65 }}>
              {plan.plan.greeting}
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                fontSize: fontVars.sm,
                fontFamily: 'var(--g-font-mono)',
                color: 'var(--g-text-faint)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              {t('execution.dailyPlanReview.suggestedN', { n: plan.plan.tasks.length })}
            </div>
            {plan.plan.tasks.map((t, i) => (
              <PlanTaskRow key={i} task={t} index={i + 1} />
            ))}
          </div>

          {plan.plan.care_message && (
            <div
              style={{
                padding: 12,
                background: 'var(--g-accent-soft)',
                border: '1px solid var(--g-accent-line)',
                borderRadius: 10,
                fontSize: fontVars.sm,
                color: 'var(--g-text)',
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <IconBolt size={14} style={{ color: 'var(--g-accent)', marginTop: 2, flexShrink: 0 }} />
              <span>{plan.plan.care_message}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Pill mono>{plan.source === 'llm' ? t('execution.dailyPlanReview.sourceLlm') : t('execution.dailyPlanReview.sourceFallback')}</Pill>
          </div>
        </div>
      )}
    </Modal>
  );
}

const ENERGY_COLOR: Record<string, string> = {
  high: 'var(--g-dim-goal)',
  medium: 'var(--g-dim-insight)',
  low: 'var(--g-text-muted)',
};

function PlanTaskRow({ task, index }: { task: PlanTask; index: number }) {
  const t = useTranslations('app');
  return (
    <article
      style={{
        padding: '10px 12px',
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 10,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <span
        style={{
          width: 22, height: 22, borderRadius: 6,
          background: 'var(--g-bg-raised)',
          border: '1px solid var(--g-border)',
          color: 'var(--g-text-mid)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--g-font-mono)',
          fontSize: fontVars.sm,
          fontWeight: 600,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {index}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: 500 }}>{task.title}</div>
        {task.why && (
          <p style={{ margin: '4px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.5 }}>{task.why}</p>
        )}
      </div>
      {task.energy && (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 999,
          background: `color-mix(in oklch, ${ENERGY_COLOR[task.energy]} 14%, transparent)`,
          color: ENERGY_COLOR[task.energy],
          fontSize: fontVars.sm,
          fontFamily: 'var(--g-font-mono)',
        }}>
          <IconCheck size={9} /> {t(`execution.energy.${task.energy}`)}
        </span>
      )}
    </article>
  );
}
