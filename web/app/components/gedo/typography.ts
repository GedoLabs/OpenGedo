import type { CSSProperties } from 'react';

/**
 * Typography tokens — baseline (standard):
 * - fine print (timestamps, eyebrows, mono labels): 11px (--g-text-2xs) / 12px (--g-text-xs)
 * - min body / caption / label: 14px (--g-text-sm)
 * - body: 16px (--g-text-base)
 * - title: 20px, heading: 24px, display: 32px
 * Landing pages lock scale via `.gedo-land-page`; /app uses user pref (0.9 / 1 / 1.1).
 */
export const fontVars = {
  '2xs': 'var(--g-text-2xs)',
  xs: 'var(--g-text-xs)',
  sm: 'var(--g-text-sm)',
  base: 'var(--g-text-base)',
  md: 'var(--g-text-md)',
  lg: 'var(--g-text-lg)',
  xl: 'var(--g-text-xl)',
  '2xl': 'var(--g-text-2xl)',
  lead: 'var(--g-text-lead)',
  hero: 'var(--g-text-hero)',
} as const;

export type FontScalePref = 'small' | 'standard' | 'large';

export const FONT_SCALE_MULT: Record<FontScalePref, number> = {
  small: 0.9,
  standard: 1,
  large: 1.1,
};

export const STORAGE_FONT_SCALE = 'gedo_font_scale';

export function fontScaleToPref(mult: number): FontScalePref {
  if (mult <= 0.95) return 'small';
  if (mult >= 1.05) return 'large';
  return 'standard';
}

export function prefToMult(pref: FontScalePref): number {
  return FONT_SCALE_MULT[pref];
}

/** Reusable text style presets — all sizes from CSS variables. */
export const text = {
  caption: {
    fontSize: fontVars.sm,
    lineHeight: 'var(--g-leading-caption)',
  },
  label: {
    fontSize: fontVars.sm,
    lineHeight: 'var(--g-leading-caption)',
    fontWeight: 500,
  },
  body: {
    fontSize: fontVars.base,
    lineHeight: 'var(--g-leading-base)',
  },
  bodySm: {
    fontSize: fontVars.sm,
    lineHeight: 'var(--g-leading-base)',
  },
  lead: {
    fontSize: fontVars.lead,
    lineHeight: 'var(--g-leading-base)',
  },
  title: {
    fontSize: fontVars.md,
    lineHeight: 'var(--g-leading-tight)',
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  heading: {
    fontSize: fontVars.lg,
    lineHeight: 'var(--g-leading-tight)',
    fontWeight: 600,
    letterSpacing: '-0.02em',
  },
  display: {
    fontSize: fontVars.xl,
    lineHeight: 'var(--g-leading-tight)',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  mono: {
    fontSize: fontVars.sm,
    lineHeight: 'var(--g-leading-caption)',
    fontFamily: 'var(--g-font-mono)',
  },
} as const satisfies Record<string, CSSProperties>;

/** Landing / marketing — fixed baseline, no user scale. */
export const land = {
  hero: {
    margin: 0,
    fontSize: fontVars.hero,
    fontWeight: 600,
    letterSpacing: '-0.035em',
    lineHeight: 1.1,
    color: 'var(--g-text)',
    textWrap: 'balance',
  },
  heroSub: {
    fontSize: fontVars.lead,
    lineHeight: 1.55,
    color: 'var(--g-text-muted)',
  },
  badge: {
    fontSize: fontVars.sm,
    color: 'var(--g-text-mid)',
  },
  sectionTitle: {
    margin: 0,
    fontSize: 'clamp(24px, 3vw, 36px)',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: 'var(--g-text)',
    textWrap: 'balance',
  },
  sectionDesc: {
    fontSize: fontVars.base,
    lineHeight: 1.6,
    color: 'var(--g-text-muted)',
  },
  eyebrow: {
    fontSize: fontVars.sm,
    fontFamily: 'var(--g-font-mono)',
    color: 'var(--g-text-faint)',
    letterSpacing: '0.12em',
  },
  body: text.body,
  caption: text.caption,
} as const satisfies Record<string, CSSProperties>;

export function landCtaStyle(primary = true): CSSProperties {
  return primary
    ? {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: 'var(--g-btn-pad-y-lg) var(--g-btn-pad-x-lg)',
        borderRadius: 12,
        background: 'var(--g-accent)',
        color: 'var(--g-accent-ink)',
        fontSize: fontVars.base,
        fontWeight: 500,
        textDecoration: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--g-font-sans)',
        minHeight: 44,
      }
    : {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: 'var(--g-btn-pad-y-lg) var(--g-btn-pad-x-lg)',
        borderRadius: 12,
        background: 'transparent',
        color: 'var(--g-text)',
        border: '1px solid var(--g-border)',
        fontSize: fontVars.base,
        textDecoration: 'none',
        fontFamily: 'var(--g-font-sans)',
        minHeight: 44,
      };
}
