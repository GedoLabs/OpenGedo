'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import type { Entity, MemorySource, SourceQuota, MemoryDimensionAssessment } from '@/lib/apiClient';
import { IconPlus, IconLayers, IconListChecks, IconEdit, IconChat } from '@/app/components/gedo/icons';
import { primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';
import { fontVars } from '@/app/components/gedo/typography';
import { MemoryCaptureModal } from '@/app/components/gedo/companion/MemoryCaptureModal';
import { EmptyState } from '@/app/components/gedo/EmptyState';
import { ReminderRuleModal } from './ReminderRuleModal';
import { MemoryProfileView } from './profile/MemoryProfileView';
import { EntityCodexView } from './codex/EntityCodexView';
import { FragmentStream, type ApiMem, type ApiGoal } from './FragmentStream';
import { Drawer } from '@/app/components/gedo/Drawer';
import { AddSourcesModal, type AddSourceMode } from './sources/AddSourcesModal';
import { SourceDetailDrawer } from './sources/SourceDetailDrawer';
import { SourceRail, selectionMatches, type SourceSelection } from './sources/SourceRail';
import { IconFileDoc, IconLink, IconBot } from './sources/icons';
import { InboxPanel, type InboxFocus } from './InboxPanel';

type DimProfile = Record<string, { summary?: string; self_score?: number | null }>;
type View = 'memories' | 'profile' | 'codex';

const ACTIVE_SOURCE = new Set(['queued', 'fetching', 'parsing', 'extracting']);
const UNDO_WINDOW_MS = 30_000;

// URL ?source= 编码：chat|manual|src_xxx；all 不写
function encodeSel(sel: SourceSelection): string | null {
  if (sel.kind === 'all') return null;
  if (sel.kind === 'origin') return sel.origin;
  return sel.id;
}
function decodeSel(raw: string | null): SourceSelection {
  if (!raw) return { kind: 'all' };
  if (raw === 'chat' || raw === 'manual') return { kind: 'origin', origin: raw };
  return { kind: 'source', id: raw };
}

export function MemoryScreen() {
  const { api } = useAuth();
  const t = useTranslations('app');
  // 默认落地页 = 画像（进智忆先看「AI 眼中的你」）；URL 无 view 参数时用此初值，
  // ?view=memories 仍可显式回记忆流。
  const [view, setView] = useState<View>('profile');
  const [sourceSel, setSourceSel] = useState<SourceSelection>({ kind: 'all' });
  const [goals, setGoals] = useState<ApiGoal[]>([]);
  const [memories, setMemories] = useState<ApiMem[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [profileDims, setProfileDims] = useState<DimProfile>({});
  const [dimAssessment, setDimAssessment] = useState<MemoryDimensionAssessment | null>(null);
  const [selectedDim, setSelectedDim] = useState<string | null>(null);
  const [codexFocusId, setCodexFocusId] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [railDrawerOpen, setRailDrawerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddSourceMode | undefined>(undefined);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [detailSourceId, setDetailSourceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  // 证据下钻（关于我「来自这 N 条记忆」→ 记忆流按证据 id 过滤，会话内状态不进 URL）
  const [evidenceFilter, setEvidenceFilter] = useState<{ ids: string[]; label: string } | null>(null);
  // 改版一次性提示：「生命之花搬进了关于我」
  const [flowerNoticeDismissed, setFlowerNoticeDismissed] = useState(true);
  useEffect(() => {
    try { setFlowerNoticeDismissed(localStorage.getItem('gedo_flower_moved_notice_v1') === '1'); } catch { /* ignore */ }
  }, []);
  const dismissFlowerNotice = useCallback(() => {
    setFlowerNoticeDismissed(true);
    try { localStorage.setItem('gedo_flower_moved_notice_v1', '1'); } catch { /* ignore */ }
  }, []);

  // ── 待确认：常驻入口 badge + 面板 ────────────────────────────────────
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxFocus, setInboxFocus] = useState<InboxFocus | null>(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [pendingBySource, setPendingBySource] = useState<Map<string, number>>(new Map());
  const [activeSources, setActiveSources] = useState(0);

  const refreshInboxCount = useCallback(() => {
    api.getMemoryInbox({ limit: 0 })
      .then((snap) => {
        setInboxCount(snap.counts.total);
        setActiveSources(snap.counts.active_sources ?? 0);
        setPendingBySource(new Map(snap.counts.by_source.map(s => [s.source_id, s.count])));
      })
      .catch(() => {});
  }, [api]);

  useEffect(() => { refreshInboxCount(); }, [refreshInboxCount, reloadKey]);

  const openInbox = useCallback((focus?: InboxFocus) => {
    setInboxFocus(focus ?? null);
    setInboxOpen(true);
  }, []);

  // ── 来源库（屏级单一所有者：rail / FilterBar / 添加弹窗共用）──────────
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [quota, setQuota] = useState<SourceQuota | null>(null);
  const refreshSources = useCallback(() => {
    api.listSources()
      .then((r) => { setSources(r.sources); setQuota(r.quota); })
      .catch(() => {});
  }, [api]);
  useEffect(() => { refreshSources(); }, [refreshSources, reloadKey]);

  // 有导入在跑：badge + 来源进度一起 2.5s 轮询（切视图不断流）；否则不轮询
  useEffect(() => {
    if (!activeSources) return;
    const timer = setInterval(() => { refreshInboxCount(); refreshSources(); }, 2500);
    return () => clearInterval(timer);
  }, [activeSources, refreshInboxCount, refreshSources]);

  // ── URL 状态：view / source / inbox 可分享可后退（方案 2 交互 5）──────
  const urlReady = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawView = params.get('view');
    // 旧深链映射：sources(&add=1) → 记忆视图+导入；flower → 记忆视图
    if (rawView === 'sources') {
      setView('memories');
      if (params.get('add') === '1') { setAddOpen(true); setAddMode(undefined); }
    } else if (rawView === 'flower' || rawView === 'memories') {
      setView('memories');
    } else if (rawView === 'profile' || rawView === 'codex') {
      setView(rawView);
    }
    setSourceSel(decodeSel(params.get('source')));
    if (params.get('inbox') === '1') setInboxOpen(true);
    // 延迟到下一个宏任务才允许写 URL：否则同轮的写回 effect 会用初始
    // state 把刚解析的参数覆写掉（StrictMode 双挂载下 source 参数丢失）。
    const id = setTimeout(() => { urlReady.current = true; }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!urlReady.current) return;
    const params = new URLSearchParams(window.location.search);
    params.set('view', view);
    const sel = encodeSel(sourceSel);
    if (sel && view === 'memories') params.set('source', sel); else params.delete('source');
    if (inboxOpen) params.set('inbox', '1'); else params.delete('inbox');
    params.delete('add');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [view, sourceSel, inboxOpen]);

  // Goals once (dimension drill-in).
  useEffect(() => {
    let cancelled = false;
    api.listGoals()
      .then(r => { if (!cancelled && r?.items) setGoals(r.items as ApiGoal[]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api]);

  // Episodes + entities + profile dims (reload-aware). Rail 固定项计数与
  // 记忆流共用这一份 owner-visible 列表，口径始终一致。
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Promise.all([
      api.listEpisodes({ includeExcluded: true, limit: 1000 }),
      api.listEntities().catch(() => ({ items: [] as Entity[] })),
      api.getMemoryProfile().catch(() => null),
      api.getMemoryDimensions().catch(() => null),
    ])
      .then(([eps, ents, profile, dimAssess]) => {
        if (cancelled) return;
        setMemories((eps?.items as ApiMem[]) ?? []);
        setEntities((ents?.items as Entity[]) ?? []);
        const dims = (profile as { semantic_memory?: { dimensions?: DimProfile } } | null)?.semantic_memory?.dimensions;
        if (dims) setProfileDims(dims);
        setDimAssessment(dimAssess as MemoryDimensionAssessment | null);
      })
      .catch(() => { if (!cancelled) setMemories([]); })
      .finally(() => { if (!cancelled) { setLoading(false); setLoaded(true); } });
    return () => { cancelled = true; clearTimeout(id); };
  }, [api, reloadKey]);

  // Per-memory privacy controls (operate on the episode store).
  const handleToggleExclude = useCallback((id: string, aiExcluded: boolean) => {
    setMemories(prev => prev.map(m => (m.id === id ? { ...m, ai_excluded: aiExcluded } : m)));
    api.setEpisodeExcluded(id, aiExcluded).catch(() => {
      setMemories(prev => prev.map(m => (m.id === id ? { ...m, ai_excluded: !aiExcluded } : m)));
    });
  }, [api]);

  // ── 删除：确认后仍留 30 秒撤销窗（客户端延迟提交 DELETE，守住「硬删除」承诺）──
  const pendingDeletes = useRef<Map<string, { mem: ApiMem; timer: ReturnType<typeof setTimeout> }>>(new Map());
  const [undoCount, setUndoCount] = useState(0);
  const handleDeleteMem = useCallback((id: string) => {
    const mem = memories.find(m => m.id === id);
    if (!mem) return;
    setMemories(prev => prev.filter(m => m.id !== id));
    const timer = setTimeout(() => {
      pendingDeletes.current.delete(id);
      setUndoCount(pendingDeletes.current.size);
      api.deleteEpisode(id).catch(() => { /* best-effort; next reload reconciles */ });
    }, UNDO_WINDOW_MS);
    pendingDeletes.current.set(id, { mem, timer });
    setUndoCount(pendingDeletes.current.size);
  }, [api, memories]);

  const undoDeletes = useCallback(() => {
    const restored: ApiMem[] = [];
    for (const [, { mem, timer }] of pendingDeletes.current) {
      clearTimeout(timer);
      restored.push(mem);
    }
    pendingDeletes.current.clear();
    setUndoCount(0);
    if (restored.length) {
      setMemories(prev => [...prev, ...restored]
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
    }
  }, []);

  // 离开页面：把撤销窗内的删除立即提交（不留悬空定时器）
  useEffect(() => () => {
    for (const [id, { timer }] of pendingDeletes.current) {
      clearTimeout(timer);
      api.deleteEpisode(id).catch(() => {});
    }
    pendingDeletes.current.clear();
  }, [api]);

  // 降权/恢复：低权重记忆在召回里排得更后（impact_score）。
  const handleDownweight = useCallback((id: string, value: number) => {
    let prevVal: number | undefined;
    setMemories(prev => prev.map(m => {
      if (m.id !== id) return m;
      prevVal = m.impact_score;
      return { ...m, impact_score: value };
    }));
    api.setEpisodeImportance(id, value).catch(() => {
      setMemories(prev => prev.map(m => (m.id === id ? { ...m, impact_score: prevVal } : m)));
    });
  }, [api]);

  // Fragment click-through to a codex card.
  const openCodexAt = useCallback((entityId: string) => {
    setCodexFocusId(entityId);
    setView('codex');
  }, []);

  // 来源选择 → 记忆流预过滤（领域计数因此自动是来源范围内口径）
  const streamEpisodes = useMemo(
    () => memories.filter(m => selectionMatches(sourceSel, m)
      && (!evidenceFilter || (m.id ? evidenceFilter.ids.includes(m.id) : false))),
    [memories, sourceSel, evidenceFilter],
  );
  const sourceLabel = useMemo(() => {
    if (sourceSel.kind === 'all') return null;
    if (sourceSel.kind === 'origin') return t(sourceSel.origin === 'chat' ? 'memory.rail.chat' : 'memory.rail.manual');
    return sources.find(s => s.id === sourceSel.id)?.title || t('memory.inbox.deletedSource');
  }, [sourceSel, sources, t]);

  const dimLabel = selectedDim ? t(`memory.profileDims.${selectedDim}` as Parameters<typeof t>[0]) : null;
  const headerTitle = view === 'profile'
    ? t('memory.profileTitle')
    : view === 'codex'
      ? t('memory.codexTitle')
      : (dimLabel ?? t('memory.memoriesTitle'));
  const headerSub = view === 'profile'
    ? t('memory.profileSub')
    : view === 'codex'
      ? t('memory.codexSub')
      : t('memory.memoriesSub');
  const crumbTail = view === 'profile'
    ? [t('memory.nav.profile')]
    : view === 'codex'
      ? [t('memory.nav.codex')]
      : dimLabel ? [t('memory.nav.memories'), dimLabel] : [t('memory.nav.memories')];

  const sourceRail = (
    <SourceRail
      sources={sources}
      quota={quota}
      pendingBySource={pendingBySource}
      episodes={memories}
      selection={sourceSel}
      onSelect={(sel) => { setSourceSel(sel); setRailDrawerOpen(false); }}
      onOpenInbox={(sourceId) => openInbox({ sourceId })}
      onOpenDetail={setDetailSourceId}
      onRetry={(sourceId) => { api.retrySource(sourceId).then(() => { refreshSources(); refreshInboxCount(); }).catch(() => {}); }}
      onDelete={(sourceId) => {
        setSources(prev => prev.filter(x => x.id !== sourceId));
        if (sourceSel.kind === 'source' && sourceSel.id === sourceId) setSourceSel({ kind: 'all' });
        api.deleteSource(sourceId).then(() => { refreshSources(); refreshInboxCount(); }).catch(() => { refreshSources(); });
      }}
      onAdd={() => { setAddMode(undefined); setAddOpen(true); }}
    />
  );

  const hasAnyImports = sources.length > 0;
  const emptyAll = loaded && memories.length === 0;

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
          <Breadcrumb path={['GEDO', t('nav.memory'), ...crumbTail]} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: fontVars.md, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.25 }}>{headerTitle}</h1>
            <p className="gedo-hide-mobile-subtitle" style={{ margin: '2px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.4 }}>
              {headerSub}
            </p>
          </div>
        </div>
        <div className="gedo-screen-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'profile',  label: t('memory.nav.profile') },
              { value: 'memories', label: t('memory.nav.memories') },
              { value: 'codex',    label: t('memory.nav.codex') },
            ]}
          />
          <button
            type="button"
            title={t('memory.inbox.title')}
            aria-label={t('memory.inbox.title')}
            onClick={() => openInbox()}
            style={{ ...ghostBtnStyle(), position: 'relative', fontSize: fontVars.sm }}
          >
            <IconListChecks size={15} />
            {inboxCount > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -6, minWidth: 17, height: 17,
                padding: '0 4px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--g-accent)', color: 'var(--g-bg)', fontSize: 10.5, fontWeight: 700,
                border: '2px solid var(--g-bg)', boxSizing: 'border-box',
              }}>
                {inboxCount > 99 ? '99+' : inboxCount}
              </span>
            )}
          </button>
          {/* 统一「+ 添加」：记一笔 / 上传 / 贴链接 / AI 平台导出（方案 2 交互 6） */}
          <span style={{ position: 'relative' }}>
            <button
              type="button"
              style={{ ...primaryBtnStyle(), fontSize: fontVars.sm }}
              onClick={() => setAddMenuOpen(o => !o)}
            >
              <IconPlus size={14} /> <span className="gedo-btn-label">{t('memory.addMenu.button')}</span>
            </button>
            {addMenuOpen && (
              <>
                <span style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={() => setAddMenuOpen(false)} />
                <span style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40, minWidth: 190,
                  display: 'flex', flexDirection: 'column', padding: 6, borderRadius: 10,
                  background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', boxShadow: '0 8px 28px oklch(0 0 0 / 0.22)',
                }}>
                  <AddMenuItem icon={<IconEdit size={14} />} label={t('memory.addMenu.capture')}
                    onClick={() => { setAddMenuOpen(false); setCaptureOpen(true); }} />
                  <AddMenuItem icon={<IconFileDoc size={14} />} label={t('memory.addMenu.upload')}
                    onClick={() => { setAddMenuOpen(false); setAddMode('upload'); setAddOpen(true); }} />
                  <AddMenuItem icon={<IconLink size={14} />} label={t('memory.addMenu.link')}
                    onClick={() => { setAddMenuOpen(false); setAddMode('url'); setAddOpen(true); }} />
                  <AddMenuItem icon={<IconBot size={14} />} label={t('memory.addMenu.ai')}
                    onClick={() => { setAddMenuOpen(false); setAddMode('ai'); setAddOpen(true); }} />
                </span>
              </>
            )}
          </span>
        </div>
      </header>

      {view === 'memories' && !flowerNoticeDismissed && (
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 28px', borderBottom: '1px solid var(--g-border)',
          background: 'var(--g-accent-soft)', fontSize: fontVars.sm, color: 'var(--g-text-mid)',
        }}>
          <span style={{ flex: 1 }}>{t('memory.flowerMovedNotice')}</span>
          <button type="button" style={{ border: 'none', background: 'transparent', color: 'var(--g-accent)', cursor: 'pointer', fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', fontWeight: 600 }}
            onClick={() => { dismissFlowerNotice(); setView('profile'); }}>
            {t('memory.flowerMovedCta')} →
          </button>
          <button type="button" aria-label={t('common.close')} style={{ border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer' }}
            onClick={dismissFlowerNotice}>✕</button>
        </div>
      )}

      {view === 'memories' && (
        <div className="gedo-mobile-toolbar gedo-mobile-only">
          <button type="button" style={{ ...ghostBtnStyle(), flex: 1, justifyContent: 'center' }} onClick={() => setRailDrawerOpen(true)}>
            <IconLayers size={14} /> {t('memory.rail.title')}
          </button>
        </div>
      )}

      {view === 'profile' ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <MemoryProfileView
            onGoTimeline={() => setView('memories')}
            onOpenInbox={() => openInbox({ group: 'consolidation' })}
            onGoMemories={(dim) => { setEvidenceFilter(null); setSelectedDim(dim); setView('memories'); }}
            onGoCodex={() => { setCodexFocusId(null); setView('codex'); }}
            onEvidence={(ids, label) => {
              setEvidenceFilter({ ids, label });
              setSelectedDim(null);
              setSourceSel({ kind: 'all' });
              setView('memories');
            }}
          />
        </div>
      ) : view === 'codex' ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <EntityCodexView
            focusEntityId={codexFocusId}
            onOpenInbox={(entityId, entityName) => openInbox({ entityId, entityName })}
          />
        </div>
      ) : emptyAll && !hasAnyImports ? (
        // 空态矩阵①：0 记忆 × 0 来源 → 整屏引导（方案 2.1）
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '56px 28px' }} className="gedo-content-padded-lg">
          <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <EmptyState
              icon={<IconLayers size={22} />}
              title={t('memory.emptyTimelineTitle')}
              hint={t('memory.emptyTimelineHint')}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button type="button" style={primaryBtnStyle()} onClick={() => setCaptureOpen(true)}>
                <IconChat size={14} /> {t('memory.addMenu.capture')}
              </button>
              <button type="button" style={ghostBtnStyle()} onClick={() => { setAddMode(undefined); setAddOpen(true); }}>
                {t('memory.rail.guideCta')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {sourceRail}
          {emptyAll ? (
            // 空态矩阵②：0 记忆 × 有来源 → 指向待确认
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '56px 28px' }}>
              <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <EmptyState
                  icon={<IconListChecks size={22} />}
                  title={t('memory.emptyPendingTitle')}
                  hint={t('memory.emptyPendingHint')}
                />
                {inboxCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button type="button" style={primaryBtnStyle()} onClick={() => openInbox()}>
                      {t('memory.emptyPendingCta', { n: inboxCount })}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <FragmentStream
              episodes={streamEpisodes}
              sourceLabel={sourceLabel}
              onClearSource={() => setSourceSel({ kind: 'all' })}
              evidenceLabel={evidenceFilter ? evidenceFilter.label : null}
              onClearEvidence={() => setEvidenceFilter(null)}
              selectedDim={selectedDim}
              onSelectDim={setSelectedDim}
              dimData={selectedDim ? profileDims[selectedDim] : undefined}
              dimAssess={selectedDim ? dimAssessment?.dimensions?.[selectedDim] ?? null : null}
              goals={goals}
              entities={entities}
              onToggleExclude={handleToggleExclude}
              onDelete={handleDeleteMem}
              onDownweight={handleDownweight}
              onEntityClick={openCodexAt}
              onReminder={() => setReminderOpen(true)}
              onGoAssess={() => setView('profile')}
              loading={loading}
            />
          )}
        </div>
      )}

      <Drawer open={railDrawerOpen} onClose={() => setRailDrawerOpen(false)} title={t('memory.rail.title')} side="left" width={340}>
        <div className="gedo-drawer-inner" style={{ height: '100%', display: 'flex' }}>
          {sourceRail}
        </div>
      </Drawer>

      <MemoryCaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onSaved={() => reload()}
      />
      <ReminderRuleModal
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        prefillTitle={selectedDim && dimLabel ? t('memory.reminder.prefillTitle', { query: dimLabel }) : ''}
        onSaved={() => reload()}
      />
      <AddSourcesModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        quota={quota}
        initialMode={addMode}
        onCreated={() => { refreshSources(); refreshInboxCount(); }}
      />
      <SourceDetailDrawer
        source={sources.find(s => s.id === detailSourceId) || null}
        pendingCount={detailSourceId ? (pendingBySource.get(detailSourceId) ?? 0) : 0}
        onClose={() => setDetailSourceId(null)}
        onGoReview={(sourceId) => { setDetailSourceId(null); openInbox({ sourceId }); }}
      />
      <InboxPanel
        open={inboxOpen}
        focus={inboxFocus}
        onClose={() => { setInboxOpen(false); setInboxFocus(null); refreshInboxCount(); }}
        onDecided={() => { reload(); }}
      />

      {/* 删除撤销 toast（30 秒窗口） */}
      {undoCount > 0 && (
        <div style={{
          position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 70,
          display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderRadius: 12,
          background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', boxShadow: '0 10px 32px oklch(0 0 0 / 0.3)',
          fontSize: fontVars.sm, color: 'var(--g-text)',
        }}>
          {t('memory.undoToast.deleted', { n: undoCount })}
          <button type="button" onClick={undoDeletes}
            style={{ border: 'none', background: 'transparent', color: 'var(--g-accent)', cursor: 'pointer', fontWeight: 700, fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)' }}>
            {t('memory.undoToast.undo')}
          </button>
        </div>
      )}
    </div>
  );
}

function AddMenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
        padding: '8px 11px', borderRadius: 8, border: 'none', cursor: 'pointer',
        background: 'transparent', color: 'var(--g-text-mid)',
        fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--g-text-muted)', display: 'flex' }}>{icon}</span>{label}
    </button>
  );
}

function Breadcrumb({ path }: { path: string[] }) {
  return (
    <div className="gedo-hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--g-text-faint)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', letterSpacing: '0.04em' }}>
      {path.map((b, i) => (
        <span key={i} style={{ display: 'inline-flex', gap: 6 }}>
          {i > 0 && <span style={{ opacity: 0.5 }}>/</span>}
          <span style={{ color: i === path.length - 1 ? 'var(--g-text-mid)' : 'var(--g-text-faint)' }}>{b}</span>
        </span>
      ))}
    </div>
  );
}

function Segmented<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: React.Dispatch<React.SetStateAction<T>>;
  options: { value: T; label: string }[];
}) {
  return (
    <div style={{ display: 'flex', background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 8, padding: 2 }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
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
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
