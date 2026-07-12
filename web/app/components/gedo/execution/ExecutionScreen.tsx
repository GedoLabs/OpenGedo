'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  IconWand, IconPlus, IconCheck, IconTarget, IconCal, IconChev, IconFlag,
} from '@/app/components/gedo/icons';
import {
  Pill, Dot,
  primaryBtnStyle, ghostBtnStyle, chipBtnStyle,
} from '@/app/components/gedo/primitives';
import { fontVars, text } from '@/app/components/gedo/typography';
import { TaskCreateModal } from './TaskCreateModal';
import GoalDetailModal from '@/app/components/planner/GoalDetailModal';
import { ObstacleMatchModal } from './ObstacleMatchModal';
import { DailyPlanReviewModal } from './DailyPlanReviewModal';
import { EveningReflectionModal } from './EveningReflectionModal';
import { TaskBreakdownModal } from './TaskBreakdownModal';
import { GoalDecomposeModal } from './GoalDecomposeModal';

// ── Types matching the backend store shape ────────────────────────────
type ApiTask = {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done' | 'skipped' | 'cancelled' | string;
  energy_level?: 'high' | 'medium' | 'low' | string;
  estimated_duration?: number;
  due_date?: string | null;
  scheduled_date?: string | null;
  goal_id?: string | null;
  goal_title?: string;
  priority?: string;
  is_mit?: boolean;
  scheduled_time?: string;
  started_at?: string;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
};

type ApiGoal = {
  id: string;
  title: string;
  life_wheel_dimension?: string;
  status?: string;
  progress?: number;
  due_date?: string | null;
  level?: string;
  parent_id?: string | null;
  decomposed?: boolean;
  child_count?: number;
  task_count?: number;
};

type ApiIfThen = {
  id: string;
  if_condition: string;
  then_action: string;
  triggered_count?: number;
  executed_count?: number;
};

type ApiECS = {
  total: number;
  completion_rate?: number;
  plan_stability?: number;
  reflection_completed?: boolean;
  date?: string;
};

// ── Local UI row types ────────────────────────────────────────────────
type TaskRow = {
  id?: string;
  time: string;
  title: string;
  status: 'done' | 'in_progress' | 'todo' | 'skipped';
  current?: boolean;   // UI 启发式：建议「现在做」的那一项（高亮，非真实状态）
  goal?: string;
  energy: 'H' | 'M' | 'L';
  dur: string;
  durMin: number;
  needsFlow: boolean;  // true → 走 开始→进行中→完成；false → 一键完成
  startedAt?: string;
  mit?: boolean;
  isNew?: boolean;
};

type CheckinStatus = 'todo' | 'in_progress' | 'done' | 'skipped';

// A day bucket for the 未来 / 历史 scopes.
type DayGroup = { key: string; label: string; rows: TaskRow[] };

function timeFromTask(t: ApiTask, idx: number): string {
  if (t.scheduled_time) {
    return t.scheduled_time.length >= 16 ? t.scheduled_time.slice(11, 16) : t.scheduled_time;
  }
  // Spread tasks across the day if no explicit schedule.
  const hr = 8 + idx * 2;
  return `${String(hr).padStart(2, '0')}:00`;
}

function mapEnergy(e?: string): TaskRow['energy'] {
  return e === 'high' || e === 'H' ? 'H' : e === 'low' || e === 'L' ? 'L' : 'M';
}

// 智能混合：预计 ≥25 分钟或 MIT（专注类）任务走 待办→进行中→完成 三态；
// 其余快速任务一键完成。集中定义，前后端语义一致。
const FLOW_MIN_DURATION = 25;
function taskNeedsFlow(t: ApiTask): boolean {
  return (t.estimated_duration ?? 30) >= FLOW_MIN_DURATION || !!t.is_mit;
}

// ── Date helpers for 今日 / 未来 / 历史 partitioning ──────────────────────
// Returns a local 'YYYY-MM-DD' key. Pure calendar-date strings are kept
// verbatim (no timezone shift); full timestamps are resolved to local date.
function dayKeyOf(value?: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

type Tr = (key: string, values?: Record<string, string | number>) => string;

function dayLabel(key: string, todayKey: string, t: Tr, weekdays: string[]): string {
  if (!key) return t('execution.dayLabel.unscheduled');
  const [yy, mm, dd] = key.split('-').map(Number);
  const dt = new Date(yy, mm - 1, dd);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const today = new Date(ty, tm - 1, td);
  const diff = Math.round((dt.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return t('execution.dayLabel.today');
  if (diff === 1) return t('execution.dayLabel.tomorrow');
  if (diff === -1) return t('execution.dayLabel.yesterday');
  if (diff === 2) return t('execution.dayLabel.dayAfterTomorrow');
  return t('execution.dayLabel.dateFormat', { mm, dd, wd: weekdays[dt.getDay()] ?? '' });
}

// Group rows by day key (preserving insertion order of keys) into DayGroups.
function groupByDay(
  entries: { key: string; row: TaskRow }[],
  todayKey: string,
  order: 'asc' | 'desc',
  t: Tr,
  weekdays: string[],
): DayGroup[] {
  const map = new Map<string, TaskRow[]>();
  for (const { key, row } of entries) {
    const k = key || '';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(row);
  }
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === b) return 0;
    if (!a) return 1;            // undated bucket last
    if (!b) return -1;
    return order === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
  });
  return keys.map(k => ({ key: k, label: dayLabel(k, todayKey, t, weekdays), rows: map.get(k)! }));
}

