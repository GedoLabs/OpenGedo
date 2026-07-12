'use client';

// Shared studio primitives — inline-style + --g-* tokens, matching the
// ExecutionScreen / MemoryScreen idiom. The persona surface uses
// --g-dim-persona as its dimension accent.

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { fontVars, text } from '@/app/components/gedo/typography';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', ...text.label, color: 'var(--g-text-muted)', marginBottom: 6 }}>{label}</span>
      {children}
      {hint && (
        <span style={{ display: 'block', ...text.caption, color: 'var(--g-text-faint)', marginTop: 5 }}>{hint}</span>
      )}
    </label>
  );
}

export function SectionTitle({ title, mono, desc }: { title: string; mono?: string; desc?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 style={{ margin: 0, ...text.body, fontWeight: 600, color: 'var(--g-text)', letterSpacing: '-0.005em' }}>{title}</h2>
        {mono && (
          <span style={{ ...text.mono, color: 'var(--g-text-faint)', letterSpacing: '0.06em' }}>{mono}</span>
        )}
      </div>
      {desc && <p style={{ margin: '4px 0 0', ...text.caption, color: 'var(--g-text-muted)' }}>{desc}</p>}
    </div>
  );
}

export function Segmented<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: Dispatch<SetStateAction<T>>;
  options: { value: T; label: string; badge?: number }[];
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
              padding: 'var(--g-btn-pad-y) calc(var(--g-btn-pad-x) * 0.85)',
              minHeight: 32,
              border: 'none',
              background: active ? 'var(--g-surface-2)' : 'transparent',
              color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
              borderRadius: 6,
              fontSize: fontVars.sm,
              cursor: 'pointer',
              fontFamily: 'var(--g-font-sans)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {o.label}
            {o.badge ? (
              <span style={{ fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)', color: active ? 'var(--g-dim-persona)' : 'var(--g-text-faint)' }}>
                {o.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// A bordered card surface — the studio's basic content container.
export function Card({ children, tone, style }: { children: ReactNode; tone?: 'persona' | 'plain'; style?: React.CSSProperties }) {
  return (
    <section
      style={{
        background: 'var(--g-bg-raised)',
        border: `1px solid ${tone === 'persona' ? 'color-mix(in oklch, var(--g-dim-persona) 32%, transparent)' : 'var(--g-border)'}`,
        borderRadius: 14,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </section>
  );
}
