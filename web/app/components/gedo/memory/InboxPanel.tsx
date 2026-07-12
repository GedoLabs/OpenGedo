'use client';

// 统一收件箱（IA v2 批次1）：三个确认队列的唯一入口 —— 来源导入候选 +
// 聊天新发现（同为 captures）+ 画像变更（conflicts，id 前缀 conflict_）。
// 由 MemoryScreen 头部常驻按钮打开的右侧滑出面板；行交互（勾选/行内编辑
// 内容·类型·领域）承袭原 SourceReviewPanel；动作只有「收下/跳过」两个词。
// 临期候选（≤7 天）单独置顶；「已自动收下」摘要行提供按来源一键撤销。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import type { MemoryInboxItem, MemoryInboxSnapshot, MemoryCandidate } from '@/lib/apiClient';
import { fontVars } from '@/app/components/gedo/typography';
import { primaryBtnStyle, ghostBtnStyle, chipBtnStyle } from '@/app/components/gedo/primitives';
import { IconEdit } from '@/app/components/gedo/icons';
import { DIM_KEYS, dimColor } from './dimensions';

const MEM_TYPES = ['important_info', 'personal_trait', 'key_event', 'date_reminder'] as const;
const EXPIRING_DAYS = 7;

type RowEdit = { content?: string; type?: string; dimensions?: string[] };
type RowState = { checked: boolean; editing: boolean; edit: RowEdit; failed?: string };

export type InboxFocus = {
  /** 来源卡「去确认」→ 滚动定位到该来源分组 */
  sourceId?: string | null;
  /** 图鉴详情「关于 TA 的发现」→ 只看该实体相关候选 */
  entityId?: string | null;
  entityName?: string | null;
  /** 一键梳理 → 定位画像变更分组 */
  group?: 'consolidation' | null;
};

