'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useMemo } from 'react';

export type Theme = 'dark' | 'light' | 'auto';
export type AccentHue = 145 | 75 | 235 | 305 | 25 | 195;

export const HUE_OPTIONS: { hue: AccentHue; label: string; hex: string }[] = [
  { hue: 145, label: 'Emerald', hex: '#5eb380' },
  { hue: 75,  label: 'Amber',   hex: '#c7a047' },
  { hue: 235, label: 'Blue',    hex: '#6098d8' },
  { hue: 305, label: 'Purple',  hex: '#c477c2' },
  { hue: 25,  label: 'Coral',   hex: '#d48870' },
  { hue: 195, label: 'Teal',    hex: '#4ab5b5' },
];

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  accentHue: AccentHue;
  setTheme: (t: Theme) => void;
  setAccent: (h: AccentHue) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_THEME = 'gedo_theme';
const STORAGE_HUE = 'gedo_accent_hue';

type TokenMap = Record<string, string>;

function themeTokens(theme: 'dark' | 'light', hue: number): TokenMap {
  const isDark = theme === 'dark';

  // Accent ramp – matches applyGedoTheme() in tokens.jsx
  const accLight = isDark ? 0.74 : 0.58;
  const accChroma = isDark ? 0.13 : 0.16;
  const accent = `oklch(${accLight} ${accChroma} ${hue})`;
  const accentSoft = `oklch(${accLight} ${accChroma} ${hue} / 0.14)`;
  const accentLine = `oklch(${accLight} ${accChroma} ${hue} / 0.35)`;
  const accentInk = isDark ? `oklch(0.22 0.06 ${hue})` : `oklch(0.99 0.003 270)`;

  if (isDark) {
    return {
      '--g-bg':         'oklch(0.16 0.006 270)',
      '--g-bg-raised':  'oklch(0.185 0.006 270)',
      '--g-surface-1':  'oklch(0.205 0.006 270)',
      '--g-surface-2':  'oklch(0.235 0.006 270)',
      '--g-border':     'oklch(0.27 0.006 270)',
      '--g-border-hi':  'oklch(0.34 0.006 270)',
      '--g-text':       'oklch(0.97 0.003 270)',
      '--g-text-mid':   'oklch(0.78 0.005 270)',
      '--g-text-muted': 'oklch(0.6  0.008 270)',
      '--g-text-faint': 'oklch(0.45 0.008 270)',
      '--g-dim-memory': 'oklch(0.72 0.13 305)',
      '--g-dim-exec':   'oklch(0.74 0.13 145)',
      '--g-dim-goal':   'oklch(0.78 0.13 75)',
      '--g-dim-insight':'oklch(0.72 0.13 235)',
      '--g-dim-persona':'oklch(0.72 0.13 195)',
      '--g-danger':     'oklch(0.65 0.18 25)',
      '--g-life-health':   'oklch(0.74 0.13 145)',
      '--g-life-career':   'oklch(0.78 0.13 75)',
      '--g-life-family':   'oklch(0.72 0.13 350)',
      '--g-life-finance':  'oklch(0.72 0.13 270)',
      '--g-life-growth':   'oklch(0.72 0.13 235)',
      '--g-life-social':   'oklch(0.72 0.13 195)',
      '--g-life-hobby':    'oklch(0.74 0.13 30)',
      '--g-life-selfreal': 'oklch(0.72 0.13 305)',
      '--g-accent':       accent,
      '--g-accent-soft':  accentSoft,
      '--g-accent-line':  accentLine,
      '--g-accent-ink':   accentInk,
      '--g-accent-hue':   String(hue),
      '--g-shadow-card':  '0 8px 24px -16px oklch(0 0 0 / 0.6)',
    };
  }

  return {
    '--g-bg':         'oklch(0.974 0.005 270)',
    '--g-bg-raised':  'oklch(0.992 0.002 270)',
    '--g-surface-1':  'oklch(1.000 0 0)',
    '--g-surface-2':  'oklch(0.948 0.006 270)',
    '--g-border':     'oklch(0.905 0.007 270)',
    '--g-border-hi':  'oklch(0.820 0.008 270)',
    '--g-text':       'oklch(0.20 0.008 270)',
    '--g-text-mid':   'oklch(0.38 0.010 270)',
    '--g-text-muted': 'oklch(0.52 0.010 270)',
    '--g-text-faint': 'oklch(0.66 0.008 270)',
    '--g-dim-memory': 'oklch(0.52 0.18 305)',
    '--g-dim-exec':   'oklch(0.54 0.16 145)',
    '--g-dim-goal':   'oklch(0.58 0.15 65)',
    '--g-dim-insight':'oklch(0.52 0.17 235)',
    '--g-dim-persona':'oklch(0.52 0.17 195)',
    '--g-danger':     'oklch(0.55 0.21 25)',
    '--g-life-health':   'oklch(0.54 0.16 145)',
    '--g-life-career':   'oklch(0.58 0.15 65)',
    '--g-life-family':   'oklch(0.52 0.18 350)',
    '--g-life-finance':  'oklch(0.52 0.17 270)',
    '--g-life-growth':   'oklch(0.52 0.17 235)',
    '--g-life-social':   'oklch(0.52 0.17 195)',
    '--g-life-hobby':    'oklch(0.55 0.16 30)',
    '--g-life-selfreal': 'oklch(0.52 0.18 305)',
    '--g-accent':       accent,
    '--g-accent-soft':  accentSoft,
    '--g-accent-line':  accentLine,
    '--g-accent-ink':   accentInk,
    '--g-accent-hue':   String(hue),
    '--g-shadow-card':  '0 8px 24px -16px oklch(0 0 0 / 0.18)',
  };
}

