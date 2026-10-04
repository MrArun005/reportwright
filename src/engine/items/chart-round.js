// @ts-check
/** Round charts: pie, donut, radar, gauge and funnel (funnel is here because, like a pie, it shows one series by category). */
import { inkOn, niceScale, linearTicks } from './chart-kit.js';

export const ROUND_TYPES = new Set(['pie', 'donut', 'radar', 'gauge', 'funnel']);
const f = (v) => Math.round(v * 100) / 100;
const tag = (o, a) => { if (a) o.anim = a; return o; };

export function arc(cx, cy, r, ri, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${f(cx + Math.cos(a) * rad)} ${f(cy + Math.sin(a) * rad)}`;
  if (!ri) return `M ${f(cx)} ${f(cy)} L ${p(r, a0)} A ${f(r)} ${f(r)} 0 ${large} 1 ${p(r, a1)} Z`;
  return `M ${p(r, a0)} A ${f(r)} ${f(r)} 0 ${large} 1 ${p(r, a1)} L ${p(ri, a1)} A ${f(ri)} ${f(ri)} 0 ${large} 0 ${p(ri, a0)} Z`;
}

export function paintRound(type, g) {
  if (type === 'radar') return paintRadar(g);
  if (type === 'gauge') return paintGauge(g);
  if (type === 'funnel') return paintFunnel(g);
  return paintPie(type, g);
}

function paintPie(type, g) {
  const { item, data, out, X, W, top, bottom, fs, bold, text, fmtV, pointFill, pointLink, pal, label, labelText, anim } = g;
  const vals = (data.series[0]?.values || []).map(v => Math.max(0, v || 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const cx = X + W / 2, cy = (top + bottom) / 2;
  const outside = item.labelPosition === 'outside';
  const r = Math.max(4, Math.min(W, bottom - top) / 2 - 6 - (outside ? fs * 2 : 0));
  const ri = type === 'donut' ? r * 0.58 : 0;
  let a0 = -Math.PI / 2;
  vals.forEach((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    const fill = pointFill(i, pal[i % pal.length]);
    if (v > 0) {
      const d = arc(cx, cy, r, ri, a0, Math.min(a1, a0 + Math.PI * 2 - 1e-4));
      out.push(tag({ t: 'path', x: 0, y: 0, d, fill, stroke: '#ffffff', strokeWidth: 0.75 }, anim && (anim === 'grow' ? { k: 'scale', ox: cx, oy: cy, i } : { k: 'fade', i })));
      pointLink(i, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, `${data.categories[i]}: ${fmtV(v)} (${Math.round((v / total) * 100)}%)`, d);
    }
    const mid = (a0 + a1) / 2, frac = v / total;
    if (frac >= 0.05 && item.showValues !== false) {
      const s = item.labelTemplate ? labelText(i, data.series[0], v, frac) : `${Math.round(frac * 100)}%`;
      if (outside) {
        const lr = r + 5, lx = cx + Math.cos(mid) * lr;
        label(s, lx, cy + Math.sin(mid) * lr + fs * 0.35, { align: Math.abs(lx - cx) < 2 ? 'center' : lx > cx ? 'left' : 'right', size: fs, color: g.ink });
      } else {
        const lr = ri ? (r + ri) / 2 : r * 0.62;
        label(s, cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr + fs * 0.35, { color: inkOn(fill), f: bold, size: fs });
      }
    }
    a0 = a1;
  });
  if (type === 'donut' && item.centerText !== false) {
    text(fmtV(total), cx, cy + fs * 0.45, { align: 'center', size: fs * 1.4, f: bold, color: '#111827' });
  }
}

/** Radar: one spoke per category (the first at the top, clockwise), one closed polygon per series. */
function paintRadar(g) {
  const { item, data, out, X, W, top, bottom, fs, text, measure, fmtV, pointLink, label, labelsOn, labelText, grid, anim, axes } = g;
  const n = data.categories.length;
  const catW = Math.min(W * 0.25, Math.max(10, ...data.categories.map(c => measure(c).w)));
  const cx = X + W / 2, cy = (top + bottom) / 2 + fs * 0.3;
  const R = Math.max(6, Math.min(W / 2 - catW - 8, (bottom - top) / 2 - fs * 1.6));
  let lo = 0, hi = 0;
  for (const s of data.series) for (const v of s.values) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const ys = axes.y || {};
  const sc = niceScale(Number.isFinite(Number(ys.min)) && ys.min !== '' && ys.min != null ? Number(ys.min) : lo, Number.isFinite(Number(ys.max)) && ys.max !== '' && ys.max != null ? Number(ys.max) : hi, 5);
  const a = ys.min != null && ys.min !== '' ? Number(ys.min) : sc.lo, b = ys.max != null && ys.max !== '' ? Number(ys.max) : sc.hi;
  const ticks = linearTicks(a, b, sc.step);
  const rad = (v) => Math.max(0, Math.min(1, (v - a) / ((b - a) || 1))) * R;
  const ang = (i) => -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
  const at = (i, r) => ({ x: cx + Math.cos(ang(i)) * r, y: cy + Math.sin(ang(i)) * r });
  const poly = (r) => Array.from({ length: n }, (_, i) => at(i, r)).map((p, i) => `${i ? 'L' : 'M'} ${f(p.x)} ${f(p.y)}`).join(' ') + ' Z';
  // polygon grid, spokes, tick values up the first spoke
  if (ys.gridlines !== false) for (const t of ticks) if (rad(t) > 0) out.push({ t: 'path', x: 0, y: 0, d: n > 2 ? poly(rad(t)) : '', fill: null, stroke: grid, strokeWidth: 0.5 });
  for (let i = 0; i < n; i++) { const e = at(i, R); out.push({ t: 'line', x1: cx, y1: cy, x2: e.x, y2: e.y, stroke: grid, strokeWidth: 0.5 }); }
  for (const t of ticks) text(fmtV(t), cx + 2, cy - rad(t) - 1.5, { size: fs * 0.8, color: '#6b7280' });
  data.categories.forEach((c, i) => {
    const p = at(i, R + 4), cos = Math.cos(ang(i));
    text(c, p.x, p.y + fs * 0.35 + (Math.sin(ang(i)) > 0.5 ? fs * 0.5 : 0), { align: Math.abs(cos) < 0.2 ? 'center' : cos > 0 ? 'left' : 'right', maxW: catW });
  });
  data.series.forEach((s, si) => {
    const pts = s.values.map((v, i) => (v == null ? null : { ...at(i, rad(v)), v, i })).filter(Boolean);
    if (!pts.length) return;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${f(p.x)} ${f(p.y)}`).join(' ') + ' Z';
    out.push(tag({ t: 'path', x: 0, y: 0, d, fill: s.color + (s.def.type === 'line' ? '00' : '2e'), stroke: s.color, strokeWidth: 1.4 }, anim && (anim === 'grow' ? { k: 'scale', ox: cx, oy: cy, i: si } : { k: 'fade', i: si })));
    if (n <= 40) for (const p of pts) out.push({ t: 'ellipse', cx: p.x, cy: p.y, rx: 1.8, ry: 1.8, fill: s.color, stroke: null });
    for (const p of pts) pointLink(p.i, { x: p.x - 4, y: p.y - 4, w: 8, h: 8 }, `${data.categories[p.i]}${data.series.length > 1 ? ` · ${s.name}` : ''}: ${fmtV(p.v)}`);
    if (labelsOn || item.labelTemplate) for (const p of pts) label(labelText(p.i, s, p.v), p.x, p.y - 3, { size: fs * 0.85 });
  });
}

