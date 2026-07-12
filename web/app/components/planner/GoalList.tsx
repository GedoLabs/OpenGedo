'use client';

import { fontVars } from '@/app/components/gedo/typography';
// Gedo 设计系统版 —— OKR 目标树（O/KR/月/任务四层）。
// 颜色走 --g-* token；层级色 (levelInfo.color) / 维度色 (dimColor) 为分类语义色保留 hex。
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, MoreHorizontal, Trash2, Pause, Play, CheckCircle, Target, Shield, Sparkles, Loader2, Pencil } from 'lucide-react';
import type { Goal, TreeTask } from './types';
import { LEVEL_COLORS, DIMENSION_COLORS } from './types';
import { usePlannerDimensions, usePlannerLevelInfo, usePlannerStatusLabel } from './planner-i18n';

interface Props {
  goals: Goal[];
  onGoalClick?: (goal: Goal) => void;
  onStatusChange?: (id: string, status: Goal['status']) => void;
  onDelete?: (id: string) => void;
  onViewObstacles?: (goalId: string) => void;
  /** Edit the goal itself (title / dimension / description / WOOP). */
  onEdit?: (goal: Goal) => void;
  /** Decompose an objective into a persisted OKR tree (KR → 月 → 任务). */
  onDecompose?: (goalId: string) => void;
  /** Goal id currently being decomposed (shows an inline spinner). */
  decomposingId?: string | null;
  /** Real ToDos (tasks table) rendered as leaf rows under their owning O/KR/M. */
  tasks?: TreeTask[];
  /** Open the shared goal-detail drawer (edit O / KR / ToDo + replan). */
  onOpenDetail?: (goalId: string) => void;
}

function buildTree(goals: Goal[]): Goal[] {
  const map = new Map<string, Goal>();
  const roots: Goal[] = [];
  // level='task' goal nodes are deprecated — real ToDos render from the tasks table.
  const visible = goals.filter(g => g.level !== 'task');

  visible.forEach(g => map.set(g.id, { ...g, children: [] }));

  visible.forEach(g => {
    const node = map.get(g.id)!;
    if (g.parentId && map.has(g.parentId)) {
      map.get(g.parentId)!.children = map.get(g.parentId)!.children || [];
      map.get(g.parentId)!.children!.push(node);
    } else if (!g.parentId || g.level === 'objective') {
      roots.push(node);
    }
  });

  return roots;
}

function ProgressRing({ progress, size = 36, color }: { progress: number; size?: number; color: string }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (progress / 100) * c;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--g-border)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }} fill="var(--g-text)" fontSize="10" fontWeight="bold">
        {progress}%
      </text>
    </svg>
  );
}

const STATUS_FG: Record<string, string> = {
  active: 'var(--g-accent)',
  completed: 'var(--g-dim-insight)',
  paused: 'var(--g-warning, #f59e0b)',
  draft: 'var(--g-text-muted)',
  cancelled: 'var(--g-text-muted)',
};

