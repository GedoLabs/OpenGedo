'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import type { Entity, MemoryDimensionEntry } from '@/lib/apiClient';
import { fontVars } from '@/app/components/gedo/typography';
import { Dot, Pill, ghostBtnStyle } from '@/app/components/gedo/primitives';
import { IconSearch, IconWand, IconArrow, IconPin, IconTarget } from '@/app/components/gedo/icons';
import { DIM_KEYS, dimColor } from './dimensions';

// The AI summary is generated at most once per day and cached in localStorage
// (keyed by user), so revisiting the view reuses it instead of re-calling the LLM.
const SUMMARY_CACHE_KEY = 'gedo_mem_summary_v1';
const todayStamp = () => new Date().toISOString().slice(0, 10);

/**
 * 记忆流（IA v2 批次2）：episodes 由父级按「来源库」选择预过滤后传入，
 * 本组件负责 领域 chips（计数=当前来源范围内）+ 搜索 + FilterBar 组合过滤，
 * 以及记忆卡的行操作（收进「…」菜单，人话文案）。工具条最多两段：
 * 搜索 + 领域 chips；摘要/导出/提醒收进「…」溢出菜单（UX 评审 2.2）。
 */

export type ApiMem = {
  id?: string;
  content_raw?: string;
  type?: string;
  source?: string;
  source_id?: string | null;
  tags?: string[];
  system_tags?: string[];
  created_at?: string;
  dimensions?: string[];
  entity_ids?: string[];
  ai_excluded?: boolean;
  impact_score?: number;
};

export type ApiGoal = {
  id: string;
  title: string;
  life_wheel_dimension?: string;
  status?: string;
  progress?: number;
};

type Tr = (key: string, values?: Record<string, string | number>) => string;

