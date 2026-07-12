'use client';

// 图鉴 (Codex) — 智忆 → 图鉴视图外壳（IA v3 高级感改版）。
// 布局：左导航 CodexRail（分组+搜索+新建，折叠/Drawer 降级）+ 卡墙 +
// 右侧滑出详情面板（≥1100px 内嵌 motion.aside；更窄走 Drawer；旧详情
// Modal 退役）。编辑器保留 Modal（表单密集 + 破坏性操作）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from 'framer-motion';
import { useAuth } from '@/app/contexts/AuthContext';
import type { Entity } from '@/lib/apiClient';
import { fontVars } from '@/app/components/gedo/typography';
import { ghostBtnStyle } from '@/app/components/gedo/primitives';
import { EmptyState } from '@/app/components/gedo/EmptyState';
import { Drawer } from '@/app/components/gedo/Drawer';
import { CodexRail } from './CodexRail';
import { EntityCard } from './EntityCard';
import { EntityDetailContent } from './EntityDetailPanel';
import { EntityEditor } from './EntityEditor';
import { groupOf, type GroupKey } from './shared';
import { GROUP_ICONS } from './typeMeta';
import { useMediaQuery } from './useMediaQuery';

const PANEL_WIDTH = 400;

export function EntityCodexView({ focusEntityId = null, onOpenInbox }: {
  focusEntityId?: string | null;
  /** 详情面板「关于 TA 的发现」→ 打开统一收件箱（按实体过滤） */
  onOpenInbox?: (entityId: string, entityName: string) => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<'all' | GroupKey>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Entity | null>(null);
  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [personaSlug, setPersonaSlug] = useState<string | null>(null);
  const [railDrawerOpen, setRailDrawerOpen] = useState(false);
  const consumedFocus = useRef<string | null>(null);
  const reduced = useReducedMotion();
  // 详情面板内嵌/Drawer 切换断点（1100px：rail 224 + 卡墙 ≥450 + 面板 400）
  const wide = useMediaQuery('(min-width: 1100px)');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await api.listEntities();
      setEntities(items || []);
    } catch (e) {
      console.error('load entities failed', e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // Deep-link from a fragment's entity chip: open that card's detail panel once.
  useEffect(() => {
    if (!focusEntityId || focusEntityId === consumedFocus.current || entities.length === 0) return;
    if (entities.some(e => e.id === focusEntityId)) {
      consumedFocus.current = focusEntityId;
      setAdding(false);
      setDetailId(focusEntityId);
    }
  }, [focusEntityId, entities]);

  // Real persona slug for invite links.
  useEffect(() => {
    let cancelled = false;
    api.getDigitalPersona()
      .then((p) => { if (!cancelled && p?.published && p.slug) setPersonaSlug(p.slug); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api]);

  // 详情实体从列表按 id 派生：编辑/重生成后 load() 即自动刷新面板内容；
  // 删除/合并掉的卡 id 找不到 → 面板自动收起。
  const detail = useMemo(() => entities.find(e => e.id === detailId) ?? null, [entities, detailId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities
      .filter((e) => groupFilter === 'all' || groupOf(e.entity_type) === groupFilter)
      .filter((e) => {
        if (!q) return true;
        const hay = [e.name, e.relation, ...(e.aliases || [])].join(' ').toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (b.interaction_count || 0) - (a.interaction_count || 0)
        || (b.updated_at || '').localeCompare(a.updated_at || ''));
  }, [entities, groupFilter, search]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entities) {
      const g = groupOf(e.entity_type);
      counts[g] = (counts[g] || 0) + 1;
    }
    return counts;
  }, [entities]);

  const editorOpen = adding || editing !== null;
  const RailIcon = GROUP_ICONS.all;

  const rail = (
    <CodexRail
      total={entities.length}
      groupCounts={groupCounts}
      selection={groupFilter}
      onSelect={(sel) => { setGroupFilter(sel); setRailDrawerOpen(false); }}
      search={search}
      onSearch={setSearch}
      onAdd={() => { setEditing(null); setAdding(true); setRailDrawerOpen(false); }}
    />
  );

  const detailContent = detail && (
    <EntityDetailContent
      entity={detail}
      allEntities={entities}
      inline={wide}
      onClose={() => setDetailId(null)}
      onEdit={() => setEditing(detail)}
      onChanged={() => { load(); }}
      onOpenInbox={onOpenInbox}
    />
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      {/* ≤900px：rail 收进左侧 Drawer */}
      <div className="gedo-mobile-toolbar gedo-mobile-only">
        <button type="button" style={{ ...ghostBtnStyle(), flex: 1, justifyContent: 'center' }} onClick={() => setRailDrawerOpen(true)}>
          <RailIcon size={14} strokeWidth={1.7} /> {t('memory.codex.rail.title')}
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {rail}

        {/* Card wall */}
        <main style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', padding: 20 }} className="gedo-content-padded-lg">
          {loading && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--g-text-faint)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)' }}>
              {t('memory.codex.loading')}
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ maxWidth: 460, margin: '40px auto 0' }}>
              <EmptyState
                icon={<RailIcon size={22} strokeWidth={1.6} />}
                title={t('memory.codex.emptyTitle')}
                hint={t('memory.codex.emptyHint')}
              />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
            {filtered.map((e) => (
              <EntityCard
                key={e.id}
                entity={e}
                active={detailId === e.id}
                onClick={() => { setAdding(false); setDetailId(prev => (prev === e.id ? null : e.id)); }}
              />
            ))}
          </div>
        </main>

        {/* ≥1100px：内嵌右栏详情面板（width 0→400 滑出；内层固定宽防回流。
            用 CSS transition 而非 framer width 动画：flex 子项的 width 动画
            在开发态可能被打断卡在中间值，CSS 由浏览器兜底更稳）。 */}
        {wide && (
          <aside
            aria-hidden={!detail}
            style={{
              width: detail ? PANEL_WIDTH : 0,
              transition: reduced ? 'none' : 'width 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
              flexShrink: 0, minHeight: 0, overflow: 'hidden',
              borderLeft: detail ? '1px solid var(--g-border)' : 'none',
              background: 'var(--g-bg-raised)',
            }}
          >
            <div style={{ width: PANEL_WIDTH, height: '100%' }}>
              {detailContent}
            </div>
          </aside>
        )}
      </div>

      {/* <1100px：详情走右侧 Drawer（同一份内容） */}
      {!wide && (
        <Drawer open={!!detail} onClose={() => setDetailId(null)} side="right" width={420} title={detail?.name || ''}>
          {detailContent}
        </Drawer>
      )}

      <Drawer open={railDrawerOpen} onClose={() => setRailDrawerOpen(false)} title={t('memory.codex.rail.title')} side="left" width={300}>
        <div className="gedo-drawer-inner" style={{ height: '100%', display: 'flex' }}>
          {rail}
        </div>
      </Drawer>

      {editorOpen && (
        <EntityEditor
          key={editing?.id || 'new'}
          entity={editing}
          personaSlug={personaSlug}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSaved={() => { setEditing(null); setAdding(false); load(); }}
        />
      )}
    </div>
  );
}
