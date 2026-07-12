// Pure-string SVG radar (octagon) shared by the in-page DualRadar component and
// the downloadable single-file HTML save — one renderer, identical picture.

import { DIM_KEYS, type Dims } from './lifeDimensions';

export interface RadarSeries { dims: Dims; stroke: string; fill?: string; dash?: string; width?: number }

const pt = (cx: number, cy: number, r: number, i: number) => {
  const ang = (Math.PI * 2 * i) / DIM_KEYS.length - Math.PI / 2;
  return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)] as const;
};

const poly = (cx: number, cy: number, r: number, dims: Dims, floor: number) =>
  DIM_KEYS.map((k, i) => {
    const [x, y] = pt(cx, cy, (Math.max(floor, dims[k]) / 10) * r, i);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

/**
 * @param labels dim key → localized short label
 * @param size   square viewBox edge
 * @param opts.floor 数值地板（0-10 刻度）。/sim 沿用默认 0.4（视觉上不塌陷）；
 *   智忆生命之花传 0——未自评=0 画到圆心，诚实呈现「未评」而非假点。
 */
export function radarSvg(series: RadarSeries[], labels: Record<string, string>, size = 300, opts: { grid?: string; text?: string; floor?: number } = {}): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const grid = opts.grid || 'rgba(148,163,184,0.25)';
  const text = opts.text || 'rgba(148,163,184,0.9)';
  const floor = opts.floor ?? 0.4;

  const rings = [0.25, 0.5, 0.75, 1].map(f =>
    `<polygon points="${DIM_KEYS.map((_, i) => pt(cx, cy, r * f, i).map(n => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${grid}" stroke-width="0.6"/>`
  ).join('');

  const spokes = DIM_KEYS.map((_, i) => {
    const [x, y] = pt(cx, cy, r, i);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${grid}" stroke-width="0.6"/>`;
  }).join('');

  const shapes = series.map(s =>
    `<polygon points="${poly(cx, cy, r, s.dims, floor)}" fill="${s.fill || 'none'}" stroke="${s.stroke}" stroke-width="${s.width ?? 1.6}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>`
  ).join('');

  const tags = DIM_KEYS.map((k, i) => {
    const [x, y] = pt(cx, cy, r + size * 0.075, i);
    return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" font-size="${Math.round(size * 0.037)}" fill="${text}" font-family="inherit">${labels[k] || k}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${size} ${size}" width="100%" role="img" xmlns="http://www.w3.org/2000/svg">${rings}${spokes}${shapes}${tags}</svg>`;
}
