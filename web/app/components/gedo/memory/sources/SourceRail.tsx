'use client';

// 来源库左栏（IA v2 批次2）：接替花瓣枢纽的位置，来源即过滤器 ——
// 固定项（与智伴的对话 / 手动记录）+ 导入来源紧凑条；点谁右侧记忆流就只看谁。
// 分级渲染（UX 评审 major 项）：0 个导入来源 = 220px 紧凑轨 + 导入引导卡，
// ≥1 = 340px 全栏；整栏可折叠为图标轨（localStorage 记忆）。
// 确认动作不在本地：来源条「N 条待确认 →」只做跳链（唯一确认入口=待确认面板）。
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { MemorySource, SourceQuota } from '@/lib/apiClient';
import { fontVars } from '@/app/components/gedo/typography';
import { chipBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';
import { IconChat, IconEdit, IconLayers, IconChev, IconTrash, IconPlus } from '@/app/components/gedo/icons';
import { IconFileDoc, IconLink, IconClipboard, IconBot, IconRefresh } from './icons';
import type { ApiMem } from '../FragmentStream';

const ACTIVE = new Set(['queued', 'fetching', 'parsing', 'extracting']);
const COLLAPSE_KEY = 'gedo_mem_rail_collapsed';

export type SourceSelection =
  | { kind: 'all' }
  | { kind: 'origin'; origin: 'chat' | 'manual' }
  | { kind: 'source'; id: string };

export function selectionMatches(sel: SourceSelection, mem: ApiMem): boolean {
  if (sel.kind === 'all') return true;
  const src = mem.source ?? 'text';
  const sid = (mem as { source_id?: string | null }).source_id ?? null;
  if (sel.kind === 'source') return sid === sel.id;
  if (sel.origin === 'chat') return !sid && (src === 'chat' || src === 'auto_extract');
  return !sid && (src === 'text' || src === 'voice' || src === 'image');
}

function typeIcon(source: MemorySource, size = 14) {
  if (source.type === 'chat_export' || source.platform) return <IconBot size={size} />;
  if (source.type === 'url') return <IconLink size={size} />;
  if (source.type === 'text') return <IconClipboard size={size} />;
  return <IconFileDoc size={size} />;
}

function statusColor(status: MemorySource['status']) {
  if (status === 'failed') return 'oklch(0.65 0.18 25)';
  if (status === 'review') return 'var(--g-accent)';
  if (status === 'done') return 'var(--g-text-muted)';
  if (status === 'canceled' || status === 'queued') return 'var(--g-text-faint)';
  return 'var(--g-accent)';
}

export function SourceRail({
  sources,
  quota,
  pendingBySource,
  episodes,
  selection,
  onSelect,
  onOpenInbox,
  onOpenDetail,
  onRetry,
  onDelete,
  onAdd,
}: {
  sources: MemorySource[];
  quota: SourceQuota | null;
  /** 每来源待确认数（来自待确认聚合计数，与右上 badge 同源） */
  pendingBySource: Map<string, number>;
  episodes: ApiMem[];
  selection: SourceSelection;
  onSelect: (sel: SourceSelection) => void;
  onOpenInbox: (sourceId: string) => void;
  onOpenDetail: (sourceId: string) => void;
  onRetry: (sourceId: string) => void;
  onDelete: (sourceId: string) => void;
  onAdd: () => void;
}) {
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const locale = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* ignore */ }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed(c => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  };

  // 固定项计数 + 最近活动（与后端 origin 口径一致：chat/auto_extract vs text/voice/image）
  const originStats = useMemo(() => {
    const acc = {
      chat: { count: 0, last: '' },
      manual: { count: 0, last: '' },
    };
    for (const m of episodes) {
      const sid = (m as { source_id?: string | null }).source_id ?? null;
      if (sid) continue;
      const src = m.source ?? 'text';
      const bucket = (src === 'chat' || src === 'auto_extract') ? acc.chat
        : (src === 'text' || src === 'voice' || src === 'image') ? acc.manual : null;
      if (!bucket) continue;
      bucket.count += 1;
      if ((m.created_at ?? '') > bucket.last) bucket.last = m.created_at ?? '';
    }
    return acc;
  }, [episodes]);

  const lastLabel = (iso: string) => {
    if (!iso) return null;
    try { return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' }); } catch { return null; }
  };

  const hasImports = sources.length > 0;
  const quotaLine = quota && quota.limit != null
    ? td('memory.rail.quota', { used: quota.used, limit: quota.limit })
    : null;

  // ── 折叠态：44px 图标轨 ─────────────────────────────────────────────
  if (collapsed) {
    const iconBtn = (active: boolean, onClick: () => void, title: string, icon: React.ReactNode) => (
      <button
        key={title}
        type="button"
        title={title}
        onClick={onClick}
        style={{
          width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${active ? 'var(--g-accent-line)' : 'transparent'}`,
          background: active ? 'var(--g-accent-soft)' : 'transparent',
          color: active ? 'var(--g-accent)' : 'var(--g-text-muted)', cursor: 'pointer',
        }}
      >
        {icon}
      </button>
    );
    return (
      <aside className="gedo-aux-sidebar" style={{
        width: 46, flexShrink: 0, borderRight: '1px solid var(--g-border)', background: 'var(--g-bg-raised)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 0', minHeight: 0,
      }}>
        <button type="button" title={t('memory.rail.expand')} onClick={toggleCollapsed}
          style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconChev size={14} />
        </button>
        {iconBtn(selection.kind === 'all', () => onSelect({ kind: 'all' }), t('memory.rail.all'), <IconLayers size={15} />)}
        {iconBtn(selection.kind === 'origin' && selection.origin === 'chat', () => onSelect({ kind: 'origin', origin: 'chat' }), t('memory.rail.chat'), <IconChat size={15} />)}
        {iconBtn(selection.kind === 'origin' && selection.origin === 'manual', () => onSelect({ kind: 'origin', origin: 'manual' }), t('memory.rail.manual'), <IconEdit size={15} />)}
      </aside>
    );
  }

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '7px 10px', borderRadius: 10, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--g-accent-line)' : 'transparent'}`,
    background: active ? 'var(--g-accent-soft)' : 'transparent',
    color: 'var(--g-text)', fontFamily: 'var(--g-font-sans)', fontSize: fontVars.sm,
  });

  const fixedRow = (
    sel: SourceSelection, icon: React.ReactNode, label: string,
    count: number, last: string,
  ) => {
    const active = JSON.stringify(sel) === JSON.stringify(selection);
    const lastText = lastLabel(last);
    return (
      <button type="button" style={rowStyle(active)} onClick={() => onSelect(active ? { kind: 'all' } : sel)}>
        <span style={{ color: active ? 'var(--g-accent)' : 'var(--g-text-muted)', flexShrink: 0, display: 'flex' }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {lastText && <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', flexShrink: 0 }}>{lastText}</span>}
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', flexShrink: 0, minWidth: 18, textAlign: 'right' }}>{count}</span>
      </button>
    );
  };

  return (
    <aside className="gedo-aux-sidebar" style={{
      width: hasImports ? 340 : 224, flexShrink: 0, minHeight: 0,
      borderRight: '1px solid var(--g-border)', background: 'var(--g-bg-raised)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* 栏头 */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 6px' }}>
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.08em' }}>
          {t('memory.rail.title')}
        </span>
        <button type="button" title={t('memory.rail.collapse')} onClick={toggleCollapsed}
          style={{ border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', display: 'flex', transform: 'rotate(180deg)' }}>
          <IconChev size={13} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fixedRow({ kind: 'all' }, <IconLayers size={14} />, t('memory.rail.all'), episodes.length, '')}
        {fixedRow({ kind: 'origin', origin: 'chat' }, <IconChat size={14} />, t('memory.rail.chat'), originStats.chat.count, originStats.chat.last)}
        {fixedRow({ kind: 'origin', origin: 'manual' }, <IconEdit size={14} />, t('memory.rail.manual'), originStats.manual.count, originStats.manual.last)}

        {/* 导入来源分区 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px 4px' }}>
          <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.06em' }}>
            {t('memory.rail.imports')}{hasImports ? ` · ${sources.length}` : ''}
          </span>
          <button type="button" title={t('memory.rail.addImport')} onClick={onAdd}
            style={{ border: 'none', background: 'transparent', color: 'var(--g-text-muted)', cursor: 'pointer', display: 'flex' }}>
            <IconPlus size={13} />
          </button>
        </div>

        {!hasImports ? (
          // 引导卡：把空栏变成导入获客位
          <div style={{
            margin: '2px 2px 0', padding: '12px 12px 14px', borderRadius: 12,
            border: '1px dashed var(--g-border)', background: 'var(--g-surface-1)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ display: 'flex', gap: 8, color: 'var(--g-text-muted)' }}>
              <IconFileDoc size={15} /><IconLink size={15} /><IconClipboard size={15} /><IconBot size={15} />
            </div>
            <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-muted)', lineHeight: 1.55 }}>
              {t('memory.rail.guideText')}
            </p>
            <button type="button" style={{ ...chipBtnStyle(true), justifyContent: 'center', fontWeight: 600 }} onClick={onAdd}>
              {t('memory.rail.guideCta')}
            </button>
            {quotaLine && (
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{quotaLine}</span>
            )}
          </div>
        ) : (
          <>
            {sources.map((s) => (
              <SourceRailItem
                key={s.id}
                source={s}
                active={selection.kind === 'source' && selection.id === s.id}
                pendingCount={pendingBySource.get(s.id) ?? 0}
                onSelect={() => onSelect(selection.kind === 'source' && selection.id === s.id ? { kind: 'all' } : { kind: 'source', id: s.id })}
                onOpenInbox={() => onOpenInbox(s.id)}
                onOpenDetail={() => onOpenDetail(s.id)}
                onRetry={() => onRetry(s.id)}
                onDelete={() => onDelete(s.id)}
              />
            ))}
            {quotaLine && (
              <div style={{ padding: '8px 10px 0' }}>
                <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                  {quotaLine}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function SourceRailItem({
  source, active, pendingCount, onSelect, onOpenInbox, onOpenDetail, onRetry, onDelete,
}: {
  source: MemorySource;
  active: boolean;
  pendingCount: number;
  onSelect: () => void;
  onOpenInbox: () => void;
  onOpenDetail: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    if (!confirmDel) return;
    const id = setTimeout(() => setConfirmDel(false), 3200);
    return () => clearTimeout(id);
  }, [confirmDel]);

  const isActive = ACTIVE.has(source.status);
  const pct = source.progress.chunks_total > 0
    ? Math.round((source.progress.chunks_done / source.progress.chunks_total) * 100)
    : null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 5,
      padding: '7px 10px', borderRadius: 10,
      border: `1px solid ${active ? 'var(--g-accent-line)' : 'transparent'}`,
      background: active ? 'var(--g-accent-soft)' : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onSelect}
          title={source.title || undefined}
          style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
            border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
            color: 'var(--g-text)', fontFamily: 'var(--g-font-sans)', fontSize: fontVars.sm,
          }}
        >
          <span style={{ color: statusColor(source.status), flexShrink: 0, display: 'flex' }}>{typeIcon(source)}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {source.title || td(`memory.sources.typeNames.${source.type}`)}
          </span>
        </button>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
          {(source.status === 'failed' || source.status === 'canceled') && (
            <RailIconBtn title={t('common.retry')} onClick={onRetry}><IconRefresh size={12} /></RailIconBtn>
          )}
          <RailIconBtn title={t('memory.sources.detail.open')} onClick={onOpenDetail}>
            <span style={{ fontSize: 11, fontFamily: 'var(--g-font-mono)' }}>ⓘ</span>
          </RailIconBtn>
          <RailIconBtn
            title={confirmDel ? t('memory.sources.card.deleteConfirm') : t('common.delete')}
            danger={confirmDel}
            onClick={() => { if (confirmDel) { setConfirmDel(false); onDelete(); } else setConfirmDel(true); }}
          >
            {confirmDel ? <span style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{t('memory.sources.card.deleteConfirm')}</span> : <IconTrash size={12} />}
          </RailIconBtn>
        </span>
      </div>

      {isActive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--g-surface-2)', overflow: 'hidden' }}>
            <div style={{
              width: pct != null ? `${Math.max(4, pct)}%` : '30%', height: '100%',
              background: 'var(--g-accent)', transition: 'width 0.6s ease',
              animation: pct == null ? 'gedoRailPulse 1.4s ease-in-out infinite alternate' : undefined,
            }} />
            <style>{'@keyframes gedoRailPulse { from { margin-left: 0 } to { margin-left: 70% } }'}</style>
          </div>
          <span style={{ flexShrink: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {source.status === 'queued' && source.queue_position != null
              ? td('memory.sources.card.queuePos', { pos: source.queue_position })
              : pct != null ? `${source.progress.chunks_done}/${source.progress.chunks_total}` : '…'}
          </span>
        </div>
      )}

      {pendingCount > 0 && !isActive && (
        <button type="button" onClick={onOpenInbox}
          style={{
            alignSelf: 'flex-start', border: 'none', cursor: 'pointer', padding: '1px 8px', borderRadius: 999,
            background: 'var(--g-accent-soft)', color: 'var(--g-accent)', fontSize: fontVars.xs, fontFamily: 'var(--g-font-sans)',
          }}>
          {td('memory.rail.pendingChip', { n: pendingCount })} →
        </button>
      )}

      {source.status === 'failed' && source.error && (
        <span style={{ fontSize: fontVars.xs, color: 'oklch(0.65 0.18 25)', lineHeight: 1.4 }}>
          {td(`memory.sources.status.failed`)} · {source.error.code}
        </span>
      )}
    </div>
  );
}

function RailIconBtn({ title, onClick, danger, children }: {
  title: string; onClick: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        border: 'none', background: 'transparent', cursor: 'pointer',
        color: danger ? 'oklch(0.65 0.18 25)' : 'var(--g-text-faint)',
        display: 'flex', alignItems: 'center', padding: '3px 4px', borderRadius: 6,
      }}
    >
      {children}
    </button>
  );
}
