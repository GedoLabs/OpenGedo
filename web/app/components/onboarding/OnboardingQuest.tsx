'use client';

/**
 * OnboardingQuest — 人生快照 · 初始画像 modal (S0-5).
 *
 * Seven chapters, no enforced daily pacing — finish in one ~5-10 min sitting
 * or resume anytime from the saved server-side step. Triggered by /app layout
 * when `users.onboarding_step < 7`. Each chapter's answers are POSTed to
 * /v1/onboarding/step which:
 *   1. persists every answer as a memory item AND an episodic memory
 *      tagged ['identity', 'onboarding', 'dayN', questionId]
 *   2. immediately backfills profile.json / working.json (L1/L2/L3)
 *   3. bumps users.onboarding_step to max(current, day)
 *
 * On completion a summary screen shows the resulting profile completeness
 * (core memory slots) and links to the memory architecture view.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ChevronLeft, ChevronRight, X, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import type { MemoryStats } from '@/lib/apiClient';
import {
  TOTAL_DAYS,
  FINAL_STEP,
  QUEST_SEQUENCE,
  ringForDay,
  isRingFinalDay,
  knowLevelKey,
  type RingKey,
} from './quest-schema';
import { useQuestDays, type QuestDay, type QuestQuestion } from './useQuestDays';
import { fontVars } from '@/app/components/gedo/typography';

const seqPos = (day: number) => QUEST_SEQUENCE.indexOf(day);

type AnswersByDay = Record<number, Record<string, unknown>>;

interface OnboardingQuestProps {
  /** Saved server-side step (0..7). Modal opens at min(step+1, 7). */
  initialStep: number;
  /** Called after every successful POST so the parent can re-gate. */
  onStepChange?: (newStep: number) => void;
  /** Called when the user finishes day 7 or chooses 'done for today'. */
  onClose: () => void;
}

function emptyAnswersForDay(day: QuestDay): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const q of day.questions) {
    if (q.type === 'multi_short_text') out[q.id] = Array(q.count || 3).fill('');
    else if (q.type === 'rating_grid') {
      const grid: Record<string, number | null> = {};
      for (const dim of q.dimensions || []) grid[dim.key] = null;
      out[q.id] = grid;
    } else {
      out[q.id] = '';
    }
  }
  return out;
}

function isAnswerNonEmpty(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(v => typeof v === 'string' && v.trim().length > 0);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(v => v !== null && v !== '');
  }
  return Boolean(value);
}

function dayHasRequiredAnswers(day: QuestDay, answers: Record<string, unknown>): boolean {
  for (const q of day.questions) {
    if (q.optional) continue;
    if (!isAnswerNonEmpty(answers[q.id])) return false;
  }
  return true;
}

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--g-surface-2)',
  border: '1px solid var(--g-border)',
  color: 'var(--g-text)',
  borderRadius: 12,
  padding: '10px 16px',
  fontSize: fontVars.base,
  width: '100%',
  outline: 'none',
  transition: 'border-color 0.15s',
  fontFamily: 'var(--g-font-sans)',
};

