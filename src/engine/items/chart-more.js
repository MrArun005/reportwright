// @ts-check
/**
 * Treemap, histogram, box plot, waterfall and Gantt, drawn as page-model primitives like every other chart, so the
 * viewer, PDF and HTML match. Chart data is untrusted: every loop here is linear in the rows (sorts are n log n),
 * and rows, bins, boxes, outliers and bars are capped (each cap warns when it bites).
 */
import { evalValue, toText } from '../expr/evaluate.js';
import { CAPS, inkOn, niceScale, linearTicks } from './chart-kit.js';

export const MORE_TYPES = new Set(['treemap', 'histogram', 'boxplot', 'waterfall', 'gantt']);
/** bins: histogram bins; outliers: box-plot outlier dots drawn per chart. */
export const MORE_CAPS = { bins: 500, outliers: 2000 };
const DAY = 86400000;

/** Legend entries for these types (the series legend does not fit them). */
export function moreLegend(type, item, data, pal) {
  if (type === 'waterfall') return [{ name: 'Increase', color: item.upColor || '#16a34a' }, { name: 'Decrease', color: item.downColor || '#dc2626' }, { name: 'Total', color: item.totalColor || '#2563eb' }];
  if (type === 'gantt' && item.seriesGroup) return ganttGroups(item, data, pal).list.map(gr => ({ name: gr.name, color: gr.color }));
  return [];
}

export function paintMore(type, g) {
  if (type === 'treemap') return paintTreemap(g);
  if (type === 'histogram') return paintHistogram(g);
  if (type === 'boxplot') return paintBoxPlot(g);
  if (type === 'waterfall') return paintWaterfall(g);
  return paintGantt(g);
}

const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
/** A row's value of an expression (aggregates read the row alone, so =Sum(Fields.x) is that row's x). */
function rowValues(g, expr, rows) {
  const { ctx, lc, who } = g;
  const c = { ...ctx };
  const out = [];
  for (const r of rows) {
    c.fields = r; c.aggRows = [r]; c.aggIndex = undefined;
    let v;
    try { v = evalValue(expr, c); } catch (e) { lc.warn(`${who}: ${e.message}`); v = null; }
    out.push(num(v));
  }
  return out;
}
/** At most CAPS.points rows for one chart. */
function capRows(g, rows) {
  if (rows.length <= CAPS.points) return rows;
  g.lc.warn(`${g.who}: ${rows.length} rows; only the first ${CAPS.points} are drawn`);
  return rows.slice(0, CAPS.points);
}
const noData = (g) => g.text('No data', g.X + g.W / 2, (g.top + g.bottom) / 2, { align: 'center', color: '#9ca3af' });

/* ---------------------------------------------------------------- value axis on the left, categories below */
function frame(g, lo, hi, fmt, { cats = null, catW = 0 } = {}) {
  const { item, lc, X, W, top, bottom, fs, text, out, axes, who, grid } = g;
  const ys = axes.y || {};
  const plotTop = top + fs * 0.6;
  const xTitle = axes.x?.title || item.xTitle, yTitle = ys.title;
  const plotBottom = bottom - fs * 1.8 - (xTitle ? fs * 1.6 : 0);
  const ay = g.valueAxis(ys, lo, hi, Infinity, { includeZero: true, len: plotBottom - plotTop, fs, fmt, lc, who, name: 'y' });
  const valW = Math.max(10, ...ay.ticks.map(t => lc.m.width(ay.fmt(t), g.font, fs)));
  const left = X + 4 + (yTitle ? fs * 1.6 : 0) + valW + 6, right = X + W - 6;
  const vy = (v) => { const fr = Math.max(0, Math.min(1, ay.frac(v) ?? 0)); return ys.reversed ? plotTop + fr * (plotBottom - plotTop) : plotBottom - fr * (plotBottom - plotTop); };
  for (const t of ay.ticks) {
    if (ys.gridlines !== false) out.push({ t: 'line', x1: left, y1: vy(t), x2: right, y2: vy(t), stroke: grid, strokeWidth: 0.5 });
    text(ay.fmt(t), left - 5, vy(t) + fs * 0.35, { align: 'right' });
  }
  if (xTitle) text(xTitle, (left + right) / 2, bottom - 2, { align: 'center', color: '#6b7280' });
  if (yTitle) { const my = (plotTop + plotBottom) / 2; text(yTitle, X + 4 + fs, my, { align: 'center', color: '#6b7280', maxW: plotBottom - plotTop, rotate: { a: -90, cx: X + 4 + fs, cy: my } }); }
  const band = (right - left) / Math.max(1, cats ? cats.length : 1);
  if (cats) {
    const every = Math.max(1, Math.ceil((catW + 6) / band));
    cats.forEach((c, i) => { if (i % every === 0) text(c, left + band * (i + 0.5), plotBottom + fs * 1.35, { align: 'center', maxW: band * every - 2 }); });
  }
  return { left, right, plotTop, plotBottom, vy, band, ay };
}