function apiTaskToRow(t: ApiTask, idx: number): TaskRow {
  const durMin = t.estimated_duration ?? 30;
  const status: TaskRow['status'] =
    t.status === 'done' ? 'done'
    : t.status === 'skipped' ? 'skipped'
    : t.status === 'in_progress' ? 'in_progress'
    : 'todo';
  return {
    id: t.id,
    time: timeFromTask(t, idx),
    title: t.title,
    status,
    goal: t.goal_title || undefined,
    energy: mapEnergy(t.energy_level),
    dur: `${durMin}m`,
    durMin,
    needsFlow: taskNeedsFlow(t),
    startedAt: t.started_at,
    mit: !!t.is_mit,
  };
}

export function ExecutionScreen({ tabs }: { tabs?: ReactNode } = {}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const locale = useLocale();
  const weekdays = t.raw('execution.weekdays') as string[];
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const weekday = weekdays[date.getDay()];

  const todayKey = `${y}-${m}-${d}`;

  // 新用户默认空白：真实数据从 API 加载。执行页按时间维度切分为 今日 / 未来 / 历史，
  // 默认优先展示今日；未来=已排期到今日之后的待办，历史=已完成/已跳过的记录。
  const [allTasks, setAllTasks] = useState<ApiTask[]>([]);
  const [goals, setGoals] = useState<ApiGoal[]>([]);
  const [obstacles, setObstacles] = useState<ApiIfThen[]>([]);
  const [ecs, setEcs] = useState<ApiECS | null>(null);
  const [scope, setScope] = useState<'today' | 'upcoming' | 'history'>('today');
  const [filter, setFilter] = useState<'all' | 'mit' | 'open'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [blockedTask, setBlockedTask] = useState<{ id: string; title: string } | null>(null);
  const [breakdownFor, setBreakdownFor] = useState<{ id: string; title: string } | null>(null);
  const [planGoal, setPlanGoal] = useState<{ id: string; title: string } | null>(null);
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);

  const loadTasks = useCallback(() => {
    api.listTasks()
      .then(res => { setAllTasks((res?.items as ApiTask[]) ?? []); })
      .catch(() => { /* keep current */ });
  }, [api]);

  const loadGoals = useCallback(() => {
    api.listGoals()
      .then(res => {
        const active = ((res?.items as ApiGoal[]) ?? []).filter(g => !g.parent_id && g.status !== 'completed' && g.status !== 'archived').slice(0, 6);
        setGoals(active);
      })
      .catch(() => { /* keep current */ });
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    loadTasks();

    api.listGoals()
      .then(res => {
        if (cancelled || !res?.items?.length) return;
        const active = (res.items as ApiGoal[])
          .filter(g => !g.parent_id && g.status !== 'completed' && g.status !== 'archived')
          .slice(0, 6);
        if (active.length) setGoals(active);
      })
      .catch(() => { /* keep demo */ });

    api.listObstacleCards()
      .then(res => {
        if (cancelled || !res?.items?.length) return;
        const cards = (res.items as ApiIfThen[]).slice(0, 4);
        if (cards.length) setObstacles(cards);
      })
      .catch(() => { /* keep demo */ });

    api.getECSHistory(1)
      .then(res => {
        if (cancelled || !res?.items?.length) return;
        const latest = res.items[res.items.length - 1] as ApiECS;
        if (latest) setEcs(latest);
      })
      .catch(() => { /* keep demo */ });

    return () => { cancelled = true; };
  }, [api, loadTasks]);

  // Split every task into today / upcoming / history by schedule date + status.
  const { todayRows, upcomingGroups, historyGroups, upcomingCount, historyCount } = useMemo(() => {
    const schedKeyOf = (t: ApiTask) => dayKeyOf(t.scheduled_date ?? null) ?? dayKeyOf(t.due_date ?? null);
    const isActive = (s: string) => s === 'todo' || s === 'in_progress';
    const isClosed = (s: string) => s === 'done' || s === 'skipped';

    const todayList: ApiTask[] = [];
    const upcomingEntries: { key: string; row: TaskRow }[] = [];
    const historyEntries: { key: string; row: TaskRow }[] = [];

    for (const t of allTasks) {
      const sk = schedKeyOf(t);
      if (isActive(t.status)) {
        // Future-dated → 未来；otherwise (undated / overdue / due today) → 今日。
        if (sk && sk > todayKey) upcomingEntries.push({ key: sk, row: apiTaskToRow(t, 0) });
        else todayList.push(t);
      } else if (isClosed(t.status)) {
        const ck = dayKeyOf(t.updated_at ?? t.created_at ?? null) ?? '';
        historyEntries.push({ key: ck, row: apiTaskToRow(t, 0) });
        // 今日「完成」的任务也保留在今日视图（跳过的只进历史，避免显示成可执行项）。
        if (t.status === 'done' && ck === todayKey) todayList.push(t);
      }
    }

    const tRows = todayList.map((t, i) => apiTaskToRow(t, i));
    // 标记「建议现在做」的一项（仅 UI 高亮）：优先已在进行中的任务，否则第一条待办。
    const inProgressIdx = tRows.findIndex(r => r.status === 'in_progress');
    const currentIdx = inProgressIdx >= 0 ? inProgressIdx : tRows.findIndex(r => r.status === 'todo');
    if (currentIdx >= 0) {
      tRows[currentIdx] = { ...tRows[currentIdx], current: true };
    }

    return {
      todayRows: tRows,
      upcomingGroups: groupByDay(upcomingEntries, todayKey, 'asc', t, weekdays),
      historyGroups: groupByDay(historyEntries, todayKey, 'desc', t, weekdays),
      upcomingCount: upcomingEntries.length,
      historyCount: historyEntries.length,
    };
  }, [allTasks, todayKey, t, weekdays]);

  const doneCount = todayRows.filter(row => row.status === 'done').length;
  const mitCount  = todayRows.filter(row => row.mit).length;
  const ecsTotal  = ecs?.total ?? 76;
  const ecsLabel  = ecsTotal >= 80 ? t('execution.ecsLabel.excellent') : ecsTotal >= 60 ? t('execution.ecsLabel.good') : ecsTotal >= 40 ? t('execution.ecsLabel.fair') : t('execution.ecsLabel.watch');

  const visibleTodayRows = useMemo(() => {
    if (filter === 'mit') return todayRows.filter(t => t.mit);
    if (filter === 'open') return todayRows.filter(t => t.status !== 'done' && t.status !== 'skipped');
    return todayRows;
  }, [todayRows, filter]);

  const handleCheckin = useCallback(async (taskId: string, status: CheckinStatus) => {
    const nowIso = new Date().toISOString();
    try {
      await api.checkin(taskId, { status });
      // Optimistic update + refresh. 「开始」时本地补上 started_at 以便立即计时。
      setAllTasks(prev => prev.map(t => t.id === taskId ? {
        ...t,
        status,
        started_at: status === 'in_progress' && !t.started_at ? nowIso : t.started_at,
        updated_at: nowIso,
      } : t));
      loadTasks();
    } catch { /* swallow */ }
  }, [api, loadTasks]);

  const handleObstacle = useCallback((task: TaskRow) => {
    if (!task.id) return;
    setBlockedTask({ id: task.id, title: task.title });
  }, []);

  const handleBreakdown = useCallback((task: TaskRow) => {
    if (!task.id) return;
    setBreakdownFor({ id: task.id, title: task.title });
  }, []);

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
            <span style={{ color: 'var(--g-text-mid)' }}>{t('execution.brand')}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: fontVars.md, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.25 }}>{t('execution.brand')}</h1>
            <p className="gedo-hide-mobile-subtitle" style={{ margin: '2px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.4 }}>{t('execution.subtitle')}</p>
          </div>
        </div>
        <div className="gedo-screen-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {tabs}
          <div
            className="gedo-hide-mobile"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: 'var(--g-surface-1)',
              border: '1px solid var(--g-border)',
              borderRadius: 999,
              fontSize: fontVars.sm,
            }}
          >
            <span style={{ color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>ECS</span>
            <span style={{ fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-accent)' }}>{ecsTotal}</span>
            <span style={{ color: 'var(--g-accent)', fontSize: fontVars.xs }}>{ecsLabel}</span>
          </div>
          <button type="button" style={{ ...ghostBtnStyle(), fontSize: fontVars.sm }} onClick={() => setReflectionOpen(true)} title={t('execution.eveningReview')}>
            <IconCal size={14} /> <span className="gedo-btn-label">{t('execution.eveningReview')}</span>
          </button>
          <button type="button" style={{ ...ghostBtnStyle(), fontSize: fontVars.sm }} onClick={() => setPlanOpen(true)}>
            <IconWand size={14} /> <span className="gedo-btn-label">{t('execution.replan')}</span>
          </button>
          <button type="button" style={{ ...primaryBtnStyle(), fontSize: fontVars.sm }} onClick={() => setAddOpen(true)}>
            <IconPlus size={14} /> <span className="gedo-btn-label">{t('execution.addTask')}</span>
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <main
          className="gedo-content-padded"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '20px 32px 28px',
            overflow: 'auto',
            borderRight: '1px solid var(--g-border)',
          }}
        >
          <div className="gedo-exec-date-line" style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: fontVars.lg, fontWeight: 600, letterSpacing: '-0.01em' }}>{weekday} · {y} / {m} / {d}</span>
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
              {scope === 'today'
                ? t('execution.dateLine.todayPlanned', { n: todayRows.length })
                : scope === 'upcoming'
                ? t('execution.dateLine.upcomingPlanned', { n: upcomingCount })
                : t('execution.dateLine.historyDone', { n: historyCount })}
            </span>
          </div>
          <DailyHero done={doneCount} total={todayRows.length} mitPending={mitCount > 0 && !todayRows.some(t => t.status === 'in_progress' && t.mit)} />
          <ScheduleSection
            scope={scope}
            onScopeChange={setScope}
            todayRows={visibleTodayRows}
            todayAllCount={todayRows.length}
            mitCount={mitCount}
            filter={filter}
            onFilterChange={setFilter}
            upcomingGroups={upcomingGroups}
            historyGroups={historyGroups}
            upcomingCount={upcomingCount}
            historyCount={historyCount}
            onCheckin={handleCheckin}
            onObstacle={handleObstacle}
            onBreakdown={handleBreakdown}
          />
        </main>
        <ExecSidebar goals={goals} obstacles={obstacles} onPlan={(g) => setPlanGoal({ id: g.id, title: g.title })} onOpenDetail={(g) => setDetailGoalId(g.id)} />
      </div>

      <TaskCreateModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => loadTasks()}
      />
      <ObstacleMatchModal
        open={!!blockedTask}
        onClose={() => setBlockedTask(null)}
        taskId={blockedTask?.id ?? null}
        taskTitle={blockedTask?.title ?? ''}
        onResolved={() => { setBlockedTask(null); loadTasks(); }}
      />
      <TaskBreakdownModal
        open={!!breakdownFor}
        onClose={() => setBreakdownFor(null)}
        taskId={breakdownFor?.id ?? null}
        taskTitle={breakdownFor?.title ?? ''}
        onApplied={() => { setBreakdownFor(null); loadTasks(); }}
      />
      <GoalDecomposeModal
        open={!!planGoal}
        onClose={() => setPlanGoal(null)}
        goalId={planGoal?.id ?? null}
        goalTitle={planGoal?.title ?? ''}
        onCommitted={() => { setPlanGoal(null); loadTasks(); loadGoals(); }}
      />
      <GoalDetailModal
        goalId={detailGoalId}
        open={!!detailGoalId}
        onClose={() => setDetailGoalId(null)}
        onChanged={() => { loadTasks(); loadGoals(); }}
      />
      <DailyPlanReviewModal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        onAccepted={() => { setPlanOpen(false); loadTasks(); }}
      />
      <EveningReflectionModal
        open={reflectionOpen}
        onClose={() => setReflectionOpen(false)}
        completionRate={todayRows.length > 0 ? Math.round((doneCount / todayRows.length) * 100) : 0}
        taskTotal={todayRows.length}
      />
    </div>
  );
}

