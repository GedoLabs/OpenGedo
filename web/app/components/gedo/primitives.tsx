// Shared design-system primitives for Gedo AI 重构.
// All colors come from CSS variables set by ThemeProvider — never hardcode.

import type { CSSProperties, ReactNode } from 'react';
import { fontVars } from './typography';

type Tone = 'neutral' | 'accent' | 'memory' | 'goal' | 'exec' | 'insight' | 'persona';

const TONE_VARS: Record<Tone, { fg: string; mix: string }> = {
  neutral: { fg: 'var(--g-text-mid)',   mix: 'var(--g-border)' },
  accent:  { fg: 'var(--g-accent)',     mix: 'var(--g-accent-line)' },
  memory:  { fg: 'var(--g-dim-memory)', mix: 'var(--g-dim-memory)' },
  goal:    { fg: 'var(--g-dim-goal)',   mix: 'var(--g-dim-goal)' },
  exec:    { fg: 'var(--g-dim-exec)',   mix: 'var(--g-dim-exec)' },
  insight: { fg: 'var(--g-dim-insight)', mix: 'var(--g-dim-insight)' },
  persona: { fg: 'var(--g-dim-persona)', mix: 'var(--g-dim-persona)' },
};

export function Pill({
  children,
  tone = 'neutral',
  mono = false,
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  mono?: boolean;
  style?: CSSProperties;
}) {
  const t = TONE_VARS[tone];
  const bg =
    tone === 'neutral'
      ? 'var(--g-surface-1)'
      : tone === 'accent'
      ? 'var(--g-accent-soft)'
      : `color-mix(in oklch, ${t.mix} 14%, transparent)`;
  const bd =
    tone === 'neutral'
      ? 'var(--g-border)'
      : tone === 'accent'
      ? 'var(--g-accent-line)'
      : `color-mix(in oklch, ${t.mix} 32%, transparent)`;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: bg,
        color: t.fg,
        border: `1px solid ${bd}`,
        fontSize: fontVars.xs,
        lineHeight: 'var(--g-leading-caption)',
        fontFamily: mono ? 'var(--g-font-mono)' : 'var(--g-font-sans)',
        letterSpacing: mono ? '0.02em' : 0,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Dot({
  color,
  size = 6,
  style,
}: {
  color: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

/**
 * Unified surface card used across /app screens. One treatment only:
 * raised surface + 1px border + lg radius + standard padding. No gradients,
 * no colored left borders — a section's tone is signalled by a small accent
 * `Dot` next to the title, not by structural chrome.
 */
export function ScreenCard({
  title, hint, badge, action, accent, icon, children, style, bodyStyle,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  accent?: string;
  icon?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}) {
  const hasHeader = title != null || action != null || badge != null || icon != null;
  return (
    <section
      style={{
        background: 'var(--g-bg-raised)',
        border: '1px solid var(--g-border)',
        borderRadius: 'var(--g-radius-lg)',
        padding: '16px 20px',
        ...style,
      }}
    >
      {hasHeader && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: hint != null ? 2 : 12, flexWrap: 'wrap' }}>
          {icon}
          {accent != null && <Dot color={accent} size={7} />}
          {title != null && <span style={{ fontSize: fontVars.base, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</span>}
          {badge}
          {action != null && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>{action}</span>}
        </div>
      )}
      {hint != null && <p style={{ margin: '0 0 12px', fontSize: fontVars.xs, color: 'var(--g-text-muted)', lineHeight: 'var(--g-leading-caption)' }}>{hint}</p>}
      <div style={bodyStyle}>{children}</div>
    </section>
  );
}

/** Icon + text with consistent gap/alignment — replaces ad-hoc inline combos. */
export function IconLabel({
  icon, children, gap = 8, style,
}: {
  icon: ReactNode;
  children: ReactNode;
  gap?: number;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap, minWidth: 0, ...style }}>
      <span style={{ flexShrink: 0, display: 'inline-flex' }}>{icon}</span>
      {children}
    </span>
  );
}

// Primary / ghost buttons – inline styles so they pick up token swaps live.
export function primaryBtnStyle(small = false): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: small
      ? 'calc(var(--g-btn-pad-y) * 0.75) calc(var(--g-btn-pad-x) * 0.85)'
      : 'var(--g-btn-pad-y) var(--g-btn-pad-x)',
    minHeight: small ? 32 : 36,
    background: 'var(--g-accent)',
    color: 'var(--g-accent-ink)',
    border: 'none',
    borderRadius: small ? 8 : 10,
    fontSize: small ? fontVars.sm : fontVars.base,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'var(--g-font-sans)',
  };
}

export function ghostBtnStyle(): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: 'var(--g-btn-pad-y) var(--g-btn-pad-x)',
    minHeight: 36,
    background: 'transparent',
    color: 'var(--g-text-mid)',
    border: '1px solid var(--g-border)',
    borderRadius: 10,
    fontSize: fontVars.base,
    cursor: 'pointer',
    fontFamily: 'var(--g-font-sans)',
  };
}

export function iconBtnStyle(): CSSProperties {
  return {
    width: 'var(--g-icon-btn-size)',
    height: 'var(--g-icon-btn-size)',
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    color: 'var(--g-text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };
}

export function chipBtnStyle(active = false): CSSProperties {
  return {
    padding: '4px 10px',
    background: active ? 'var(--g-surface-2)' : 'transparent',
    border: '1px solid var(--g-border)',
    color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
    borderRadius: 999,
    fontSize: fontVars.xs,
    cursor: 'pointer',
    fontFamily: 'var(--g-font-sans)',
  };
}