/* ---------------------------------------------------------------- treemap */
/**
 * Squarified treemap (Bruls, Huizing, van Wijk): values sorted largest first, laid out in rows along the shorter side,
 * a row closed when adding the next value would make its worst aspect ratio worse. Linear after the sort.
 * @returns {{x:number,y:number,w:number,h:number,i:number}[]}
 */
export function squarify(items, x, y, w, h) {
  const total = items.reduce((s, it) => s + it.v, 0);
  const out = [];
  if (!(total > 0) || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  let row = [], sum = 0, min = Infinity, max = 0;
  const worst = (s, mn, mx, side) => Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  const flush = () => {
    if (!row.length) return;
    if (w >= h) { // a column on the left
      const cw = sum / h;
      let yy = y;
      for (const r of row) { const rh = r.a / cw; out.push({ x, y: yy, w: cw, h: rh, i: r.i }); yy += rh; }
      x += cw; w -= cw;
    } else { // a row on top
      const rh = sum / w;
      let xx = x;
      for (const r of row) { const rw = r.a / rh; out.push({ x: xx, y, w: rw, h: rh, i: r.i }); xx += rw; }
      y += rh; h -= rh;
    }
    row = []; sum = 0; min = Infinity; max = 0;
  };
  for (const it of items) {
    const a = it.v * scale;
    const side = Math.min(w, h);
    if (row.length && worst(sum + a, Math.min(min, a), Math.max(max, a), side) > worst(sum, min, max, side)) flush();
    row.push({ a, i: it.i }); sum += a; min = Math.min(min, a); max = Math.max(max, a);
  }
  flush();
  return out;
}

function paintTreemap(g) {
  const { item, data, out, X, W, top, bottom, fs, pal, pointFill, pointLink, fmtV, lc, who, anim } = g;
  const s = data.series[0];
  const items = [];
  let dropped = 0;
  (s?.values || []).forEach((v, i) => { if (v != null && v > 0) items.push({ v, i }); else if (v != null) dropped++; });
  if (dropped) lc.warn(`${who}: ${dropped} categories with a value of 0 or less have no area in a treemap`);
  if (!items.length) return noData(g);
  items.sort((a, b) => b.v - a.v);
  const total = items.reduce((t, it) => t + it.v, 0);
  const rects = squarify(items, X + 2, top + 2, W - 4, bottom - top - 4);
  for (const r of rects) {
    const fill = pointFill(r.i, pal[r.i % pal.length]);
    out.push({ t: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, fill, stroke: '#ffffff', strokeWidth: 1, ...(anim ? { anim: { k: 'fade', i: r.i } } : {}) });
    const v = s.values[r.i];
    pointLink(r.i, { x: r.x, y: r.y, w: r.w, h: r.h }, `${data.categories[r.i]}: ${fmtV(v)} (${Math.round(v / total * 100)}%)`);
    // the category and its value inside the box, when they fit
    if (r.w > fs * 3 && r.h > fs * 1.6) {
      const ink = inkOn(fill);
      g.text(data.categories[r.i], r.x + 4, r.y + fs * 1.3, { color: ink, maxW: r.w - 8, f: g.bold });
      if (r.h > fs * 3 && item.showValues !== false) g.text(g.labelText(r.i, s, v, v / total), r.x + 4, r.y + fs * 2.5, { color: ink, maxW: r.w - 8, size: fs * 0.9 });
    }
  }
}

/* ---------------------------------------------------------------- histogram */
/** Bins over [lo, hi]: a count (default: Sturges) or a width. At most MORE_CAPS.bins; linear in the values. */
export function binValues(vals, { binCount, binWidth } = {}) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!vals.length) return { lo: 0, hi: 1, width: 1, counts: [], capped: false };
  let n, width, capped = false;
  const wantW = num(binWidth);
  if (wantW != null && wantW > 0) {
    lo = Math.floor(lo / wantW) * wantW;
    n = Math.floor((hi - lo) / wantW + 1e-9) + 1; // the last bin holds the highest value
    width = wantW;
    if (!(n <= MORE_CAPS.bins)) { capped = true; n = MORE_CAPS.bins; width = (hi - lo) / n || 1; }
  } else {
    const want = num(binCount);
    n = Math.round(want != null && want > 0 ? want : Math.ceil(Math.log2(vals.length)) + 1);
    if (n > MORE_CAPS.bins) { capped = true; n = MORE_CAPS.bins; }
    n = Math.max(1, n);
    width = hi > lo ? (hi - lo) / n : 1;
  }
  const counts = new Array(n).fill(0);
  for (const v of vals) counts[Math.min(n - 1, Math.max(0, Math.floor((v - lo) / width)))]++;
  return { lo, hi: lo + width * n, width, counts, capped };
}

