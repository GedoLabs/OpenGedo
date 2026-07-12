'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { Goal } from './types';
import type { LifeWheelDimension } from '../life-tree/types';

const LIFE_WHEEL_DIMS: LifeWheelDimension[] = [
  'health', 'career', 'family', 'finance', 'growth', 'social', 'hobby', 'self_realization',
];

const inputStyle: CSSProperties = {
  width: '100%', borderRadius: 8, background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)',
  padding: '8px 12px', fontSize: fontVars.sm, color: 'var(--g-text)', outline: 'none', fontFamily: 'var(--g-font-sans)',
};

export default function GoalEditModal({ goal, onSave, onCancel, saving }: {
  goal: Goal;
  onSave: (patch: Partial<Goal>) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const t = useTranslations('app.planner.editModal');
  const tCommon = useTranslations('app.common');
  const dimT = useTranslations('app.planner.dimensions');
  const [title, setTitle] = useState(goal.title);
  const [dimension, setDimension] = useState<LifeWheelDimension>(goal.lifeWheelDimension);
  const [description, setDescription] = useState(goal.description || '');
  const [wish, setWish] = useState(goal.wish || '');
  const [outcome, setOutcome] = useState(goal.outcome || '');
  const [obstacle, setObstacle] = useState(goal.obstacle || '');

  const canSave = title.trim().length > 0 && !saving;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      title: title.trim(),
      lifeWheelDimension: dimension,
      description: description.trim(),
      wish: wish.trim(),
      outcome: outcome.trim(),
      obstacle: obstacle.trim(),
    });
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(0 0 0 / 0.6)', padding: 16 }}
      onClick={onCancel}
    >
      <div
        style={{ width: '100%', maxWidth: 520, borderRadius: 16, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', boxShadow: '0 24px 60px -24px oklch(0 0 0 / 0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--g-border)' }}>
          <div>
            <div style={{ fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', color: 'var(--g-accent)', letterSpacing: '0.06em' }}>{t('eyebrow')}</div>
            <h2 style={{ margin: '2px 0 0', fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)' }}>{t('title')}</h2>
          </div>
          <button type="button" onClick={onCancel} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--g-text-muted)', fontSize: fontVars.base, lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflow: 'auto' }}>
          <Field label={t('titleLabel')} required>
            <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} placeholder={t('titlePlaceholder')} autoFocus />
          </Field>

          <Field label={t('dimensionLabel')}>
            <select value={dimension} onChange={e => setDimension(e.target.value as LifeWheelDimension)} style={inputStyle}>
              {LIFE_WHEEL_DIMS.map(k => <option key={k} value={k}>{dimT(k)}</option>)}
            </select>
          </Field>

          <Field label={t('descriptionLabel')}>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder={t('descriptionPlaceholder')} />
          </Field>

          <div style={{ paddingTop: 8, borderTop: '1px solid var(--g-border)' }}>
            <div style={{ fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', color: 'var(--g-text-faint)', marginBottom: 10, letterSpacing: '0.06em' }}>{t('woopSection')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label={t('wishLabel')}><input value={wish} onChange={e => setWish(e.target.value)} style={inputStyle} placeholder={t('wishPlaceholder')} /></Field>
              <Field label={t('outcomeLabel')}><input value={outcome} onChange={e => setOutcome(e.target.value)} style={inputStyle} placeholder={t('outcomePlaceholder')} /></Field>
              <Field label={t('obstacleLabel')}><input value={obstacle} onChange={e => setObstacle(e.target.value)} style={inputStyle} placeholder={t('obstaclePlaceholder')} /></Field>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid var(--g-border)' }}>
          <button type="button" onClick={onCancel} disabled={saving} style={{ padding: '8px 16px', borderRadius: 10, fontSize: fontVars.sm, color: 'var(--g-text-mid)', background: 'transparent', border: '1px solid var(--g-border)', cursor: 'pointer', fontFamily: 'var(--g-font-sans)' }}>{tCommon('cancel')}</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            style={{ padding: '8px 16px', borderRadius: 10, fontSize: fontVars.sm, fontWeight: 500, color: 'var(--g-accent-ink)', background: 'var(--g-accent)', border: 'none', cursor: canSave ? 'pointer' : 'default', opacity: canSave ? 1 : 0.5, fontFamily: 'var(--g-font-sans)' }}
          >
            {saving ? tCommon('saving') : tCommon('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: fontVars.sm, color: 'var(--g-text-muted)', marginBottom: 6 }}>
        {label}{required && <span style={{ color: 'var(--g-accent)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}
