'use client';

// 经历卡（画像侧栏化改版新增）：把 milestone_events / failure_learnings 从
// 计数 MiniStat 升级成正经的叙事板块 —— 里程碑竖向时间线（按年分组、
// impact 高者加重）+ 经验教训列表 + 「重要的人」跳图鉴入口。
// failure_learnings 无 ts 字段，进不了时间线，单独成节。
import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { IconArrow } from '@/app/components/gedo/icons';
import { Pill, ScreenCard, ghostBtnStyle } from '@/app/components/gedo/primitives';
import { fontVars } from '@/app/components/gedo/typography';

export type Milestone = { event?: string; impact?: number; ts?: string; tags?: string[] };
export type Learning = { context?: string; lesson?: string; applied?: boolean };

const HIGH_IMPACT = 0.85;

export function ExperienceCard({ milestones, learnings, peopleCount, onGoCodex, onReorganize, reorganizing }: {
  milestones: Milestone[];
  learnings: Learning[];
  peopleCount: number;
  /** 「重要的人 N 位 →」跳图鉴 */
  onGoCodex?: () => void;
  /** 空态 CTA：复用一键梳理 */
  onReorganize?: () => void;
  reorganizing?: boolean;
}) {
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const locale = useLocale();

  const sorted = useMemo(
    () => milestones
      .filter(m => (m?.event ?? '').toString().trim())
      .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || ''))),
    [milestones],
  );
  const validLearnings = useMemo(
    () => learnings.filter(l => (l?.lesson ?? '').toString().trim()),
    [learnings],
  );
  const empty = sorted.length === 0 && validLearnings.length === 0;

  const dateLabel = (ts?: string) => {
    if (!ts) return null;
    try { return new Date(ts).toLocaleDateString(locale, { month: 'short', day: 'numeric' }); } catch { return null; }
  };
  const yearOf = (ts?: string) => {
    if (!ts) return null;
    const y = new Date(ts).getFullYear();
    return Number.isFinite(y) ? y : null;
  };

  return (
    <ScreenCard
      title={t('memory.profile.experience.title')}
      hint={t('memory.profile.experience.hint')}
      action={peopleCount > 0 && onGoCodex ? (
        <button type="button" style={{ ...ghostBtnStyle(), fontSize: fontVars.xs, padding: '4px 10px', minHeight: 30 }} onClick={onGoCodex}>
          {td('memory.profile.experience.peopleEntry', { n: peopleCount })} <IconArrow size={11} />
        </button>
      ) : undefined}
    >
      {empty ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, flex: 1, minWidth: 200, fontSize: fontVars.sm, color: 'var(--g-text-faint)', lineHeight: 1.6 }}>
            {t('memory.profile.experience.empty')}
          </p>
          {onReorganize && (
            <button type="button" style={{ ...ghostBtnStyle(), opacity: reorganizing ? 0.6 : 1 }} onClick={onReorganize} disabled={reorganizing}>
              {reorganizing ? t('memory.profile.reorganizing') : t('memory.profile.reorganize')}
            </button>
          )}
        </div>
      ) : (
        <>
          {sorted.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {sorted.map((m, i) => {
                const year = yearOf(m.ts);
                const prevYear = i > 0 ? yearOf(sorted[i - 1].ts) : null;
                const high = (m.impact ?? 0) >= HIGH_IMPACT;
                return (
                  <div key={i}>
                    {year != null && year !== prevYear && (
                      <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.06em', padding: i === 0 ? '0 0 6px' : '10px 0 6px' }}>
                        {year}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 12 }}>
                      {/* 时间线轨：圆点 + 竖线 */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 10, flexShrink: 0 }}>
                        <span style={{
                          width: high ? 9 : 7, height: high ? 9 : 7, borderRadius: 999, marginTop: 5, flexShrink: 0,
                          background: high ? 'var(--g-accent)' : 'var(--g-surface-2)',
                          border: `1.5px solid ${high ? 'var(--g-accent)' : 'var(--g-text-faint)'}`,
                        }} />
                        {i < sorted.length - 1 && <span style={{ width: 1.5, flex: 1, background: 'var(--g-border)', marginTop: 3 }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, paddingBottom: i < sorted.length - 1 ? 12 : 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: fontVars.sm, color: high ? 'var(--g-text)' : 'var(--g-text-mid)', fontWeight: high ? 600 : 400, lineHeight: 1.6 }}>
                            {m.event}
                          </span>
                          {dateLabel(m.ts) && (
                            <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', flexShrink: 0 }}>{dateLabel(m.ts)}</span>
                          )}
                        </div>
                        {(m.tags?.length ?? 0) > 0 && (
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                            {m.tags!.slice(0, 3).map((tag, j) => <Pill key={j}>{tag}</Pill>)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {validLearnings.length > 0 && (
            <div style={{ marginTop: sorted.length > 0 ? 14 : 0, paddingTop: sorted.length > 0 ? 12 : 0, borderTop: sorted.length > 0 ? '1px solid var(--g-border)' : 'none' }}>
              <div style={{ fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text-muted)', marginBottom: 8 }}>
                {t('memory.profile.experience.lessonsTitle')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {validLearnings.map((l, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6 }}>{l.lesson}</span>
                      {l.context && (
                        <span style={{ display: 'block', fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginTop: 2, lineHeight: 1.5 }}>{l.context}</span>
                      )}
                    </div>
                    {l.applied && <Pill tone="insight">{t('memory.profile.experience.lessonApplied')}</Pill>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </ScreenCard>
  );
}
