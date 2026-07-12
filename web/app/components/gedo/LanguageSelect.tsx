'use client';

// 语言选择器（设置页内）—— 视觉与 TimezoneSelect 一致的整宽下拉；仅 3 种语言，无需搜索。
import { useEffect, useRef, useState } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { LANGUAGES } from '@/i18n/languages';
import type { Locale } from '@/i18n/routing';
import { fontVars } from './typography';

export function LanguageSelect({ value, onChange }: { value: Locale; onChange: (locale: Locale) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find(l => l.code === value) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--g-surface-2)',
          border: '1px solid var(--g-border)',
          borderRadius: 8,
          color: 'var(--g-text)',
          fontSize: fontVars.base,
          fontFamily: 'var(--g-font-sans)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Globe size={15} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.native}</span>
        </span>
        <ChevronDown size={14} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--g-bg-raised, var(--g-bg))',
            border: '1px solid var(--g-border)',
            borderRadius: 10,
            boxShadow: '0 12px 32px -16px rgba(0,0,0,0.45)',
            zIndex: 60,
            overflow: 'hidden',
          }}
        >
          {LANGUAGES.map(l => {
            const active = l.code === value;
            return (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(l.code); setOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  width: '100%',
                  padding: '9px 12px',
                  border: 'none',
                  background: active ? 'color-mix(in oklch, var(--g-accent) 14%, transparent)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--g-font-sans)',
                }}
              >
                <span style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: active ? 600 : 400 }}>{l.native}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{l.short}</span>
                  {active && <Check size={14} style={{ color: 'var(--g-accent)', flexShrink: 0 }} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