/** Returns 'dark' | 'light' based on OS preference. */
function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Collapses 'auto' to the actual dark/light value. */
function resolveTheme(t: Theme): 'dark' | 'light' {
  if (t === 'auto') return getSystemTheme();
  return t;
}

function applyTokens(resolved: 'dark' | 'light', hue: number) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const tokens = themeTokens(resolved, hue);
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'auto';
  try {
    const saved = localStorage.getItem(STORAGE_THEME);
    return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

function readInitialHue(): AccentHue {
  if (typeof window === 'undefined') return 145;
  try {
    const saved = Number(localStorage.getItem(STORAGE_HUE));
    return (HUE_OPTIONS.some(o => o.hue === saved) ? saved : 145) as AccentHue;
  } catch {
    return 145;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);
  const [accentHue, setAccentState] = useState<AccentHue>(readInitialHue);
  // Track the resolved (actual) theme so consumers can read it
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => resolveTheme(readInitialTheme()));

  // Keep tokens applied to <html>. When theme === 'auto', also listen for
  // OS preference changes so the page repaints without a manual toggle.
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTokens(resolved, accentHue);

    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        const next = e.matches ? 'dark' : 'light';
        setResolvedTheme(next);
        applyTokens(next, accentHue);
      };
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme, accentHue]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_THEME, t); } catch {}
  }, []);

  const setAccent = useCallback((h: AccentHue) => {
    setAccentState(h);
    try { localStorage.setItem(STORAGE_HUE, String(h)); } catch {}
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, accentHue, setTheme, setAccent }),
    [theme, resolvedTheme, accentHue, setTheme, setAccent]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