function paintHistogram(g) {
  const { item, data, out, fs, lc, who, ctx, pal, axes, anim } = g;
  const s = data.series[0];
  const rows = capRows(g, data.rows);
  const vals = rowValues(g, s?.def?.value || '=0', rows).filter(v => v != null);
  if (!vals.length) return noData(g);
  const b = binValues(vals, { binCount: item.binCount, binWidth: item.binWidth });
  if (b.capped) lc.warn(`${who}: more than ${MORE_CAPS.bins} bins; drawn with ${MORE_CAPS.bins}`);
  const peak = Math.max(...b.counts);
  const fmtX = (v) => toText(v, axes.x?.format || item.valueFormat || 'N0', ctx);
  const f = frame(g, 0, Math.max(peak, 4), (v) => toText(v, axes.y?.format || 'N0', ctx)); // counts: at least 0–4, so ticks are whole numbers
  const n = b.counts.length, bw = (f.right - f.left) / n;
  const color = s?.color || pal[0];
  b.counts.forEach((c, i) => {
    const x = f.left + i * bw, y = f.vy(c), base = f.vy(0);
    if (c > 0) out.push({ t: 'rect', x: x + 0.5, y, w: Math.max(0.5, bw - 1), h: base - y, fill: color, ...(anim ? { anim: { k: anim === 'grow' ? 'growY' : 'fade', o: 'bottom', i } } : {}) });
    if (item.tooltips !== false) g.links.push({ t: 'link', x, y: f.plotTop, w: bw, h: f.plotBottom - f.plotTop, action: null, tip: `${fmtX(b.lo + i * b.width)} – ${fmtX(b.lo + (i + 1) * b.width)}: ${c}` });
    if (g.labelsOn && c > 0) g.label(String(c), x + bw / 2, y - 3, { size: fs * 0.85 });
  });
  // bin edges on the x axis, thinned while their labels would touch
  const edgeW = Math.max(...[b.lo, b.hi].map(v => g.measure(fmtX(v)).w));
  const every = Math.max(1, Math.ceil((edgeW + 6) / bw));
  for (let i = 0; i <= n; i += every) g.text(fmtX(b.lo + i * b.width), f.left + i * bw, f.plotBottom + fs * 1.35, { align: 'center' });
  out.push({ t: 'line', x1: f.left, y1: f.plotBottom, x2: f.right, y2: f.plotBottom, stroke: '#9ca3af', strokeWidth: 0.75 });
}

