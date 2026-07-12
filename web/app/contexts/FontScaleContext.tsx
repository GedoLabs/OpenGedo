'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FONT_SCALE_MULT,
  prefToMult,
  STORAGE_FONT_SCALE,
  type FontScalePref,
} from '@/app/components/gedo/typography';

interface FontScaleContextValue {
  fontScale: FontScalePref;
  fontScaleMult: number;
  setFontScale: (pref: FontScalePref) => void;
}

const FontScaleContext = createContext<FontScaleContextValue | undefined>(undefined);

function readInitialPref(): FontScalePref {
  if (typeof window === 'undefined') return 'standard';
  try {
    const saved = localStorage.getItem(STORAGE_FONT_SCALE);
    if (saved === 'small' || saved === 'standard' || saved === 'large') return saved;
    return 'standard';
  } catch {
    return 'standard';
  }
}

function applyFontScale(mult: number) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--g-font-scale-user', String(mult));
  // Landing pages pin baseline via `.gedo-land-page { --g-font-scale-user: 1 }` in globals.css.
}

export function FontScaleProvider({ children }: { children: ReactNode }) {
  const [fontScale, setFontScaleState] = useState<FontScalePref>(readInitialPref);

  useEffect(() => {
    applyFontScale(prefToMult(fontScale));
  }, [fontScale]);

  const setFontScale = useCallback((pref: FontScalePref) => {
    setFontScaleState(pref);
    try {
      localStorage.setItem(STORAGE_FONT_SCALE, pref);
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(
    () => ({
      fontScale,
      fontScaleMult: FONT_SCALE_MULT[fontScale],
      setFontScale,
    }),
    [fontScale, setFontScale],
  );

  return <FontScaleContext.Provider value={value}>{children}</FontScaleContext.Provider>;
}

export function useFontScale() {
  const ctx = useContext(FontScaleContext);
  if (!ctx) throw new Error('useFontScale must be used inside <FontScaleProvider>');
  return ctx;
}

/** Inline script to apply saved font scale before hydration (prevents flash). */
export function FontScaleScript() {
  const code = `
(function() {
  try {
    var p = localStorage.getItem('${STORAGE_FONT_SCALE}') || 'standard';
    var m = p === 'small' ? 0.9 : p === 'large' ? 1.1 : 1;
    document.documentElement.style.setProperty('--g-font-scale-user', String(m));
  } catch (e) {}
})();
  `.trim();
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