// Server-safe theme bootstrap — injects an inline script before hydration so
// the page paints with the user's saved tokens, preventing a flash.
export function ThemeScript() {
  const code = `
(function() {
  try {
    var t = localStorage.getItem('${STORAGE_THEME}') || 'auto';
    var h = parseInt(localStorage.getItem('${STORAGE_HUE}') || '145', 10);
    var valid = [145, 75, 235, 305, 25, 195];
    if (valid.indexOf(h) < 0) h = 145;
    if (t === 'auto') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else if (t !== 'light' && t !== 'dark') {
      t = 'dark';
    }
    var dark = t === 'dark';
    var aL = dark ? 0.74 : 0.58, aC = dark ? 0.13 : 0.16;
    var R = document.documentElement;
    function s(k, v) { R.style.setProperty(k, v); }
    if (dark) {
      s('--g-bg','oklch(0.16 0.006 270)');
      s('--g-bg-raised','oklch(0.185 0.006 270)');
      s('--g-surface-1','oklch(0.205 0.006 270)');
      s('--g-surface-2','oklch(0.235 0.006 270)');
      s('--g-border','oklch(0.27 0.006 270)');
      s('--g-border-hi','oklch(0.34 0.006 270)');
      s('--g-text','oklch(0.97 0.003 270)');
      s('--g-text-mid','oklch(0.78 0.005 270)');
      s('--g-text-muted','oklch(0.6 0.008 270)');
      s('--g-text-faint','oklch(0.45 0.008 270)');
      s('--g-dim-memory','oklch(0.72 0.13 305)');
      s('--g-dim-exec','oklch(0.74 0.13 145)');
      s('--g-dim-goal','oklch(0.78 0.13 75)');
      s('--g-dim-insight','oklch(0.72 0.13 235)');
      s('--g-dim-persona','oklch(0.72 0.13 195)');
      s('--g-danger','oklch(0.65 0.18 25)');
      s('--g-life-health','oklch(0.74 0.13 145)');
      s('--g-life-career','oklch(0.78 0.13 75)');
      s('--g-life-family','oklch(0.72 0.13 350)');
      s('--g-life-finance','oklch(0.72 0.13 270)');
      s('--g-life-growth','oklch(0.72 0.13 235)');
      s('--g-life-social','oklch(0.72 0.13 195)');
      s('--g-life-hobby','oklch(0.74 0.13 30)');
      s('--g-life-selfreal','oklch(0.72 0.13 305)');
      s('--g-shadow-card','0 8px 24px -16px oklch(0 0 0 / 0.6)');
      s('--g-accent-ink','oklch(0.22 0.06 ' + h + ')');
    } else {
      s('--g-bg','oklch(0.974 0.005 270)');
      s('--g-bg-raised','oklch(0.992 0.002 270)');
      s('--g-surface-1','oklch(1 0 0)');
      s('--g-surface-2','oklch(0.948 0.006 270)');
      s('--g-border','oklch(0.905 0.007 270)');
      s('--g-border-hi','oklch(0.820 0.008 270)');
      s('--g-text','oklch(0.20 0.008 270)');
      s('--g-text-mid','oklch(0.38 0.010 270)');
      s('--g-text-muted','oklch(0.52 0.010 270)');
      s('--g-text-faint','oklch(0.66 0.008 270)');
      s('--g-dim-memory','oklch(0.52 0.18 305)');
      s('--g-dim-exec','oklch(0.54 0.16 145)');
      s('--g-dim-goal','oklch(0.58 0.15 65)');
      s('--g-dim-insight','oklch(0.52 0.17 235)');
      s('--g-dim-persona','oklch(0.52 0.17 195)');
      s('--g-danger','oklch(0.55 0.21 25)');
      s('--g-life-health','oklch(0.54 0.16 145)');
      s('--g-life-career','oklch(0.58 0.15 65)');
      s('--g-life-family','oklch(0.52 0.18 350)');
      s('--g-life-finance','oklch(0.52 0.17 270)');
      s('--g-life-growth','oklch(0.52 0.17 235)');
      s('--g-life-social','oklch(0.52 0.17 195)');
      s('--g-life-hobby','oklch(0.55 0.16 30)');
      s('--g-life-selfreal','oklch(0.52 0.18 305)');
      s('--g-shadow-card','0 8px 24px -16px oklch(0 0 0 / 0.18)');
      s('--g-accent-ink','oklch(0.99 0.003 270)');
    }
    s('--g-accent','oklch(' + aL + ' ' + aC + ' ' + h + ')');
    s('--g-accent-soft','oklch(' + aL + ' ' + aC + ' ' + h + ' / 0.14)');
    s('--g-accent-line','oklch(' + aL + ' ' + aC + ' ' + h + ' / 0.35)');
    s('--g-accent-hue', String(h));
    R.dataset.theme = t;
    R.style.colorScheme = t;
  } catch (e) {}
})();
  `.trim();
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