function DailyHero({ done, total, mitPending }: { done: number; total: number; mitPending: boolean }) {
  const t = useTranslations('app');
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <section className="gedo-exec-daily-hero" style={{ marginBottom: 22, display: 'flex', gap: 14 }}>
      <div
        style={{
          flex: 1.4,
          background: 'var(--g-surface-1)',
          border: '1px solid var(--g-border)',
          borderRadius: 14,
          padding: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <Ring percent={percent} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: fontVars['2xl'], fontWeight: 600, color: 'var(--g-text)', letterSpacing: '-0.02em', fontFeatureSettings: '"tnum"' }}>
              {done}<span style={{ color: 'var(--g-text-faint)' }}>/{total}</span>
            </span>
            <span style={{ fontSize: fontVars.base, color: 'var(--g-text-muted)' }}>
              {t('execution.hero.completedToday')}{mitPending ? t('execution.hero.mitNotStarted') : ''}
            </span>
          </div>
          <p style={{ margin: '6px 0 12px', fontSize: fontVars.base, color: 'var(--g-text-mid)', lineHeight: 1.55 }}>
            {t.rich('execution.hero.focusTip', { b: (chunks) => <b style={{ color: 'var(--g-text)' }}>{chunks}</b> })}
          </p>
          <div className="gedo-exec-hero-stats" style={{ display: 'flex', gap: 12, fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>
            <span>{t('execution.hero.completedPct', { pct: percent })}</span>
            <span style={{ opacity: 0.3 }}>·</span>
            <span>{t('execution.hero.planStable')}</span>
            <span style={{ opacity: 0.3 }}>·</span>
            <span>{t('execution.hero.reviewPending')}</span>
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          background: 'var(--g-surface-1)',
          border: '1px solid var(--g-border)',
          borderRadius: 14,
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: 500 }}>{t('execution.hero.energyCurveTitle')}</span>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{t('execution.hero.past14')}</span>
        </div>
        <div className="gedo-energy-curve-wrap">
          <EnergyCurve />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', marginTop: 4 }}>
          <span>06</span>
          <span>09</span>
          <span>12</span>
          <span>15</span>
          <span>18</span>
          <span>21</span>
        </div>
      </div>
    </section>
  );
}