/* ---------------------------------------------------------------- box plot */
/** Quartiles (linear interpolation, as Excel QUARTILE.INC), whiskers at the furthest values within 1.5 IQR, outliers beyond. */
export function boxStats(sorted) {
  const n = sorted.length;
  const q = (p) => { const h = (n - 1) * p, l = Math.floor(h); return sorted[l] + (h - l) * ((sorted[Math.min(n - 1, l + 1)]) - sorted[l]); };
  const q1 = q(0.25), med = q(0.5), q3 = q(0.75), iqr = q3 - q1;
  const loF = q1 - 1.5 * iqr, hiF = q3 + 1.5 * iqr;
  let lo = med, hi = med;
  const outliers = [];
  for (const v of sorted) { if (v < loF || v > hiF) outliers.push(v); else { if (v < lo) lo = v; if (v > hi) hi = v; } }
  let sum = 0;
  for (const v of sorted) sum += v;
  return { min: sorted[0], max: sorted[n - 1], q1, med, q3, lo, hi, outliers, mean: sum / n, n };
}

function paintBoxPlot(g) {
  const { item, data, out, fs, pal, lc, who, pointFill, pointLink, fmtV, ctx } = g;
  const s = data.series[0];
  let budget = CAPS.points;
  const stats = data.buckets.map((bk) => {
    let rows = bk.rows;
    if (rows.length > budget) { lc.warn(`${who}: more than ${CAPS.points} rows; the rest are left out`); rows = rows.slice(0, Math.max(0, budget)); }
    budget -= rows.length;
    const vals = rowValues(g, s?.def?.value || '=0', rows).filter(v => v != null).sort((a, b) => a - b);
    return vals.length ? boxStats(vals) : null;
  });
  if (!stats.some(Boolean)) return noData(g);
  let lo = Infinity, hi = -Infinity;
  for (const st of stats) if (st) { lo = Math.min(lo, st.min); hi = Math.max(hi, st.max); }
  const catW = Math.max(10, ...data.categories.map(c => g.measure(c).w));
  const f = frame(g, lo, hi, (v) => toText(v, g.axes.y?.format || item.valueFormat || 'N0', ctx), { cats: data.categories, catW });
  let dots = 0, cut = false;
  stats.forEach((st, i) => {
    if (!st) return;
    const cx = f.left + f.band * (i + 0.5), bw = Math.min(f.band * 0.5, 40);
    const color = pointFill(i, s?.color || pal[0]);
    const ln = (x1, y1, x2, y2, w = 1) => out.push({ t: 'line', x1, y1, x2, y2, stroke: color, strokeWidth: w });
    ln(cx, f.vy(st.hi), cx, f.vy(st.q3)); ln(cx, f.vy(st.q1), cx, f.vy(st.lo));
    ln(cx - bw / 4, f.vy(st.hi), cx + bw / 4, f.vy(st.hi)); ln(cx - bw / 4, f.vy(st.lo), cx + bw / 4, f.vy(st.lo));
    const y3 = f.vy(st.q3), y1 = f.vy(st.q1);
    out.push({ t: 'rect', x: cx - bw / 2, y: Math.min(y1, y3), w: bw, h: Math.max(0.75, Math.abs(y1 - y3)), fill: color + '40', stroke: color, strokeWidth: 1 });
    ln(cx - bw / 2, f.vy(st.med), cx + bw / 2, f.vy(st.med), 1.8);
    if (item.showMean) out.push({ t: 'path', x: cx, y: f.vy(st.mean), d: 'M -3 0 L 0 -3 L 3 0 L 0 3 Z', fill: '#ffffff', stroke: color, strokeWidth: 1 });
    for (const v of st.outliers) {
      if (dots >= MORE_CAPS.outliers) { cut = true; break; }
      dots++;
      out.push({ t: 'ellipse', cx, cy: f.vy(v), rx: 2, ry: 2, fill: null, stroke: color, strokeWidth: 0.9 });
    }
    pointLink(i, { x: cx - f.band / 2, y: f.plotTop, w: f.band, h: f.plotBottom - f.plotTop }, `${data.categories[i]}: min ${fmtV(st.lo)}, Q1 ${fmtV(st.q1)}, median ${fmtV(st.med)}, Q3 ${fmtV(st.q3)}, max ${fmtV(st.hi)}${st.outliers.length ? `, ${st.outliers.length} outliers` : ''} (n ${st.n})`);
    if (g.labelsOn) g.label(fmtV(st.med), cx + bw / 2 + 3, f.vy(st.med) + fs * 0.3, { align: 'left', size: fs * 0.85 });
  });
  if (cut) lc.warn(`${who}: more than ${MORE_CAPS.outliers} outliers; the rest are not drawn`);
  out.push({ t: 'line', x1: f.left, y1: f.plotBottom, x2: f.right, y2: f.plotBottom, stroke: '#9ca3af', strokeWidth: 0.75 });
}

