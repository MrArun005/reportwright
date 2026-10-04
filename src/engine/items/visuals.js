// @ts-check
/** Small in-cell visuals: sparkline, data bar, bullet, icon set, range bar. Used by table cells and as items. */
import { evalValue, toText, isDynamic } from '../expr/evaluate.js';
import { resolveFontKey } from '../text/fonts.js';

const MAX_POINTS = 5000;
export const ICON_SETS = ['trafficLights', 'arrows', 'symbols', 'flags', 'ratings'];
const STATE = ['#dc2626', '#f59e0b', '#16a34a']; // low, middle, high

const f = (v) => Math.round(v * 100) / 100;
function num(expr, ctx, lc, who) {
  if (expr == null || expr === '') return null;
  try { const v = evalValue(expr, ctx); return v == null || v === '' ? null : Number(v); } catch (e) { lc.warn(`${who}: ${e.message}`); return null; }
}

/**
 * @param {{type: 'sparkline'|'databar'|'bullet'|'iconset'|'rangebar', value?: string, values?: string, max?: string, min?: string, target?: string, color?: string, showValue?: boolean, format?: string,
 *   style?: 'line'|'column'|'area'|'winloss', bandLow?: string, bandHigh?: string, bandColor?: string, negColor?: string,
 *   iconSet?: string, lower?: string, upper?: string, low?: string, high?: string}} v
 * @param {{x:number, y:number, w:number, h:number}} box
 */
/** The first MAX_POINTS entries, cut before they are evaluated: per row in a table, a cap after the work bounds nothing. */
function capped(list, lc, who) {
  if (list.length <= MAX_POINTS) return list;
  lc.warn(`${who}: ${list.length} values; only the first ${MAX_POINTS} are drawn`);
  return list.slice(0, MAX_POINTS);
}