function useIsMobile(breakpoint = 900) {
  const [mobile, setMobile] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${breakpoint}px)`).matches : false),
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  return mobile;
}

/**
 * O-level action menu. The dropdown is rendered through a portal to
 * `document.body` so it escapes the list container's `overflow-hidden`.
 */
function GoalActionsMenu({ goal, canDecompose, onDecompose, onEdit, onStatusChange, onDelete, onViewObstacles }: {
  goal: Goal;
  canDecompose?: boolean;
  onDecompose?: (goalId: string) => void;
  onEdit?: (goal: Goal) => void;
  onStatusChange?: (id: string, status: Goal['status']) => void;
  onDelete?: (id: string) => void;
  onViewObstacles?: (goalId: string) => void;
}) {
  const t = useTranslations('app.planner.list');
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('touchstart', onDown, { passive: true });
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const itemStyle = (fg = 'var(--g-text-mid)'): React.CSSProperties => ({
    width: '100%', padding: isMobile ? '12px 14px' : '8px 12px', textAlign: 'left', fontSize: isMobile ? 14 : 13,
    color: fg, background: 'transparent', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--g-font-sans)',
  });

  const menuItems = (
    <>
      {onEdit && (
        <button type="button" onClick={() => { onEdit(goal); setOpen(false); }} style={itemStyle()}>
          <Pencil className="w-3.5 h-3.5" /> {t('editGoal')}
        </button>
      )}
      {onDecompose && canDecompose && (
        <button type="button" onClick={() => { onDecompose(goal.id); setOpen(false); }} style={itemStyle('var(--g-accent)')}>
          <Sparkles className="w-3.5 h-3.5" /> {t('decomposeOkr')}
        </button>
      )}
      {onViewObstacles && (
        <button type="button" onClick={() => { onViewObstacles(goal.id); setOpen(false); }} style={itemStyle()}>
          <Shield className="w-3.5 h-3.5" /> {t('viewObstacles')}
        </button>
      )}
      {onStatusChange && goal.status === 'active' && (
        <button type="button" onClick={() => { onStatusChange(goal.id, 'paused'); setOpen(false); }} style={itemStyle()}>
          <Pause className="w-3.5 h-3.5" /> {t('pause')}
        </button>
      )}
      {onStatusChange && goal.status === 'paused' && (
        <button type="button" onClick={() => { onStatusChange(goal.id, 'active'); setOpen(false); }} style={itemStyle()}>
          <Play className="w-3.5 h-3.5" /> {t('resume')}
        </button>
      )}
      {onStatusChange && (
        <button type="button" onClick={() => { onStatusChange(goal.id, 'completed'); setOpen(false); }} style={itemStyle()}>
          <CheckCircle className="w-3.5 h-3.5" /> {t('markComplete')}
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={() => { onDelete(goal.id); setOpen(false); }} style={itemStyle('var(--g-danger)')}>
          <Trash2 className="w-3.5 h-3.5" /> {t('delete')}
        </button>
      )}
    </>
  );

  return (
    <div className="gl-actions-menu" style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('moreActions')}
        aria-expanded={open}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={`gl-more-btn${open ? ' gl-actions-open' : ''}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="gl-dropdown-menu"
          style={{
            position: 'fixed',
            width: isMobile ? 192 : 168,
            top: pos.top,
            right: pos.right,
            zIndex: 200,
            background: 'var(--g-bg-raised)',
            border: '1px solid var(--g-border)',
            borderRadius: 10,
            boxShadow: '0 16px 40px -16px oklch(0 0 0 / 0.4)',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {menuItems}
        </div>,
        document.body
      )}
    </div>
  );
}

