'use client';

import { fontVars, text } from '../typography';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { Modal } from '@/app/components/gedo/Modal';
import { Field, TextInput, Select, RadioGroup } from '@/app/components/gedo/FormField';
import { primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';

type Energy = 'high' | 'medium' | 'low';

type ApiGoal = { id: string; title: string; level?: string; parent_id?: string | null };

const ENERGY_VALUES: Energy[] = ['high', 'medium', 'low'];
const DURATION_VALUES = ['15', '25', '45', '60', '90'];

/**
 * Add a new task via POST /v1/tasks (api.createTask). Energy / duration / goal
 * are sent as real fields so they actually persist (the old applyTaskAdjust
 * workaround crammed them into a free-text reason and lost them).
 */
export function TaskCreateModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const energyOptions = ENERGY_VALUES.map(v => ({ value: v, label: t(`execution.taskCreate.energyOptions.${v}.label`), description: t(`execution.taskCreate.energyOptions.${v}.desc`) }));
  const durationOptions = DURATION_VALUES.map(v => ({ value: v, label: t(`execution.taskCreate.durations.${v}`) }));
  const [title, setTitle] = useState('');
  const [energy, setEnergy] = useState<Energy>('medium');
  const [duration, setDuration] = useState<string>('30');
  const [goalSel, setGoalSel] = useState<string>(''); // '' | <objectiveId> | <objectiveId>::<krId>
  const [goals, setGoals] = useState<ApiGoal[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.listGoals()
      .then(r => { if (!cancelled) setGoals((r?.items as ApiGoal[] ?? [])); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, open]);

  const canSave = title.trim().length > 1 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const [gid, krid] = goalSel.split('::');
      await api.createTask({
        title: title.trim(),
        energy_level: energy,
        estimated_duration: Number(duration) || 30,
        scheduled_date: new Date().toISOString().split('T')[0],
        goal_id: gid || null,
        key_result_id: krid || null,
      });
      setTitle('');
      onCreated?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('execution.taskCreate.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('execution.taskCreate.eyebrow')}
      title={t('execution.taskCreate.title')}
      size="md"
      footer={
        <>
          <button type="button" style={ghostBtnStyle()} onClick={onClose} disabled={saving}>
            {t('execution.taskCreate.cancel')}
          </button>
          <button
            type="button"
            style={{ ...primaryBtnStyle(), opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'default' }}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? t('execution.taskCreate.adding') : t('execution.taskCreate.add')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label={t('execution.taskCreate.titleLabel')} required>
          <TextInput
            value={title}
            onChange={setTitle}
            placeholder={t('execution.taskCreate.titlePlaceholder')}
            autoFocus
            onEnter={handleSave}
          />
        </Field>

        <Field label={t('execution.taskCreate.energyLabel')}>
          <RadioGroup value={energy} onChange={setEnergy} options={energyOptions} inline />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={t('execution.taskCreate.durationLabel')}>
            <Select value={duration} onChange={setDuration} options={durationOptions} />
          </Field>
          <Field label={t('execution.taskCreate.goalLabel')}>
            <Select
              value={goalSel}
              onChange={setGoalSel}
              options={[
                { value: '', label: t('execution.taskCreate.noGoal') },
                ...goals.filter(g => (g.level || 'objective') === 'objective').flatMap(o => [
                  { value: o.id, label: o.title },
                  ...goals.filter(k => k.level === 'key_result' && k.parent_id === o.id).map(k => ({ value: `${o.id}::${k.id}`, label: `　└ ${k.title}` })),
                ]),
              ]}
            />
          </Field>
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
    </Modal>
  );
}
