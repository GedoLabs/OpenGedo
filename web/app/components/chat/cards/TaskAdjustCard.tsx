'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Undo2, CalendarClock, Trash2, ArrowUp, ArrowDown, Clock } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';
import type { TaskAdjustCard, TaskAdjustItem } from '@/lib/genui/schemas';

const ACTION_ICON: Record<TaskAdjustItem['action'], React.ElementType> = {
  postpone:      Clock,
  reschedule:    CalendarClock,
  remove:        Trash2,
  priority_up:   ArrowUp,
  priority_down: ArrowDown,
};

type ApplyState = 'idle' | 'applying' | 'applied' | 'noop' | 'undoing' | 'undone' | 'error';

export default function TaskAdjustCard({ card }: { card: TaskAdjustCard }) {
  const t = useTranslations('app');
  const { api } = useAuth();
  const total = card.items.length;
  const [state, setState] = useState<ApplyState>('idle');
  const [undoToken, setUndoToken] = useState<string | undefined>(card.undo_token);
  const [appliedCount, setAppliedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const handleApply = async () => {
    setState('applying');
    try {
      const res = await api.applyTaskAdjust(card.items);
      // 后端只对能匹配到的 task_id 生效并返回真实生效数；不能无条件报"已应用"，
      // 否则 LLM 编造的 ID 全部落空时用户会以为改动成功了（见管线分析 P1-4）。
      const applied = typeof res?.applied === 'number' ? res.applied : total;
      setAppliedCount(applied);
      if (applied === 0) {
        setState('noop');
        return;
      }
      setUndoToken(res?.undo_token);
      setState('applied');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('companion.cards.taskAdjust.errorApply'));
      setState('error');
    }
  };

  const handleUndo = async () => {
    if (!undoToken) return;
    setState('undoing');
    try {
      await api.undoTaskAdjust(undoToken);
      setState('undone');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('companion.cards.taskAdjust.errorUndo'));
      setState('error');
    }
  };

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
        {card.title ?? t('companion.cards.taskAdjust.fallbackTitle')}
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {card.items.map((item, i) => {
          const Icon = ACTION_ICON[item.action];
          return (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: fontVars.sm }}>
              <Icon style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0, color: 'var(--g-dim-insight)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    color: 'var(--g-text)',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                  }}
                >
                  {item.task_title}
                </span>
                <span style={{ color: 'var(--g-text-muted)', fontSize: fontVars.sm }}>
                  {t('companion.cards.taskAdjust.action', { action: item.action })}
                  {item.new_date ? `  →  ${item.new_date}` : ''}
                  {item.reason ? `  ·  ${item.reason}` : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {state === 'error' && (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-danger)' }}>{errorMsg}</p>
      )}

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        {state === 'idle' || state === 'error' ? (
          <button
            type="button"
            onClick={handleApply}
            style={{ ...primaryBtnStyle(), flex: 1, justifyContent: 'center' }}
          >
            <Check style={{ width: 14, height: 14 }} />
            {t('companion.cards.taskAdjust.apply')}
          </button>
        ) : state === 'applying' ? (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '6px 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>
            {t('companion.cards.taskAdjust.applying')}
          </div>
        ) : state === 'applied' ? (
          <>
            <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: fontVars.sm, color: 'var(--g-accent)', padding: '6px 0' }}>
              <Check style={{ width: 14, height: 14 }} /> {appliedCount < total ? t('companion.cards.taskAdjust.appliedPartial', { applied: appliedCount, total }) : t('companion.cards.taskAdjust.applied')}
            </span>
            {undoToken && (
              <button
                type="button"
                onClick={handleUndo}
                style={{ ...ghostBtnStyle(), fontSize: fontVars.sm, padding: '6px 10px' }}
              >
                <Undo2 style={{ width: 14, height: 14 }} /> {t('companion.cards.taskAdjust.undo')}
              </button>
            )}
          </>
        ) : state === 'noop' ? (
          <span style={{ flex: 1, fontSize: fontVars.sm, color: 'var(--g-text-muted)', padding: '6px 0' }}>
            {t('companion.cards.taskAdjust.noop')}
          </span>
        ) : state === 'undoing' ? (
          <div style={{ flex: 1, fontSize: fontVars.sm, color: 'var(--g-text-muted)', padding: '6px 0', display: 'flex', justifyContent: 'center' }}>
            {t('companion.cards.taskAdjust.undoing')}
          </div>
        ) : (
          <span style={{ flex: 1, fontSize: fontVars.sm, color: 'var(--g-text-muted)', padding: '6px 0' }}>{t('companion.cards.taskAdjust.undone')}</span>
        )}
      </div>
    </div>
  );
}
