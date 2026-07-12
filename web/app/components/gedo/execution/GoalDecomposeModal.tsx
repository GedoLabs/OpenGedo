'use client';

import { fontVars, text } from '../typography';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { Modal } from '@/app/components/gedo/Modal';
import { primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';
import { IconSpark, IconPlus } from '@/app/components/gedo/icons';
import type { GoalPlan } from '@/lib/apiClient';

const inputStyle: React.CSSProperties = {
  background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 8,
  color: 'var(--g-text)', fontSize: fontVars.sm, padding: '6px 9px', fontFamily: 'var(--g-font-sans)', outline: 'none', width: '100%',
};
const miniInput: React.CSSProperties = { ...inputStyle, width: 56, textAlign: 'center', padding: '5px 4px' };

function countTasks(plan: GoalPlan | null): number {
  if (!plan) return 0;
  if (plan.cadence === 'milestone') return plan.milestoneTasks.length;
  return plan.phases.reduce((s, ph) => s + Math.max(0, ph.endDay - ph.startDay + 1) * ph.dailyTasks.length, 0);
}

/**
 * 目标拆解：记忆驱动生成「分阶段每日节奏」计划 → 可编辑 / 多次重新生成 → 确认后
 * 展开成执行页的可执行任务（如 90 天每天 3 件事）。
 */
export function GoalDecomposeModal({
  open, onClose, goalId, goalTitle, onCommitted,
}: {
  open: boolean;
  onClose: () => void;
  goalId: string | null;
  goalTitle: string;
  onCommitted?: (taskCount: number) => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [plan, setPlan] = useState<GoalPlan | null>(null);
  const [personalized, setPersonalized] = useState(false);
  const [isReplan, setIsReplan] = useState(false);
  const [stats, setStats] = useState<{ total: number; done: number; skipped: number; open: number; completionRate: number } | null>(null);
  const [duration, setDuration] = useState(30);
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback((opts?: { durationDays?: number; regenerateHint?: string }) => {
    if (!goalId) return;
    setLoading(true);
    setError(null);
    api.previewGoalPlan(goalId, opts)
      .then(r => {
        setPlan(r.plan);
        setPersonalized(r.personalized);
        setIsReplan(r.isReplan);
        setStats(r.stats);
        setDuration(r.plan.durationDays);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('execution.goalDecompose.genError')))
      .finally(() => setLoading(false));
  }, [api, goalId, t]);

  useEffect(() => {
    if (open && goalId) { setPlan(null); setHint(''); generate(); }
  }, [open, goalId, generate]);

  // ── immutable plan updaters ──
  const patch = (fn: (p: GoalPlan) => GoalPlan) => setPlan(p => (p ? fn(structuredClone(p)) : p));
  const setObjective = (v: string) => patch(p => { p.objective = v; return p; });
  const setKR = (i: number, v: string) => patch(p => { p.keyResults[i] = v; return p; });
  const addKR = () => patch(p => { p.keyResults.push(t('execution.goalDecompose.newKr')); return p; });
  const removeKR = (i: number) => patch(p => { p.keyResults.splice(i, 1); return p; });
  const setPhaseField = (pi: number, k: 'name' | 'startDay' | 'endDay', v: string | number) =>
    patch(p => { (p.phases[pi] as Record<string, unknown>)[k] = v; return p; });
  const setTask = (pi: number, ti: number, k: 'title' | 'estimatedDuration', v: string | number) =>
    patch(p => { (p.phases[pi].dailyTasks[ti] as Record<string, unknown>)[k] = v; return p; });
  const addTask = (pi: number) => patch(p => { p.phases[pi].dailyTasks.push({ title: t('execution.goalDecompose.newDailyTask'), estimatedDuration: 20, energyLevel: 'medium' }); return p; });
  const removeTask = (pi: number, ti: number) => patch(p => { p.phases[pi].dailyTasks.splice(ti, 1); return p; });

  const total = countTasks(plan);

  const handleCommit = async () => {
    if (!goalId || !plan || committing || total === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const r = await api.commitGoalPlan(goalId, plan);
      onCommitted?.(r.taskCount);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('execution.goalDecompose.commitError'));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isReplan ? t('execution.goalDecompose.eyebrowReplan') : t('execution.goalDecompose.eyebrowNew')}
      title={goalTitle ? t('execution.goalDecompose.titleWith', { action: isReplan ? t('execution.goalDecompose.actionReplan') : t('execution.goalDecompose.actionPlan'), title: goalTitle }) : t('execution.goalDecompose.titleGeneric')}
      size="lg"
      footer={
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
            <input value={hint} onChange={e => setHint(e.target.value)} placeholder={t('execution.goalDecompose.hintPlaceholder')}
              style={{ ...inputStyle, width: 240 }} />
            <button type="button" style={ghostBtnStyle()} disabled={loading} onClick={() => generate({ durationDays: duration, regenerateHint: hint })}>
              {loading ? t('execution.goalDecompose.regenerating') : t('execution.goalDecompose.regenerate')}
            </button>
          </div>
          <button type="button" style={ghostBtnStyle()} onClick={onClose} disabled={committing}>{t('execution.goalDecompose.cancel')}</button>
          <button type="button"
            style={{ ...primaryBtnStyle(), opacity: total && !committing && !loading ? 1 : 0.5, cursor: total && !committing ? 'pointer' : 'default' }}
            onClick={handleCommit} disabled={!total || committing || loading}>
            {committing ? t('execution.goalDecompose.committing') : t('execution.goalDecompose.confirmGenerate', { prefix: isReplan ? t('execution.goalDecompose.replanPrefix') : '', n: total })}
          </button>
        </>
      }
    >
      {loading && !plan ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)' }}>
          {t('execution.goalDecompose.planningText')}
        </div>
      ) : !plan ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm }}>{error || t('execution.goalDecompose.noPlan')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '60vh', overflow: 'auto', paddingRight: 4 }}>
          {/* re-plan banner */}
          {isReplan && stats && (
            <div style={{ padding: '10px 12px', background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderLeft: '3px solid var(--g-dim-goal)', borderRadius: 10 }}>
              <div style={{ fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' }}>
                {t('execution.goalDecompose.replanBanner', {
                  doneSuffix: stats.total > 0 ? t('execution.goalDecompose.doneSuffix', { done: stats.done, total: stats.total, pct: stats.completionRate }) : '',
                  skipSuffix: stats.skipped > 0 ? t('execution.goalDecompose.skipSuffix', { n: stats.skipped }) : '',
                })}
              </div>
              <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)', marginTop: 3, lineHeight: 1.6 }}>
                {t.rich('execution.goalDecompose.replanNote', { b: (chunks) => <b>{chunks}</b> })}
              </div>
            </div>
          )}

          {/* personalization note */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', background: 'var(--g-accent-soft)', border: '1px solid var(--g-accent-line)', borderRadius: 10 }}>
            <IconSpark size={14} style={{ color: 'var(--g-accent)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6 }}>
              {plan.personalNote || (personalized ? t('execution.goalDecompose.personalizedNote') : t('execution.goalDecompose.notPersonalizedNote'))}
            </div>
          </div>

          {/* objective */}
          <Section label={t('execution.goalDecompose.objectiveLabel')}>
            <input value={plan.objective} onChange={e => setObjective(e.target.value)} style={inputStyle} />
          </Section>

          {/* key results */}
          <Section label={t('execution.goalDecompose.keyResultsLabel')} action={<button type="button" style={{ ...ghostBtnStyle(), fontSize: fontVars.sm, padding: '3px 8px' }} onClick={addKR}><IconPlus size={11} /> {t('execution.goalDecompose.addKr')}</button>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {plan.keyResults.map((kr, i) => (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <input value={kr} onChange={e => setKR(i, e.target.value)} style={inputStyle} />
                  <button type="button" onClick={() => removeKR(i)} style={delBtn}>✕</button>
                </div>
              ))}
            </div>
          </Section>

          {/* duration */}
          <Section label={t('execution.goalDecompose.durationLabel')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>
              <input type="number" min={1} max={366} value={duration}
                onChange={e => setDuration(Math.max(1, Math.min(366, Number(e.target.value) || 1)))} style={miniInput} />
              <span>{t('execution.goalDecompose.days')}</span>
              <button type="button" style={{ ...ghostBtnStyle(), fontSize: fontVars.sm, padding: '4px 9px' }} disabled={loading}
                onClick={() => generate({ durationDays: duration, regenerateHint: hint })}>
                {t('execution.goalDecompose.rescheduleBtn')}
              </button>
              <span style={{ marginLeft: 'auto', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
                {plan.cadence === 'daily' ? t('execution.goalDecompose.dailySummary', { n: plan.phases[0]?.dailyTasks.length ?? 0, total }) : t('execution.goalDecompose.milestoneSummary', { total })}
              </span>
            </div>
          </Section>

          {/* phases + daily tasks */}
          {plan.cadence === 'daily' && plan.phases.map((ph, pi) => (
            <div key={pi} style={{ border: '1px solid var(--g-border)', borderLeft: '3px solid var(--g-dim-goal)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <input value={ph.name} onChange={e => setPhaseField(pi, 'name', e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 160, fontWeight: 600 }} />
                <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('execution.goalDecompose.phaseDayPrefix')}</span>
                <input type="number" min={1} value={ph.startDay} onChange={e => setPhaseField(pi, 'startDay', Number(e.target.value) || 1)} style={miniInput} />
                <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>–</span>
                <input type="number" min={1} value={ph.endDay} onChange={e => setPhaseField(pi, 'endDay', Number(e.target.value) || 1)} style={miniInput} />
                <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('execution.goalDecompose.phaseDaySuffix')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ph.dailyTasks.map((dt, ti) => (
                  <div key={ti} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ width: 14, height: 14, borderRadius: 999, background: 'var(--g-surface-2)', flexShrink: 0 }} />
                    <input value={dt.title} onChange={e => setTask(pi, ti, 'title', e.target.value)} style={inputStyle} />
                    <input type="number" min={5} max={240} value={dt.estimatedDuration} onChange={e => setTask(pi, ti, 'estimatedDuration', Number(e.target.value) || 5)} style={miniInput} />
                    <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('execution.goalDecompose.minutesSuffix')}</span>
                    <button type="button" onClick={() => removeTask(pi, ti)} style={delBtn}>✕</button>
                  </div>
                ))}
                <button type="button" style={{ ...ghostBtnStyle(), fontSize: fontVars.sm, padding: '4px 8px', alignSelf: 'flex-start' }} onClick={() => addTask(pi)}>
                  <IconPlus size={11} /> {t('execution.goalDecompose.addDailyTask')}
                </button>
              </div>
            </div>
          ))}

          {plan.cadence === 'milestone' && (
            <Section label={t('execution.goalDecompose.milestoneTasksLabel')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {plan.milestoneTasks.map((mt, i) => (
                  <div key={i} style={{ fontSize: fontVars.sm, color: 'var(--g-text)', display: 'flex', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--g-font-mono)', color: 'var(--g-text-faint)', flexShrink: 0 }}>{t('execution.goalDecompose.dayPrefix', { day: mt.day })}</span>
                    <span>{mt.title}</span>
                    <span style={{ marginLeft: 'auto', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{mt.estimatedDuration}{t('execution.goalDecompose.minutesSuffix')}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {error && <div style={{ fontSize: fontVars.sm, color: 'var(--g-danger)', textAlign: 'center' }}>{error}</div>}
        </div>
      )}
    </Modal>
  );
}

const delBtn: React.CSSProperties = {
  flexShrink: 0, width: 26, height: 28, borderRadius: 8, border: '1px solid var(--g-border)',
  background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', fontSize: fontVars.sm,
};

function Section({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text-mid)' }}>{label}</span>
        <span style={{ marginLeft: 'auto' }}>{action}</span>
      </div>
      {children}
    </div>
  );
}
