'use client';

import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { IconFlag, IconBolt, IconCheck, IconTarget } from '@/app/components/gedo/icons';
import { EmptyState } from '@/app/components/gedo/EmptyState';
import { fontVars } from '@/app/components/gedo/typography';
import { useObstacleTypeInfo } from '@/app/components/planner/planner-i18n';
import ObstacleLibrary from '@/app/components/obstacles/ObstacleLibrary';
import type { IfThenCard, ObstacleType, ObstacleEvent, ObstacleStats } from '@/app/components/obstacles/types';

function mapCard(raw: Record<string, unknown>): IfThenCard {
  return {
    id: raw.id as string,
    goalId: (raw.goal_id as string) || '',
    goalTitle: (raw.goal_title as string) || '',
    obstacleDescription: (raw.obstacle_description as string) || '',
    ifCondition: (raw.if_condition as string) || '',
    thenAction: (raw.then_action as string) || '',
    untilCondition: raw.until_condition as string | undefined,
    obstacleType: (raw.obstacle_type as ObstacleType) || 'procrastination_fear',
    triggeredCount: (raw.triggered_count as number) || 0,
    executedCount: (raw.executed_count as number) || 0,
    status: (raw.status as 'active' | 'archived') || 'active',
    createdAt: (raw.created_at as string) || new Date().toISOString(),
    updatedAt: (raw.updated_at as string) || new Date().toISOString(),
  };
}

function mapEvent(raw: Record<string, unknown>): ObstacleEvent {
  return {
    id: raw.id as string,
    taskId: (raw.task_id as string) || '',
    taskTitle: (raw.task_title as string) || '',
    obstacleType: (raw.obstacle_type as ObstacleType) || 'procrastination_fear',
    matchedPredicted: (raw.matched_predicted as boolean) || false,
    ifThenCardId: raw.if_then_card_id as string | undefined,
    ifThenTriggered: (raw.if_then_triggered as boolean) || false,
    ifThenExecuted: (raw.if_then_executed as boolean) || false,
    reasonNote: raw.reason_note as string | undefined,
    occurredAt: (raw.occurred_at as string) || new Date().toISOString(),
  };
}

const EMPTY_STATS: ObstacleStats = {
  totalCards: 0, totalEvents: 0, hitRate: 0, triggerCount: 0, executeCount: 0, byType: {} as Record<ObstacleType, number>,
};