export function paintVisual(v, box, ctx, lc, base, who = 'Visual') {
  const out = [];
  const pad = 3;
  const x = box.x + pad, y = box.y + pad, w = Math.max(1, box.w - pad * 2), h = Math.max(1, box.h - pad * 2);
  let color = v.color || '#2563eb';
  if (isDynamic(color)) { try { color = String(evalValue(color, ctx) || '#2563eb'); } catch { color = '#2563eb'; } }
  if (v.type === 'sparkline') {
    // one point per row of the current scope (a group in a table, or the data set)
    let vals = [];
    if (v.values) {
      try { const arr = evalValue(v.values, ctx); if (Array.isArray(arr)) vals = capped(arr, lc, who).map(Number); } catch (e) { lc.warn(`${who}: ${e.message}`); }
    } else if (v.category) {
      // one point per category (e.g. month): aggregate the value over that category's rows
      const rows = ctx.aggRows || [];
      const c = { ...ctx };
      const buckets = new Map();
      for (const r of rows) {
        c.fields = r;
        let k; try { k = evalValue(v.category, c); } catch { k = null; }
        const kk = k instanceof Date ? k.getTime() : k;
        if (!buckets.has(kk)) buckets.set(kk, []);
        buckets.get(kk).push(r);
      }
      const keys = capped([...buckets.keys()].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0)), lc, who);
      vals = keys.map(k => { const rs = buckets.get(k); return num(v.value, { ...ctx, fields: rs[0], aggRows: rs, aggIndex: undefined }, lc, who); });
    } else {
      const rows = capped(ctx.aggRows || [], lc, who);
      const c = { ...ctx };
      vals = rows.map(r => { c.fields = r; return num(v.value, c, lc, who); });
    }
    vals = vals.filter(n => Number.isFinite(n));
    if (vals.length < 2) return out;
    let lo = Infinity, hi = -Infinity;
    for (const n of vals) { if (n < lo) lo = n; if (n > hi) hi = n; }
    const span = hi - lo || 1;
    const px = (i) => x + (i / (vals.length - 1)) * w, py = (n) => y + h - ((n - lo) / span) * h;
    // a range band (e.g. the target range) behind the line, on the line's scale
    const bl = num(v.bandLow, ctx, lc, who), bh = num(v.bandHigh, ctx, lc, who);
    if (bl != null && bh != null) {
      const clampY = (n) => Math.max(y, Math.min(y + h, py(n)));
      const a = clampY(Math.max(bl, bh)), b = clampY(Math.min(bl, bh));
      if (b > a) out.push({ t: 'rect', x, y: a, w, h: b - a, fill: v.bandColor || '#e5e7eb' });
    }
    if (v.style === 'winloss') {
      // every bar the same height: up for a win, down (in red) for a loss, a stub for zero
      const bw = w / vals.length, mid = y + h / 2;
      vals.forEach((n, i) => out.push(n === 0
        ? { t: 'rect', x: x + i * bw + bw * 0.1, y: mid - 0.5, w: bw * 0.8, h: 1, fill: '#9ca3af' }
        : { t: 'rect', x: x + i * bw + bw * 0.1, y: n > 0 ? mid - h / 2 : mid, w: bw * 0.8, h: h / 2, fill: n > 0 ? color : (v.negColor || '#dc2626') }));
      return out;
    }
    if (v.style === 'area') {
      const line = vals.map((n, i) => `${f(px(i))} ${f(py(n))}`).join(' L ');
      out.push({ t: 'path', x: 0, y: 0, d: `M ${f(px(0))} ${f(y + h)} L ${line} L ${f(px(vals.length - 1))} ${f(y + h)} Z`, fill: color + '33', stroke: null });
    }
    if (v.style === 'column') {
      const bw = w / vals.length;
      vals.forEach((n, i) => out.push({ t: 'rect', x: x + i * bw + bw * 0.1, y: py(n), w: bw * 0.8, h: y + h - py(n) + 0.5, fill: color }));
    } else {
      out.push({ t: 'path', x: 0, y: 0, d: 'M ' + vals.map((n, i) => `${f(px(i))} ${f(py(n))}`).join(' L '), fill: null, stroke: color, strokeWidth: 1.1 });
      const last = vals.length - 1;
      out.push({ t: 'ellipse', cx: px(last), cy: py(vals[last]), rx: 1.6, ry: 1.6, fill: color, stroke: null });
    }
    return out;
  }
  if (v.type === 'iconset') {
    const val = num(v.value, ctx, lc, who);
    if (val == null) return out;
    const lower = num(v.lower, ctx, lc, who) ?? 33, upper = num(v.upper, ctx, lc, who) ?? 67;
    const state = val < lower ? 0 : val < upper ? 1 : 2;
    const sz = Math.max(4, Math.min(w, h)), ix = x + (w - sz) / 2, iy = y + (h - sz) / 2;
    out.push(...icon(ICON_SETS.includes(v.iconSet) ? v.iconSet : 'trafficLights', state, ix, iy, sz));
    return out;
  }
  if (v.type === 'rangebar') {
    const low = num(v.low, ctx, lc, who), high = num(v.high, ctx, lc, who);
    const min = num(v.min, ctx, lc, who) ?? 0;
    let max = num(v.max, ctx, lc, who) ?? Math.max(high ?? 1, 1);
    if (!(max > min)) max = min + 1;
    const fr = (n) => Math.max(0, Math.min(1, (n - min) / (max - min)));
    out.push({ t: 'rect', x, y: y + h * 0.3, w, h: h * 0.4, fill: '#e5e7eb', radius: 1 });
    if (low != null && high != null) {
      const a = fr(Math.min(low, high)), b = fr(Math.max(low, high));
      out.push({ t: 'rect', x: x + w * a, y: y + h * 0.15, w: Math.max(1, w * (b - a)), h: h * 0.7, fill: color, radius: 1 });
    }
    return out;
  }
  const val = num(v.value, ctx, lc, who) ?? 0;
  const max = num(v.max, ctx, lc, who) ?? Math.max(val, 1);
  const frac = Math.max(0, Math.min(1, max ? val / max : 0));
  if (v.type === 'databar') {
    out.push({ t: 'rect', x, y: y + h * 0.18, w: w * frac, h: h * 0.64, fill: color + 'cc', radius: 1 });
    if (v.showValue !== false) {
      const key = resolveFontKey(base.fontFamily, 'normal', 'normal');
      const size = Math.min(h * 0.75, Number(base.fontSize) || 8);
      const s = toText(val, v.format || 'N0', ctx);
      const tw = lc.m.width(s, key, size);
      const inside = w * frac > tw + 6;
      out.push({ t: 'text', font: key, size, color: inside ? '#ffffff' : '#374151', lines: [{ x: inside ? x + w * frac - tw - 3 : x + w * frac + 3, y: y + h / 2 + size * 0.35, text: s, w: tw }] });
    }
    return out;
  }
  if (v.type === 'bullet') {
    const target = num(v.target, ctx, lc, who);
    out.push({ t: 'rect', x, y, w, h, fill: '#e5e7eb' });
    out.push({ t: 'rect', x, y: y + h * 0.3, w: w * frac, h: h * 0.4, fill: color });
    if (target != null && max) {
      const tx = x + w * Math.max(0, Math.min(1, target / max));
      out.push({ t: 'line', x1: tx, y1: y + h * 0.1, x2: tx, y2: y + h * 0.9, stroke: '#111827', strokeWidth: 1.5 });
    }
    return out;
  }
  return out;
}