/** Gauge: a half circle from min (left) to max (right); bands colour the track, line overlays mark targets. */
function paintGauge(g) {
  const { item, data, out, X, W, top, bottom, fs, bold, text, fmtV, pointLink, axes, lc, who, safe, ctx } = g;
  const v = data.series[0]?.values?.[0] ?? null;
  const ys = axes.y || {};
  const num = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
  const lo = num(ys.min) ?? 0;
  let hi = num(ys.max) ?? niceScale(lo, Math.max(lo + 1, v ?? 0), 5).hi;
  if (!(hi > lo)) hi = lo + 1;
  const frac = (x) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  const ang = (x) => Math.PI + frac(x) * Math.PI;
  const cx = X + W / 2;
  const R = Math.max(8, Math.min(W / 2 - 8, bottom - top - fs * 3.6));
  const cy = top + 4 + R;
  const th = R * 0.22;
  const scope = { ...ctx, fields: data.rows[0] || null, aggRows: data.rows, aggIndex: undefined };
  const val = (o, k) => (typeof o[k] === 'number' ? o[k] : num(safe(o[k], scope, lc, who)));
  const overlays = (Array.isArray(item.overlays) ? item.overlays : []).slice(0, 20).filter(o => o && typeof o === 'object');
  const bands = overlays.filter(o => o.type === 'band');
  out.push({ t: 'path', x: 0, y: 0, d: arc(cx, cy, R, R - th, Math.PI, 2 * Math.PI - 1e-4), fill: '#e5e7eb', stroke: null });
  const BAND = ['#16a34a', '#f59e0b', '#dc2626', '#2563eb', '#8b5cf6'];
  bands.forEach((o, i) => {
    const a = val(o, 'from'), b = val(o, 'to');
    if (a == null || b == null) return;
    const a0 = ang(Math.min(a, b)), a1 = ang(Math.max(a, b));
    if (a1 - a0 > 1e-4) out.push({ t: 'path', x: 0, y: 0, d: arc(cx, cy, R, R - th, a0, a1), fill: typeof o.color === 'string' && o.color ? o.color : BAND[i % BAND.length], stroke: null });
  });
  const color = data.series[0]?.color || g.pal[0];
  if (v != null && !bands.length && frac(v) > 0) out.push(tag({ t: 'path', x: 0, y: 0, d: arc(cx, cy, R, R - th, Math.PI, Math.max(Math.PI + 1e-4, ang(v))), fill: color, stroke: null }, g.anim && { k: 'fade', i: 0 }));
  for (const o of overlays) if (o.type === 'line') {
    const t = val(o, 'value'); if (t == null) continue;
    const a = ang(t);
    out.push({ t: 'line', x1: cx + Math.cos(a) * (R - th - 2), y1: cy + Math.sin(a) * (R - th - 2), x2: cx + Math.cos(a) * (R + 2), y2: cy + Math.sin(a) * (R + 2), stroke: o.color || '#111827', strokeWidth: 1.5 });
  }
  text(fmtV(lo), cx - R + th / 2, cy + fs * 1.3, { align: 'center', color: '#6b7280' });
  text(fmtV(hi), cx + R - th / 2, cy + fs * 1.3, { align: 'center', color: '#6b7280' });
  if (v == null) { text('No data', cx, cy - R / 3, { align: 'center', color: '#9ca3af' }); return; }
  // needle: a thin triangle from the hub to just inside the track
  const a = ang(v), len = R - th * 0.4, bw = Math.max(1.5, R * 0.04);
  const tip = { x: cx + Math.cos(a) * len, y: cy + Math.sin(a) * len };
  const n1 = { x: cx + Math.cos(a + Math.PI / 2) * bw, y: cy + Math.sin(a + Math.PI / 2) * bw }, n2 = { x: cx + Math.cos(a - Math.PI / 2) * bw, y: cy + Math.sin(a - Math.PI / 2) * bw };
  const d = `M ${f(n1.x)} ${f(n1.y)} L ${f(tip.x)} ${f(tip.y)} L ${f(n2.x)} ${f(n2.y)} Z`;
  out.push(tag({ t: 'path', x: 0, y: 0, d, fill: '#1f2937', stroke: null }, g.anim && { k: 'rotate', ox: cx, oy: cy, a: frac(v) * 180, i: 0 }));
  out.push({ t: 'ellipse', cx, cy, rx: bw * 1.6, ry: bw * 1.6, fill: '#1f2937', stroke: null });
  text(item.labelTemplate ? g.labelText(0, data.series[0], v) : fmtV(v), cx, cy + fs * 2.6, { align: 'center', size: fs * 1.6, f: bold, color: '#111827' });
  pointLink(0, { x: cx - R, y: cy - R, w: R * 2, h: R }, `${data.series[0]?.name || 'Value'}: ${fmtV(v)}`);
}