/* ---------------------------------------------------------------- waterfall */
function paintWaterfall(g) {
  const { item, data, out, fs, ctx, lc, who, pointLink, fmtV, anim } = g;
  const s = data.series[0];
  const up = item.upColor || '#16a34a', down = item.downColor || '#dc2626', tot = item.totalColor || '#2563eb';
  // a category is a subtotal when waterfallTotals is true in its scope: its bar is the running total, from 0
  const isTotal = (i) => {
    if (!item.waterfallTotals) return false;
    const b = data.buckets[i];
    try { const v = evalValue(item.waterfallTotals, { ...ctx, fields: b.rows[0] || null, aggRows: b.rows, aggIndex: undefined }); return v === true || v === 1 || (typeof v === 'string' && v.toLowerCase() === 'true'); } catch (e) { lc.warn(`${who}: ${e.message}`); return false; }
  };
  const bars = [];
  let cum = 0;
  (s?.values || []).forEach((v, i) => {
    if (isTotal(i)) { bars.push({ i, a: 0, b: cum, kind: 'total', v: cum, label: data.categories[i] }); return; }
    if (v == null) return;
    bars.push({ i, a: cum, b: cum + v, kind: v >= 0 ? 'up' : 'down', v, label: data.categories[i] });
    cum += v;
  });
  if (item.showTotal !== false) bars.push({ i: -1, a: 0, b: cum, kind: 'total', v: cum, label: item.totalLabel || 'Total' });
  if (!bars.length) return noData(g);
  let lo = 0, hi = 0;
  for (const b of bars) { lo = Math.min(lo, b.a, b.b); hi = Math.max(hi, b.a, b.b); }
  const cats = bars.map(b => b.label);
  const catW = Math.max(10, ...cats.map(c => g.measure(c).w));
  const f = frame(g, lo, hi, (v) => toText(v, g.axes.y?.format || item.valueFormat || 'N0', ctx), { cats, catW });
  const bw = f.band * 0.62;
  bars.forEach((b, k) => {
    const cx = f.left + f.band * (k + 0.5);
    const y0 = f.vy(b.a), y1 = f.vy(b.b);
    const fill = b.kind === 'up' ? up : b.kind === 'down' ? down : tot;
    out.push({ t: 'rect', x: cx - bw / 2, y: Math.min(y0, y1), w: bw, h: Math.max(0.75, Math.abs(y1 - y0)), fill, ...(anim ? { anim: { k: 'fade', i: k } } : {}) });
    // a thin connector from this bar's end to the next bar
    if (k < bars.length - 1) out.push({ t: 'line', x1: cx + bw / 2, y1, x2: cx + f.band - bw / 2, y2: y1, stroke: '#9ca3af', strokeWidth: 0.6, dash: [2, 2] });
    const rect = { x: cx - f.band / 2, y: f.plotTop, w: f.band, h: f.plotBottom - f.plotTop };
    const tip = `${b.label}: ${b.kind === 'total' ? fmtV(b.v) : `${b.v >= 0 ? '+' : ''}${fmtV(b.v)} → ${fmtV(b.b)}`}`;
    if (b.i >= 0) pointLink(b.i, rect, tip); else if (item.tooltips !== false) g.links.push({ t: 'link', ...rect, action: null, tip });
    if (g.labelsOn) g.label(b.kind === 'total' ? fmtV(b.v) : `${b.v >= 0 ? '+' : ''}${fmtV(b.v)}`, cx, Math.min(y0, y1) - 3, { size: fs * 0.85, alt: { y: Math.max(y0, y1) + fs, color: g.ink } });
  });
  out.push({ t: 'line', x1: f.left, y1: f.vy(0), x2: f.right, y2: f.vy(0), stroke: '#9ca3af', strokeWidth: 0.75 });
}