/** One icon of a 3-state set, drawn in a sz × sz square. */
function icon(set, state, x, y, sz) {
  const c = STATE[state];
  const cx = x + sz / 2, cy = y + sz / 2, r = sz * 0.42;
  const P = (pts) => 'M ' + pts.map(([a, b]) => `${f(x + a * sz)} ${f(y + b * sz)}`).join(' L ') + ' Z';
  if (set === 'arrows') {
    if (state === 1) return [{ t: 'path', x: 0, y: 0, d: P([[0.1, 0.4], [0.55, 0.4], [0.55, 0.2], [0.9, 0.5], [0.55, 0.8], [0.55, 0.6], [0.1, 0.6]]), fill: c, stroke: null }];
    const up = [[0.5, 0.08], [0.88, 0.5], [0.62, 0.5], [0.62, 0.92], [0.38, 0.92], [0.38, 0.5], [0.12, 0.5]];
    return [{ t: 'path', x: 0, y: 0, d: P(state === 2 ? up : up.map(([a, b]) => [a, 1 - b])), fill: c, stroke: null }];
  }
  if (set === 'symbols') {
    if (state === 1) return [{ t: 'path', x: 0, y: 0, d: P([[0.5, 0.06], [0.95, 0.9], [0.05, 0.9]]), fill: c, stroke: null },
      { t: 'path', x: 0, y: 0, d: `M ${f(cx)} ${f(y + sz * 0.36)} L ${f(cx)} ${f(y + sz * 0.62)} M ${f(cx)} ${f(y + sz * 0.74)} L ${f(cx)} ${f(y + sz * 0.76)}`, fill: null, stroke: '#ffffff', strokeWidth: Math.max(0.8, sz * 0.1) }];
    const mark = state === 2 ? `M ${f(x + sz * 0.3)} ${f(y + sz * 0.52)} L ${f(x + sz * 0.45)} ${f(y + sz * 0.67)} L ${f(x + sz * 0.72)} ${f(y + sz * 0.36)}`
      : `M ${f(x + sz * 0.33)} ${f(y + sz * 0.33)} L ${f(x + sz * 0.67)} ${f(y + sz * 0.67)} M ${f(x + sz * 0.67)} ${f(y + sz * 0.33)} L ${f(x + sz * 0.33)} ${f(y + sz * 0.67)}`;
    return [{ t: 'ellipse', cx, cy, rx: r, ry: r, fill: c, stroke: null }, { t: 'path', x: 0, y: 0, d: mark, fill: null, stroke: '#ffffff', strokeWidth: Math.max(0.8, sz * 0.1) }];
  }
  if (set === 'flags') {
    return [{ t: 'line', x1: x + sz * 0.22, y1: y + sz * 0.1, x2: x + sz * 0.22, y2: y + sz * 0.92, stroke: '#4b5563', strokeWidth: Math.max(0.6, sz * 0.07) },
      { t: 'path', x: 0, y: 0, d: P([[0.25, 0.1], [0.85, 0.3], [0.25, 0.52]]), fill: c, stroke: null }];
  }
  if (set === 'ratings') {
    // three bars of rising height; as many filled as the state (1 to 3)
    return [0, 1, 2].map(i => ({ t: 'rect', x: x + sz * (0.1 + i * 0.3), y: y + sz * (0.6 - i * 0.25), w: sz * 0.22, h: sz * (0.3 + i * 0.25), fill: i <= state ? '#2563eb' : '#d1d5db' }));
  }
  return [{ t: 'ellipse', cx, cy, rx: r, ry: r, fill: c, stroke: '#ffffff', strokeWidth: 0.5 }];
}