function GoalNode({ goal, depth = 0, tasks = [], onDecompose, onEdit, onOpenDetail, decomposingId, onStatusChange, onDelete, onViewObstacles }: {
  goal: Goal;
  depth?: number;
  tasks?: TreeTask[];
  onDecompose?: (goalId: string) => void;
  onEdit?: (goal: Goal) => void;
  onOpenDetail?: (goalId: string) => void;
  decomposingId?: string | null;
  onStatusChange?: (id: string, status: Goal['status']) => void;
  onDelete?: (id: string) => void;
  onViewObstacles?: (goalId: string) => void;
}) {
  const t = useTranslations('app.planner.list');
  const dimLabel = usePlannerDimensions();
  const levelInfo = usePlannerLevelInfo();
  const statusLabel = usePlannerStatusLabel();
  const [expanded, setExpanded] = useState(goal.level === 'objective');
  const [showWoop, setShowWoop] = useState(false);
  const hasWoop = !!(goal.wish || goal.outcome || goal.obstacle);
  const hasChildren = goal.children && goal.children.length > 0;
  // Real ToDos owned by THIS node, by most-specific linkage so each appears once:
  // monthly→plan_node_id, key_result→key_result_id (not already under a month),
  // objective→goal_id (not under a KR/month). Free ToDos (no goal_id) stay out of the tree.
  const ownTasks = (tasks || []).filter((tk) =>
    goal.level === 'monthly' ? tk.plan_node_id === goal.id
    : goal.level === 'key_result' ? tk.key_result_id === goal.id && !tk.plan_node_id
    : goal.level === 'objective' ? tk.goal_id === goal.id && !tk.key_result_id && !tk.plan_node_id
    : false);
  const expandable = hasChildren || ownTasks.length > 0;
  // Prefer the server-computed signal (has child goals OR any attached ToDo —
  // catches goals decomposed with zero KR nodes but materialized tasks, which
  // the local children-only check would miss and keep offering to re-decompose).
  const canDecompose = depth === 0 && !(goal.decomposed ?? hasChildren);
  const decomposing = decomposingId === goal.id;
  const level = levelInfo(goal.level);
  const dimColor = DIMENSION_COLORS[goal.lifeWheelDimension];
  const statusFg = STATUS_FG[goal.status] ?? STATUS_FG.draft;
  const statusText = statusLabel(goal.status);

  const ringSize = depth === 0 ? 36 : 28;

  return (
    <div>
      <div
        className={`gl-row gl-depth-${depth}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          padding: '12px 16px',
          paddingLeft: depth * 24 + 16,
          cursor: expandable ? 'pointer' : 'default',
          borderBottom: depth === 0 ? '1px solid var(--g-border)' : 'none',
        }}
        onClick={() => expandable && setExpanded(!expanded)}
      >
        <div className="gl-row-primary" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, width: '100%' }}>
          <div className="gl-chevron" style={{ width: 20, flexShrink: 0, color: 'var(--g-text-muted)', paddingTop: 2 }}>
            {expandable ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <div style={{ width: 16, height: 16 }} />}
          </div>

          <span className="gl-level-badge" style={{ padding: '2px 6px', fontSize: fontVars.sm, fontWeight: 700, borderRadius: 5, flexShrink: 0, background: level.color + '20', color: level.color, marginTop: 1 }}>
            {goal.level === 'objective' ? 'O' : goal.level === 'key_result' ? 'KR' : goal.level === 'monthly' ? 'M' : 'T'}
          </span>

          <div className="gl-title-wrap" style={{ flex: 1, minWidth: 0 }}>
            <p
              className="gl-title"
              style={{
                margin: 0,
                color: depth === 0 ? 'var(--g-text)' : 'var(--g-text-mid)',
                fontSize: fontVars.sm,
                fontWeight: 400,
                lineHeight: 1.45,
              }}
            >
              {goal.title}
            </p>
            {depth === 0 && goal.lifeWheelDimension && (
              <div className="gl-title-tags" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: fontVars.sm, padding: '1px 6px', borderRadius: 5, background: dimColor + '20', color: dimColor }}>
                  {dimLabel(goal.lifeWheelDimension)}
                </span>
                {goal.createdAt && (
                  <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                    {t('createdOn', { date: goal.createdAt.slice(0, 10) })}
                  </span>
                )}
                {goal.startDate && goal.endDate ? (
                  <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                    {t('targetSpan', { start: goal.startDate.slice(0, 10), end: goal.endDate.slice(0, 10) })}
                  </span>
                ) : goal.endDate ? (
                  <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                    {t('targetBy', { date: goal.endDate.slice(0, 10) })}
                  </span>
                ) : null}
                {goal.obstacleHitRate !== undefined && (
                  <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('hitRate', { rate: goal.obstacleHitRate })}</span>
                )}
              </div>
            )}
          </div>

          <div className="gl-row-aside" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <span className="gl-progress" style={{ flexShrink: 0, lineHeight: 0 }}>
              <ProgressRing progress={goal.progress} size={ringSize} color={level.color} />
            </span>

            <span className="gl-status" style={{ fontSize: fontVars.sm, padding: '2px 7px', borderRadius: 999, background: `color-mix(in oklch, ${statusFg} 16%, transparent)`, color: statusFg, flexShrink: 0, whiteSpace: 'nowrap' }}>
              {statusText}
            </span>

            {decomposing && (
              <span className="gl-decomposing" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fontVars.sm, color: 'var(--g-accent)', flexShrink: 0 }}>
                <Loader2 className="w-3 h-3 animate-spin" />
              </span>
            )}

            {depth === 0 && (
              <div className="gl-actions-wrap">
                {canDecompose && onDecompose && (
                  <button type="button" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onDecompose(goal.id); }}
                    className="gl-decompose-btn"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--g-accent-line)', background: 'var(--g-accent-soft)', color: 'var(--g-accent)', fontSize: fontVars.sm, cursor: 'pointer', fontFamily: 'var(--g-font-sans)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <Sparkles className="w-3 h-3" /> <span className="gl-decompose-label">{t('decomposeOkr')}</span>
                  </button>
                )}
                {onOpenDetail && (
                  <button type="button" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onOpenDetail(goal.id); }}
                    className="gl-detail-btn">
                    {t('detail')}
                  </button>
                )}
                {hasWoop && (
                  <button type="button" title="WOOP" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setShowWoop(s => !s); }}
                    className="gl-woop-btn"
                    style={{ padding: '4px 8px', borderRadius: 999, border: '1px solid var(--g-border)', background: showWoop ? 'var(--g-surface-2)' : 'transparent', color: 'var(--g-text-muted)', fontSize: fontVars.sm, cursor: 'pointer', fontFamily: 'var(--g-font-mono)', flexShrink: 0 }}>
                    WOOP
                  </button>
                )}
                <GoalActionsMenu
                  goal={goal}
                  canDecompose={canDecompose}
                  onDecompose={onDecompose}
                  onEdit={onEdit}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                  onViewObstacles={onViewObstacles}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* WOOP Summary (O-level) — 默认收起,点行内 WOOP 小标记才展开。 */}
      {depth === 0 && showWoop && (goal.wish || goal.outcome || goal.obstacle) && (
        <div style={{ padding: '12px 16px', paddingLeft: 24 + 16, background: 'var(--g-bg-raised)', borderBottom: '1px solid var(--g-border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: fontVars.sm }} className="gl-woop-grid">
            {goal.wish && (
              <div>
                <span style={{ color: 'var(--g-accent)', fontWeight: 600 }}>{t('woopWish')}</span>
                <p style={{ margin: '2px 0 0', color: 'var(--g-text-muted)' }}>{goal.wish}</p>
              </div>
            )}
            {goal.outcome && (
              <div>
                <span style={{ color: 'var(--g-warning, #f59e0b)', fontWeight: 600 }}>{t('woopOutcome')}</span>
                <p style={{ margin: '2px 0 0', color: 'var(--g-text-muted)' }}>{goal.outcome}</p>
              </div>
            )}
            {goal.obstacle && (
              <div>
                <span style={{ color: 'var(--g-danger)', fontWeight: 600 }}>{t('woopObstacle')}</span>
                <p style={{ margin: '2px 0 0', color: 'var(--g-text-muted)' }}>{goal.obstacle}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Children */}
      <AnimatePresence>
        {expanded && expandable && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
            {hasChildren && goal.children!.map(child => (
              <GoalNode
                key={child.id}
                goal={child}
                depth={depth + 1}
                tasks={tasks}
                onDecompose={onDecompose}
                onEdit={onEdit}
                decomposingId={decomposingId}
                onStatusChange={onStatusChange}
                onDelete={onDelete}
                onViewObstacles={onViewObstacles}
              />
            ))}
            {ownTasks.map((tk) => {
              const done = tk.status === 'done';
              return (
                <div key={tk.id} className="gl-row gl-task-row" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 16px', paddingLeft: (depth + 1) * 24 + 16 }}>
                  <span style={{ width: 20, flexShrink: 0 }} />
                  <span style={{ width: 12, height: 12, borderRadius: 999, flexShrink: 0, marginTop: 3, border: `1.5px solid ${done ? 'var(--g-accent)' : 'var(--g-border)'}`, background: done ? 'var(--g-accent)' : 'transparent' }} />
                  <span className="gl-title" style={{ flex: 1, minWidth: 0, fontSize: fontVars.sm, color: done ? 'var(--g-text-faint)' : 'var(--g-text-mid)', textDecoration: done ? 'line-through' : 'none', lineHeight: 1.45 }}>{tk.title}</span>
                  {tk.is_mit && <span style={{ fontSize: fontVars.sm, fontWeight: 700, color: 'var(--g-accent)' }}>MIT</span>}
                  {tk.estimated_duration ? <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{tk.estimated_duration}m</span> : null}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function GoalList({ goals, tasks, onDecompose, onEdit, onOpenDetail, decomposingId, onStatusChange, onDelete, onViewObstacles }: Props) {
  const t = useTranslations('app.planner.list');
  const tree = buildTree(goals);

  if (tree.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0' }}>
        <Target className="w-12 h-12" style={{ color: 'var(--g-text-faint)', margin: '0 auto 12px' }} />
        <h3 style={{ margin: '0 0 6px', color: 'var(--g-text)', fontWeight: 500 }}>{t('emptyTitle')}</h3>
        <p style={{ margin: 0, color: 'var(--g-text-muted)', fontSize: fontVars.sm }}>{t('emptyHint')}</p>
      </div>
    );
  }

  return (
    // flexShrink:0 — this sits in GoalsView's flex-column <main overflow:auto>
    // alongside the CTA banner and stat grid. Without it, the default
    // flex-shrink:1 squeezes this (by far the tallest) item below its content
    // height, and overflow:hidden then silently clips the rest of the list
    // instead of it being reachable via the ancestor's scroll.
    <div style={{ borderRadius: 14, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', overflow: 'hidden', flexShrink: 0 }}>
      <style>{`
        .gl-row:hover { background: var(--g-bg-raised); }
        .gl-row .gl-actions-open, .gl-row:hover button { opacity: 1; }
        .gl-more-btn {
          padding: 6px;
          border-radius: 8px;
          background: transparent;
          border: 1px solid var(--g-border);
          cursor: pointer;
          color: var(--g-text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .gl-detail-btn {
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid var(--g-border);
          background: transparent;
          color: var(--g-text-mid);
          font-size: 12px;
          cursor: pointer;
          font-family: var(--g-font-sans);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .gl-row-aside {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .gl-actions-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        @media (min-width: 901px) {
          .gl-row:not(.gl-task-row) {
            flex-direction: row !important;
            align-items: center !important;
            gap: 12px !important;
          }
          .gl-row-primary { flex: 1; min-width: 0; align-items: center !important; }
          .gl-row-aside { margin-left: auto; }
          .gl-title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }
      `}</style>
      {tree.map(goal => (
        <GoalNode
          key={goal.id}
          goal={goal}
          tasks={tasks}
          onDecompose={onDecompose}
          onEdit={onEdit}
          onOpenDetail={onOpenDetail}
          decomposingId={decomposingId}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
          onViewObstacles={onViewObstacles}
        />
      ))}
    </div>
  );
}