/* ---------------------------------------------------------------- Gantt */
function ganttGroups(item, data, pal) {
  const keyOf = new Map(), list = [];
  if (!item.seriesGroup) return { keyOf, list };
  for (const b of data.buckets) for (const r of b.rows) {
    let k;
    try { k = evalValue(item.seriesGroup, { ...data.ctx, fields: r, aggRows: [r], aggIndex: undefined }); } catch { k = null; }
    const name = k == null ? '' : String(k);
    let gr = list.find(x => x.name === name);
    if (!gr) { if (list.length >= CAPS.series) continue; gr = { name, color: pal[list.length % pal.length] }; list.push(gr); }
    keyOf.set(r, gr);
  }
  return { keyOf, list };
}
/** A start or end: a date (or date text) as ms, or a plain number. */
function timeOf(v) {
  if (v instanceof Date) return { t: v.getTime(), date: true };
  if (typeof v === 'number') return Number.isFinite(v) ? { t: v, date: false } : null;
  if (typeof v === 'string' && v.trim()) { const n = Number(v); if (Number.isFinite(n)) return { t: n, date: false }; const d = Date.parse(v); return Number.isFinite(d) ? { t: d, date: true } : null; }
  return null;
}
/** Date ticks: the first step of day, week, month, quarter, year that gives at most `max` ticks. */
export function dateTicks(lo, hi, max = 8) {
  const steps = [[1, 'd'], [2, 'd'], [7, 'd'], [14, 'd'], [1, 'm'], [3, 'm'], [6, 'm'], [1, 'y'], [2, 'y'], [5, 'y'], [10, 'y'], [50, 'y'], [100, 'y']];
  for (const [n, u] of steps) {
    const ticks = [];
    const d = new Date(lo);
    if (u === 'd') { d.setUTCHours(0, 0, 0, 0); if (n === 7 || n === 14) d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); }
    else { d.setUTCHours(0, 0, 0, 0); d.setUTCDate(1); if (u === 'y') d.setUTCMonth(0); }
    while (d.getTime() < lo) step(d, n, u);
    for (let i = 0; d.getTime() <= hi && i <= max; i++) { ticks.push(d.getTime()); step(d, n, u); }
    if (ticks.length <= max) return { ticks, unit: u };
  }
  return { ticks: [lo, hi], unit: 'y' };
}
function step(d, n, u) { if (u === 'd') d.setUTCDate(d.getUTCDate() + n); else if (u === 'm') d.setUTCMonth(d.getUTCMonth() + n); else d.setUTCFullYear(d.getUTCFullYear() + n); }

