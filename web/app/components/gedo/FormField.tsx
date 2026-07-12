'use client';

import type { ChangeEvent, ReactNode, KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { fontVars, text } from './typography';

/**
 * Standard form primitives for the redesign. All token-driven.
 * Pattern: wrap children with <Field label=... hint=... />.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label style={{ ...text.label, color: 'var(--g-text-mid)' }}>
          {label}
          {required && <span style={{ color: 'var(--g-danger)', marginLeft: 4 }}>*</span>}
        </label>
      )}
      {children}
      {hint && !error && (
        <p style={{ margin: 0, ...text.caption, color: 'var(--g-text-faint)' }}>{hint}</p>
      )}
      {error && (
        <p style={{ margin: 0, ...text.caption, color: 'var(--g-danger)' }}>{error}</p>
      )}
    </div>
  );
}

const baseInputStyle = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--g-surface-1)',
  border: '1px solid var(--g-border)',
  borderRadius: 8,
  color: 'var(--g-text)',
  fontSize: fontVars.base,
  lineHeight: 'var(--g-leading-base)',
  fontFamily: 'var(--g-font-sans)',
  outline: 'none',
} as const;

export function TextInput({
  value, onChange, placeholder, autoFocus, disabled, onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      style={{
        ...baseInputStyle,
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
}

export function TextArea({
  value, onChange, placeholder, rows = 3, autoFocus, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      autoFocus={autoFocus}
      disabled={disabled}
      style={{
        ...baseInputStyle,
        resize: 'vertical',
        minHeight: 56,
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
}

export function Select<T extends string>({
  value, onChange, options, disabled,
}: {
  value: T;
  onChange: React.Dispatch<React.SetStateAction<T>>;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as T)}
      disabled={disabled}
      style={{
        ...baseInputStyle,
        padding: '7px 10px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function RadioGroup<T extends string>({
  value, onChange, options, inline = false,
}: {
  value: T;
  onChange: React.Dispatch<React.SetStateAction<T>>;
  options: { value: T; label: string; description?: string }[];
  inline?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: inline ? 'row' : 'column', gap: inline ? 6 : 8, flexWrap: 'wrap' }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              flex: inline ? '1 1 auto' : undefined,
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '8px 12px',
              borderRadius: 10,
              border: `1px solid ${active ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
              background: active ? 'var(--g-accent-soft)' : 'var(--g-surface-1)',
              cursor: 'pointer',
              fontFamily: 'var(--g-font-sans)',
              color: active ? 'var(--g-text)' : 'var(--g-text-mid)',
            }}
          >
            <span style={{ fontSize: fontVars.sm, fontWeight: 500 }}>{o.label}</span>
            {o.description && (
              <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{o.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TagInput({
  value, onChange, placeholder,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const tr = useTranslations('app');
  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t || value.includes(t)) return;
    onChange([...value, t]);
  };
  const removeTag = (t: string) => onChange(value.filter(x => x !== t));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(e.currentTarget.value);
      e.currentTarget.value = '';
    } else if (e.key === 'Backspace' && !e.currentTarget.value && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div
      style={{
        ...baseInputStyle,
        padding: '6px 6px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        minHeight: 36,
        alignItems: 'center',
      }}
    >
      {value.map(t => (
        <span
          key={t}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px 2px 9px',
            borderRadius: 999,
            background: 'var(--g-accent-soft)',
            color: 'var(--g-accent)',
            border: '1px solid var(--g-accent-line)',
            fontSize: fontVars.sm,
            lineHeight: 1.4,
            fontFamily: 'var(--g-font-mono)',
          }}
        >
          {t}
          <button
            type="button"
            onClick={() => removeTag(t)}
            aria-label={tr('common.removeItem', { item: t })}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              padding: 0,
              width: 14,
              height: 14,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.6,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </span>
      ))}
      <input
        type="text"
        placeholder={value.length === 0 ? placeholder : ''}
        onKeyDown={onKey}
        style={{
          flex: '1 1 80px',
          minWidth: 80,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--g-text)',
          fontSize: fontVars.sm,
          padding: '4px 6px',
          fontFamily: 'var(--g-font-sans)',
        }}
      />
    </div>
  );
}

export function Slider({
  value, onChange, min = 0, max = 100, step = 1, label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: ReactNode;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>
          <span>{label}</span>
          <span style={{ fontFamily: 'var(--g-font-mono)', color: 'var(--g-text)' }}>{value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          height: 4,
          appearance: 'none',
          WebkitAppearance: 'none',
          background: `linear-gradient(to right, var(--g-accent) ${pct}%, var(--g-surface-2) ${pct}%)`,
          borderRadius: 999,
          cursor: 'pointer',
          outline: 'none',
        }}
      />
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--g-accent);
          border: 2px solid var(--g-bg-raised);
          box-shadow: 0 0 0 1px var(--g-accent-line);
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--g-accent);
          border: 2px solid var(--g-bg-raised);
          box-shadow: 0 0 0 1px var(--g-accent-line);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
