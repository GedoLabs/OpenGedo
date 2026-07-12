'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  IconInsight, IconSpark, IconBolt, IconCheck, IconWand, IconArrow, IconChev,
} from '@/app/components/gedo/icons';
import {
  Pill,
  primaryBtnStyle, ghostBtnStyle, chipBtnStyle,
} from '@/app/components/gedo/primitives';
import { fontVars, text } from '@/app/components/gedo/typography';
import { ReviewDetailModal, type ApiReview } from './ReviewDetailModal';
import { EmptyState } from '@/app/components/gedo/EmptyState';

type Period = 'weekly' | 'monthly';

type InsightStats = {
  period: Period;
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  activeGoals: number;
  newMemories: number;
  reflectionCount: number;
  avgECS: number;
  dailyCompletion: Record<string, { total: number; done: number }>;
};

type Suggestion = { type: 'warning' | 'praise' | 'tip'; text: string };

type ECSRecord = { date: string; total: number; completion_rate?: number; plan_stability?: number };

// 新用户默认空白：零值统计，无演示建议/趋势。真实数据从 API 加载。
const EMPTY_STATS: InsightStats = {
  period: 'weekly',
  totalTasks: 0,
  completedTasks: 0,
  completionRate: 0,
  activeGoals: 0,
  newMemories: 0,
  reflectionCount: 0,
  avgECS: 0,
  dailyCompletion: {},
};

