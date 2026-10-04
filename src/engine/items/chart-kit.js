// @ts-check
/**
 * Chart maths with no drawing: palettes, label contrast, scales and ticks, curve paths, trend fits,
 * moving averages and label placement. Everything here is linear (or n log n) in its input: chart data is untrusted.
 */

/** Size caps for untrusted data; each cap warns when it bites. */
export const CAPS = { categories: 1000, series: 50, points: 10000, overlays: 20, period: 1000 };

/** 12 named palettes. `default` is the original Pagewright palette. */
export const PALETTES = {
  default: ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#64748b', '#f97316'],
  office: ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e', '#636363', '#997300'],
  // Okabe–Ito: tells the series apart with any kind of colour blindness
  colorblind: ['#0072b2', '#e69f00', '#009e73', '#d55e00', '#cc79a7', '#56b4e9', '#000000', '#f0e442'],
  vivid: ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324'],
  pastel: ['#8fb3e8', '#f6b78c', '#94d3a2', '#f19c9c', '#c3a6e6', '#8ed3dc', '#f2a7cf', '#c9de8a'],
  ocean: ['#03396c', '#005b96', '#0e7c86', '#2a9d8f', '#6497b1', '#48cae4', '#90e0ef', '#023047'],
  sunset: ['#9d0208', '#d00000', '#dc2f02', '#e85d04', '#f48c06', '#faa307', '#6a040f', '#ffba08'],
  forest: ['#1b4332', '#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2', '#606c38', '#283618'],
  berry: ['#5a189a', '#7b2cbf', '#9d4edd', '#c77dff', '#b5179e', '#f72585', '#7209b7', '#3a0ca3'],
  earth: ['#7f5539', '#9c6644', '#b08968', '#ddb892', '#6b705c', '#a5a58d', '#cb997e', '#3f4238'],
  grayscale: ['#111827', '#374151', '#6b7280', '#9ca3af', '#4b5563', '#1f2937', '#d1d5db', '#030712'],
  highContrast: ['#000000', '#d00000', '#0033cc', '#007a00', '#e07000', '#8000a0', '#008080', '#806000'],
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A palette by name, or a custom list of #hex colours. */
export function paletteOf(p) {
  if (Array.isArray(p)) {
    const ok = p.slice(0, 64).filter(c => typeof c === 'string' && HEX.test(c));
    return ok.length ? ok : PALETTES.default;
  }
  return (typeof p === 'string' && Object.hasOwn(PALETTES, p) && PALETTES[p]) || PALETTES.default;
}

function rgbOf(c) {
  if (typeof c !== 'string' || !HEX.test(c)) return null;
  let h = c.slice(1);
  if (h.length === 3) h = h.replace(/./g, x => x + x);
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #hex colours (1 when either is not a colour). */
export function contrast(a, b) {
  const x = rgbOf(a), y = rgbOf(b);
  if (!x || !y) return 1;
  const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}
export const DARK_INK = '#111827';
/** White or near-black, whichever reads better on the fill. */
export function inkOn(fill) {
  if (!rgbOf(fill)) return '#ffffff';
  return contrast(fill, '#ffffff') >= contrast(fill, DARK_INK) ? '#ffffff' : DARK_INK;
}

/** "Nice" axis bounds and step (Heckbert). */
export function niceScale(min, max, ticks = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (min === max) { if (max === 0) max = 1; else if (max > 0) min = 0; else max = 0; }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, ticks - 1), true);
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}
function niceNum(x, round) {
  const e = Math.floor(Math.log10(x));
  const f = x / 10 ** e;
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** e;
}
/** Ticks from lo to hi by step, rounded so 0.1 + 0.2 reads 0.3. At most 200 (a bad min/max cannot loop for ever). */
export function linearTicks(lo, hi, step) {
  const out = [];
  if (!(step > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) return [lo, hi];
  for (let v = lo, i = 0; v <= hi + step / 2 && i < 200; v += step, i++) out.push(Math.round(v * 1e9) / 1e9 || 0); // || 0: never "-0"
  return out;
}
/** Powers of ten covering [min, max] (both > 0); at least two. */
export function logTicks(min, max) {
  const a = Math.floor(Math.log10(min)), b = Math.max(a + 1, Math.ceil(Math.log10(max)));
  const out = [];
  for (let e = a; e <= b && out.length < 60; e++) out.push(Number((10 ** e).toPrecision(12)));
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
/**
 * An SVG path through points (in drawing order along the category axis).
 * `along: 'y'` when the categories run down the page (a bar chart): the curve is then monotone in y.
 * @param {{x:number,y:number}[]} pts
 * @param {'straight'|'smooth'|'step'} mode
 * @param {{along?: 'x'|'y', move?: boolean}} [o] move: false continues an existing path (L to the first point)
 */
export function curvePath(pts, mode = 'straight', { along = 'x', move = true } = {}) {
  if (!pts.length) return '';
  const sw = along === 'y';
  const P = sw ? pts.map(p => ({ x: p.y, y: p.x })) : pts;
  const xy = (x, y) => (sw ? `${r2(y)} ${r2(x)}` : `${r2(x)} ${r2(y)}`);
  let d = `${move ? 'M' : 'L'} ${xy(P[0].x, P[0].y)}`;
  if (P.length === 1) return d;
  if (mode === 'step') {
    for (let i = 1; i < P.length; i++) {
      const mid = (P[i - 1].x + P[i].x) / 2;
      d += sw ? ` V ${r2(mid)} H ${r2(P[i].y)} V ${r2(P[i].x)}` : ` H ${r2(mid)} V ${r2(P[i].y)} H ${r2(P[i].x)}`;
    }
    return d;
  }
  if (mode !== 'smooth' || P.length < 3) {
    for (let i = 1; i < P.length; i++) d += ` L ${xy(P[i].x, P[i].y)}`;
    return d;
  }
  // Fritsch–Carlson monotone cubic: tangents limited so no segment overshoots its end points
  const n = P.length, dx = [], s = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1].x - P[i].x; s[i] = dx[i] ? (P[i + 1].y - P[i].y) / dx[i] : 0; }
  m[0] = s[0]; m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / s[i], b = m[i + 1] / s[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * s[i]; m[i + 1] = t * b * s[i]; }
  }
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${xy(P[i].x + h, P[i].y + m[i] * h)} ${xy(P[i + 1].x - h, P[i + 1].y - m[i + 1] * h)} ${xy(P[i + 1].x, P[i + 1].y)}`;
  }
  return d;
}

/**
 * Least-squares trend through [x, y] pairs.
 * @param {[number, number][]} pts
 * @param {'linear'|'exp'|'poly'} kind
 * @returns {{at: (x:number) => number, order: number} | null}
 */
export function fitTrend(pts, kind = 'linear', order = 2) {
  pts = pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (kind === 'exp') {
    const pos = pts.filter(([, y]) => y > 0);
    const l = fitPoly(pos.map(([x, y]) => [x, Math.log(y)]), 1);
    return l && { at: (x) => Math.exp(l.at(x)), order: 1 };
  }
  if (kind === 'poly') return fitPoly(pts, Math.max(2, Math.min(6, Math.round(Number(order)) || 2)));
  return fitPoly(pts, 1);
}
function fitPoly(pts, order) {
  const n = pts.length;
  if (n < order + 1 || n < 2) return null;
  // centre and scale x so the normal equations stay well conditioned
  let mean = 0; for (const [x] of pts) mean += x; mean /= n;
  let sc = 0; for (const [x] of pts) sc = Math.max(sc, Math.abs(x - mean)); sc = sc || 1;
  const k = order + 1;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (const [x, y] of pts) {
    const u = (x - mean) / sc;
    const pw = [1]; for (let i = 1; i < 2 * k; i++) pw.push(pw[i - 1] * u);
    for (let r = 0; r < k; r++) { for (let c = 0; c < k; c++) A[r][c] += pw[r + c]; A[r][k] += pw[r] * y; }
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
  }
  const coef = A.map((row, i) => row[k] / row[i]);
  return { order, at: (x) => { const u = (x - mean) / sc; let v = 0; for (let i = k - 1; i >= 0; i--) v = v * u + coef[i]; return v; } };
}

/** Trailing moving average: null until `period` values are in; a missing value starts the count again. */
export function movingAverage(values, period) {
  const p = Math.max(1, Math.min(CAPS.period, Math.round(Number(period)) || 1));
  const out = new Array(values.length).fill(null);
  let sum = 0, run = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) { sum = 0; run = 0; continue; }
    sum += v; run++;
    if (run > p) { sum -= values[i - p]; run = p; }
    if (run === p) out[i] = sum / p;
  }
  return out;
}

/** Accepts label boxes that stay inside the plot and overlap no box placed before. Grid buckets keep it near linear. */
export class LabelPlacer {
  constructor(bounds, cell = 24) { this.b = bounds; this.cell = cell; this.grid = new Map(); }
  fits(r) {
    const b = this.b;
    if (r.x < b.x - 0.5 || r.y < b.y - 0.5 || r.x + r.w > b.x + b.w + 0.5 || r.y + r.h > b.y + b.h + 0.5) return false;
    for (const key of this.keys(r)) for (const o of this.grid.get(key) || []) {
      if (r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h) return false;
    }
    return true;
  }
  place(r) {
    if (!this.fits(r)) return false;
    for (const key of this.keys(r)) { let l = this.grid.get(key); if (!l) this.grid.set(key, l = []); l.push(r); }
    return true;
  }
  *keys(r) {
    const c = this.cell;
    for (let i = Math.floor(r.x / c); i <= Math.floor((r.x + r.w) / c); i++) for (let j = Math.floor(r.y / c); j <= Math.floor((r.y + r.h) / c); j++) yield `${i},${j}`;
  }
}