function Ring({ percent }: { percent: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const off = c * (1 - percent / 100);
  return (
    <svg width={96} height={96} style={{ flexShrink: 0 }}>
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--g-surface-2)" strokeWidth="6" />
      <circle
        cx="48" cy="48" r={r}
        fill="none" stroke="var(--g-accent)" strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform="rotate(-90 48 48)"
      />
      <text
        x="48" y="52" textAnchor="middle"
        fill="var(--g-text)"
        style={{ fontSize: fontVars.lg, fontWeight: 600, fontFamily: 'var(--g-font-mono)' }}
      >
        {percent}%
      </text>
    </svg>
  );
}

function EnergyCurve() {
  const t = useTranslations('app');
  const data = [0.3, 0.5, 0.7, 0.85, 0.9, 0.82, 0.65, 0.55, 0.6, 0.68, 0.58, 0.42, 0.3, 0.25];
  const w = 380;
  const h = 92;
  const padX = 6;
  const padTop = 16;   // reserved band for "现在"
  const padBottom = 6;
  const chartH = h - padTop - padBottom;
  const labelStyle = { fontSize: fontVars['2xs'], fontFamily: 'var(--g-font-mono)' } as const;

  const pts = data.map((v, i) => {
    const x = padX + (i * (w - padX * 2)) / (data.length - 1);
    const y = padTop + (1 - v) * chartH;
    return [x, y] as const;
  });
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`)).join(' ');
  const fill = d + ` L${pts[pts.length - 1][0]} ${h - padBottom} L${pts[0][0]} ${h - padBottom} Z`;
  const peakX = pts[4][0];
  const peakY = pts[4][1];
  const nowX = pts[6][0];
  const labelsClose = nowX - peakX < 72;
  // Peak sits high on the curve — label below the dot to avoid top clipping.
  const peakBelow = peakY < padTop + chartH * 0.35;
  const peakLabelY = peakBelow ? peakY + 11 : peakY - 5;
  const peakLabelX = labelsClose ? peakX - 5 : peakX + 5;
  const peakAnchor = labelsClose ? 'end' : 'start';

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="ec-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--g-accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--g-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={nowX} y1={padTop} x2={nowX} y2={h - padBottom} stroke="var(--g-border)" strokeDasharray="2 3" />
      <text
        x={nowX + 4}
        y={11}
        fill="var(--g-text-faint)"
        style={labelStyle}
      >
        {t('execution.hero.now')}
      </text>
      <path d={fill} fill="url(#ec-grad)" />
      <path d={d} fill="none" stroke="var(--g-accent)" strokeWidth="1.5" />
      <circle cx={peakX} cy={peakY} r="3" fill="var(--g-dim-goal)" />
      <text
        x={peakLabelX}
        y={peakLabelY}
        textAnchor={peakAnchor}
        fill="var(--g-dim-goal)"
        style={labelStyle}
      >
        {t('execution.hero.peak')}
      </text>
    </svg>
  );
}

type Scope = 'today' | 'upcoming' | 'history';

function ScheduleSection({
  scope, onScopeChange,
  todayRows, todayAllCount, mitCount, filter, onFilterChange,
  upcomingGroups, historyGroups, upcomingCount, historyCount,
  onCheckin, onObstacle, onBreakdown,
}: {
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  todayRows: TaskRow[];
  todayAllCount: number;
  mitCount: number;
  filter: 'all' | 'mit' | 'open';
  onFilterChange: (f: 'all' | 'mit' | 'open') => void;
  upcomingGroups: DayGroup[];
  historyGroups: DayGroup[];
  upcomingCount: number;
  historyCount: number;
  onCheckin: (taskId: string, status: CheckinStatus) => void;
  onObstacle: (task: TaskRow) => void;
  onBreakdown: (task: TaskRow) => void;
}) {
  const t = useTranslations('app');
  const title = scope === 'today' ? t('execution.schedule.todayTimeline') : scope === 'upcoming' ? t('execution.schedule.upcomingTasks') : t('execution.schedule.historyRecord');
  const meta =
    scope === 'today' ? `TODAY · ${todayAllCount} ITEMS · ${mitCount} MIT` :
    scope === 'upcoming' ? `UPCOMING · ${upcomingCount} ITEMS` :
    `HISTORY · ${historyCount} ITEMS`;

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 600 }}>{title}</h3>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.06em' }}>
            {meta}
          </span>
        </div>
        <div className="gedo-schedule-chips" style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={chipBtnStyle(scope === 'today')} onClick={() => onScopeChange('today')}>{t('execution.schedule.todayChip')}</button>
          <button type="button" style={chipBtnStyle(scope === 'upcoming')} onClick={() => onScopeChange('upcoming')}>
            {t('execution.schedule.upcomingChip', { count: upcomingCount > 0 ? ` · ${upcomingCount}` : '' })}
          </button>
          <button type="button" style={chipBtnStyle(scope === 'history')} onClick={() => onScopeChange('history')}>
            {t('execution.schedule.historyChip', { count: historyCount > 0 ? ` · ${historyCount}` : '' })}
          </button>
        </div>
      </div>

      {scope === 'today' && (
        <>
          <div className="gedo-schedule-chips" style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: -4, marginBottom: 12 }}>
            <button type="button" style={chipBtnStyle(filter === 'all')} onClick={() => onFilterChange('all')}>{t('execution.schedule.filterAll')}</button>
            <button type="button" style={chipBtnStyle(filter === 'mit')} onClick={() => onFilterChange('mit')}>{t('execution.schedule.filterMitOnly')}</button>
            <button type="button" style={chipBtnStyle(filter === 'open')} onClick={() => onFilterChange('open')}>{t('execution.schedule.filterOpen')}</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {todayRows.length === 0 ? (
              <EmptyBlock text={todayAllCount === 0 ? t('execution.schedule.emptyNoTasksToday') : t('execution.schedule.emptyNoFilterMatch')} />
            ) : todayRows.map((row, i) => (
              <TaskRowItem
                key={row.id ?? i}
                row={row}
                last={i === todayRows.length - 1}
                onCheckin={onCheckin}
                onObstacle={() => onObstacle(row)}
                onBreakdown={() => onBreakdown(row)}
              />
            ))}
          </div>

          {upcomingCount > 0 && (
            <button
              type="button"
              onClick={() => onScopeChange('upcoming')}
              style={{
                marginTop: 20,
                width: '100%',
                textAlign: 'left',
                padding: 14,
                border: '1px dashed var(--g-border)',
                borderRadius: 12,
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <IconCal size={16} style={{ color: 'var(--g-text-muted)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: fontVars.base, color: 'var(--g-text)' }}>{t('execution.schedule.upcomingBanner', { n: upcomingCount })}</div>
                <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-muted)', marginTop: 2 }}>{upcomingPreview(upcomingGroups)}</div>
              </div>
              <span style={{ ...ghostBtnStyle(), pointerEvents: 'none' }}>
                {t('execution.schedule.view')} <IconChev size={12} />
              </span>
            </button>
          )}
        </>
      )}

      {scope === 'upcoming' && (
        <GroupedScopeList
          groups={upcomingGroups}
          mode="upcoming"
          emptyText={t('execution.schedule.emptyNoUpcoming')}
          onCheckin={onCheckin}
        />
      )}

      {scope === 'history' && (
        <GroupedScopeList
          groups={historyGroups}
          mode="history"
          emptyText={t('execution.schedule.emptyNoHistory')}
        />
      )}
    </section>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '24px 16px',
        textAlign: 'center',
        color: 'var(--g-text-faint)',
        fontSize: fontVars.base,
        border: '1px dashed var(--g-border)',
        borderRadius: 12,
      }}
    >
      {text}
    </div>
  );
}

// First couple of upcoming days, e.g. "明天：PRD 评审 · 周三：与产品同步".
function upcomingPreview(groups: DayGroup[]): string {
  return groups
    .slice(0, 2)
    .map(g => `${g.label}：${g.rows[0]?.title ?? ''}`)
    .join(' · ');
}

function GroupedScopeList({
  groups, mode, emptyText, onCheckin,
}: {
  groups: DayGroup[];
  mode: 'upcoming' | 'history';
  emptyText: string;
  onCheckin?: (taskId: string, status: CheckinStatus) => void;
}) {
  const t = useTranslations('app');
  if (groups.length === 0) return <EmptyBlock text={emptyText} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {groups.map(g => (
        <div key={g.key || 'undated'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' }}>{g.label}</span>
            <div style={{ flex: 1, height: 1, background: 'var(--g-border)' }} />
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{t('execution.schedule.itemsCount', { n: g.rows.length })}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.rows.map((r, i) => (
              <ScopeTaskCard key={r.id ?? i} row={r} mode={mode} onCheckin={onCheckin} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopeTaskCard({
  row, mode, onCheckin,
}: {
  row: TaskRow;
  mode: 'upcoming' | 'history';
  onCheckin?: (taskId: string, status: CheckinStatus) => void;
}) {
  const t = useTranslations('app');
  const { id, title, status, goal, energy, dur, mit } = row;
  const isDone = status === 'done';
  const isSkipped = status === 'skipped';
  const closed = isDone || isSkipped;
  const energyColor =
    energy === 'H' ? 'var(--g-dim-goal)' :
    energy === 'M' ? 'var(--g-dim-insight)' :
    'var(--g-text-muted)';

  return (
    <article
      style={{
        background: 'var(--g-bg-raised)',
        border: '1px solid var(--g-border)',
        borderRadius: 12,
        padding: 14,
        opacity: closed ? 0.62 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {mit && (
          <span
            style={{
              padding: '2px 7px',
              borderRadius: 5,
              background: 'color-mix(in oklch, var(--g-dim-goal) 18%, transparent)',
              color: 'var(--g-dim-goal)',
              fontSize: fontVars.sm,
              fontWeight: 700,
              fontFamily: 'var(--g-font-mono)',
              letterSpacing: '0.06em',
            }}
          >
            MIT
          </span>
        )}
        <span
          style={{
            fontSize: fontVars.sm,
            fontWeight: 400,
            color: 'var(--g-text)',
            textDecoration: isDone ? 'line-through' : 'none',
            flex: 1,
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{dur}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {goal && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: fontVars.xs, color: 'var(--g-text-muted)' }}>
            <IconTarget size={11} style={{ color: 'var(--g-dim-goal)' }} /> {goal}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: fontVars.xs, color: 'var(--g-text-muted)' }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: energyColor }} />
          {energy === 'H' ? t('execution.energy.high') : energy === 'M' ? t('execution.energy.medium') : t('execution.energy.low')}
        </span>
        <div style={{ flex: 1 }} />
        {mode === 'upcoming' && id && onCheckin ? (
          <button type="button" style={chipBtnStyle()} onClick={() => onCheckin(id, 'done')}>{t('execution.task.done')}</button>
        ) : mode === 'history' ? (
          <span style={{ fontSize: fontVars.xs, fontFamily: 'var(--g-font-mono)', color: isDone ? 'var(--g-accent)' : 'var(--g-text-faint)' }}>
            {isDone ? t('execution.task.doneMark') : t('execution.task.skipMark')}
          </span>
        ) : null}
      </div>
    </article>
  );
}

// 进行中任务的实时计时（mm:ss），从 started_at 客户端推算，每秒刷新。
function TaskTimer({ startedAt }: { startedAt?: string }) {
  const t = useTranslations('app');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  if (Number.isNaN(start)) return null;
  const sec = Math.max(0, Math.floor((now - start) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return (
    <span style={{ fontSize: fontVars.xs, color: 'var(--g-dim-goal)', fontFamily: 'var(--g-font-mono)', display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 'auto' }}>
      {t('execution.task.inProgress', { time: `${mm}:${ss}` })}
    </span>
  );
}

function TaskRowItem({
  row, last, onCheckin, onObstacle, onBreakdown,
}: {
  row: TaskRow;
  last?: boolean;
  onCheckin: (taskId: string, status: CheckinStatus) => void;
  onObstacle: () => void;
  onBreakdown: () => void;
}) {
  const t = useTranslations('app');
  const { id, time, title, status, current, goal, energy, dur, needsFlow, startedAt, mit, isNew } = row;
  const isDone = status === 'done';
  const isInProgress = status === 'in_progress';
  const highlight = isInProgress || !!current;  // 橙色高亮：进行中，或「建议现在做」的那一项
  const energyColor =
    energy === 'H' ? 'var(--g-dim-goal)' :
    energy === 'M' ? 'var(--g-dim-insight)' :
    'var(--g-text-muted)';

  const handle = (s: CheckinStatus) => { if (id) onCheckin(id, s); };

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      <div style={{ width: 56, flexShrink: 0, paddingTop: 14, position: 'relative' }}>
        <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>{time}</div>
        {!last && <div style={{ position: 'absolute', left: 44, top: 32, bottom: -14, width: 1, background: 'var(--g-border)' }} />}
      </div>

      <div style={{ width: 22, paddingTop: 14, display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
        <span
          style={{
            width: highlight ? 16 : 12,
            height: highlight ? 16 : 12,
            borderRadius: 999,
            background: isDone ? 'var(--g-accent)' : highlight ? 'var(--g-bg)' : 'var(--g-surface-2)',
            border: `2px solid ${isDone ? 'var(--g-accent)' : highlight ? 'var(--g-dim-goal)' : 'var(--g-border)'}`,
            boxShadow: highlight ? '0 0 0 4px color-mix(in oklch, var(--g-dim-goal) 22%, transparent)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--g-bg)',
          }}
        >
          {isDone && <IconCheck size={9} />}
          {isInProgress && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--g-dim-goal)' }} />}
        </span>
      </div>

      <div style={{ flex: 1, paddingTop: 6, paddingBottom: 14 }}>
        <article
          style={{
            background: highlight ? 'linear-gradient(180deg, var(--g-surface-1), var(--g-bg-raised))' : 'var(--g-bg-raised)',
            border: `1px solid ${highlight ? 'color-mix(in oklch, var(--g-dim-goal) 32%, transparent)' : 'var(--g-border)'}`,
            borderRadius: 12,
            padding: 14,
            opacity: isDone ? 0.58 : 1,
          }}
        >
          <div className="gedo-task-title-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mit && (
              <span
                style={{
                  padding: '2px 7px',
                  borderRadius: 5,
                  background: 'color-mix(in oklch, var(--g-dim-goal) 18%, transparent)',
                  color: 'var(--g-dim-goal)',
                  fontSize: fontVars.sm,
                  fontWeight: 700,
                  fontFamily: 'var(--g-font-mono)',
                  letterSpacing: '0.06em',
                  flexShrink: 0,
                }}
              >
                MIT
              </span>
            )}
            <span
              className="gedo-task-title-text"
              style={{
                fontSize: fontVars.sm,
                fontWeight: 400,
                color: 'var(--g-text)',
                textDecoration: isDone ? 'line-through' : 'none',
                flex: 1,
                minWidth: 0,
              }}
            >
              {title}
            </span>
            {isNew && <Pill tone="accent">{t('execution.task.new')}</Pill>}
            <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{dur}</span>
          </div>
          <div className="gedo-task-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {goal && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: fontVars.xs, color: 'var(--g-text-muted)' }}>
                <IconTarget size={11} style={{ color: 'var(--g-dim-goal)' }} /> {goal}
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: fontVars.xs, color: 'var(--g-text-muted)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: energyColor }} />
              {energy === 'H' ? t('execution.energy.high') : energy === 'M' ? t('execution.energy.medium') : t('execution.energy.low')}
            </span>
            <div style={{ flex: 1 }} />
            {isDone ? (
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-accent)', fontFamily: 'var(--g-font-mono)' }}>{t('execution.task.doneMark')}</span>
            ) : isInProgress ? (
              // 进行中：显示计时 + 完成（终态）。开始与完成已彻底分离。
              <>
                <TaskTimer startedAt={startedAt} />
                <button type="button" style={chipBtnStyle()} onClick={onBreakdown}>{t('execution.task.refine')}</button>
                <button type="button" style={chipBtnStyle()} onClick={() => handle('skipped')}>{t('execution.task.later')}</button>
                <button type="button" style={chipBtnStyle()} onClick={onObstacle}>{t('execution.task.blocked')}</button>
                <button type="button" style={{ ...primaryBtnStyle(true), padding: '4px 12px' }} onClick={() => handle('done')}>{t('execution.task.doneCheck')}</button>
              </>
            ) : needsFlow ? (
              // 待办 · 长/专注任务 → 「开始」进入进行中（不再一点就完成）
              <>
                {current && <button type="button" style={chipBtnStyle()} onClick={onBreakdown}>{t('execution.task.refine')}</button>}
                {current && <button type="button" style={chipBtnStyle()} onClick={() => handle('skipped')}>{t('execution.task.later')}</button>}
                {current && <button type="button" style={chipBtnStyle()} onClick={onObstacle}>{t('execution.task.blocked')}</button>}
                <button type="button" style={{ ...primaryBtnStyle(true), padding: '4px 12px' }} onClick={() => handle('in_progress')}>{t('execution.task.start')}</button>
              </>
            ) : (
              // 待办 · 快速任务 → 一键完成
              <>
                {current && <button type="button" style={chipBtnStyle()} onClick={() => handle('skipped')}>{t('execution.task.later')}</button>}
                <button type="button" style={{ ...primaryBtnStyle(true), padding: '4px 12px' }} onClick={() => handle('done')}>{t('execution.task.done')}</button>
              </>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}

function ExecSidebar({ goals, obstacles, onPlan, onOpenDetail }: { goals: ApiGoal[]; obstacles: ApiIfThen[]; onPlan: (g: ApiGoal) => void; onOpenDetail: (g: ApiGoal) => void }) {
  const t = useTranslations('app');
  return (
    <aside
      className="gedo-aux-sidebar"
      style={{
        width: 360,
        flexShrink: 0,
        background: 'var(--g-bg-raised)',
        padding: '18px 18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflow: 'auto',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconTarget size={14} />
            <span style={{ fontSize: fontVars.base, fontWeight: 500 }}>{t('execution.sidebar.activeGoalsTitle')}</span>
          </div>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {t('execution.sidebar.activeCount', { n: goals.length })}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {goals.map(g => <GoalCard key={g.id} goal={g} onPlan={() => onPlan(g)} onOpenDetail={() => onOpenDetail(g)} />)}
          {goals.length === 0 && (
            <div
              style={{
                padding: '20px 12px',
                textAlign: 'center',
                color: 'var(--g-text-faint)',
                fontSize: fontVars.sm,
                border: '1px dashed var(--g-border)',
                borderRadius: 12,
              }}
            >
              {t('execution.sidebar.noGoals')}
            </div>
          )}
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconFlag size={14} />
            <span style={{ fontSize: fontVars.base, fontWeight: 500 }}>{t('execution.sidebar.ifThenTitle')}</span>
          </div>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {t('execution.sidebar.hitRate', { rate: hitRate(obstacles) })}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          {obstacles.map(o => (
            <ObstacleCard
              key={o.id}
              ifText={o.if_condition}
              thenText={o.then_action}
              fires={o.triggered_count ?? 0}
              executed={o.executed_count ?? 0}
            />
          ))}
          {obstacles.length === 0 && (
            <div
              style={{
                padding: '20px 12px',
                textAlign: 'center',
                color: 'var(--g-text-faint)',
                fontSize: fontVars.sm,
                border: '1px dashed var(--g-border)',
                borderRadius: 12,
              }}
            >
              {t('execution.sidebar.noObstacles')}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function hitRate(obstacles: ApiIfThen[]): string {
  const fires = obstacles.reduce((s, o) => s + (o.triggered_count ?? 0), 0);
  const exec = obstacles.reduce((s, o) => s + (o.executed_count ?? 0), 0);
  if (!fires) return '—';
  return `${Math.round((exec / fires) * 100)}%`;
}

// key/color 固定，label 走 i18n（app.execution.dims.<key>）。
const DIM_MAP: Record<string, { c: string }> = {
  career:   { c: 'var(--g-dim-goal)' },
  health:   { c: 'var(--g-dim-exec)' },
  growth:   { c: 'var(--g-dim-insight)' },
  learning: { c: 'var(--g-dim-insight)' },
  relation: { c: 'var(--g-dim-memory)' },
  family:   { c: 'var(--g-dim-memory)' },
  finance:  { c: 'var(--g-text-muted)' },
  self:     { c: 'var(--g-dim-memory)' },
  fun:      { c: 'var(--g-dim-goal)' },
};

function GoalCard({ goal, onPlan, onOpenDetail }: { goal: ApiGoal; onPlan: () => void; onOpenDetail: () => void }) {
  const t = useTranslations('app');
  const locale = useLocale();
  const dimKey = (goal.life_wheel_dimension && DIM_MAP[goal.life_wheel_dimension]) ? goal.life_wheel_dimension : 'growth';
  const d = DIM_MAP[dimKey];
  const dimLabel = t(`execution.dims.${dimKey}`);
  const progress = goal.progress ?? 0;
  const due = goal.due_date
    ? new Date(goal.due_date).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
    : t('execution.goalCard.ongoing');

  return (
    <article
      style={{
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <Dot color={d.c} />
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>
          {dimLabel}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{due}</span>
      </div>
      <p style={{ margin: '0 0 8px', fontSize: fontVars.sm, fontWeight: 400, color: 'var(--g-text)', lineHeight: 1.45 }}>{goal.title}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 4, background: 'var(--g-surface-2)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: d.c, borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text)', fontFamily: 'var(--g-font-mono)', minWidth: 28, textAlign: 'right' }}>
          {progress}%
        </span>
      </div>
      {goal.decomposed && (
        <div style={{ marginTop: 8, fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
          {t('execution.goalCard.decomposed', {
            n: goal.task_count ?? 0,
            sub: (goal.child_count ?? 0) > 0 ? t('execution.goalCard.childGoals', { n: goal.child_count ?? 0 }) : '',
          })}
        </div>
      )}
      <button
        type="button"
        onClick={goal.decomposed ? onOpenDetail : onPlan}
        style={{
          marginTop: goal.decomposed ? 6 : 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 8, border: '1px solid var(--g-accent-line)', background: 'var(--g-accent-soft)',
          color: 'var(--g-accent)', fontSize: fontVars.sm, cursor: 'pointer', fontFamily: 'var(--g-font-sans)',
        }}
      >
        <IconWand size={12} /> {goal.decomposed ? t('execution.goalCard.viewBtn') : t('execution.goalCard.decomposeBtn')}
      </button>
    </article>
  );
}

function ObstacleCard({
  ifText, thenText, fires, executed,
}: {
  ifText: string;
  thenText: string;
  fires: number;
  executed: number;
}) {
  const t = useTranslations('app');
  const rate = fires > 0 ? Math.round((executed / fires) * 100) : 0;
  const tagStyle: CSSProperties = {
    padding: '2px 6px',
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--g-font-mono)',
    fontSize: fontVars.xs,
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 1,
    lineHeight: 1.2,
  };
  return (
    <article style={{ background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 12, padding: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        <span
          style={{
            ...tagStyle,
            background: 'color-mix(in oklch, var(--g-dim-goal) 14%, transparent)',
            border: '1px solid color-mix(in oklch, var(--g-dim-goal) 32%, transparent)',
            color: 'var(--g-dim-goal)',
          }}
        >
          IF
        </span>
        <div className="gedo-sidebar-card-text" style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', flex: 1, minWidth: 0, fontWeight: 400 }}>{ifText}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6, minWidth: 0 }}>
        <span
          style={{
            ...tagStyle,
            background: 'var(--g-accent-soft)',
            border: '1px solid var(--g-accent-line)',
            color: 'var(--g-accent)',
          }}
        >
          THEN
        </span>
        <div className="gedo-sidebar-card-text" style={{ fontSize: fontVars.sm, color: 'var(--g-text)', flex: 1, minWidth: 0, fontWeight: 400 }}>{thenText}</div>
      </div>
      {fires > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px solid var(--g-border)',
            fontSize: fontVars.xs,
            color: 'var(--g-text-faint)',
            fontFamily: 'var(--g-font-mono)',
          }}
        >
          <span>{t('execution.obstacleCard.triggered', { n: fires })}</span>
          <span>·</span>
          <span>{t('execution.obstacleCard.executed', { n: executed })}</span>
          <div style={{ flex: 1 }} />
          <span style={{ color: 'var(--g-accent)' }}>{rate}%</span>
        </div>
      )}
    </article>
  );
}
