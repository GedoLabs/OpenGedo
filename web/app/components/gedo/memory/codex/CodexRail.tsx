'use client';

// 图鉴左导航栏（IA v3 高级感改版）：接替顶部筛选工具栏 —— 搜索 + 「全部」
// + 4 分组行（lucide 图标 + mono 计数）+ 底部新建入口。对齐记忆视图
// SourceRail 的交互语言：选中态 accent-soft、可折叠为图标轨（localStorage
// 记忆）、≤900px 由 EntityCodexView 塞进 Drawer。
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fontVars } from '@/app/components/gedo/typography';
import { IconChev, IconPlus, IconSearch } from '@/app/components/gedo/icons';
import { ENTITY_GROUPS, type GroupKey, type Tr } from './shared';
import { GROUP_ICONS } from './typeMeta';

const COLLAPSE_KEY = 'gedo_codex_rail_collapsed';

export function CodexRail({ total, groupCounts, selection, onSelect, search, onSearch, onAdd }: {
  total: number;
  groupCounts: Record<string, number>;
  selection: 'all' | GroupKey;
  onSelect: (sel: 'all' | GroupKey) => void;
  search: string;
  onSearch: (q: string) => void;
  onAdd: () => void;
}) {
  const t = useTranslations('app');
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

  const groupLabel = (key: 'all' | GroupKey) =>
    key === 'all' ? t('memory.codex.types.all') : t(`memory.codex.groups.${key}` as Parameters<Tr>[0]);

  // ── 折叠态：46px 图标轨 ─────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="gedo-aux-sidebar" style={{
        width: 46, flexShrink: 0, borderRight: '1px solid var(--g-border)', background: 'var(--g-bg-raised)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 0', minHeight: 0,
      }}>
        <button type="button" title={t('memory.codex.rail.expand')} onClick={toggleCollapsed}
          style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconChev size={14} />
        </button>
        {(['all', ...ENTITY_GROUPS.map(g => g.key)] as const).map((key) => {
          const Icon = GROUP_ICONS[key];
          const active = selection === key;
          return (
            <button
              key={key}
              type="button"
              title={groupLabel(key)}
              onClick={() => onSelect(key)}
              style={{
                width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${active ? 'var(--g-accent-line)' : 'transparent'}`,
                background: active ? 'var(--g-accent-soft)' : 'transparent',
                color: active ? 'var(--g-accent)' : 'var(--g-text-muted)', cursor: 'pointer',
              }}
            >
              <Icon size={15} strokeWidth={1.7} />
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <button type="button" title={t('memory.codex.addCard')} onClick={onAdd}
          style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: 'transparent', color: 'var(--g-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconPlus size={15} />
        </button>
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

  return (
    <aside className="gedo-aux-sidebar" style={{
      width: 224, flexShrink: 0, minHeight: 0,
      borderRight: '1px solid var(--g-border)', background: 'var(--g-bg-raised)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* 栏头 */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 6px' }}>
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.08em' }}>
          {t('memory.codex.rail.title')}
        </span>
        <button type="button" title={t('memory.codex.rail.collapse')} onClick={toggleCollapsed}
          style={{ border: 'none', background: 'transparent', color: 'var(--g-text-faint)', cursor: 'pointer', display: 'flex', transform: 'rotate(180deg)' }}>
          <IconChev size={13} />
        </button>
      </div>

      {/* 搜索 */}
      <div style={{ flexShrink: 0, padding: '4px 10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 10, padding: '5px 10px' }}>
          <IconSearch size={13} style={{ color: 'var(--g-text-muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('memory.codex.searchPlaceholder')}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--g-text)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', width: '100%', minWidth: 0 }}
          />
        </div>
      </div>

      {/* 分组行 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {(['all', ...ENTITY_GROUPS.map(g => g.key)] as const).map((key) => {
          const Icon = GROUP_ICONS[key];
          const active = selection === key;
          const count = key === 'all' ? total : (groupCounts[key] || 0);
          return (
            <button key={key} type="button" style={rowStyle(active)} onClick={() => onSelect(key)}>
              <span style={{ color: active ? 'var(--g-accent)' : 'var(--g-text-muted)', flexShrink: 0, display: 'flex' }}>
                <Icon size={14} strokeWidth={1.7} />
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: count === 0 && !active ? 'var(--g-text-muted)' : undefined }}>
                {groupLabel(key)}
              </span>
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', flexShrink: 0, minWidth: 18, textAlign: 'right' }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* 新建入口 */}
      <div style={{ flexShrink: 0, padding: '8px 10px 12px', borderTop: '1px solid var(--g-border)' }}>
        <button type="button" onClick={onAdd} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%',
          padding: '7px 10px', borderRadius: 10, cursor: 'pointer',
          border: '1px dashed var(--g-border)', background: 'transparent',
          color: 'var(--g-text-mid)', fontFamily: 'var(--g-font-sans)', fontSize: fontVars.sm,
        }}>
          <IconPlus size={13} /> {t('memory.codex.addCard')}
        </button>
      </div>
    </aside>
  );
}
