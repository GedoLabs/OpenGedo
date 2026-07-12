'use client';

import { fontVars, text } from '../typography';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { Modal } from '@/app/components/gedo/Modal';
import { Field, TextInput, Select } from '@/app/components/gedo/FormField';
import { primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';

type Frequency = 'once' | 'daily' | 'weekly' | 'monthly';

const FREQ_VALUES: Frequency[] = ['once', 'daily', 'weekly', 'monthly'];

/**
 * Lightweight reminder rule editor. Reminders are stored as memory items
 * with reminder_date metadata — calls captureMemory with a 'reminder' tag.
 */
export function ReminderRuleModal({
  open, onClose, prefillTitle = '', onSaved,
}: {
  open: boolean;
  onClose: () => void;
  prefillTitle?: string;
  onSaved?: () => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const freqOptions = FREQ_VALUES.map(v => ({ value: v, label: t(`memory.reminder.freq.${v}`) }));
  const [title, setTitle] = useState(prefillTitle);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('09:00');
  const [freq, setFreq] = useState<Frequency>('once');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = title.trim().length > 1 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const ruleNote = freq === 'once'
        ? t('memory.reminder.onceNote', { date, time })
        : t('memory.reminder.repeatNote', { freq: t(`memory.reminder.freqShort.${freq}`), date, time });
      await api.captureMemory({
        type: 'important_info',
        content_raw: `${title.trim()}\n${ruleNote}`,
        tags: ['reminder', `freq:${freq}`],
        source: 'text',
      });
      setTitle('');
      onSaved?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('memory.reminder.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('memory.reminder.eyebrow')}
      title={t('memory.reminder.title')}
      size="md"
      footer={
        <>
          <button type="button" style={ghostBtnStyle()} onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button
            type="button"
            style={{ ...primaryBtnStyle(), opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'default' }}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? t('memory.reminder.saving') : t('memory.reminder.save')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label={t('memory.reminder.contentLabel')} required>
          <TextInput
            value={title}
            onChange={setTitle}
            placeholder={t('memory.reminder.contentPlaceholder')}
            autoFocus
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={t('memory.reminder.dateLabel')}>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                background: 'var(--g-surface-1)',
                border: '1px solid var(--g-border)',
                borderRadius: 8,
                color: 'var(--g-text)',
                fontSize: fontVars.sm,
                fontFamily: 'var(--g-font-sans)',
                outline: 'none',
                colorScheme: 'dark',
              }}
            />
          </Field>
          <Field label={t('memory.reminder.timeLabel')}>
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                background: 'var(--g-surface-1)',
                border: '1px solid var(--g-border)',
                borderRadius: 8,
                color: 'var(--g-text)',
                fontSize: fontVars.sm,
                fontFamily: 'var(--g-font-sans)',
                outline: 'none',
                colorScheme: 'dark',
              }}
            />
          </Field>
        </div>

        <Field label={t('memory.reminder.freqLabel')}>
          <Select value={freq} onChange={setFreq} options={freqOptions} />
        </Field>

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