function QuestionField({
  q, value, onChange, multiIndexLabel, essayLabels,
}: {
  q: QuestQuestion;
  value: unknown;
  onChange: (next: unknown) => void;
  multiIndexLabel: (placeholder: string, index: number, count: number) => string;
  essayLabels: { sayALittle: string; expandMore: string };
}) {
  // 作文题降门槛：long_text 默认折叠成一行"说一句也行"，想多写再展开。
  const [essayExpanded, setEssayExpanded] = useState(
    () => q.type === 'long_text' && String((value as string) || '').length > 60,
  );

  if (q.type === 'short_text') {
    return (
      <input
        type="text"
        value={(value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={q.placeholder}
        style={INPUT_STYLE}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--g-accent-line)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--g-border)'; }}
      />
    );
  }

  if (q.type === 'long_text') {
    if (!essayExpanded) {
      return (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={essayLabels.sayALittle}
            style={{ ...INPUT_STYLE, flex: 1 }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--g-accent-line)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--g-border)'; }}
          />
          <button
            type="button"
            onClick={() => setEssayExpanded(true)}
            className="flex-shrink-0 text-[length:var(--g-text-sm)] text-slate-500 hover:text-slate-300 transition-colors whitespace-nowrap"
          >
            {essayLabels.expandMore}
          </button>
        </div>
      );
    }
    return (
      <textarea
        rows={4}
        autoFocus
        value={(value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={q.placeholder}
        style={{ ...INPUT_STYLE, resize: 'none', lineHeight: 1.6 }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--g-accent-line)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--g-border)'; }}
      />
    );
  }

  if (q.type === 'multi_short_text') {
    const arr = (Array.isArray(value) ? (value as string[]) : []).slice();
    const count = q.count || 3;
    while (arr.length < count) arr.push('');
    return (
      <div className="space-y-2">
        {arr.slice(0, count).map((v, i) => (
          <input
            key={i}
            type="text"
            value={v}
            onChange={(e) => {
              const next = arr.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={multiIndexLabel(q.placeholder || '', i + 1, count)}
            style={{ ...INPUT_STYLE, padding: '8px 16px' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--g-accent-line)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--g-border)'; }}
          />
        ))}
      </div>
    );
  }

  if (q.type === 'rating_grid') {
    const grid = (value as Record<string, number | null>) || {};
    const min = q.scale?.min ?? 0;
    const max = q.scale?.max ?? 10;
    return (
      <div className="space-y-3">
        {(q.dimensions || []).map((dim) => {
          const v = grid[dim.key];
          return (
            <div key={dim.key} className="flex items-center gap-3">
              <span className="text-[length:var(--g-text-sm)] text-slate-300 w-16 flex-shrink-0">{dim.label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={v == null ? Math.floor((min + max) / 2) : v}
                onChange={(e) => onChange({ ...grid, [dim.key]: Number(e.target.value) })}
                className="flex-1 accent-violet-500"
              />
              <span className={`text-[length:var(--g-text-base)] font-mono w-7 text-right ${v == null ? 'text-slate-600' : 'text-violet-300'}`}>
                {v == null ? '—' : v}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}

export default function OnboardingQuest({
  initialStep,
  onStepChange,
  onClose,
}: OnboardingQuestProps) {
  const { api } = useAuth();
  const router = useRouter();
  const t = useTranslations('app.onboarding');
  const tApp = useTranslations('app');
  const questDays = useQuestDays();
  // Resume at the ring-sequence position after the server step marker.
  // The server still stores max(day) — with ring order this can point back
  // to the start of the core ring for a user who quit mid-core; the dots
  // allow skipping ahead, and the POST contract stays untouched.
  const startingDay = QUEST_SEQUENCE[
    Math.min(seqPos(initialStep) + 1, QUEST_SEQUENCE.length - 1)
  ] ?? QUEST_SEQUENCE[0];
  const [currentDay, setCurrentDay] = useState<number>(startingDay);
  const [answersByDay, setAnswersByDay] = useState<AnswersByDay>(() => ({}));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [completionStats, setCompletionStats] = useState<MemoryStats | null>(null);
  // 圈完成反馈：{ ring, percent } → 下一章顶部的"了解等级"横幅。
  const [ringBanner, setRingBanner] = useState<{ ring: RingKey; percent: number } | null>(null);
  const dayConfigRef = useRef<Map<number, QuestDay>>(new Map(questDays.map(d => [d.day, d])));

  const day = dayConfigRef.current.get(currentDay) ?? questDays.find(d => d.day === currentDay);

  useEffect(() => {
    dayConfigRef.current = new Map(questDays.map(d => [d.day, d]));
  }, [questDays]);

  // Initialize answers for the active day if not yet present.
  useEffect(() => {
    if (!day) return;
    setAnswersByDay((prev) => {
      if (prev[day.day]) return prev;
      return { ...prev, [day.day]: emptyAnswersForDay(day) };
    });
  }, [day]);

  const answers = day ? answersByDay[day.day] || {} : {};
  const canContinue = useMemo(() => (day ? dayHasRequiredAnswers(day, answers) : false), [day, answers]);

  if (!day) return null;

  const setQuestionValue = (id: string, next: unknown) => {
    setAnswersByDay((prev) => ({
      ...prev,
      [day.day]: { ...(prev[day.day] || {}), [id]: next },
    }));
  };

  async function handleSubmit({ skip }: { skip?: boolean } = {}) {
    setError(null);
    setSubmitting(true);
    setRingBanner(null);
    try {
      await api.submitOnboardingStep({
        day: day!.day,
        answers,
        skip: Boolean(skip),
      });
      const pos = seqPos(day!.day);
      if (pos >= QUEST_SEQUENCE.length - 1) {
        // Show the completion summary first; defer onStepChange until the
        // user leaves it (the parent gate unmounts this modal at step 7).
        setCompleted(true);
        api.getMemoryStats().then(setCompletionStats).catch(() => {});
        return;
      }
      // Use day.day (not result.step) so returning users re-opening the quest
      // don't get a server step = FINAL_STEP that collapses the gate.
      onStepChange?.(day!.day);
      // 完成一圈 → 取最新完成度，下一章顶部展示"了解等级"反馈。
      if (!skip && isRingFinalDay(day!.day)) {
        const ring = ringForDay(day!.day);
        api.getMemoryStats()
          .then(s => setRingBanner({ ring, percent: s.core_slots?.percent ?? 0 }))
          .catch(() => {});
      }
      setCurrentDay(QUEST_SEQUENCE[pos + 1]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveError'));
    } finally {
      setSubmitting(false);
    }
  }

  const goBack = () => {
    const pos = seqPos(currentDay);
    if (pos > 0) setCurrentDay(QUEST_SEQUENCE[pos - 1]);
  };

  const isLastDay = seqPos(day.day) >= QUEST_SEQUENCE.length - 1;

  // ── Completion summary — profile completeness + CTA to the arch view ──
  if (completed) {
    const slots = completionStats?.core_slots;
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
        >
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl my-auto p-7 text-center"
          >
            <span className="inline-flex w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 items-center justify-center mb-4">
              <Check className="w-6 h-6 text-white" />
            </span>
            <h2 className="text-lg font-bold text-white mb-1.5">{t('completion.title')}</h2>
            <p className="text-[length:var(--g-text-base)] text-slate-400 leading-relaxed mb-5">
              {t('completion.body')}
              {slots ? ` ${t('completion.slotsFilled', { filled: slots.filled, total: slots.total })}` : ''}
            </p>
            {slots && (
              <>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden mb-2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500"
                    style={{ width: `${slots.percent}%` }}
                  />
                </div>
                <p className="text-[length:var(--g-text-sm)] text-slate-500 font-mono mb-4">
                  {t('completion.completeness', { percent: slots.percent })}
                  {' · '}
                  {t('knowLevelLabel')}：{tApp(`memory.knowLevels.${knowLevelKey(slots.percent)}` as Parameters<typeof tApp>[0])}
                </p>
                <div className="flex flex-wrap justify-center gap-1.5 mb-5">
                  {slots.slots.map(s => (
                    <span
                      key={s.id}
                      className={`text-[length:var(--g-text-sm)] px-2.5 py-0.5 rounded-full border ${
                        s.filled
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                          : 'border-slate-700 text-slate-500'
                      }`}
                    >
                      {s.filled ? '✓ ' : '○ '}{s.label}
                    </span>
                  ))}
                </div>
              </>
            )}
            <p className="text-[length:var(--g-text-sm)] text-slate-500 leading-relaxed mb-6">
              {t('completion.hint')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => { onStepChange?.(FINAL_STEP); onClose(); router.push('/app/memory'); }}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-[length:var(--g-text-base)] font-medium transition-all shadow-lg shadow-violet-900/30"
              >
                {t('completion.viewMemory')}
              </button>
              <button
                onClick={() => { onStepChange?.(FINAL_STEP); onClose(); router.push('/app/companion'); }}
                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 text-[length:var(--g-text-base)] transition-colors"
              >
                {t('completion.startChat')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      >
        <motion.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl my-auto"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </span>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span className="text-slate-500 font-mono text-[length:var(--g-text-sm)]">{seqPos(day.day) + 1}/{TOTAL_DAYS}</span>
                  {day.title}
                  <span className="text-[length:var(--g-text-sm)] font-normal px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                    {t(`rings.${ringForDay(day.day)}`)}
                  </span>
                  <span className="text-[length:var(--g-text-sm)] font-mono font-normal px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-300">
                    {day.layer} {day.layerLabel}
                  </span>
                </h2>
                <p className="text-[length:var(--g-text-sm)] text-slate-500">{t('subtitle')}</p>
              </div>
            </div>
            <button
              onClick={() => onClose()}
              title={t('later')}
              className="p-2 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Progress dots — ring order (基础 → 生活 → 内核) */}
          <div className="px-6 pt-3">
            <div className="flex items-center gap-1.5">
              {QUEST_SEQUENCE.map((dayNo, pos) => {
                const d = dayConfigRef.current.get(dayNo);
                const done = pos <= seqPos(initialStep);
                const active = dayNo === day.day;
                const reachable = pos <= Math.max(seqPos(currentDay), seqPos(initialStep) + 1);
                return (
                  <button
                    key={dayNo}
                    onClick={() => { if (reachable) setCurrentDay(dayNo); }}
                    title={d?.title}
                    className={`flex-1 h-1.5 rounded-full transition-colors ${
                      active
                        ? 'bg-violet-400'
                        : done
                        ? 'bg-emerald-500/60 hover:bg-emerald-500'
                        : 'bg-slate-700/60'
                    }`}
                  />
                );
              })}
            </div>
            {ringBanner && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[length:var(--g-text-sm)] text-emerald-300">
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="flex-1">
                  {t('ringDone', { ring: t(`rings.${ringBanner.ring}`) })} · {t('knowLevelLabel')}：
                  {tApp(`memory.knowLevels.${knowLevelKey(ringBanner.percent)}` as Parameters<typeof tApp>[0])}（{ringBanner.percent}%）
                </span>
                <button onClick={() => setRingBanner(null)} className="text-emerald-400/70 hover:text-emerald-200">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <p className="text-[length:var(--g-text-sm)] text-slate-500 mt-2">{day.intro}</p>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
            {day.questions.map((q) => (
              <div key={q.id} className="space-y-1.5">
                <label className="block text-[length:var(--g-text-base)] font-medium text-slate-200">
                  {q.label}
                  {q.optional && <span className="text-[length:var(--g-text-sm)] text-slate-600 ml-1.5">{t('optional')}</span>}
                </label>
                {t.has(`benefit.${q.id}` as Parameters<typeof t>[0]) && (
                  <p className="text-[length:var(--g-text-sm)] text-emerald-400/80">
                    ✦ {t(`benefit.${q.id}` as Parameters<typeof t>[0])}
                  </p>
                )}
                {q.hint && <p className="text-[length:var(--g-text-sm)] text-slate-500 italic">{q.hint}</p>}
                <QuestionField
                  q={q}
                  value={answers[q.id]}
                  onChange={(next) => setQuestionValue(q.id, next)}
                  multiIndexLabel={(placeholder, index, count) => t('multiIndex', { placeholder, index, count })}
                  essayLabels={{ sayALittle: t('sayALittle'), expandMore: t('expandMore') }}
                />
              </div>
            ))}
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-[length:var(--g-text-sm)] text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-800">
            <button
              onClick={goBack}
              disabled={currentDay <= 1 || submitting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[length:var(--g-text-base)] text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
            >
              <ChevronLeft className="w-4 h-4" /> {t('prevChapter')}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSubmit({ skip: true })}
                disabled={submitting}
                className="text-[length:var(--g-text-sm)] text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
              >
                {t('skipChapter')}
              </button>
              <button
                onClick={() => handleSubmit({ skip: false })}
                disabled={!canContinue || submitting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-[length:var(--g-text-base)] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-900/30"
              >
                {submitting ? t('saving') : isLastDay ? (<>{t('finish')} <Check className="w-4 h-4" /></>) : (<>{t('continue')} <ChevronRight className="w-4 h-4" /></>)}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export { TOTAL_DAYS, FINAL_STEP };
