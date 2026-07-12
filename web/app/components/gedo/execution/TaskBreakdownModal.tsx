'use client';

import { fontVars, text } from '../typography';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { Modal } from '@/app/components/gedo/Modal';
import { primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';

type SubTask = { title: string; description?: string; estimated_duration?: number; energy_level?: string };

/**
 * 「细化」弹窗：调大模型把一条粗任务拆成 2-4 个小步骤（预览），
 * 用户勾选后再创建为真实任务（review-before-apply）。
 */
export function TaskBreakdownModal({
  open, onClose, taskId, taskTitle, onApplied,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string | null;
  taskTitle: string;
  onApplied?: () => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [subtasks, setSubtasks] = useState<SubTask[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !taskId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSubtasks([]);
    api.breakdownTask(taskId)
      .then(r => {
        if (cancelled) return;
        const list = r?.subtasks ?? [];
        setSubtasks(list);
        setSelected(Object.fromEntries(list.map((_, i) => [i, true])));
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : t('execution.taskBreakdown.genError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, taskId, api]);

  const chosen = subtasks.filter((_, i) => selected[i]);

  const handleApply = async () => {
    if (!taskId || chosen.length === 0 || applying) return;
    setApplying(true);
    setError(null);
    try {
      await api.applyTaskBreakdown(taskId, chosen);
      onApplied?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('execution.taskBreakdown.applyError'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('execution.taskBreakdown.eyebrow')}
      title={taskTitle ? t('execution.taskBreakdown.titleWith', { title: taskTitle }) : t('execution.taskBreakdown.titleGeneric')}
      size="md"
      footer={
        <>
          <button type="button" style={ghostBtnStyle()} onClick={onClose} disabled={applying}>{t('execution.taskBreakdown.cancel')}</button>
          <button
            type="button"
            style={{ ...primaryBtnStyle(), opacity: chosen.length && !applying ? 1 : 0.5, cursor: chosen.length && !applying ? 'pointer' : 'default' }}
            onClick={handleApply}
            disabled={!chosen.length || applying}
          >
            {applying ? t('execution.taskBreakdown.creating') : t('execution.taskBreakdown.addN', { n: chosen.length })}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>
          {t('execution.taskBreakdown.intro')}
        </p>
        {loading && (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)' }}>
            {t('execution.taskBreakdown.loading')}
          </div>
        )}
        {!loading && subtasks.map((s, i) => (
          <label
            key={i}
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 10,
              border: '1px solid var(--g-border)',
              background: selected[i] ? 'var(--g-surface-1)' : 'transparent', cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={!!selected[i]}
              onChange={e => setSelected(p => ({ ...p, [i]: e.target.checked }))}
              style={{ marginTop: 2 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: 500 }}>{s.title}</div>
              {s.description && <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)', marginTop: 3, lineHeight: 1.5 }}>{s.description}</div>}
              <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', marginTop: 4 }}>
                {s.estimated_duration ?? 20}m · {s.energy_level === 'high' ? t('execution.energy.high') : s.energy_level === 'low' ? t('execution.energy.low') : t('execution.energy.medium')}
              </div>
            </div>
          </label>
        ))}
        {!loading && subtasks.length === 0 && !error && (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm }}>{t('execution.taskBreakdown.empty')}</div>
        )}
        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'color-mix(in oklch, var(--g-danger) 12%, transparent)', border: '1px solid color-mix(in oklch, var(--g-danger) 32%, transparent)', color: 'var(--g-danger)', fontSize: fontVars.sm }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
