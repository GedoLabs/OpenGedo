'use client';

import { fontVars, text } from './typography';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LANGUAGES } from '@/i18n/languages';
import type { Locale } from '@/i18n/routing';
import { useAuth } from '@/app/contexts/AuthContext';
import { iconBtnStyle } from './primitives';

type Placement = 'bottom-end' | 'right-end' | 'top-end';

/**
 * 可复用语言切换器 —— 营销页 Header 与产品区左栏共用同一份实现。
 *
 * 切换语言时：
 *  1. 始终用语言感知 router.replace 替换 URL 语言前缀（即时生效，保留当前路径）。
 *  2. 登录态下顺带把 settings.language 写入后端（best-effort），实现跨设备记忆；
 *     登录时由 AuthContext 读取该值自动跳到偏好语言。后端 PUT /v1/settings 为合并语义，
 *     只发 { language } 不会覆盖其它设置。
 *
 * variant='button'：地球仪 + 语言码 + 下拉箭头的描边胶囊（默认，适合 Header）。
 * variant='icon'  ：仅地球仪图标的方形按钮（适合桌面左侧窄栏，外观对齐 iconBtnStyle）。
 * usePortal       ：菜单挂到 body，避免被 overflow 裁切（移动端顶栏推荐）。
 */
export function LanguageSwitcher({
  variant = 'button',
  placement = 'bottom-end',
  usePortal = false,
  onLocaleChange,
}: {
  variant?: 'button' | 'icon' | 'segmented';
  placement?: Placement;
  usePortal?: boolean;
  /** 切换成功后回调（设置页同步本地 settings.language） */
  onLocaleChange?: (locale: Locale) => void;
}) {
  const t = useTranslations('app.language');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { api, isAuthenticated, setPreferredLocale } = useAuth();

  const currentLang = LANGUAGES.find(l => l.code === locale) ?? LANGUAGES[0];

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [portalPos, setPortalPos] = useState<{ top: number; right: number; bottom: number; triggerRight: number } | null>(null);

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
    const onDoc = (e: Event) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('touchstart', onDoc, { passive: true });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  const switchLocale = (next: Locale) => {
    setOpen(false);
    if (next === locale) return;
    onLocaleChange?.(next);
    if (isAuthenticated) {
      // Update the stored preference first (so the app-shell alignment agrees),
      // then persist to the account for cross-device memory.
      setPreferredLocale(next);
      api.updateSettings({ language: next }).catch(() => { /* ignore */ });
    }
    router.replace(pathname, { locale: next });
  };

  if (variant === 'segmented') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${LANGUAGES.length}, 1fr)`, gap: 6 }}>
        {LANGUAGES.map(l => {
          const active = l.code === locale;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => switchLocale(l.code)}
              aria-pressed={active}
              style={{
                padding: '8px 6px',
                borderRadius: 8,
                textAlign: 'center',
                cursor: 'pointer',
                border: `1px solid ${active ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
                background: active ? 'var(--g-accent-soft)' : 'var(--g-surface-1)',
                color: active ? 'var(--g-accent)' : 'var(--g-text-mid)',
                fontSize: fontVars.sm,
                fontWeight: active ? 600 : 400,
                fontFamily: 'var(--g-font-sans)',
              }}
            >
              {l.native}
            </button>
          );
        })}
      </div>
    );
  }

  const menuStyle = usePortal && portalPos
    ? portalMenuPosition(placement, portalPos)
    : menuPosition(placement);

  const menu = open ? (
    <ul
      ref={menuRef}
      role="listbox"
      className="gedo-lang-menu"
      style={{
        position: usePortal ? 'fixed' : 'absolute',
        minWidth: 160,
        margin: 0,
        padding: 6,
        listStyle: 'none',
        background: 'var(--g-bg-raised, var(--g-bg))',
        border: '1px solid var(--g-border)',
        borderRadius: 10,
        boxShadow: '0 12px 32px -16px rgba(0,0,0,0.45)',
        zIndex: usePortal ? 200 : 60,
        ...menuStyle,
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      {LANGUAGES.map(l => {
        const active = l.code === locale;
        return (
          <li key={l.code}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => switchLocale(l.code)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: 'none',
                background: active ? 'color-mix(in oklch, var(--g-accent) 14%, transparent)' : 'transparent',
                color: active ? 'var(--g-text)' : 'var(--g-text-mid)',
                fontSize: fontVars.sm,
                fontFamily: 'var(--g-font-sans)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span>{l.native}</span>
              <span style={{ fontFamily: 'var(--g-font-mono)', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>
                {l.short}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  ) : null;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      {variant === 'icon' ? (
        <button
          ref={triggerRef}
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t('change')}
          title={`${t('change')} · ${currentLang.native}`}
          style={iconBtnStyle()}
        >
          <GlobeIcon size={16} />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t('change')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 8,
            background: 'transparent',
            border: '1px solid var(--g-border)',
            color: 'var(--g-text-mid)',
            fontSize: fontVars.sm,
            cursor: 'pointer',
            fontFamily: 'var(--g-font-sans)',
          }}
        >
          <GlobeIcon size={13} />
          <span>{currentLang.native}</span>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.6 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      {menu && (usePortal ? createPortal(menu, document.body) : menu)}
    </div>
  );
}

function menuPosition(placement: Placement): React.CSSProperties {
  switch (placement) {
    case 'right-end':
      return { left: 'calc(100% + 8px)', bottom: 0 };
    case 'top-end':
      return { bottom: 'calc(100% + 6px)', right: 0 };
    case 'bottom-end':
    default:
      return { top: 'calc(100% + 6px)', right: 0 };
  }
}

function portalMenuPosition(
  placement: Placement,
  pos: { top: number; right: number; bottom: number; triggerRight: number },
): React.CSSProperties {
  switch (placement) {
    case 'right-end':
      return { top: pos.top, left: pos.triggerRight + 8 };
    case 'top-end':
      return { bottom: window.innerHeight - pos.top + 6, right: pos.right };
    case 'bottom-end':
    default:
      return { top: pos.bottom + 6, right: pos.right };
  }
}

function GlobeIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}