export function InboxPanel({
  open,
  focus,
  onClose,
  onDecided,
}: {
  open: boolean;
  focus: InboxFocus | null;
  onClose: () => void;
  /** 任何裁决/撤销成功后回调（父级刷新记忆流与计数） */
  onDecided: () => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;

  const [snapshot, setSnapshot] = useState<MemoryInboxSnapshot | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [quotaHit, setQuotaHit] = useState(false);
  const [lastResult, setLastResult] = useState<{ confirmed: number; rejected: number } | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const reload = useCallback(async () => {
    try {
      const snap = await api.getMemoryInbox({ limit: 500 });
      setSnapshot(snap);
    } catch { /* 打开时再试 */ }
  }, [api]);

  useEffect(() => { if (open) void reload(); }, [open, reload]);

  // 打开期间有导入在跑就 2.5s 轮询（候选边导边涨）
  useEffect(() => {
    if (!open || !snapshot?.counts.active_sources) return;
    const timer = setInterval(() => { void reload(); }, 2500);
    return () => clearInterval(timer);
  }, [open, snapshot?.counts.active_sources, reload]);

  const items = useMemo(() => {
    let list = snapshot?.items ?? [];
    if (focus?.entityId || focus?.entityName) {
      list = list.filter((it) => {
        const c = it.candidate;
        if (!c) return false;
        if (focus.entityId && c.entity_id === focus.entityId) return true;
        if (focus.entityName && c.entity_name === focus.entityName) return true;
        return false;
      });
    }
    return list;
  }, [snapshot, focus?.entityId, focus?.entityName]);

  // 轮询整批换 items：保留幸存行状态，新行默认勾选
  useEffect(() => {
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const it of items) next[it.id] = prev[it.id] ?? { checked: true, editing: false, edit: {} };
      return next;
    });
  }, [items]);

  // 「去确认 / 一键梳理」定位：滚到分组并短暂高亮
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const key = focus?.sourceId || (focus?.group === 'consolidation' ? 'consolidation' : null);
    if (!key) return;
    const timer = setTimeout(() => {
      const el = groupRefs.current[key];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setFlashId(key);
        setTimeout(() => setFlashId(null), 1600);
      }
    }, 120); // 等一次渲染
    return () => clearTimeout(timer);
  }, [open, focus?.sourceId, focus?.group, snapshot]);

  // 分组：临期置顶 → 导入（按来源）→ 聊天 → 画像变更
  const groups = useMemo(() => {
    const soon = Date.now() + EXPIRING_DAYS * 24 * 60 * 60 * 1000;
    const expiring: MemoryInboxItem[] = [];
    const rest: MemoryInboxItem[] = [];
    for (const it of items) {
      if (it.expires_at && new Date(it.expires_at).getTime() <= soon) expiring.push(it);
      else rest.push(it);
    }
    const importGroups = new Map<string, MemoryInboxItem[]>();
    const chat: MemoryInboxItem[] = [];
    const consolidation: MemoryInboxItem[] = [];
    for (const it of rest) {
      if (it.origin === 'consolidation') consolidation.push(it);
      else if (it.origin === 'import' && it.source_id) {
        if (!importGroups.has(it.source_id)) importGroups.set(it.source_id, []);
        importGroups.get(it.source_id)!.push(it);
      } else chat.push(it);
    }
    const sourceName = (sid: string) =>
      snapshot?.counts.by_source.find((s) => s.source_id === sid)?.name || td('memory.inbox.deletedSource');
    return {
      expiring,
      imports: [...importGroups.entries()].map(([sid, list]) => ({ sid, name: sourceName(sid), list })),
      chat,
      consolidation,
    };
  }, [items, snapshot, td]);

  const checkedIds = useMemo(() => items.filter((it) => rows[it.id]?.checked).map((it) => it.id), [items, rows]);
  const setAll = (checked: boolean) =>
    setRows((prev) => Object.fromEntries(Object.entries(prev).map(([id, r]) => [id, { ...r, checked }])));

  const submit = useCallback(async (decision: 'approve' | 'reject') => {
    if (!checkedIds.length || submitting) return;
    setSubmitting(true);
    setQuotaHit(false);
    try {
      const decisions = checkedIds.map((id) => {
        const edit = rows[id]?.edit || {};
        const edits: RowEdit = {};
        if (edit.content?.trim()) edits.content = edit.content.trim();
        if (edit.type) edits.type = edit.type;
        if (edit.dimensions) edits.dimensions = edit.dimensions;
        return { id, decision, ...(decision === 'approve' && Object.keys(edits).length ? { edits } : {}) };
      });
      const res = await api.decideInboxBatch(decisions);
      if (res.failed.some((f) => f.error === 'quota_exceeded')) setQuotaHit(true);
      setLastResult({
        confirmed: res.confirmed.length + res.conflicts.applied.length,
        rejected: res.rejected.length + res.conflicts.kept.length,
      });
      setRows((prev) => {
        const next = { ...prev };
        for (const f of [...res.failed, ...res.conflicts.failed]) {
          if (f.id && next[f.id]) next[f.id] = { ...next[f.id], failed: f.error };
        }
        return next;
      });
      await reload();
      onDecided();
    } catch { /* 网络失败保持现场，可重试 */ } finally {
      setSubmitting(false);
    }
  }, [api, checkedIds, rows, submitting, reload, onDecided]);

  const undoAutoSaved = useCallback(async (sourceId: string) => {
    if (undoing) return;
    setUndoing(sourceId);
    try {
      await api.undoCapturesBatch({ sourceId });
      await reload();
      onDecided();
    } catch { /* 可重试 */ } finally {
      setUndoing(null);
    }
  }, [api, undoing, reload, onDecided]);

  // 画像字段人话标签：复用既有 review.fieldLabels/leafLabels 键（按路径末段匹配）
  const conflictFieldLabel = (field: string) => {
    const leaf = field.split('.').pop() || field;
    if (['name', 'profession', 'location', 'topPriorities', 'northStar', 'fiveYear', 'tone'].includes(leaf)) {
      return td(`memory.review.fieldLabels.${leaf}`);
    }
    if (['summary', 'recentInsight', 'skills', 'patterns'].includes(leaf)) {
      return td(`memory.review.leafLabels.${leaf}`);
    }
    return leaf;
  };

  const renderRow = (it: MemoryInboxItem) => {
    const row = rows[it.id];
    if (!row) return null;
    const c = it.candidate;
    const isMemory = c?.kind === 'memory';
    const displayContent = row.edit.content ?? c?.content ?? '';
    const displayType = row.edit.type ?? c?.type ?? 'important_info';
    const displayDims = row.edit.dimensions ?? [];
    return (
      <div key={it.id} style={{
        display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 10,
        border: `1px solid ${row.failed ? 'oklch(0.65 0.18 25 / 0.5)' : 'var(--g-border)'}`,
        background: 'var(--g-surface-1)',
      }}>
        <input
          type="checkbox"
          checked={row.checked}
          onChange={(e) => setRows((prev) => ({ ...prev, [it.id]: { ...prev[it.id], checked: e.target.checked } }))}
          style={{ marginTop: 3, accentColor: 'var(--g-accent)', cursor: 'pointer', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {it.conflict ? (
            <div style={{ fontSize: fontVars.sm, color: 'var(--g-text)', lineHeight: 1.55 }}>
              <span style={{ color: 'var(--g-text-faint)' }}>{conflictFieldLabel(it.conflict.field)}：</span>
              <span style={{ textDecoration: 'line-through', color: 'var(--g-text-faint)' }}>
                {String(it.conflict.old_value ?? t('memory.review.emptyValue'))}
              </span>
              <span style={{ margin: '0 6px', color: 'var(--g-text-faint)' }}>→</span>
              <span>{String(it.conflict.new_value ?? '')}</span>
            </div>
          ) : isMemory ? (
            row.editing ? (
              <textarea
                value={displayContent}
                autoFocus
                rows={2}
                onChange={(e) => setRows((prev) => ({ ...prev, [it.id]: { ...prev[it.id], edit: { ...prev[it.id].edit, content: e.target.value } } }))}
                onBlur={() => setRows((prev) => ({ ...prev, [it.id]: { ...prev[it.id], editing: false } }))}
                style={{
                  width: '100%', resize: 'vertical', borderRadius: 8, padding: '6px 8px',
                  border: '1px solid var(--g-accent-line)', background: 'var(--g-bg-raised)', color: 'var(--g-text)',
                  fontSize: fontVars.sm, lineHeight: 1.55, outline: 'none', fontFamily: 'var(--g-font-sans)',
                }}
              />
            ) : (
              <div style={{ fontSize: fontVars.sm, color: 'var(--g-text)', lineHeight: 1.55 }}>
                {displayContent}
                <button
                  type="button"
                  title={t('memory.sources.review.edit')}
                  onClick={() => setRows((prev) => ({ ...prev, [it.id]: { ...prev[it.id], editing: true } }))}
                  style={{ border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', padding: '0 4px', verticalAlign: 'middle' }}
                >
                  <IconEdit size={12} />
                </button>
              </div>
            )
          ) : (
            <div style={{ fontSize: fontVars.sm, color: 'var(--g-text)', lineHeight: 1.55 }}>
              <strong>{c?.entity_name}</strong>
              {c?.entity_type ? <span style={{ color: 'var(--g-text-faint)' }}>（{td(`memory.sources.entityTypes.${c.entity_type}`)}）</span> : null}
              <span style={{ color: 'var(--g-text-mid)' }}>：{c?.fact_key} = {c?.fact_value}</span>
              {!c?.entity_id && (
                <span style={{ marginLeft: 6, fontSize: fontVars.xs, color: 'var(--g-accent)' }}>
                  {t('memory.sources.review.newCardBadge')}
                </span>
              )}
            </div>
          )}

          {isMemory && !it.conflict && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <select
                value={displayType}
                onChange={(e) => setRows((prev) => ({ ...prev, [it.id]: { ...prev[it.id], edit: { ...prev[it.id].edit, type: e.target.value } } }))}
                style={{
                  padding: '3px 6px', borderRadius: 7, border: '1px solid var(--g-border)',
                  background: 'var(--g-surface-2)', color: 'var(--g-text-mid)', fontSize: fontVars.xs,
                  fontFamily: 'var(--g-font-sans)', cursor: 'pointer', outline: 'none',
                }}
              >
                {MEM_TYPES.map((ty) => (
                  <option key={ty} value={ty}>{td(`memory.sources.types.${ty}`)}</option>
                ))}
              </select>
              {DIM_KEYS.map((k) => {
                const on = displayDims.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRows((prev) => {
                      const cur = prev[it.id].edit.dimensions ?? [];
                      const next = on ? cur.filter((x) => x !== k) : [...cur, k];
                      return { ...prev, [it.id]: { ...prev[it.id], edit: { ...prev[it.id].edit, dimensions: next } } };
                    })}
                    style={{
                      padding: '2px 8px', borderRadius: 999, cursor: 'pointer', fontSize: fontVars.xs,
                      border: `1px solid ${on ? dimColor(k) : 'var(--g-border)'}`,
                      background: on ? `color-mix(in oklch, ${dimColor(k)} 18%, transparent)` : 'transparent',
                      color: on ? 'var(--g-text)' : 'var(--g-text-faint)',
                      fontFamily: 'var(--g-font-sans)',
                    }}
                  >
                    {td(`memory.profileDims.${k}`)}
                  </button>
                );
              })}
            </div>
          )}

          {row.failed && (
            <div style={{ fontSize: fontVars.xs, color: 'oklch(0.65 0.18 25)' }}>
              {row.failed === 'quota_exceeded' ? t('memory.sources.review.quotaHit') : t('memory.sources.review.rowFailed')}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderGroup = (key: string, title: string, list: MemoryInboxItem[], tone?: 'warn') => {
    if (!list.length) return null;
    return (
      <div
        key={key}
        ref={(el) => { groupRefs.current[key] = el; }}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8, borderRadius: 12, padding: 2,
          outline: flashId === key ? '2px solid var(--g-accent-line)' : 'none',
          outlineOffset: 2,
          transition: 'outline-color 0.4s ease',
        }}
      >
        <div style={{
          fontSize: fontVars.xs, fontFamily: 'var(--g-font-mono)', letterSpacing: '0.05em',
          display: 'flex', justifyContent: 'space-between', gap: 8,
          color: tone === 'warn' ? 'oklch(0.72 0.13 75)' : 'var(--g-text-faint)',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{ flexShrink: 0 }}>{list.length}</span>
        </div>
        {list.map(renderRow)}
      </div>
    );
  };

  if (!open) return null;

  const entityFiltered = !!(focus?.entityId || focus?.entityName);

  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / 0.35)', zIndex: 60 }}
      />
      {/* 右侧滑出面板 */}
      <aside
        aria-label={t('memory.inbox.title')}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 94vw)', zIndex: 61,
          background: 'var(--g-bg-raised)', borderLeft: '1px solid var(--g-border)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '-12px 0 40px oklch(0 0 0 / 0.25)',
        }}
      >
        {/* 面板头 */}
        <div style={{ flexShrink: 0, padding: '14px 16px 10px', borderBottom: '1px solid var(--g-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: fontVars.sm, fontWeight: 700, color: 'var(--g-text)' }}>
              {t('memory.inbox.title')}
              {items.length > 0 && (
                <span style={{
                  marginLeft: 8, padding: '1px 8px', borderRadius: 999, fontSize: fontVars.xs, fontWeight: 600,
                  background: 'var(--g-accent-soft)', color: 'var(--g-accent)',
                }}>{items.length}</span>
              )}
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {items.length > 0 && (
                <>
                  <button type="button" style={chipBtnStyle(false)} onClick={() => setAll(true)}>{t('memory.sources.review.selectAll')}</button>
                  <button type="button" style={chipBtnStyle(false)} onClick={() => setAll(false)}>{t('memory.sources.review.clearAll')}</button>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                style={{ ...chipBtnStyle(false), lineHeight: 1 }}
              >✕</button>
            </span>
          </div>
          <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', lineHeight: 1.45 }}>
            {t('memory.inbox.subtitle')}
          </span>
          {entityFiltered && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: fontVars.xs, color: 'var(--g-text-mid)' }}>
              {td('memory.inbox.entityFilter', { name: focus?.entityName || '' })}
              <button type="button" style={chipBtnStyle(false)} onClick={onClose}>{t('memory.inbox.clearFilter')}</button>
            </span>
          )}
        </div>

        {/* 列表滚动区 */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {quotaHit && (
            <div style={{
              padding: '10px 12px', borderRadius: 10, fontSize: fontVars.xs, lineHeight: 1.5,
              border: '1px solid oklch(0.65 0.18 25 / 0.4)', background: 'oklch(0.65 0.18 25 / 0.08)', color: 'var(--g-text)',
            }}>
              {t('memory.sources.review.quotaBanner')}{' '}
              <a href="./settings" style={{ color: 'var(--g-accent)' }}>{t('memory.sources.review.upgrade')} →</a>
            </div>
          )}

          {/* 已自动收下摘要（近 7 天，可一键撤销） */}
          {!entityFiltered && (snapshot?.auto_saved.length ?? 0) > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {snapshot!.auto_saved.map((row) => (
                <div key={row.source_id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '8px 12px', borderRadius: 10, fontSize: fontVars.xs,
                  border: '1px solid var(--g-accent-line)', background: 'var(--g-accent-soft)', color: 'var(--g-text)',
                }}>
                  <span style={{ lineHeight: 1.5 }}>
                    {td('memory.inbox.autoSavedLine', { n: row.count, name: row.name || t('memory.inbox.deletedSource') })}
                  </span>
                  <button
                    type="button"
                    disabled={undoing === row.source_id}
                    style={{ ...chipBtnStyle(false), flexShrink: 0, opacity: undoing === row.source_id ? 0.5 : 1 }}
                    onClick={() => void undoAutoSaved(row.source_id)}
                  >
                    {undoing === row.source_id ? t('common.saving') : t('memory.inbox.undoAll')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {lastResult && (
            <div style={{
              padding: '8px 12px', borderRadius: 10, fontSize: fontVars.xs,
              border: '1px solid var(--g-accent-line)', background: 'var(--g-accent-soft)', color: 'var(--g-text)',
            }}>
              ✓ {td('memory.inbox.doneLine', { confirmed: lastResult.confirmed, rejected: lastResult.rejected })}
            </div>
          )}

          {items.length === 0 ? (
            <p style={{ margin: '18px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-faint)', textAlign: 'center', lineHeight: 1.6 }}>
              {entityFiltered ? t('memory.inbox.entityEmpty') : t('memory.inbox.empty')}
            </p>
          ) : (
            <>
              {renderGroup('expiring', t('memory.inbox.groups.expiring'), groups.expiring, 'warn')}
              {groups.imports.map(({ sid, name, list }) => renderGroup(sid, name, list))}
              {renderGroup('chat', t('memory.inbox.groups.chat'), groups.chat)}
              {renderGroup('consolidation', t('memory.inbox.groups.consolidation'), groups.consolidation)}
            </>
          )}
        </div>

        {/* 面板脚：收下 / 跳过 */}
        {items.length > 0 && (
          <div style={{
            flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--g-border)',
            background: 'var(--g-surface-1)', display: 'flex', gap: 8,
          }}>
            <button
              type="button"
              disabled={!checkedIds.length || submitting}
              style={{ ...ghostBtnStyle(), flex: 1, justifyContent: 'center', opacity: !checkedIds.length || submitting ? 0.5 : 1 }}
              onClick={() => void submit('reject')}
            >
              {t('memory.inbox.skipSel')}
            </button>
            <button
              type="button"
              disabled={!checkedIds.length || submitting}
              style={{ ...primaryBtnStyle(), flex: 1.5, justifyContent: 'center', opacity: !checkedIds.length || submitting ? 0.5 : 1 }}
              onClick={() => void submit('approve')}
            >
              {submitting ? t('common.saving') : td('memory.inbox.acceptSel', { n: checkedIds.length })}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
