'use client';

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { IconPlus, IconTarget, IconCheck, IconLayers, IconFlag, IconChat, IconArrow, IconSearch } from '@/app/components/gedo/icons';
import { primaryBtnStyle, chipBtnStyle } from '@/app/components/gedo/primitives';
import { EmptyState } from '@/app/components/gedo/EmptyState';
import { fontVars } from '@/app/components/gedo/typography';
import GoalWizard from '@/app/components/planner/GoalWizard';
import GoalList from '@/app/components/planner/GoalList';
import GoalDetailModal from '@/app/components/planner/GoalDetailModal';
import { usePlannerStatusLabel } from '@/app/components/planner/planner-i18n';
import type { Goal, GoalStatus, OKRStructure, TreeTask } from '@/app/components/planner/types';
import type { IfThenCard } from '@/app/components/obstacles/types';

const STATUS_FILTERS: GoalStatus[] = ['active', 'paused', 'completed', 'draft', 'cancelled'];
const GOALS_PAGE_SIZE = 10;

function mapGoal(raw: Record<string, any>): Goal {
  return {
    id: raw.id,
    title: raw.title || '',
    description: raw.description || '',
    level: raw.level || 'objective',
    parentId: raw.parent_id || raw.parentId,
    decomposed: raw.decomposed,
    lifeWheelDimension: raw.life_wheel_dimension || raw.lifeWheelDimension || 'growth',
    status: raw.status || 'draft',
    progress: raw.progress || 0,
    wish: raw.wish,
    outcome: raw.outcome,
    obstacle: raw.obstacle,
    plan: raw.plan,
    specific: raw.specific,
    measurable: raw.measurable,
    achievable: raw.achievable,
    relevant: raw.relevant,
    timeBound: raw.time_bound || raw.timeBound,
    obstacleHitRate: raw.obstacle_hit_rate || raw.obstacleHitRate,
    startDate: raw.start_date || raw.startDate,
    endDate: raw.end_date || raw.endDate,
    createdAt: raw.created_at || raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updated_at || raw.updatedAt || new Date().toISOString(),
  };
}

type Stat = { label: string; value: number | string; tone: 'exec' | 'goal' | 'memory' | 'insight'; Icon: typeof IconTarget };

