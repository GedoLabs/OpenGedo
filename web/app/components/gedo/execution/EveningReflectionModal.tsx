'use client';

import { fontVars, text } from '../typography';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { Modal } from '@/app/components/gedo/Modal';
import { Field, TextArea, RadioGroup, Slider } from '@/app/components/gedo/FormField';
import { primaryBtnStyle, ghostBtnStyle, Pill } from '@/app/components/gedo/primitives';
import { IconSpark } from '@/app/components/gedo/icons';

type ObstacleTag =
  | 'procrastination'
  | 'time'
  | 'energy'
  | 'distraction'
  | 'mood'
  | 'external'
  | 'none';

type AdjustTag = 'no_change' | 'lower_load' | 'higher_load' | 'reorder';

const OBSTACLE_VALUES: ObstacleTag[] = ['none', 'procrastination', 'time', 'energy', 'distraction', 'mood', 'external'];
const ADJUST_VALUES: AdjustTag[] = ['no_change', 'lower_load', 'higher_load', 'reorder'];

/**
 * Evening reflection — 3 questions + ECS self-score.
 * Submits api.createReflection + api.recordECS.
 */
export function EveningReflectionModal({
  open, onClose, completionRate, taskTotal,
}: {
  open: boolean;
  onClose: () => void;
  completionRate: number; // 0-100
  taskTotal: number;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const obstacleOptions = OBSTACLE_VALUES.map(v => ({ value: v, label: t(`execution.eveningReflection.obstacles.${v}`) }));
  const adjustOptions = ADJUST_VALUES.map(v => ({ value: v, label: t(`execution.eveningReflection.adjusts.${v}.label`), description: t(`execution.eveningReflection.adjusts.${v}.desc`) }));
  const [obstacle, setObstacle] = useState<ObstacleTag>('none');
  const [mostValuable, setMostValuable] = useState('');
  const [adjust, setAdjust] = useState<AdjustTag>('no_change');
  const [planStability, setPlanStability] = useState(80);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ecsTotal = Math.round((completionRate + planStability) / 2 + 5); // simple combo
  const ecsLabel = ecsTotal >= 80 ? t('execution.ecsLabel.excellent') : ecsTotal >= 60 ? t('execution.ecsLabel.good') : ecsTotal >= 40 ? t('execution.ecsLabel.fair') : t('execution.ecsLabel.watch');

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      await api.createReflection({
        date: today,
        q1_obstacle_tag: obstacle,
        q2_most_valuable: mostValuable.trim(),
        q3_adjustment_tag: adjust,
        ecs_score: ecsTotal,
      });
      await api.recordECS({
        completion_rate: completionRate,
        plan_stability: planStability,
        reflection_completed: true,
        total: ecsTotal,
      });
      setDone(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('execution.eveningReflection.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('execution.eveningReflection.eyebrow')}
      title={done ? t('execution.eveningReflection.titleDone') : t('execution.eveningReflection.titlePending')}
      size="md"
      footer={
        done ? (
          <button type="button" style={primaryBtnStyle()} onClick={onClose}>{t('execution.eveningReflection.close')}</button>
        ) : (
          <>
            <button type="button" style={ghostBtnStyle()} onClick={onClose} disabled={saving}>
              {t('execution.eveningReflection.notNow')}
            </button>
            <button
              type="button"
              style={primaryBtnStyle()}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? t('execution.eveningReflection.saving') : t('execution.eveningReflection.finishReview')}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              padding: 14,
              background: 'var(--g-accent-soft)',
              border: '1px solid var(--g-accent-line)',
              borderRadius: 12,
              display: 'flex',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <IconSpark size={24} style={{ color: 'var(--g-accent)' }} />
            <div>
              <div style={{ fontSize: fontVars.sm, fontWeight: 500, color: 'var(--g-text)' }}>
                {t('execution.eveningReflection.todayScore', { score: ecsTotal })} <Pill tone="accent" style={{ marginLeft: 6 }}>{ecsLabel}</Pill>
              </div>
              <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', marginTop: 4, lineHeight: 1.5 }}>
                {t('execution.eveningReflection.savedNote')}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Field label={t('execution.eveningReflection.obstacleLabel')}>
            <RadioGroup value={obstacle} onChange={setObstacle} options={obstacleOptions} inline />
          </Field>

          <Field label={t('execution.eveningReflection.valuableLabel')} hint={t('execution.eveningReflection.valuableHint')}>
            <TextArea
              value={mostValuable}
              onChange={setMostValuable}
              placeholder={t('execution.eveningReflection.valuablePlaceholder')}
              rows={2}
            />
          </Field>

          <Field label={t('execution.eveningReflection.adjustLabel')}>
            <RadioGroup value={adjust} onChange={setAdjust} options={adjustOptions} />
          </Field>

          <Field label={t('execution.eveningReflection.stabilityLabel')} hint={t('execution.eveningReflection.stabilityHint', { pct: completionRate, n: taskTotal })}>
            <Slider value={planStability} onChange={setPlanStability} label={t('execution.eveningReflection.stabilitySliderLabel')} />
          </Field>

          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: 'var(--g-surface-1)',
              border: '1px solid var(--g-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: fontVars.sm,
              color: 'var(--g-text-mid)',
            }}
          >
            <IconSpark size={14} style={{ color: 'var(--g-accent)' }} />
            <span>{t('execution.eveningReflection.estimateLabel')}</span>
            <span style={{ fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)', fontFamily: 'var(--g-font-mono)' }}>
              {ecsTotal}
            </span>
            <Pill tone="accent">{ecsLabel}</Pill>
          </div>

          {error && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: 'color-mix(in oklch, var(--g-danger) 12%, transparent)',
                border: '1px solid color-mix(in oklch, var(--g-danger) 32%, transparent)',
                color: 'var(--g-danger)',
                fontSize: fontVars.sm,
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