export function InsightsScreen() {
  const { api } = useAuth();
  const t = useTranslations('app');
  const locale = useLocale();
  const [period, setPeriod] = useState<Period>('weekly');
  const [stats, setStats] = useState<InsightStats>(EMPTY_STATS);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ecsHistory, setEcsHistory] = useState<ECSRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reviews, setReviews] = useState<ApiReview[]>([]);
  const [activeReview, setActiveReview] = useState<ApiReview | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.getInsightStats(period)
      .then((s: unknown) => { if (!cancelled && s) setStats(s as InsightStats); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    api.getInsightSuggestions()
      .then((r: { suggestions?: Suggestion[] }) => {
        if (!cancelled && r?.suggestions?.length) setSuggestions(r.suggestions);
      })
      .catch(() => {});
    api.getECSHistory(period === 'monthly' ? 30 : 14)
      .then((r: { items?: ECSRecord[] }) => {
        if (!cancelled && r?.items?.length) setEcsHistory(r.items as ECSRecord[]);
      })
      .catch(() => {});
    api.listReviews()
      .then((r: { items?: ApiReview[] }) => {
        if (!cancelled) setReviews((r?.items as ApiReview[] ?? []).slice(0, 8));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, period, reloadKey]);

  const handleGenerateReview = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await api.generateReview(period) as ApiReview | { review?: ApiReview };
      const review = (res as { review?: ApiReview }).review ?? (res as ApiReview);
      if (review) {
        setActiveReview(review);
        setReloadKey(k => k + 1);
      }
    } catch { /* swallow */ }
    finally {
      setGenerating(false);
    }
  };

  const handleExportReport = () => {
    const lines: string[] = [
      `# ${t('insights.export.reportTitle')} · ${period === 'monthly' ? t('insights.export.monthly') : t('insights.export.weekly')}`,
      ``,
      `_${t('insights.export.exportedAt')}：${new Date().toLocaleString(locale)}_`,
      ``,
      `## ${t('insights.export.metrics')}`,
      `- ${t('insights.export.ecsMean')}：${stats.avgECS}`,
      `- ${t('insights.export.taskCompletion')}：${stats.completionRate}% (${stats.completedTasks}/${stats.totalTasks})`,
      `- ${t('insights.export.activeGoals')}：${stats.activeGoals}`,
      `- ${t('insights.export.newMemories')}：${stats.newMemories}`,
      `- ${t('insights.export.reflections')}：${stats.reflectionCount}`,
      ``,
      `## ${t('insights.export.aiSuggestions')}`,
      ...suggestions.map(s => `- [${s.type}] ${s.text}`),
      ``,
      `## ${t('insights.export.historyReviews')}`,
      ...reviews.map(r => `- ${r.period_type === 'monthly' ? t('insights.periodMonthShort') : t('insights.periodWeekShort')} · ${r.period_start ?? ''} → ${r.period_end ?? ''}：${r.summary ?? t('insights.export.noSummary')}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gedo-insights-${period}-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportSingleReview = (r: ApiReview) => {
    const lines = [
      `# ${r.period_type === 'monthly' ? t('insights.periodMonthShort') : t('insights.periodWeekShort')}${t('insights.export.reviewTitle')}`,
      ``,
      `${r.period_start ?? ''} → ${r.period_end ?? ''}`,
      ``,
      r.summary ? `## ${t('insights.overview')}\n\n${r.summary}\n` : '',
      r.highlights?.length ? `## ${t('insights.highlights')}\n\n${r.highlights.map(h => `- ${h}`).join('\n')}\n` : '',
      r.lowlights?.length ? `## ${t('insights.lowlights')}\n\n${r.lowlights.map(h => `- ${h}`).join('\n')}\n` : '',
      r.next_period_focus?.length ? `## ${t('insights.nextFocus')}\n\n${r.next_period_focus.map(h => `- ${h}`).join('\n')}\n` : '',
    ].filter(Boolean).join('\n');
    const blob = new Blob([lines], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gedo-review-${r.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--g-bg)' }}>
      <header
        className="gedo-screen-header"
        style={{
          minHeight: 60,
          flexShrink: 0,
          padding: '10px 28px',
          borderBottom: '1px solid var(--g-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--g-bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div className="gedo-hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--g-text-faint)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>
            <span>GEDO</span>
            <span style={{ opacity: 0.5 }}>/</span>
            <span style={{ color: 'var(--g-text-mid)' }}>{t('insights.brand')}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: fontVars.md, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.25 }}>
              {period === 'weekly' ? t('insights.titleWeek') : t('insights.titleMonth')}
            </h1>
            <p className="gedo-hide-mobile-subtitle" style={{ margin: '2px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.4 }}>
              {t('insights.subtitle', { days: period === 'weekly' ? 7 : 30 })}
            </p>
          </div>
        </div>
        <div className="gedo-screen-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 8, padding: 2 }}>
            {(['weekly', 'monthly'] as Period[]).map(p => {
              const active = p === period;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: '4px 12px',
                    border: 'none',
                    background: active ? 'var(--g-surface-2)' : 'transparent',
                    color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
                    borderRadius: 6,
                    fontSize: fontVars.sm,
                    cursor: 'pointer',
                    fontFamily: 'var(--g-font-sans)',
                  }}
                >
                  {p === 'weekly' ? t('insights.periodWeek') : t('insights.periodMonth')}
                </button>
              );
            })}
          </div>
          <button type="button" style={{ ...ghostBtnStyle(), fontSize: fontVars.sm }} onClick={handleGenerateReview} disabled={generating}>
            <IconWand size={14} /> <span className="gedo-btn-label">{generating ? t('insights.generating') : t('insights.aiReview')}</span>
          </button>
          <button type="button" style={{ ...primaryBtnStyle(), fontSize: fontVars.sm }} onClick={handleExportReport}>
            <IconArrow size={14} /> <span className="gedo-btn-label">{t('insights.exportReport')}</span>
          </button>
        </div>
      </header>

      {loaded && suggestions.length === 0 && ecsHistory.length === 0 && reviews.length === 0 && !stats.totalTasks && !stats.newMemories && !stats.reflectionCount && !stats.activeGoals ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '56px 28px' }}>
          <div style={{ width: '100%', maxWidth: 460 }}>
            <EmptyState
              icon={<IconInsight size={22} />}
              title={t('insights.emptyTitle')}
              hint={t('insights.emptyHint')}
            />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <main
          style={{
            flex: 1,
            minWidth: 0,
            padding: '24px 32px 32px',
            overflow: 'auto',
            borderRight: '1px solid var(--g-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
          }}
        >
          <KpiGrid stats={stats} />
          <EcsTrendCard history={ecsHistory} period={period} />
          <CompletionByDay stats={stats} />
          <ReviewsSection reviews={reviews} onOpen={setActiveReview} />
        </main>
        <InsightSidebar
          suggestions={suggestions}
          onRegenerate={() => setReloadKey(k => k + 1)}
        />
        </div>
      )}

      <ReviewDetailModal
        open={!!activeReview}
        onClose={() => setActiveReview(null)}
        review={activeReview}
        onExport={handleExportSingleReview}
      />
    </div>
  );
}