export function GoalsView({ tabs, onViewObstacles }: { tabs?: ReactNode; onViewObstacles?: (goalId: string) => void }) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const tPlanner = useTranslations('app.planner');
  const statusLabel = usePlannerStatusLabel();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<TreeTask[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [decomposingId, setDecomposingId] = useState<string | null>(null);
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<GoalStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const loadGoals = useCallback(async () => {
    try {
      const [gRes, tRes] = await Promise.all([api.listGoals(), api.listTasks().catch(() => ({ items: [] }))]);
      setGoals((gRes.items || []).map((g: any) => mapGoal(g)));
      setTasks(tRes.items || []);
    } catch {
      // graceful
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const objectives = goals.filter(g => g.level === 'objective');
  const activeCount = objectives.filter(g => g.status === 'active').length;
  const completedCount = objectives.filter(g => g.status === 'completed').length;
  const avgProgress = objectives.length > 0
    ? Math.round(objectives.reduce((sum, g) => sum + g.progress, 0) / objectives.length) : 0;
  const withHit = objectives.filter(g => g.obstacleHitRate !== undefined);
  const avgHitRate = withHit.length > 0
    ? Math.round(withHit.reduce((sum, g) => sum + (g.obstacleHitRate || 0), 0) / withHit.length) : 0;

  // Search + status filter apply to top-level objectives only; pagination then
  // slices those. Each page's objectives still bring their full KR/monthly/task
  // subtree along (GoalList/buildTree drop any child whose parent isn't in the
  // visible set, so filtering by objective id is enough — no separate walk needed).
  // Newest first: the API returns insertion order (oldest first), which with
  // pagination buries a just-created goal on the last page — the user then
  // concludes the decompose "didn't save".
  const filteredObjectives = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return objectives
      .filter(g =>
        (statusFilter === 'all' || g.status === statusFilter) &&
        (!q || g.title.toLowerCase().includes(q)))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [objectives, searchQuery, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredObjectives.length / GOALS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageObjectiveIds = useMemo(() => new Set(
    filteredObjectives.slice((currentPage - 1) * GOALS_PAGE_SIZE, currentPage * GOALS_PAGE_SIZE).map(g => g.id)
  ), [filteredObjectives, currentPage]);
  const visibleGoals = goals.filter(g => g.level !== 'objective' || pageObjectiveIds.has(g.id));

  useEffect(() => { setPage(1); }, [searchQuery, statusFilter]);

  const handleWizardComplete = useCallback(async (newGoals: Goal[], newCards: IfThenCard[], okrStructure?: OKRStructure | null) => {
    setShowWizard(false);
    for (const goal of newGoals) {
      try {
        const created = await api.createGoal({ title: goal.title, description: goal.description, life_wheel_dimension: goal.lifeWheelDimension, wish: goal.wish, outcome: goal.outcome, obstacle: goal.obstacle });
        const gid = created?.id;
        // Commit the exact OKR the user just previewed — no LLM regeneration.
        if (gid && okrStructure) { try { await api.decomposeGoal(gid, { okrStructure }); } catch { /* graceful */ } }
        // If-Then 应急卡 tied to the new objective.
        for (const card of newCards) {
          try {
            await api.createObstacleCard({ goal_id: gid, goal_title: goal.title, obstacle_type: card.obstacleType, obstacle_description: card.obstacleDescription, if_condition: card.ifCondition, then_action: card.thenAction });
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
    await loadGoals();
  }, [api, loadGoals]);

  const handleStatusChange = useCallback(async (id: string, status: Goal['status']) => {
    setGoals(prev => prev.map(g => g.id === id ? { ...g, status, updatedAt: new Date().toISOString() } : g));
    try { await api.updateGoalStatus(id, status); } catch { /* ignore */ }
  }, [api]);

  const handleDelete = useCallback(async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm(tPlanner('deleteGoalConfirm'))) return;
    setGoals(prev => prev.filter(g => g.id !== id && g.parentId !== id));
    try { await api.deleteGoal(id); } catch { /* ignore */ } finally { loadGoals(); }
  }, [api, loadGoals]);

  const handleDecompose = useCallback(async (goalId: string) => {
    setDecomposingId(goalId);
    try {
      await api.decomposeGoal(goalId);
      await loadGoals();
    } catch { /* graceful */ } finally {
      setDecomposingId(null);
    }
  }, [api, loadGoals]);

  const stats: Stat[] = [
    { label: t('execution.goalsView.stats.active'), value: activeCount, tone: 'exec', Icon: IconTarget },
    { label: t('execution.goalsView.stats.completed'), value: completedCount, tone: 'insight', Icon: IconCheck },
    { label: t('execution.goalsView.stats.avgProgress'), value: `${avgProgress}%`, tone: 'goal', Icon: IconLayers },
    { label: t('execution.goalsView.stats.hitRate'), value: `${avgHitRate}%`, tone: 'memory', Icon: IconFlag },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--g-bg)' }}>
      <header
        className="gedo-screen-header gedo-goals-header"
        style={{
          minHeight: 60, flexShrink: 0, padding: '10px 28px',
          borderBottom: '1px solid var(--g-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--g-bg)', gap: 8,
        }}
      >
        <div className="gedo-goals-header-main">
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('execution.goalsView.title')}</h1>
            <p className="gedo-hide-mobile-subtitle" style={{ margin: '2px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('execution.goalsView.subtitle')}</p>
          </div>
        </div>
        <div className="gedo-screen-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {tabs}
          <button type="button" style={{ ...primaryBtnStyle(), flexShrink: 0 }} onClick={() => setShowWizard(true)}>
            <IconPlus size={14} /> <span className="gedo-btn-label">{t('execution.goalsView.newGoal')}</span>
          </button>
        </div>
      </header>

      <main className="gedo-content-padded" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 32px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Link
          href="/app/companion"
          className="gedo-goals-chat-cta"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: 12,
            background: 'var(--g-accent-soft)', border: '1px solid var(--g-accent-line)',
            textDecoration: 'none', color: 'var(--g-accent)', fontSize: fontVars.sm,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconChat size={15} /> {t('execution.goalsView.chatCta')}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fontVars.sm }}>{t('execution.goalsView.goToChat')} <IconArrow size={13} /></span>
        </Link>

        {/* 统计 */}
        <section className="gedo-stat-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {stats.map(s => <StatCard key={s.label} {...s} />)}
        </section>

        {/* 向导 */}
        {showWizard && (
          <div style={{ background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 14, padding: 4 }}>
            <GoalWizard onComplete={handleWizardComplete} onCancel={() => setShowWizard(false)} />
          </div>
        )}

        {/* 搜索 + 状态筛选 */}
        {!loading && objectives.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 10, padding: '6px 10px', minWidth: 200, flex: '1 1 200px', color: 'var(--g-text-muted)' }}>
              <IconSearch size={14} style={{ flexShrink: 0 }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={tPlanner('list.searchPlaceholder')}
                style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--g-text)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)' }}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button type="button" style={chipBtnStyle(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>
                {tPlanner('list.filterAll')}
              </button>
              {STATUS_FILTERS.map(s => (
                <button key={s} type="button" style={chipBtnStyle(statusFilter === s)} onClick={() => setStatusFilter(s)}>
                  {statusLabel(s)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 目标树 / 空态 */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <span style={{ width: 28, height: 28, borderRadius: 999, border: '2px solid var(--g-border)', borderTopColor: 'var(--g-accent)', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : goals.length === 0 && !showWizard ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <div style={{ width: '100%', maxWidth: 460 }}>
              <EmptyState
                icon={<IconTarget size={22} />}
                title={t('execution.goalsView.emptyTitle')}
                hint={t('execution.goalsView.emptyHint')}
              />
            </div>
          </div>
        ) : filteredObjectives.length === 0 && !showWizard ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '48px 24px', border: '1px dashed var(--g-border)', borderRadius: 16, background: 'var(--g-bg-raised)' }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--g-accent)', background: 'var(--g-accent-soft)', border: '1px solid var(--g-accent-line)', marginBottom: 4 }}>
                <IconSearch size={22} />
              </div>
              <h3 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)' }}>{tPlanner('list.noResultsTitle')}</h3>
              <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.6, maxWidth: 320 }}>{tPlanner('list.noResultsHint')}</p>
              <button type="button" style={{ ...chipBtnStyle(), marginTop: 10 }} onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>
                {tPlanner('list.clearFilters')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <GoalList
              goals={visibleGoals}
              tasks={tasks}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onViewObstacles={onViewObstacles}
              onDecompose={handleDecompose}
              onEdit={(g) => setDetailGoalId(g.id)}
              onOpenDetail={(id) => setDetailGoalId(id)}
              decomposingId={decomposingId}
            />
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexShrink: 0 }}>
                <button type="button" style={{ ...chipBtnStyle(), opacity: currentPage <= 1 ? 0.4 : 1, cursor: currentPage <= 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft className="w-3 h-3" /> {tPlanner('list.pagePrev')}
                </button>
                <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)', fontFamily: 'var(--g-font-mono)' }}>
                  {tPlanner('list.pageIndicator', { current: currentPage, total: totalPages })}
                </span>
                <button type="button" style={{ ...chipBtnStyle(), opacity: currentPage >= totalPages ? 0.4 : 1, cursor: currentPage >= totalPages ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  {tPlanner('list.pageNext')} <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <GoalDetailModal
        goalId={detailGoalId}
        open={!!detailGoalId}
        onClose={() => setDetailGoalId(null)}
        onChanged={loadGoals}
      />
    </div>
  );
}

function StatCard({ label, value, tone, Icon }: Stat) {
  const color =
    tone === 'exec' ? 'var(--g-dim-exec)' :
    tone === 'goal' ? 'var(--g-dim-goal)' :
    tone === 'memory' ? 'var(--g-dim-memory)' :
    'var(--g-dim-insight)';
  return (
    <article style={{ background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
        <span style={{ color }}><Icon size={13} /></span>
        <span style={{ fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>{label}</span>
      </div>
      <span style={{ fontSize: fontVars.lg, fontWeight: 600, color, letterSpacing: '-0.02em', fontFeatureSettings: '"tnum"' }}>{value}</span>
    </article>
  );
}