export function FragmentStream({
  episodes,
  sourceLabel,
  onClearSource,
  evidenceLabel,
  onClearEvidence,
  selectedDim,
  onSelectDim,
  dimData,
  dimAssess,
  goals,
  entities,
  onToggleExclude,
  onDelete,
  onDownweight,
  onEntityClick,
  onReminder,
  onGoAssess,
  loading,
}: {
  /** 已按来源库选择预过滤的记忆列表（领域计数因此自动是来源范围内口径） */
  episodes: ApiMem[];
  /** 当前来源过滤的显示名（null=全部来源，FilterBar 不显示来源条件） */
  sourceLabel: string | null;
  onClearSource: () => void;
  /** 证据下钻过滤（「来自这 N 条记忆」）：卡片名；null=未启用 */
  evidenceLabel?: string | null;
  onClearEvidence?: () => void;
  selectedDim: string | null;
  onSelectDim: (dim: string | null) => void;
  dimData?: { summary?: string; self_score?: number | null };
  /** 选中维度的 AI 评估条目（与生命之花卡同口径；缺=显示了解不足） */
  dimAssess?: MemoryDimensionEntry | null;
  goals: ApiGoal[];
  entities: Entity[];
  onToggleExclude: (id: string, aiExcluded: boolean) => void;
  onDelete: (id: string) => void;
  onDownweight: (id: string, value: number) => void;
  onEntityClick: (id: string) => void;
  onReminder: () => void;
  /** 「去评估 →」/ 雷达小图标：跳关于我的生命之花卡 */
  onGoAssess: () => void;
  loading: boolean;
}) {
  const { api, user } = useAuth();
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const locale = useLocale();
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(8);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setQuery(searchInput), 220);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Reset paging when the filter scope changes.
  useEffect(() => { setVisibleCount(8); }, [selectedDim, sourceLabel, query]);

  const entitiesById = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities]);

  // 领域计数：episodes 已按来源预过滤 → 计数天然是来源范围内口径（UX 评审 2.4）
  const dimCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of episodes) for (const d of (m.dimensions ?? [])) counts[d] = (counts[d] || 0) + 1;
    return counts;
  }, [episodes]);

  // 全部 8 个维度常驻可见（有计数的排前，便于直接按任意领域筛选）；
  // 「全部」重置 chip 单独渲染在最前，不再折叠 +N。
  const allDims = useMemo(
    () => [...DIM_KEYS].sort((a, b) => (dimCounts[b] || 0) - (dimCounts[a] || 0)),
    [dimCounts],
  );

  const scoped = useMemo(() => {
    let list = episodes;
    if (selectedDim) list = list.filter(m => Array.isArray(m.dimensions) && m.dimensions.includes(selectedDim));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(m =>
        (m.content_raw ?? '').toLowerCase().includes(q) ||
        (m.tags ?? []).some(tag => tag.toLowerCase().includes(q)));
    }
    return list;
  }, [episodes, selectedDim, query]);

  const visible = scoped.slice(0, visibleCount);
  const hasMore = visibleCount < scoped.length;

  const dimGoals = useMemo(() => (
    selectedDim
      ? goals.filter(g => g.life_wheel_dimension === selectedDim && g.status !== 'completed' && g.status !== 'archived').slice(0, 3)
      : []
  ), [goals, selectedDim]);

  const dimEntities = useMemo(() => (
    selectedDim ? entities.filter(e => (e.dimensions || []).includes(selectedDim)).slice(0, 6) : []
  ), [entities, selectedDim]);

  const handleRegenerate = useCallback(async () => {
    if (!scoped.length || summaryLoading) return;
    setSummaryLoading(true);
    try {
      const content = scoped.slice(0, 30).map(m => m.content_raw ?? '').filter(Boolean).join('\n---\n');
      const result = await api.analyzeMemory(content) as { summary?: string; analysis?: string; insight?: string };
      const text = result?.summary ?? result?.analysis ?? result?.insight ?? t('memory.noSummaryReturned');
      setSummary(text);
      try { localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify({ uid: user?.id ?? null, date: todayStamp(), summary: text })); } catch { /* ignore storage errors */ }
    } catch (e: unknown) {
      setSummary(e instanceof Error ? t('memory.genFailedDetail', { msg: e.message }) : t('memory.genFailed'));
    } finally {
      setSummaryLoading(false);
    }
  }, [scoped, summaryLoading, api, t, user?.id]);

  // Show the AI summary by default, but generate at most once per day: reuse today's cached
  // summary on revisit/reload; only the manual "Regenerate" button forces a fresh call.
  const didInitSummary = useRef(false);
  useEffect(() => {
    if (didInitSummary.current || !scoped.length) return;
    didInitSummary.current = true;
    let cached: { uid?: string | null; date?: string; summary?: string } | null = null;
    try { cached = JSON.parse(localStorage.getItem(SUMMARY_CACHE_KEY) || 'null'); } catch { /* ignore */ }
    if (cached && cached.date === todayStamp() && (cached.uid ?? null) === (user?.id ?? null) && cached.summary) {
      setSummary(cached.summary);
    } else {
      void handleRegenerate();
    }
  }, [scoped.length, user?.id, handleRegenerate]);

  const dimLabel = selectedDim ? t(`memory.profileDims.${selectedDim}` as Parameters<typeof t>[0]) : t('memory.allMemories');

  const handleExportMarkdown = () => {
    const lines = [
      `# ${t('memory.export.title', { focus: dimLabel })}`,
      ``,
      `_${t('memory.export.exportedAt')}：${new Date().toLocaleString(locale)}_`,
      ``,
      summary ? `## ${t('memory.export.summaryHeading')}\n\n${summary}\n` : '',
      `## ${t('memory.export.timelineHeading')}`,
      ``,
      ...scoped.map(m => {
        const ts = m.created_at ? new Date(m.created_at).toLocaleString(locale) : '—';
        const src = m.source ?? 'text';
        const tagStr = (m.tags ?? []).map(tag => `#${tag}`).join(' ');
        return `- **${ts}** _(${src})_ ${tagStr}\n  ${m.content_raw ?? ''}\n`;
      }),
    ].filter(Boolean).join('\n');
    const blob = new Blob([lines], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gedo-memory-${dimLabel}-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const hasFilters = !!(sourceLabel || selectedDim || query.trim() || evidenceLabel);
  const clearAll = () => { onClearSource(); onClearEvidence?.(); onSelectDim(null); setSearchInput(''); };

  const dimChip = (k: string) => {
    const active = selectedDim === k;
    const count = dimCounts[k] || 0;
    // 零计数维度弱化（可点但视觉后退），有内容的更醒目，便于直接筛选。
    const empty = count === 0 && !active;
    return (
      <button
        key={k}
        type="button"
        onClick={() => onSelectDim(active ? null : k)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
          border: `1px solid ${active ? dimColor(k) : 'var(--g-border)'}`,
          background: active ? `color-mix(in oklch, ${dimColor(k)} 16%, transparent)` : 'transparent',
          color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
          fontSize: fontVars.xs, fontFamily: 'var(--g-font-sans)', whiteSpace: 'nowrap',
          opacity: empty ? 0.5 : 1,
        }}
      >
        <Dot color={dimColor(k)} size={6} />
        {t(`memory.profileDims.${k}` as Parameters<typeof t>[0])}
        {count > 0 && <span style={{ fontFamily: 'var(--g-font-mono)', color: 'var(--g-text-faint)' }}>{count}</span>}
      </button>
    );
  };

  // 「全部」重置 chip：选中态=未按维度过滤（selectedDim===null）。
  const allDimsChip = (() => {
    const active = selectedDim === null;
    return (
      <button
        type="button"
        onClick={() => onSelectDim(null)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
          border: `1px solid ${active ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
          background: active ? 'var(--g-accent-soft)' : 'transparent',
          color: active ? 'var(--g-accent)' : 'var(--g-text-muted)',
          fontSize: fontVars.xs, fontFamily: 'var(--g-font-sans)', whiteSpace: 'nowrap',
        }}
      >
        {t('memory.dimAll')}
        <span style={{ fontFamily: 'var(--g-font-mono)', color: active ? 'var(--g-accent)' : 'var(--g-text-faint)' }}>{episodes.length}</span>
      </button>
    );
  })();

  return (
    <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {/* Dimension drill-in header：主位 = AI 评估分 + 等级徽章（与生命之花卡
          同口径），自评降为 faint 次要文本；解读链 insight → summary → 空态 */}
      {selectedDim && (() => {
        const scored = dimAssess?.status === 'scored';
        const aiScore = scored ? dimAssess!.score : null;
        const insightText = (scored && dimAssess?.insight) || dimData?.summary || null;
        return (
        <section style={{ padding: '16px 24px 14px', borderBottom: '1px solid var(--g-border)', background: 'var(--g-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Dot color={dimColor(selectedDim)} size={8} />
            <h2 style={{ margin: 0, fontSize: fontVars.lg, fontWeight: 600 }}>{dimLabel}</h2>
            {scored && dimAssess?.level_key ? (
              <span
                title={t(`memory.dimLevelDesc.${dimAssess.level_key}` as Parameters<typeof t>[0])}
                style={{
                  fontSize: fontVars.xs, padding: '2px 9px', borderRadius: 999,
                  background: `color-mix(in oklch, ${dimColor(selectedDim)} 16%, transparent)`,
                  border: `1px solid color-mix(in oklch, ${dimColor(selectedDim)} 36%, transparent)`,
                  color: 'var(--g-text)',
                }}
              >
                {t(`memory.dimLevels.${dimAssess.level_key}` as Parameters<typeof t>[0])}
              </span>
            ) : (
              <span style={{
                fontSize: fontVars.xs, padding: '2px 9px', borderRadius: 999,
                background: 'var(--g-surface-2)', border: '1px solid var(--g-border)', color: 'var(--g-text-faint)',
              }}>
                {t('memory.dimLevels.unknown')}
              </span>
            )}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              {aiScore != null && (
                <span style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontFamily: 'var(--g-font-mono)' }}>
                  {aiScore}<span style={{ color: 'var(--g-text-faint)' }}>/10</span>
                </span>
              )}
              {dimData?.self_score != null && (
                <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                  {td('memory.flowerCard.selfCompare', { s: dimData.self_score })}
                </span>
              )}
              <button type="button" onClick={onGoAssess}
                style={{ border: 'none', background: 'transparent', color: 'var(--g-accent)', cursor: 'pointer', fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', padding: 0 }}>
                {t('memory.dimDetail.goAssess')} →
              </button>
            </span>
          </div>
          <div style={{ height: 4, background: 'var(--g-surface-2)', borderRadius: 2, overflow: 'hidden', margin: '8px 0 10px' }}>
            <div style={{ width: `${aiScore != null ? aiScore * 10 : 0}%`, height: '100%', background: dimColor(selectedDim), borderRadius: 2 }} />
          </div>
          <p style={{ margin: 0, fontSize: fontVars.sm, color: insightText ? 'var(--g-text-mid)' : 'var(--g-text-faint)', lineHeight: 1.6, fontStyle: insightText ? 'normal' : 'italic' }}>
            {insightText || t('memory.dimDetail.empty')}
          </p>
          {(dimGoals.length > 0 || dimEntities.length > 0) && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
              {dimGoals.length > 0 && (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginBottom: 4 }}>{t('memory.flower.dimGoals')}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {dimGoals.map(g => (
                      <span key={g.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: fontVars.sm, padding: '2px 9px', borderRadius: 999, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', color: 'var(--g-text-mid)' }}>
                        {g.title}
                        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{g.progress ?? 0}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {dimEntities.length > 0 && (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginBottom: 4 }}>{t('memory.flower.dimEntities')}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {dimEntities.map(e => (
                      <button key={e.id} type="button" onClick={() => onEntityClick(e.id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: fontVars.sm, padding: '2px 9px', borderRadius: 999, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', color: 'var(--g-text-mid)', cursor: 'pointer', fontFamily: 'var(--g-font-sans)' }}>
                        <span>{e.emoji || '✨'}</span>{e.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
        );
      })()}

      <section style={{ padding: '10px 24px 28px' }}>
        {/* 工具条：搜索 + 「全部」重置 + 8 维常驻 chips + 「…」 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 10, padding: '5px 10px', flexShrink: 0 }}>
            <IconSearch size={13} style={{ color: 'var(--g-text-muted)' }} />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={t('memory.searchPlaceholder')}
              style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--g-text)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', width: 140 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
            {allDimsChip}
            {allDims.map(dimChip)}
            <button
              type="button"
              title={t('memory.dimDetail.goAssess')}
              onClick={onGoAssess}
              style={{ border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', display: 'flex', padding: 2 }}
            >
              <IconTarget size={14} />
            </button>
          </div>
          <span style={{ flex: 1 }} />
          {scoped.length > 0 && <Pill tone="memory">{t('memory.detail.countPill', { count: scoped.length })}</Pill>}
          <span style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              title={t('memory.toolsMenu')}
              onClick={() => setToolsOpen(o => !o)}
              style={{ ...ghostBtnStyle(), padding: '4px 10px' }}
            >
              …
            </button>
            {toolsOpen && (
              <span style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, minWidth: 168,
                display: 'flex', flexDirection: 'column', padding: 6, borderRadius: 10,
                background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', boxShadow: '0 8px 28px oklch(0 0 0 / 0.22)',
              }}>
                <MenuItem icon={<IconWand size={13} />} label={summaryLoading ? t('memory.sidebar.generating') : t('memory.sidebar.regenSummary')}
                  disabled={summaryLoading || scoped.length === 0}
                  onClick={() => { setToolsOpen(false); void handleRegenerate(); }} />
                <MenuItem icon={<IconArrow size={13} />} label={t('memory.sidebar.exportMd')} disabled={scoped.length === 0}
                  onClick={() => { setToolsOpen(false); handleExportMarkdown(); }} />
                <MenuItem icon={<IconPin size={13} />} label={t('memory.sidebar.setReminder')}
                  onClick={() => { setToolsOpen(false); onReminder(); }} />
              </span>
            )}
          </span>
        </div>

        {/* FilterBar：来源 × 领域 × 搜索，独立可退（方案 2 交互 4） */}
        {hasFilters && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '0 0 10px' }}>
            <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{t('memory.filterBar.label')}</span>
            {evidenceLabel && (
              <FilterChip label={td('memory.filterBar.evidence', { name: evidenceLabel })} onClear={() => onClearEvidence?.()} />
            )}
            {sourceLabel && (
              <FilterChip label={td('memory.filterBar.source', { name: sourceLabel })} onClear={onClearSource} />
            )}
            {selectedDim && (
              <FilterChip label={td('memory.filterBar.dim', { name: dimLabel })} onClear={() => onSelectDim(null)} />
            )}
            {query.trim() && (
              <FilterChip label={td('memory.filterBar.search', { q: query.trim() })} onClear={() => setSearchInput('')} />
            )}
            <button type="button" onClick={clearAll}
              style={{ border: 'none', background: 'transparent', color: 'var(--g-text-muted)', cursor: 'pointer', fontSize: fontVars.xs, fontFamily: 'var(--g-font-sans)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              {t('memory.filterBar.clearAll')}
            </button>
          </div>
        )}

        {summary && (
          <div style={{ padding: 12, marginBottom: 12, background: 'var(--g-accent-soft)', border: '1px solid var(--g-accent-line)', borderRadius: 10, fontSize: fontVars.sm, lineHeight: 1.6, color: 'var(--g-text-mid)' }}>
            <div style={{ fontSize: fontVars.xs, color: 'var(--g-accent)', fontFamily: 'var(--g-font-mono)', marginBottom: 6, letterSpacing: '0.06em' }}>{t('memory.aiSummaryLabel')}</div>
            {summary}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--g-text-faint)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)' }}>
            {t('memory.detail.loading')}
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.base, border: '1px dashed var(--g-border)', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <span>
              {!hasFilters
                ? t('memory.detail.emptyAll')
                : td('memory.filterBar.emptyCombo', {
                    conditions: [
                      evidenceLabel ? td('memory.filterBar.evidence', { name: evidenceLabel }) : null,
                      sourceLabel ? td('memory.filterBar.source', { name: sourceLabel }) : null,
                      selectedDim ? td('memory.filterBar.dim', { name: dimLabel }) : null,
                      query.trim() ? td('memory.filterBar.search', { q: query.trim() }) : null,
                    ].filter(Boolean).join(' · '),
                  })}
            </span>
            {hasFilters && (
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {sourceLabel && <button type="button" style={ghostBtnStyle()} onClick={onClearSource}>{t('memory.filterBar.clearSource')}</button>}
                {selectedDim && <button type="button" style={ghostBtnStyle()} onClick={() => onSelectDim(null)}>{t('memory.filterBar.clearDim')}</button>}
                {query.trim() && <button type="button" style={ghostBtnStyle()} onClick={() => setSearchInput('')}>{t('memory.filterBar.clearSearch')}</button>}
              </span>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map((m, i) => (
            <MemEntry
              key={m.id ?? i}
              mem={m}
              entitiesById={entitiesById}
              onToggleExclude={onToggleExclude}
              onDelete={onDelete}
              onDownweight={onDownweight}
              onEntityClick={onEntityClick}
            />
          ))}
        </div>

        {hasMore && (
          <div style={{ textAlign: 'center', paddingTop: 12 }}>
            <button type="button" style={ghostBtnStyle()} onClick={() => setVisibleCount(c => c + 10)}>
              {t('memory.detail.loadMore', { n: Math.min(scoped.length - visibleCount, 10) })}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 6px 2px 10px', borderRadius: 999, fontSize: fontVars.xs,
      background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', color: 'var(--g-text-mid)',
    }}>
      {label}
      <button type="button" onClick={onClear} aria-label="clear"
        style={{ border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>
        ✕
      </button>
    </span>
  );
}

function MenuItem({ icon, label, onClick, disabled, danger }: {
  icon?: ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: 8, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: 'transparent',
        color: disabled ? 'var(--g-text-faint)' : danger ? 'oklch(0.65 0.18 25)' : 'var(--g-text-mid)',
        fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', whiteSpace: 'nowrap',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon}{label}
    </button>
  );
}

const SOURCE_KEYS = ['text', 'chat_extract', 'voice', 'passive_event', 'reminder', 'import'];
// 真实来源值 → 展示文案键：对话两种写入值共用「对话提取」标签
const SOURCE_LABEL_ALIAS: Record<string, string> = { chat: 'chat_extract', auto_extract: 'chat_extract' };

function MemEntry({ mem, entitiesById, onToggleExclude, onDelete, onDownweight, onEntityClick }: {
  mem: ApiMem;
  entitiesById: Map<string, Entity>;
  onToggleExclude: (id: string, aiExcluded: boolean) => void;
  onDelete: (id: string) => void;
  onDownweight: (id: string, value: number) => void;
  onEntityClick: (id: string) => void;
}) {
  const t = useTranslations('app');
  const locale = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!menuOpen) setConfirmDelete(false);
  }, [menuOpen]);

  const time = mem.created_at ? formatRelativeTime(mem.created_at, locale, t as unknown as Tr) : '—';
  const srcKey = SOURCE_LABEL_ALIAS[mem.source ?? 'text'] ?? mem.source ?? 'text';
  const sourceLabel = SOURCE_KEYS.includes(srcKey) ? t(`memory.entry.sources.${srcKey}` as Parameters<typeof t>[0]) : t('memory.entry.sources.raw');
  const tags = mem.tags ?? [];
  const isHighlight = (mem.system_tags ?? []).includes('goal_related');
  const excluded = mem.ai_excluded === true;
  const lowImpact = (mem.impact_score ?? 0.5) <= 0.3;
  const linkedEntities = (mem.entity_ids ?? []).map(id => entitiesById.get(id)).filter((e): e is Entity => !!e).slice(0, 4);

  return (
    <article
      style={{
        display: 'flex',
        gap: 12,
        padding: 14,
        background: isHighlight
          ? 'linear-gradient(180deg, var(--g-surface-1), var(--g-bg-raised))'
          : 'var(--g-bg-raised)',
        border: `1px solid ${excluded ? 'var(--g-warn-line, var(--g-border))' : isHighlight ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
        borderRadius: 12,
        position: 'relative',
        opacity: excluded ? 0.6 : 1,
      }}
    >
      <div style={{ width: 88, flexShrink: 0, fontFamily: 'var(--g-font-mono)', fontSize: fontVars.xs, color: 'var(--g-text-faint)', paddingTop: 1 }}>
        {time}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: '0 0 8px', fontSize: fontVars.base, color: 'var(--g-text)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          {mem.content_raw ?? t('memory.entry.emptyContent')}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {(mem.dimensions ?? []).map(d => <Dot key={d} color={dimColor(d)} size={6} />)}
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {t('memory.entry.sourceLabel', { label: sourceLabel })}
          </span>
          {excluded && (
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-warn, #d9a441)', fontFamily: 'var(--g-font-mono)', padding: '1px 7px', background: 'var(--g-surface-1)', borderRadius: 999, border: '1px solid var(--g-border)' }}>
              {t('memory.entry.aiHidden')}
            </span>
          )}
          {lowImpact && (
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', padding: '1px 7px', background: 'var(--g-surface-1)', borderRadius: 999, border: '1px solid var(--g-border)' }}>
              {t('memory.entry.downweighted')}
            </span>
          )}
          {linkedEntities.map(e => (
            <button
              key={e.id}
              type="button"
              onClick={() => onEntityClick(e.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: fontVars.xs, color: 'var(--g-text-mid)', padding: '1px 8px', background: 'var(--g-surface-1)', borderRadius: 999, border: '1px solid var(--g-border)', cursor: 'pointer', fontFamily: 'var(--g-font-sans)' }}
            >
              <span>{e.emoji || '✨'}</span>{e.name}
            </button>
          ))}
          {tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              style={{ fontSize: fontVars.xs, color: 'var(--g-text-muted)', padding: '1px 7px', background: 'var(--g-surface-1)', borderRadius: 999, border: '1px solid var(--g-border)' }}
            >
              #{tag}
            </span>
          ))}
        </div>
      </div>
      {mem.id && (
        <div style={{ flexShrink: 0, position: 'relative', alignSelf: 'flex-start' }}>
          <button
            type="button"
            title={t('memory.entry.menu.open')}
            onClick={() => setMenuOpen(o => !o)}
            style={{
              border: '1px solid var(--g-border)', background: menuOpen ? 'var(--g-surface-2)' : 'transparent',
              color: 'var(--g-text-muted)', cursor: 'pointer', borderRadius: 8, padding: '2px 9px',
              fontSize: fontVars.sm, lineHeight: 1.4,
            }}
          >
            …
          </button>
          {menuOpen && (
            <>
              {/* 点外关闭 */}
              <span style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setMenuOpen(false)} />
              <span style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 30, minWidth: 150,
                display: 'flex', flexDirection: 'column', padding: 6, borderRadius: 10,
                background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', boxShadow: '0 8px 28px oklch(0 0 0 / 0.22)',
              }}>
                <MenuItem
                  label={excluded ? t('memory.entry.menu.allowAi') : t('memory.entry.menu.muteAi')}
                  onClick={() => { setMenuOpen(false); onToggleExclude(mem.id!, !excluded); }}
                />
                <MenuItem
                  label={lowImpact ? t('memory.entry.menu.restoreWeight') : t('memory.entry.menu.downweight')}
                  onClick={() => { setMenuOpen(false); onDownweight(mem.id!, lowImpact ? 0.5 : 0.2); }}
                />
                <MenuItem
                  danger
                  label={confirmDelete ? t('memory.entry.menu.deleteConfirm') : t('memory.entry.menu.delete')}
                  onClick={() => {
                    if (!confirmDelete) { setConfirmDelete(true); return; }
                    setMenuOpen(false);
                    onDelete(mem.id!);
                  }}
                />
              </span>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function formatRelativeTime(iso: string, locale: string, t: Tr): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const day = 86400000;
    if (diff < day) {
      return t('memory.entry.timeToday', { time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` });
    }
    if (diff < 2 * day) return t('memory.entry.timeYesterday');
    if (diff < 7 * day) return t('memory.entry.timeDaysAgo', { n: Math.floor(diff / day) });
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}
