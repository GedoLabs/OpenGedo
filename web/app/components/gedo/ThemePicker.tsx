'use client';

import { fontVars } from './typography';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { HUE_OPTIONS, useTheme, type AccentHue, type Theme } from '@/app/contexts/ThemeContext';
import { IconSun, IconMoon, IconMonitor, IconCheck } from './icons';
import { iconBtnStyle } from './primitives';

type Placement = 'bottom-end' | 'right-end' | 'top-end';

const HUE_I18N: Record<AccentHue, string> = {
  145: 'emerald',
  75: 'amber',
  235: 'blue',
  305: 'purple',
  25: 'coral',
  195: 'teal',
};

export function ThemePicker({
  compact = false,
  placement = 'bottom-end',
  usePortal = false,
}: {
  compact?: boolean;
  /** 'bottom-end'：按钮下方、右对齐展开（顶部水平导航用）。
   *  'right-end'：按钮右侧、底对齐向上展开（左侧竖向侧边栏用，避免被裁切）。 */
  placement?: Placement;
  /** 菜单挂到 body（fixed 定位）——左侧栏 sticky + 右侧内容区滚动时，两者分处不同
   *  stacking context，绝对定位的菜单偶发被兄弟节点盖住；挂到 body 彻底避开这个问题。 */
  usePortal?: boolean;
}) {
  const t = useTranslations('app.settings.theme');
  const { theme, accentHue, setTheme, setAccent } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [portalPos, setPortalPos] = useState<{ top: number; bottom: number; right: number; triggerRight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !usePortal) return;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPortalPos({
        top: r.top,
        bottom: r.bottom,
        right: Math.max(8, window.innerWidth - r.right),
        triggerRight: r.right,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, usePortal]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const themeShort = theme === 'dark' ? t('modeDark') : theme === 'light' ? t('modeLight') : t('modeAuto');

  const menuPositionStyle: React.CSSProperties = usePortal && portalPos
    ? portalMenuPosition(placement, portalPos)
    : placement === 'right-end'
      ? { left: 'calc(100% + 8px)', bottom: 0 }
      : placement === 'top-end'
        ? { bottom: 'calc(100% + 8px)', right: 0 }
        : { top: 'calc(100% + 8px)', right: 0 };

  const menu = open ? (
    <div
      ref={menuRef}
      role="dialog"
      aria-label={t('pickerTitle')}
      style={{
        position: usePortal ? 'fixed' : 'absolute',
        ...menuPositionStyle,
        width: 244,
        padding: 14,
        borderRadius: 14,
        background: 'var(--g-bg-raised)',
        border: '1px solid var(--g-border)',
        boxShadow: '0 16px 40px -16px oklch(0 0 0 / 0.4)',
        zIndex: 80,
      }}
    >
      {/* Theme segment */}
      <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginBottom: 6 }}>
        {t('mode')}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 2,
          padding: 2,
          borderRadius: 10,
          background: 'var(--g-surface-1)',
          border: '1px solid var(--g-border)',
          marginBottom: 12,
        }}
      >
        {([
          { value: 'dark'  as Theme, labelKey: 'modeDark'  as const, icon: <IconMoon    size={12} /> },
          { value: 'light' as Theme, labelKey: 'modeLight' as const, icon: <IconSun     size={12} /> },
          { value: 'auto'  as Theme, labelKey: 'modeAuto'  as const, icon: <IconMonitor size={12} /> },
        ]).map(opt => {
          const active = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '6px 6px',
                background: active ? 'var(--g-surface-2)' : 'transparent',
                color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
                border: 'none',
                borderRadius: 8,
                fontSize: fontVars.sm,
                cursor: 'pointer',
                fontFamily: 'var(--g-font-sans)',
              }}
            >
              {opt.icon}{t(opt.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Accent swatches */}
      <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginBottom: 6 }}>
        {t('accent')}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {HUE_OPTIONS.map(o => {
          const active = o.hue === accentHue;
          const label = t(`accentColors.${HUE_I18N[o.hue as AccentHue]}` as never);
          return (
            <button
              key={o.hue}
              type="button"
              onClick={() => setAccent(o.hue as AccentHue)}
              title={label}
              aria-label={label}
              style={{
                width: 32,
                height: 32,
                flexShrink: 0,
                padding: 0,
                borderRadius: 999,
                border: `2px solid ${active ? o.hex : 'transparent'}`,
                background: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: o.hex,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {active && <IconCheck size={12} color="var(--g-accent-ink)" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        title={t('pickerTitle')}
        aria-label={t('pickerTitle')}
        style={{
          ...iconBtnStyle(),
          width: compact ? 32 : 'auto',
          padding: compact ? 0 : '0 10px',
          gap: 6,
          border: '1px solid var(--g-border)',
          color: 'var(--g-text-mid)',
          background: 'var(--g-surface-1)',
        }}
      >
        <span
          style={{
            width: 14, height: 14, borderRadius: 999,
            // Drive from the live accent var (set by ThemeScript pre-hydration)
            // so server and client render an identical style string — no
            // hydration mismatch — and the dot tracks the real accent color.
            background: 'var(--g-accent)',
            boxShadow: '0 0 0 1px var(--g-border) inset',
            flexShrink: 0,
          }}
        />
        {!compact && (
          <span style={{ fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)' }}>
            {themeShort}
          </span>
        )}
      </button>

      {menu && (usePortal ? createPortal(menu, document.body) : menu)}
    </div>
  );
}

function portalMenuPosition(
  placement: Placement,
  pos: { top: number; bottom: number; right: number; triggerRight: number },
): React.CSSProperties {
  switch (placement) {
    case 'right-end':
      return { left: pos.triggerRight + 8, bottom: Math.max(8, window.innerHeight - pos.bottom) };
    case 'top-end':
      return { bottom: window.innerHeight - pos.top + 8, right: pos.right };
    case 'bottom-end':
    default:
      return { top: pos.bottom + 8, right: pos.right };
  }
}
