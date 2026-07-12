'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, User, Crown, SlidersHorizontal, Plug, KeyRound, Shield, ChevronDown } from 'lucide-react';
import { fontVars } from '@/app/components/gedo/typography';
import { isOSS } from '@/lib/edition';

const ALL_SECTIONS = [
  { id: 'overview', key: 'overview', Icon: LayoutDashboard },
  { id: 'account', key: 'account', Icon: User },
  { id: 'subscription', key: 'subscription', Icon: Crown },
  { id: 'preferences', key: 'preferences', Icon: SlidersHorizontal },
  { id: 'mcp', key: 'mcp', Icon: Plug },
  { id: 'developer', key: 'developer', Icon: KeyRound },
  { id: 'privacy', key: 'privacy', Icon: Shield },
] as const;

// OSS 自托管无订阅概念：会员 tab 整个隐藏（checkEntitlement 在后端也恒通过）。
export const SETTINGS_SECTIONS = isOSS()
  ? ALL_SECTIONS.filter(s => s.id !== 'subscription')
  : [...ALL_SECTIONS];

export type SettingsSectionId = (typeof ALL_SECTIONS)[number]['id'];

export function AccountSectionNav({
  active,
  onSelect,
  orientation,
}: {
  active: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
  orientation: 'vertical' | 'horizontal';
}) {
  // 窄屏折叠为下拉菜单（避免横向溢出裁切）；宽屏为左侧竖向侧边栏。
  if (orientation === 'horizontal') return <NavDropdown active={active} onSelect={onSelect} />;
  return <NavSidebar active={active} onSelect={onSelect} />;
}

function NavSidebar({ active, onSelect }: { active: SettingsSectionId; onSelect: (id: SettingsSectionId) => void }) {
  const t = useTranslations('app.settings.nav');
  return (
    <nav
      aria-label={t('label')}
      style={{ position: 'sticky', top: 24, flexShrink: 0, width: 200, display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      {SETTINGS_SECTIONS.map(({ id, key, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textAlign: 'left',
              padding: '9px 12px',
              borderRadius: 10,
              border: '1px solid transparent',
              background: isActive ? 'color-mix(in oklch, var(--g-accent) 12%, transparent)' : 'transparent',
              color: isActive ? 'var(--g-text)' : 'var(--g-text-mid)',
              fontSize: fontVars.base,
              fontWeight: isActive ? 600 : 500,
              cursor: 'pointer',
              fontFamily: 'var(--g-font-sans)',
              transition: 'background 0.12s',
            }}
          >
            <Icon size={16} style={{ flexShrink: 0, color: isActive ? 'var(--g-accent)' : 'var(--g-text-faint)' }} />
            {t(key)}
          </button>
        );
      })}
    </nav>
  );
}

function NavDropdown({ active, onSelect }: { active: SettingsSectionId; onSelect: (id: SettingsSectionId) => void }) {
  const t = useTranslations('app.settings.nav');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  const current = SETTINGS_SECTIONS.find(s => s.id === active) ?? SETTINGS_SECTIONS[0];
  const CurrentIcon = current.Icon;

  return (
    <nav
      ref={ref}
      aria-label={t('label')}
      style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--g-bg)', padding: '8px 0 12px', marginBottom: 4 }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid var(--g-border)',
          background: 'var(--g-surface-1)',
          color: 'var(--g-text)',
          fontSize: fontVars.base,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--g-font-sans)',
        }}
      >
        <CurrentIcon size={16} style={{ color: 'var(--g-accent)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left' }}>{t(current.key)}</span>
        <ChevronDown size={16} style={{ color: 'var(--g-text-faint)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            marginTop: 6,
            padding: 6,
            listStyle: 'none',
            background: 'var(--g-bg-raised, var(--g-bg))',
            border: '1px solid var(--g-border)',
            borderRadius: 12,
            boxShadow: '0 12px 32px -16px rgba(0,0,0,0.45)',
            zIndex: 20,
          }}
        >
          {SETTINGS_SECTIONS.map(({ id, key, Icon }) => {
            const isActive = active === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => { onSelect(id); setOpen(false); }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    textAlign: 'left',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: isActive ? 'color-mix(in oklch, var(--g-accent) 12%, transparent)' : 'transparent',
                    color: isActive ? 'var(--g-text)' : 'var(--g-text-mid)',
                    fontSize: fontVars.base,
                    fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer',
                    fontFamily: 'var(--g-font-sans)',
                  }}
                >
                  <Icon size={16} style={{ flexShrink: 0, color: isActive ? 'var(--g-accent)' : 'var(--g-text-faint)' }} />
                  {t(key)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