export function ObstaclesView({ tabs }: { tabs?: ReactNode }) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const obstacleInfo = useObstacleTypeInfo();
  const [cards, setCards] = useState<IfThenCard[]>([]);
  const [events, setEvents] = useState<ObstacleEvent[]>([]);
  const [stats, setStats] = useState<ObstacleStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [cardsRes, eventsRes, statsRes] = await Promise.all([
        api.listObstacleCards(),
        api.listObstacleEvents(),
        api.getObstacleStats(),
      ]);
      setCards((cardsRes.items || []).map((c: any) => mapCard(c)));
      setEvents((eventsRes.items || []).map((e: any) => mapEvent(e)));
      setStats(statsRes as unknown as ObstacleStats);
    } catch {
      // graceful
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDelete = useCallback(async (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
    try { await api.deleteObstacleCard(id); } catch { /* ignore */ }
  }, [api]);

  const handleTrigger = useCallback(async (id: string) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, triggeredCount: c.triggeredCount + 1, executedCount: c.executedCount + 1 } : c));
    try { await api.triggerObstacleCard(id, true); } catch { /* ignore */ }
  }, [api]);

  const topObstacleTypes = useMemo(() => {
    return (Object.entries(stats.byType || {}) as [ObstacleType, number][])
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [stats]);

  const kpis: { label: string; value: string | number; color: string; sub: string; Icon?: typeof IconFlag }[] = [
    { label: t('execution.obstaclesView.kpis.hitRate'), value: `${stats.hitRate}%`, color: 'var(--g-accent)', sub: t('execution.obstaclesView.kpis.hitRateSub') },
    { label: t('execution.obstaclesView.kpis.cards'), value: stats.totalCards, color: 'var(--g-dim-goal)', sub: t('execution.obstaclesView.kpis.cardsSub'), Icon: IconFlag },
    { label: t('execution.obstaclesView.kpis.triggers'), value: stats.triggerCount, color: 'var(--g-dim-exec)', sub: t('execution.obstaclesView.kpis.triggersSub'), Icon: IconBolt },
    { label: t('execution.obstaclesView.kpis.executions'), value: stats.executeCount, color: 'var(--g-dim-insight)', sub: t('execution.obstaclesView.kpis.executionsSub'), Icon: IconCheck },
  ];

  const isEmpty = !loading && stats.totalCards === 0 && cards.length === 0 && events.length === 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--g-bg)' }}>
      <header
        className="gedo-screen-header"
        style={{
          minHeight: 60, flexShrink: 0, padding: '10px 28px',
          borderBottom: '1px solid var(--g-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--g-bg)',
        }}
      >
        <div className="gedo-goals-header-main">
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: fontVars.base, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('execution.obstaclesView.title')}</h1>
            <p className="gedo-hide-mobile-subtitle" style={{ margin: '2px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('execution.obstaclesView.subtitle')}</p>
          </div>
        </div>
        <div className="gedo-screen-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {tabs}
        </div>
      </header>

      <main className="gedo-content-padded" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 32px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {isEmpty ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <div style={{ width: '100%', maxWidth: 460 }}>
              <EmptyState
                icon={<IconFlag size={22} />}
                title={t('execution.obstaclesView.emptyTitle')}
                hint={t('execution.obstaclesView.emptyHint')}
              />
            </div>
          </div>
        ) : (
          <>
            <section className="gedo-stat-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {kpis.map(k => (
                <article key={k.label} style={{ background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>
                    {k.Icon && <k.Icon size={12} />} {k.label}
                  </div>
                  <span style={{ fontSize: fontVars.lg, fontWeight: 600, color: k.color, letterSpacing: '-0.02em', fontFeatureSettings: '"tnum"' }}>{k.value}</span>
                  <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{k.sub}</span>
                </article>
              ))}
            </section>

            {topObstacleTypes.length > 0 && (
              <section style={{ background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: fontVars.sm, fontWeight: 500 }}>{t('execution.obstaclesView.distributionTitle')}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {topObstacleTypes.map(([type, count]) => {
                    const info = obstacleInfo(type);
                    if (!info) return null;
                    const pct = stats.totalEvents > 0 ? Math.round((count / stats.totalEvents) * 100) : 0;
                    return (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: fontVars.sm, width: 120, color: info.color, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                          {info.icon}
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.label}</span>
                        </span>
                        <div style={{ flex: 1, height: 8, background: 'var(--g-surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: info.color }} />
                        </div>
                        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', width: 44, textAlign: 'right', fontFamily: 'var(--g-font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('execution.obstaclesView.timesUnit', { n: count })}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {events.length > 0 && (
              <section style={{ background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: fontVars.sm, fontWeight: 500 }}>{t('execution.obstaclesView.recentEventsTitle')}</h3>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {events.slice(0, 5).map(ev => {
                    const info = obstacleInfo(ev.obstacleType);
                    if (!info) return null;
                    return (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--g-border)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: ev.matchedPredicted ? 'var(--g-accent)' : 'var(--g-warning, #f59e0b)' }} />
                        <span style={{ flex: 1, fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>{ev.taskTitle || t('execution.obstaclesView.unnamedTask')}</span>
                        <span style={{ fontSize: fontVars.sm, padding: '2px 8px', borderRadius: 999, background: info.color + '22', color: info.color }}>{info.label}</span>
                        <span style={{ fontSize: fontVars.sm, color: ev.matchedPredicted ? 'var(--g-accent)' : 'var(--g-text-faint)' }}>{ev.matchedPredicted ? t('execution.obstaclesView.matched') : t('execution.obstaclesView.newObstacle')}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: fontVars.sm, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconTarget size={14} style={{ color: 'var(--g-text-muted)' }} /> {t('execution.obstaclesView.libraryTitle')}
              </h3>
              <ObstacleLibrary cards={cards} onDelete={handleDelete} onTrigger={handleTrigger} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