function ReviewsSection({
  reviews, onOpen,
}: {
  reviews: ApiReview[];
  onOpen: (r: ApiReview) => void;
}) {
  const t = useTranslations('app');
  if (!reviews.length) {
    return (
      <section
        style={{
          background: 'var(--g-surface-1)',
          border: '1px solid var(--g-border)',
          borderRadius: 14,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 500 }}>{t('insights.reviewsTitle')}</h3>
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
          {t('insights.reviewsEmpty')}
        </p>
      </section>
    );
  }
  return (
    <section
      style={{
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 14,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 500 }}>{t('insights.reviewsTitle')}</h3>
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.06em' }}>
          REVIEWS · {reviews.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {reviews.map(r => (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r)}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              background: 'var(--g-bg-raised)',
              border: '1px solid var(--g-border)',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: 'var(--g-font-sans)',
              color: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Pill tone={r.period_type === 'monthly' ? 'goal' : 'accent'}>
              {r.period_type === 'monthly' ? t('insights.periodMonthShort') : t('insights.periodWeekShort')}
            </Pill>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: fontVars.base, color: 'var(--g-text)', fontWeight: 500 }}>
                {r.period_start ?? ''} → {r.period_end ?? ''}
              </div>
              {r.summary && (
                <p
                  style={{
                    margin: '4px 0 0',
                    fontSize: fontVars.sm,
                    color: 'var(--g-text-muted)',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {r.summary}
                </p>
              )}
            </span>
            <IconChev size={14} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </section>
  );
}

type KpiTone = 'accent' | 'exec' | 'goal' | 'memory' | 'insight';

function KpiGrid({ stats }: { stats: InsightStats }) {
  const t = useTranslations('app');
  const items: { label: string; value: number | string; tone: KpiTone; delta: string; sub: string }[] = [
    {
      label: t('insights.kpi.ecsAvg'),
      value: stats.avgECS || 0,
      tone: 'accent',
      delta: '',
      sub: stats.avgECS >= 80 ? t('insights.kpi.ecsExcellent') : stats.avgECS >= 60 ? t('insights.kpi.ecsGood') : t('insights.kpi.ecsWatch'),
    },
    {
      label: t('insights.kpi.completionRate'),
      value: `${stats.completionRate}%`,
      tone: 'exec',
      delta: `${stats.completedTasks}/${stats.totalTasks}`,
      sub: t('insights.kpi.completionSub'),
    },
    {
      label: t('insights.kpi.activeGoals'),
      value: stats.activeGoals,
      tone: 'goal',
      delta: '',
      sub: t('insights.kpi.activeGoalsSub'),
    },
    {
      label: t('insights.kpi.newMemories'),
      value: stats.newMemories,
      tone: 'memory',
      delta: '',
      sub: t('insights.kpi.newMemoriesSub'),
    },
    {
      label: t('insights.kpi.reflections'),
      value: stats.reflectionCount,
      tone: 'insight',
      delta: '',
      sub: t('insights.kpi.reflectionsSub'),
    },
  ];
  return (
    <section className="gedo-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
      {items.map(it => (
        <KpiCard key={it.label} {...it} />
      ))}
    </section>
  );
}

function KpiCard({
  label, value, tone, delta, sub,
}: {
  label: string;
  value: number | string;
  tone: KpiTone;
  delta: string;
  sub: string;
}) {
  const color =
    tone === 'accent'  ? 'var(--g-accent)' :
    tone === 'exec'    ? 'var(--g-dim-exec)' :
    tone === 'goal'    ? 'var(--g-dim-goal)' :
    tone === 'memory'  ? 'var(--g-dim-memory)' :
    'var(--g-dim-insight)';
  return (
    <article
      style={{
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: fontVars.xl, fontWeight: 600, color, letterSpacing: '-0.02em', fontFeatureSettings: '"tnum"' }}>
          {value}
        </span>
        {delta && (
          <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {delta}
          </span>
        )}
      </div>
      <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-muted)' }}>{sub}</div>
    </article>
  );
}

function EcsTrendCard({ history, period }: { history: ECSRecord[]; period: Period }) {
  const t = useTranslations('app');
  const data = history.map(r => r.total ?? 0);
  if (data.length < 2) {
    return (
      <section
        style={{
          background: 'var(--g-surface-1)',
          border: '1px solid var(--g-border)',
          borderRadius: 14,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 220,
        }}
      >
        <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 500 }}>{t('insights.ecsTrend')}</h3>
        <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('insights.ecsNoData')}</div>
      </section>
    );
  }

  const w = 800, h = 160, pad = 16;
  const max = Math.max(...data, 100);
  const min = Math.min(...data, 0);
  const pts = data.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (data.length - 1);
    const y = pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`)).join(' ');
  const fill = d + ` L${pts[pts.length - 1][0]} ${h} L${pts[0][0]} ${h} Z`;
  const latest = data[data.length - 1];
  const first = data[0];
  const trend = latest - first;
  const trendLabel = trend > 0 ? `↑ ${trend}` : trend < 0 ? `↓ ${-trend}` : t('insights.trendFlat');
  const trendColor = trend > 0 ? 'var(--g-accent)' : trend < 0 ? 'var(--g-danger)' : 'var(--g-text-muted)';

  return (
    <section
      style={{
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 14,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 500 }}>{t('insights.ecsTrend')}</h3>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.06em' }}>
            {period === 'weekly' ? 'PAST 14 DAYS' : 'PAST 30 DAYS'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: fontVars.xl, fontWeight: 600, color: 'var(--g-text)', letterSpacing: '-0.02em', fontFeatureSettings: '"tnum"' }}>
            {latest}
          </span>
          <span style={{ fontSize: fontVars.sm, color: trendColor, fontFamily: 'var(--g-font-mono)' }}>{trendLabel}</span>
        </div>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="ecs-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--g-accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--g-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Horizontal grid: 0/50/100 */}
        {[0, 50, 100].map(v => {
          const y = pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
          return (
            <g key={v}>
              <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="var(--g-border)" strokeDasharray="2 4" opacity="0.5" />
              <text x={pad - 4} y={y + 3} textAnchor="end" fill="var(--g-text-faint)" style={{ fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)' }}>{v}</text>
            </g>
          );
        })}
        <path d={fill} fill="url(#ecs-grad)" />
        <path d={d} fill="none" stroke="var(--g-accent)" strokeWidth="1.6" />
        {pts.map((p, i) => i === pts.length - 1 && (
          <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="var(--g-accent)" />
        ))}
      </svg>
    </section>
  );
}

function CompletionByDay({ stats }: { stats: InsightStats }) {
  const t = useTranslations('app');
  const weekdays = t.raw('insights.weekdays') as string[];
  // Build last 7 days array using dailyCompletion shape: { 'YYYY-MM-DD': { total, done } }
  const days: { date: string; pct: number; label: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const rec = stats.dailyCompletion[key];
    const pct = rec && rec.total > 0 ? Math.round((rec.done / rec.total) * 100) : 0;
    days.push({
      date: key,
      pct,
      total: rec?.total ?? 0,
      label: weekdays[d.getDay()],
    });
  }

  const hasAny = days.some(d => d.total > 0);

  return (
    <section
      style={{
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 14,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 500 }}>{t('insights.completionByDay')}</h3>
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.06em' }}>
          {hasAny ? t('insights.last7') : t('insights.noData')}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 120 }}>
        {days.map(d => {
          const heightPct = Math.max(d.pct, 4);
          const isToday = d.date === new Date().toISOString().split('T')[0];
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                <div
                  style={{
                    width: '100%',
                    height: `${heightPct}%`,
                    background: d.total === 0
                      ? 'var(--g-surface-2)'
                      : isToday
                        ? 'var(--g-accent)'
                        : 'color-mix(in oklch, var(--g-accent) 40%, transparent)',
                    borderRadius: 6,
                    border: `1px solid ${d.total === 0 ? 'var(--g-border)' : 'var(--g-accent-line)'}`,
                  }}
                />
              </div>
              <div style={{ fontSize: fontVars.sm, color: isToday ? 'var(--g-text)' : 'var(--g-text-muted)', fontFamily: 'var(--g-font-mono)' }}>
                {d.label}
              </div>
              <div style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                {d.total > 0 ? `${d.pct}%` : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InsightSidebar({ suggestions, onRegenerate }: { suggestions: Suggestion[]; onRegenerate: () => void }) {
  const t = useTranslations('app');
  return (
    <aside
      className="gedo-aux-sidebar"
      style={{
        width: 340,
        flexShrink: 0,
        background: 'var(--g-bg-raised)',
        padding: '20px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflow: 'auto',
      }}
    >
      <Block title={t('insights.sidebarTitle')} mono="AI_SUGGESTIONS">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {suggestions.map((s, i) => <SuggestionCard key={i} suggestion={s} />)}
          {suggestions.length === 0 && (
            <div
              style={{
                padding: '18px 12px',
                textAlign: 'center',
                color: 'var(--g-text-faint)',
                fontSize: fontVars.sm,
                border: '1px dashed var(--g-border)',
                borderRadius: 12,
              }}
            >
              {t('insights.sidebarEmpty')}
            </div>
          )}
          <div style={{ marginTop: 4 }}>
            <button type="button" style={chipBtnStyle()} onClick={onRegenerate}>
              {t('insights.regenerate')} <IconWand size={11} />
            </button>
          </div>
        </div>
      </Block>
    </aside>
  );
}

function Block({ title, mono, children }: { title: string; mono?: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', fontWeight: 500 }}>{title}</span>
        {mono && <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.08em' }}>{mono}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const t = useTranslations('app');
  const cfg = {
    praise: { color: 'var(--g-accent)', icon: <IconCheck size={13} />, label: t('insights.suggestion.praise') },
    tip: { color: 'var(--g-dim-insight)', icon: <IconSpark size={13} />, label: t('insights.suggestion.tip') },
    warning: { color: 'var(--g-danger)', icon: <IconBolt size={13} />, label: t('insights.suggestion.warning') },
  }[suggestion.type] ?? { color: 'var(--g-text-muted)', icon: <IconSpark size={13} />, label: t('insights.suggestion.hint') };

  return (
    <article
      style={{
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        gap: 10,
      }}
    >
      <span
        style={{
          width: 22, height: 22, borderRadius: 6,
          background: `color-mix(in oklch, ${cfg.color} 14%, transparent)`,
          border: `1px solid color-mix(in oklch, ${cfg.color} 32%, transparent)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: cfg.color,
          flexShrink: 0,
        }}
      >
        {cfg.icon}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: fontVars.sm, color: cfg.color, fontFamily: 'var(--g-font-mono)', letterSpacing: '0.06em', marginBottom: 4 }}>
          {cfg.label}
        </div>
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.55 }}>{suggestion.text}</p>
      </div>
    </article>
  );
}

// 本周成就 / 下周聚焦 等写死的演示数据已移除；侧栏仅保留来自后端的真实「智伴洞察」。