/** Funnel: one stage per category in data order; each a trapezoid from its value's width to the next one's. */
function paintFunnel(g) {
  const { item, data, out, X, W, top, bottom, fs, text, measure, fmtV, pointFill, pointLink, pal, labelText, anim } = g;
  const vals = (data.series[0]?.values || []).map(v => Math.max(0, v || 0));
  const n = vals.length;
  let max = 0; for (const v of vals) max = Math.max(max, v);
  if (!max) { text('No data', X + W / 2, (top + bottom) / 2, { align: 'center', color: '#9ca3af' }); return; }
  const gap = n > 1 ? Math.min(2, (bottom - top) / n / 4) : 0;
  const sh = (bottom - top - fs * 0.6 - gap * (n - 1)) / n;
  const maxW = W * 0.62, cx = X + W * 0.36;
  let y = top + fs * 0.6;
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  vals.forEach((v, i) => {
    const tw = Math.max(2, maxW * v / max), bw = Math.max(2, i < n - 1 ? maxW * vals[i + 1] / max : tw * 0.6);
    const d = `M ${f(cx - tw / 2)} ${f(y)} L ${f(cx + tw / 2)} ${f(y)} L ${f(cx + Math.min(tw, bw) / 2)} ${f(y + sh)} L ${f(cx - Math.min(tw, bw) / 2)} ${f(y + sh)} Z`;
    const fill = pointFill(i, pal[i % pal.length]);
    out.push(tag({ t: 'path', x: 0, y: 0, d, fill, stroke: '#ffffff', strokeWidth: 0.75 }, anim && { k: 'fade', i }));
    pointLink(i, { x: cx - tw / 2, y, w: tw, h: sh }, `${data.categories[i]}: ${fmtV(v)} (${Math.round(v / total * 100)}%)`, d);
    if (item.showValues !== false) {
      const s = item.labelTemplate ? labelText(i, data.series[0], v, v / total) : `${data.categories[i]}: ${fmtV(v)}`;
      const sz = Math.min(fs, sh * 0.7);
      const { w } = measure(s, { size: sz });
      const narrow = Math.min(tw, bw);
      if (w + 6 < narrow) text(s, cx, y + sh / 2 + sz * 0.35, { align: 'center', size: sz, color: inkOn(fill) });
      else text(s, cx + maxW / 2 + 6, y + sh / 2 + sz * 0.35, { size: sz, maxW: X + W - (cx + maxW / 2 + 8) });
    }
    y += sh + gap;
  });
}