function paintGantt(g) {
  const { item, data, out, X, W, top, bottom, fs, ctx, lc, who, pal, pointFill, pointLink, axes, grid, text, anim } = g;
  const cats = data.categories;
  if (!item.ganttStart || !item.ganttEnd) { text('Set the start and end of the bars', X + W / 2, (top + bottom) / 2, { align: 'center', color: '#9ca3af' }); return; }
  const groups = ganttGroups(item, { ...data, ctx }, pal);
  // bars: one per row, in its category's lane
  const bars = [];
  let left = CAPS.points, cut = false, dates = false;
  const c = { ...ctx };
  data.buckets.forEach((bk, ci) => {
    for (const r of bk.rows) {
      if (left-- <= 0) { cut = true; return; }
      c.fields = r; c.aggRows = [r]; c.aggIndex = undefined;
      let s0, e0;
      try { s0 = timeOf(evalValue(item.ganttStart, c)); e0 = timeOf(evalValue(item.ganttEnd, c)); } catch (e) { lc.warn(`${who}: ${e.message}`); continue; }
      if (!s0 || !e0) continue;
      if (s0.date || e0.date) dates = true;
      bars.push({ ci, r, a: Math.min(s0.t, e0.t), b: Math.max(s0.t, e0.t) });
    }
  });
  if (cut) lc.warn(`${who}: more than ${CAPS.points} bars; the rest are left out`);
  if (!bars.length) return noData(g);
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { lo = Math.min(lo, b.a); hi = Math.max(hi, b.b); }
  const xs = axes.x || {};
  const now = ctx.globals?.ExecutionTime instanceof Date ? ctx.globals.ExecutionTime.getTime() : null;
  const today = dates && item.ganttToday !== false && now != null ? now : null;
  if (today != null && today >= lo - (hi - lo) * 0.1 && today <= hi + (hi - lo) * 0.1) { lo = Math.min(lo, today); hi = Math.max(hi, today); }
  if (hi === lo) { hi = lo + (dates ? DAY : 1); }
  const fmtT = (t) => (dates ? toText(new Date(t), xs.format || 'dd MMM', ctx) : toText(t, xs.format || 'N0', ctx));
  let ticks;
  if (dates) ticks = dateTicks(lo, hi, Math.max(2, Math.floor(W / 70))).ticks;
  else { const sc = niceScale(lo, hi, 5); lo = Math.min(lo, sc.lo); hi = Math.max(hi, sc.hi); ticks = linearTicks(sc.lo, sc.hi, sc.step); }
  const catW = Math.min(Math.max(10, ...cats.map(s => g.measure(s).w)), W * 0.32);
  const plotLeft = X + 4 + catW + 6, plotRight = X + W - 6;
  const plotTop = top + fs * 0.6, plotBottom = bottom - fs * 1.8 - (xs.title ? fs * 1.6 : 0);
  const px = (t) => plotLeft + ((t - lo) / (hi - lo)) * (plotRight - plotLeft);
  for (const t of ticks) {
    if (t < lo || t > hi) continue;
    if (xs.gridlines !== false) out.push({ t: 'line', x1: px(t), y1: plotTop, x2: px(t), y2: plotBottom, stroke: grid, strokeWidth: 0.5 });
    text(fmtT(t), px(t), plotBottom + fs * 1.35, { align: 'center' });
  }
  if (xs.title) text(xs.title, (plotLeft + plotRight) / 2, bottom - 2, { align: 'center', color: '#6b7280' });
  const lane = (plotBottom - plotTop) / Math.max(1, cats.length);
  const every = Math.max(1, Math.ceil(fs * 1.2 / lane));
  cats.forEach((s, i) => { if (i % every === 0) text(s, plotLeft - 5, plotTop + lane * (i + 0.5) + fs * 0.35, { align: 'right', maxW: catW }); });
  const bh = Math.max(1, Math.min(lane * 0.62, 22));
  bars.forEach((b, k) => {
    const y = plotTop + lane * (b.ci + 0.5) - bh / 2;
    const x0 = px(b.a), x1 = px(b.b);
    const fill = groups.keyOf.get(b.r)?.color || pointFill(b.ci, pal[0]);
    out.push({ t: 'rect', x: x0, y, w: Math.max(1, x1 - x0), h: bh, fill, radius: Math.min(2, bh / 4), ...(anim ? { anim: { k: anim === 'grow' ? 'growX' : 'fade', o: 'left', i: k } } : {}) });
    pointLink(b.ci, { x: x0, y, w: Math.max(4, x1 - x0), h: bh }, `${cats[b.ci]}: ${fmtT(b.a)} – ${fmtT(b.b)}`);
    if (g.labelsOn) g.label(cats[b.ci], x1 + 3, y + bh / 2 + fs * 0.3, { align: 'left', size: fs * 0.85 });
  });
  out.push({ t: 'line', x1: plotLeft, y1: plotBottom, x2: plotRight, y2: plotBottom, stroke: '#9ca3af', strokeWidth: 0.75 });
  if (today != null && today >= lo && today <= hi) {
    const tx = px(today);
    out.push({ t: 'line', x1: tx, y1: plotTop, x2: tx, y2: plotBottom, stroke: item.todayColor || '#dc2626', strokeWidth: 1, dash: [3, 2] });
    text('Today', tx + 2, plotTop + fs * 0.9, { color: item.todayColor || '#dc2626', size: fs * 0.85 });
  }
}
