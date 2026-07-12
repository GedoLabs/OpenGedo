/**
 * Canonical life-flower dimensions (生命之花八维) — keys must match backend
 * LIFE_DIMENSIONS (services/backend-api/src/memory/types.mjs). Labels live in
 * i18n under app.memory.profileDims.*; this module only owns keys + colors.
 */

// 八维键源收口到 lib/lifeDimensions（IA v2）：与平行人生共用同一份。
import type { DimKey } from '@/lib/lifeDimensions';
export { DIM_KEYS } from '@/lib/lifeDimensions';
export type { DimKey } from '@/lib/lifeDimensions';

/**
 * One dedicated color per dimension (memory IA v2) — --g-life-* are defined in
 * globals.css (:root dark defaults) and overridden per theme by ThemeProvider/
 * ThemeScript in app/contexts/ThemeContext.tsx. Do not reuse module --g-dim-*.
 */
export const DIM_COLORS: Record<DimKey, string> = {
  health: 'var(--g-life-health)',
  career: 'var(--g-life-career)',
  family: 'var(--g-life-family)',
  finance: 'var(--g-life-finance)',
  growth: 'var(--g-life-growth)',
  social: 'var(--g-life-social)',
  hobby: 'var(--g-life-hobby)',
  self_realization: 'var(--g-life-selfreal)',
};

export function dimColor(key: string): string {
  return DIM_COLORS[key as DimKey] || 'var(--g-text-faint)';
}
