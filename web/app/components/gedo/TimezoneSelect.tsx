'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fontVars } from './typography';
import { IconCheck, IconChevD, IconSearch } from './icons';
import {
  filterTimezones,
  formatTimezoneLabel,
  getDeviceTimezone,
  listTimezones,
  sortTimezones,
} from '@/lib/timezones';

/** Searchable timezone dropdown — native <select> is unusable against ~400
 * IANA zones. Mirrors mobile's TimezonePickerSheet (search input + filtered
 * list), collapsed into a popover for desktop instead of a full sheet. */
export function TimezoneSelect({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const t = useTranslations('app.language');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allZones = useMemo(() => sortTimezones(listTimezones(), getDeviceTimezone()), []);
  const zones = useMemo(() => filterTimezones(allZones, query), [allZones, query]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { setQuery(''); setOpen(o => !o); }}
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
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {formatTimezoneLabel(value)} — {value}
        </span>
        <IconChevD size={14} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--g-border)' }}>
            <IconSearch size={14} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('timezoneSearch')}
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--g-text)',
                fontSize: fontVars.sm,
                fontFamily: 'var(--g-font-sans)',
              }}
            />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {zones.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: fontVars.sm, color: 'var(--g-text-faint)', textAlign: 'center' }}>
                {t('timezoneNoResults')}
              </div>
            ) : zones.map(tz => {
              const active = tz === value;
              return (
                <button
                  key={tz}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => { onChange(tz); setOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    background: active ? 'color-mix(in oklch, var(--g-accent) 14%, transparent)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'var(--g-font-sans)',
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: active ? 600 : 400 }}>
                      {formatTimezoneLabel(tz)}
                    </span>
                    <span style={{ display: 'block', fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                      {tz}
                    </span>
                  </span>
                  {active && <IconCheck size={14} style={{ color: 'var(--g-accent)', flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
