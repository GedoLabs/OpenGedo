'use client';

import { fontVars, text } from '../typography';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { Modal } from '@/app/components/gedo/Modal';
import { Field, RadioGroup, TextArea } from '@/app/components/gedo/FormField';
import { primaryBtnStyle, ghostBtnStyle, Pill } from '@/app/components/gedo/primitives';
import { IconFlag, IconCheck } from '@/app/components/gedo/icons';

type ReasonCode =
  | 'procrastination_fear'
  | 'time_insufficient'
  | 'energy_low'
  | 'external_block'
  | 'unclear_step'
  | 'mood_dip'
  | 'other';

const REASON_VALUES: ReasonCode[] = [
  'procrastination_fear', 'time_insufficient', 'energy_low',
  'external_block', 'unclear_step', 'mood_dip', 'other',
];

type ApiIfThenCard = {
  id: string;
  if_condition: string;
  then_action: string;
  triggered_count?: number;
  executed_count?: number;
};

/**
 * "遇阻" modal. User picks a reason → we call matchObstacle → display
 * matched If-Then cards → user can record whether they followed the card
 * (triggerObstacleCard).
 */
export function ObstacleMatchModal({
  open, onClose, taskId, taskTitle, onResolved,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string | null;
  taskTitle: string;
  onResolved?: (status: 'skipped') => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const reasonOptions = REASON_VALUES.map(v => ({
    value: v,
    label: t(`execution.obstacleMatch.reasons.${v}.label`),
    description: v === 'other' ? undefined : t(`execution.obstacleMatch.reasons.${v}.desc`),
  }));
  const [reason, setReason] = useState<ReasonCode>('procrastination_fear');
  const [note, setNote] = useState('');
  const [matching, setMatching] = useState(false);
  const [matched, setMatched] = useState<ApiIfThenCard[] | null>(null);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReason('procrastination_fear');
      setNote('');
      setMatched(null);
      setResolved(false);
      setError(null);
    }
  }, [open]);

  const handleMatch = async () => {
    setMatching(true);
    setError(null);
    try {
      const r = await api.matchObstacle(reason);
      const cards = (r?.cards as ApiIfThenCard[]) ?? [];
      setMatched(cards);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('execution.obstacleMatch.matchError'));
    } finally {
      setMatching(false);
    }
  };

  const handleSkipTask = async () => {
    if (!taskId) return;
    try {
      await api.checkin(taskId, { status: 'skipped', reason_code: reason, note });
      onResolved?.('skipped');
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('execution.obstacleMatch.recordError'));
    }
  };

  const handleTriggerCard = async (cardId: string, executed: boolean) => {
    try {
      await api.triggerObstacleCard(cardId, executed);
      setResolved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('execution.obstacleMatch.recordError'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('execution.obstacleMatch.eyebrow')}
      title={taskTitle ? t('execution.obstacleMatch.titleWith', { title: taskTitle }) : t('execution.obstacleMatch.titleGeneric')}
      size="md"
      footer={
        matched === null ? (
          <>
            <button type="button" style={ghostBtnStyle()} onClick={onClose}>{t('execution.obstacleMatch.cancel')}</button>
            <button
              type="button"
              style={primaryBtnStyle()}
              onClick={handleMatch}
              disabled={matching}
            >
              {matching ? t('execution.obstacleMatch.matching') : t('execution.obstacleMatch.matchBtn')}
            </button>
          </>
        ) : (
          <>
            <button type="button" style={ghostBtnStyle()} onClick={handleSkipTask}>
              {t('execution.obstacleMatch.skipTask')}
            </button>
            <button type="button" style={primaryBtnStyle()} onClick={onClose}>
              {resolved ? t('execution.obstacleMatch.done') : t('execution.obstacleMatch.close')}
            </button>
          </>
        )
      }
    >
      {matched === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label={t('execution.obstacleMatch.whatBlocked')} required>
            <RadioGroup value={reason} onChange={setReason} options={reasonOptions} />
          </Field>
          <Field label={t('execution.obstacleMatch.noteLabel')} hint={t('execution.obstacleMatch.noteHint')}>
            <TextArea value={note} onChange={setNote} placeholder={t('execution.obstacleMatch.notePlaceholder')} rows={3} />
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
      ) : matched.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>
            {t('execution.obstacleMatch.noMatch')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>
            {t.rich('execution.obstacleMatch.matchedIntro', { n: matched.length, b: (chunks) => <b style={{ color: 'var(--g-text)' }}>{chunks}</b> })}
          </p>
          {matched.map(card => (
            <IfThenCard
              key={card.id}
              card={card}
              onTrigger={(executed) => handleTriggerCard(card.id, executed)}
            />
          ))}
          {resolved && (
            <Pill tone="accent">
              <IconCheck size={10} /> {t('execution.obstacleMatch.recordedHit')}
            </Pill>
          )}
        </div>
      )}
    </Modal>
  );
}

function IfThenCard({
  card, onTrigger,
}: {
  card: ApiIfThenCard;
  onTrigger: (executed: boolean) => void;
}) {
  const t = useTranslations('app');
  const [done, setDone] = useState(false);
  return (
    <article
      style={{
        padding: 12,
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          style={{
            width: 24, height: 24, borderRadius: 6,
            background: 'color-mix(in oklch, var(--g-dim-goal) 14%, transparent)',
            border: '1px solid color-mix(in oklch, var(--g-dim-goal) 32%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--g-dim-goal)', fontFamily: 'var(--g-font-mono)', fontSize: fontVars.sm, fontWeight: 700,
            flexShrink: 0,
          }}
        >
          IF
        </span>
        <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', flex: 1, lineHeight: 1.5 }}>
          {card.if_condition}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8 }}>
        <span
          style={{
            width: 24, height: 24, borderRadius: 6,
            background: 'var(--g-accent-soft)',
            border: '1px solid var(--g-accent-line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--g-accent)', fontFamily: 'var(--g-font-mono)', fontSize: fontVars.sm, fontWeight: 700,
            flexShrink: 0,
          }}
        >
          THEN
        </span>
        <div style={{ fontSize: fontVars.sm, color: 'var(--g-text)', flex: 1, lineHeight: 1.5, fontWeight: 500 }}>
          {card.then_action}
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: '1px solid var(--g-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: fontVars.sm,
          color: 'var(--g-text-faint)',
          fontFamily: 'var(--g-font-mono)',
        }}
      >
        <IconFlag size={11} />
        <span>{t('execution.obstacleCard.triggered', { n: card.triggered_count ?? 0 })} · {t('execution.obstacleCard.executed', { n: card.executed_count ?? 0 })}</span>
        <div style={{ flex: 1 }} />
        {done ? (
          <span style={{ color: 'var(--g-accent)' }}>{t('execution.obstacleMatch.recorded')}</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { onTrigger(false); setDone(true); }}
              style={{
                ...ghostBtnStyle(),
                fontSize: fontVars.sm,
                padding: '4px 10px',
              }}
            >
              {t('execution.obstacleMatch.notUsed')}
            </button>
            <button
              type="button"
              onClick={() => { onTrigger(true); setDone(true); }}
              style={{
                ...primaryBtnStyle(true),
                fontSize: fontVars.sm,
                padding: '4px 12px',
              }}
            >
              {t('execution.obstacleMatch.followThis')}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
