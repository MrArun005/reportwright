// @ts-check
/**
 * Charts drawn as page-model primitives (rect, line, path, ellipse, text), so every
 * renderer and exporter supports them with no extra code.
 * This file: the data step and the cartesian charts (column, bar, line, area, combos, ranges, scatter, bubble, polar,
 * candlestick, OHLC) with their axes, overlays and labels. Round charts are in chart-round.js, maths in chart-kit.js.
 */
import { evalValue, toText, sortCompare } from '../expr/evaluate.js';
import { resolveFontKey } from '../text/fonts.js';
import { applyFilters, applySort, related } from '../data/index.js';
import { CAPS, PALETTES, paletteOf, inkOn, niceScale, linearTicks, logTicks, curvePath, fitTrend, movingAverage, LabelPlacer } from './chart-kit.js';
import { paintRound, ROUND_TYPES } from './chart-round.js';
import { paintMore, moreLegend, MORE_TYPES } from './chart-more.js';

export { niceScale };
export const PALETTE = PALETTES.default;
export const CHART_TYPES = ['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter', 'bubble', 'radar', 'polar', 'candlestick', 'ohlc', 'gauge', 'funnel', 'treemap', 'histogram', 'boxplot', 'waterfall', 'gantt'];
const PER_ROW = new Set(['scatter', 'bubble', 'polar']);
const SERIES_FIELDS = ['value', 'low', 'high', 'open', 'close'];

function safe(v, ctx, lc, who) {
  try { return evalValue(v, ctx); } catch (e) { lc.warn(`${who}: ${e.message}`); return null; }
}
const keyOf = (k) => (k instanceof Date ? `d${k.getTime()}` : `${typeof k}:${k}`);
const numOrNull = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const tag = (o, a) => { if (a) o.anim = a; return o; };
const f = (v) => Math.round(v * 100) / 100;

/**
 * colorByCategory: one colour per category or series name across every chart of the render that asks for it (first
 * seen, first colour), so "North" is the same blue in the pie and the column chart. Off: colours by position.
 * @param {any} lc @param {string[]} pal
 */
const byName = (lc, pal) => (name) => {
  const m = (lc.categoryColors ||= new Map());
  const k = String(name);
  if (!m.has(k)) m.set(k, m.size);
  return pal[/** @type {number} */ (m.get(k)) % pal.length];
};
/** Categories × series values from the data. */
export function chartData(item, ctx, lc, pal = paletteOf(item.palette)) {
  let rows = item.dataSet ? related(lc.dataSets[item.dataSet] || [], ctx) : ctx.aggRows || [];
  if (item.dataSet && !lc.dataSets[item.dataSet]) lc.warn(`${item.name}: the data set "${item.dataSet}" does not exist`);
  if (item.filters?.length) rows = applyFilters(rows, item.filters, ctx);
  if (item.sort?.length) rows = applySort(rows, item.sort, ctx);
  const who = item.name || 'Chart';
  const c = { ...ctx };
  const bucket = (list, expr) => {
    const m = new Map();
    for (const r of list) {
      c.fields = r;
      const k = expr ? safe(expr, c, lc, who) : '';
      const kk = keyOf(k);
      let b = m.get(kk);
      if (!b) { b = { key: k, rows: [] }; m.set(kk, b); }
      b.rows.push(r);
    }
    return [...m.values()];
  };
  // a gauge shows one value over all the rows
  // a gauge shows one value over all the rows; a histogram bins every row's value
  let cats = item.chartType === 'gauge' || item.chartType === 'histogram' ? [{ key: '', rows }] : bucket(rows, item.category);
  if (item.categorySort === 'asc' || item.categorySort === 'desc') {
    const d = item.categorySort === 'desc' ? -1 : 1;
    cats.sort((a, b) => (a.key instanceof Date ? a.key.getTime() : a.key) > (b.key instanceof Date ? b.key.getTime() : b.key) ? d : -d);
  }
  // show at most N: a number, or an expression such as =Parameters.top (0 or empty: all)
  const maxN = typeof item.maxCategories === 'string' ? numOrNull(safe(item.maxCategories, ctx, lc, who)) : item.maxCategories;
  if (maxN > 0) cats = cats.slice(0, Math.floor(maxN));
  if (cats.length > CAPS.categories) { lc.warn(`${who}: ${cats.length} categories; only the first ${CAPS.categories} are drawn`); cats = cats.slice(0, CAPS.categories); }
  let defs = item.series?.length ? item.series : [{ name: 'Value', value: '=Count(Fields)' }];
  if (defs.length > CAPS.series) { lc.warn(`${who}: ${defs.length} series; only the first ${CAPS.series} are drawn`); defs = defs.slice(0, CAPS.series); }
  const agg = (rs, expr) => {
    if (!rs.length || expr == null || expr === '') return null;
    return numOrNull(safe(expr, { ...ctx, fields: rs[0], aggRows: rs, aggIndex: undefined }, lc, who));
  };
  // date categories with no format: labelled by how far apart they are (days: d MMM; times within a day: HH:mm)
  const dateFmt = (() => {
    const ts = cats.filter(c2 => c2.key instanceof Date).map(c2 => c2.key.getTime()).sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < ts.length; i++) if (ts[i] > ts[i - 1]) gap = Math.min(gap, ts[i] - ts[i - 1]);
    return gap < 86400000 ? (ts[ts.length - 1] - ts[0] < 86400000 ? 'HH:mm' : 'd MMM HH:mm') : gap < 28 * 86400000 ? 'd MMM' : 'MMM yyyy';
  })();
  const labelOf = (k) => toText(k, item.categoryFormat || (k instanceof Date ? dateFmt : null), ctx);
  const perRow = PER_ROW.has(item.chartType);
  const make = (sd, name, color, rowsOf) => {
    const s = { name, color, def: sd, values: [] };
    if (!perRow) for (const k of SERIES_FIELDS) if (sd[k] != null && sd[k] !== '') s[k] = cats.map((cat, i) => agg(rowsOf(cat, i), sd[k]));
    s.values = s.value || s.close || s.high || cats.map(() => null);
    return s;
  };
  const series = [];
  if (item.seriesGroup) {
    let groups = bucket(rows, item.seriesGroup).sort((a, b) => sortCompare(a.key, b.key, ctx)); // 1, 2, 10 (numbers, natural text)
    const max = Math.max(1, Math.floor(CAPS.series / defs.length));
    if (groups.length > max) { lc.warn(`${who}: ${groups.length} series groups; only the first ${max} are drawn`); groups = groups.slice(0, max); }
    // one pass: which group each row is in, then each category's rows split by group (was groups × rows)
    const gi = new Map();
    groups.forEach((gr, i) => { for (const r of gr.rows) gi.set(r, i); });
    const split = cats.map(cat => {
      const parts = groups.map(() => []);
      for (const r of cat.rows) { const i = gi.get(r); if (i !== undefined) parts[i].push(r); }
      return parts;
    });
    let ci = 0;
    groups.forEach((gr, gIdx) => {
      for (const sd of defs) {
        const name = defs.length > 1 ? `${toText(gr.key, null, ctx)} · ${sd.name}` : toText(gr.key, null, ctx);
        series.push(make(sd, name, item.colorByCategory ? byName(lc, pal)(name) : pal[ci % pal.length], (cat, i) => split[i][gIdx]));
        ci++;
      }
    });
  } else {
    defs.forEach((sd, i) => series.push(make(sd, sd.name || `Series ${i + 1}`, sd.color || pal[i % pal.length], (cat) => cat.rows)));
  }
  return { categories: cats.map(c2 => labelOf(c2.key)), buckets: cats, series, rows };
}

/**
 * Paint the chart into item-local coordinates (x from item.x, y from 0).
 * @returns {any[]} page-model items
 */
export function paintChart(item, ctx, lc, base) {
  const m = lc.m;
  const font = resolveFontKey(base.fontFamily, 'normal', 'normal');
  const bold = resolveFontKey(base.fontFamily, 'bold', 'normal');
  const fs = Math.max(6, Number(item.fontSize) || 7.5);
  const ink = item.textColor || '#374151';
  const grid = '#e5e7eb';
  const X = item.x, W = item.w, H = item.h;
  const who = item.name || 'Chart';
  const out = [];
  /** Labels are cut at 200 characters before measuring: ellipsizing is quadratic in the text length. */
  const measure = (s, { size = fs, f: fk = font, maxW = 9999 } = {}) => {
    let str = String(s).slice(0, 200);
    if (m.width(str, fk, size) > maxW) str = m.ellipsize(str, fk, size, maxW);
    return { str, w: m.width(str, fk, size) };
  };
  const text = (s, x, y, { size = fs, f: fk = font, color = ink, align = 'left', maxW = 9999, rotate = null } = {}) => {
    const { str, w } = measure(s, { size, f: fk, maxW });
    const lx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const t = { t: 'text', font: fk, size, color, lines: [{ x: lx, y, text: str, w }] };
    if (rotate) t.rotate = rotate;
    out.push(t);
    return w;
  };
  if (item.background) out.push({ t: 'rect', x: X, y: 0, w: W, h: H, fill: item.background });

  let pal = paletteOf(item.palette);
  const type = CHART_TYPES.includes(item.chartType) ? item.chartType : 'column';
  // Gantt colours its bars by seriesGroup itself (per row); the others here draw one series
  const data = chartData({ ...item, chartType: type, ...(MORE_TYPES.has(type) ? { seriesGroup: undefined } : {}) }, ctx, lc, pal);
  // pie, donut and funnel colour by category: with colorByCategory, slice i gets its category's colour of the report
  if (item.colorByCategory && (type === 'pie' || type === 'donut' || type === 'funnel') && data.categories.length) pal = data.categories.map(byName(lc, pal));
  // Interactivity per point: pointAction (any action, usually "params" to filter the report), pointColor and tooltips.
  // The point's scope is its category: Fields = first row, aggregates over the category's rows.
  const links = [];
  const pointCtx = (ci) => { const b = data.buckets[ci]; return { ...ctx, fields: b?.rows[0] || null, aggRows: b?.rows || [], aggIndex: undefined }; };
  const pointFill = (ci, fallback) => { if (!item.pointColor) return fallback; const v = safe(item.pointColor, pointCtx(ci), lc, who); return v ? String(v) : fallback; };
  const pointLink = (ci, rect, tip, d) => {
    let l = item.pointAction ? lc.linkFor({ action: item.pointAction, name: item.name }, pointCtx(ci), rect) : null;
    if (!l && item.tooltips === false) return;
    if (!l) l = { t: 'link', ...rect, action: null };
    if (tip && item.tooltips !== false) l.tip = tip;
    if (d) { l.d = d; l.x0 = rect.x; l.y0 = rect.y; }
    links.push(l);
  };
  let top = 4, bottom = H - 4;
  const title = item.title ? String(safe(item.title, ctx, lc, who) ?? '') : '';
  if (title) {
    // a long title shrinks (down to the label size), then wraps onto a second line; only a third line's worth is cut
    const tw = W - 8, full = fs * 1.35, s = String(title).slice(0, 200);
    const fit = m.width(s, bold, full) <= tw ? full : Math.max(fs, Math.floor(full * tw / m.width(s, bold, full) * 10) / 10);
    if (m.width(s, bold, fit) <= tw) { text(s, X + 4, top + fs * 1.4, { size: fit, f: bold, color: '#111827', maxW: tw }); top += fs * 2.1; }
    else {
      const words = s.split(/\s+/);
      let first = '';
      while (words.length && m.width(first ? `${first} ${words[0]}` : words[0], bold, fs) <= tw) first = first ? `${first} ${words.shift()}` : words.shift();
      if (!first) first = words.shift() || ''; // one long word: cut on its line
      text(first, X + 4, top + fs * 1.4, { size: fs, f: bold, color: '#111827', maxW: tw });
      if (words.length) text(words.join(' '), X + 4, top + fs * 2.6, { size: fs, f: bold, color: '#111827', maxW: tw });
      top += fs * (words.length ? 3.3 : 2.1);
    }
  }

  // legend at the bottom: the series (or a pie's slices), then the overlays that are in it
  const byCategory = type === 'pie' || type === 'donut' || type === 'funnel';
  const ovLegend = legendOverlays(item, type, data);
  const more = MORE_TYPES.has(type) ? moreLegend(type, item, { ...data, ctx }, pal) : null;
  const legendItems = more || (byCategory ? data.categories.map((c, i) => ({ name: c, color: pointFill(i, pal[i % pal.length]) }))
    : [...data.series.map(s => ({ name: s.name, color: s.color })), ...ovLegend]);
  const legendOn = item.legend !== 'none' && type !== 'gauge' && (more ? more.length > 0 : byCategory || data.series.length > 1 || ovLegend.length > 0);
  if (legendOn) {
    const rowsL = [];
    let line = [], lw = 0;
    for (const li of legendItems.slice(0, 200)) {
      const key = li.mark ? 14 : 10;
      const w = key + m.width(String(li.name).slice(0, 200), font, fs) + 12;
      if (lw + w > W - 8 && line.length) { rowsL.push(line); line = []; lw = 0; }
      line.push({ ...li, w, key }); lw += w;
    }
    if (line.length) rowsL.push(line);
    // a legend never takes more than half the chart
    const lh = fs * 1.6;
    const keep = rowsL.slice(0, Math.max(1, Math.floor((bottom - top) / 2 / lh)));
    bottom -= keep.length * lh;
    keep.forEach((ln, ri) => {
      let lx = X + (W - ln.reduce((s, l) => s + l.w, 0)) / 2;
      const ly = bottom + ri * lh + lh * 0.75;
      for (const l of ln) {
        if (l.mark === 'line') out.push({ t: 'line', x1: lx, y1: ly - fs * 0.35, x2: lx + 11, y2: ly - fs * 0.35, stroke: l.color, strokeWidth: 1.4, ...(l.dash ? { dash: [3, 2] } : {}) });
        else if (l.mark === 'band') out.push({ t: 'rect', x: lx, y: ly - fs * 0.75, w: 11, h: 7, fill: l.color + '40', stroke: l.color, strokeWidth: 0.5, radius: 1.5 });
        else out.push({ t: 'rect', x: lx, y: ly - fs * 0.75, w: 7, h: 7, fill: l.color, radius: 1.5 });
        text(l.name, lx + l.key, ly, { maxW: l.w - l.key });
        lx += l.w;
      }
    });
    bottom -= 4;
  }
  if (!data.categories.length && !PER_ROW.has(type)) {
    text('No data', X + W / 2, (top + bottom) / 2, { align: 'center', color: '#9ca3af' });
    return out;
  }

  const axes = item.axes && typeof item.axes === 'object' ? item.axes : {};
  const fmtV = (v) => toText(v, axes.y?.format || item.valueFormat || 'N0', ctx);
  const anim = item.animation === 'grow' || item.animation === 'fade' ? item.animation : null;
  const placer = new LabelPlacer({ x: X, y: 0, w: W, h: H });
  /** A data label: drawn only if it overlaps no label drawn before it and stays in the chart (else it tries `alt`). */
  const label = (s, x, y, { size = fs * 0.9, align = 'center', color = ink, f: fk = font, alt = null } = {}) => {
    const { str, w } = measure(s, { size, f: fk });
    if (!str.trim()) return false; // a template that gives nothing for this point
    // alt: a second place to try, a y (same x) or {x, y, align, color}
    const tries = [{ x, y, align, color }];
    if (alt != null) tries.push(typeof alt === 'number' ? { x, y: alt, align, color } : { x, y, align, color, ...alt });
    for (const p of tries) {
      const lx = p.align === 'right' ? p.x - w : p.align === 'center' ? p.x - w / 2 : p.x;
      if (placer.place({ x: lx, y: p.y - size * 0.8, w, h: size })) {
        out.push({ t: 'text', font: fk, size, color: p.color, lines: [{ x: lx, y: p.y, text: str, w }] });
        return true;
      }
    }
    return false;
  };
  const labelsOn = !!(item.showValues || item.labelTemplate);
  /** The text of a data label: the template ({value} {category} {series} {percent}, or an =expression), else the value. */
  const labelText = (ci, s, v, pct) => {
    const tpl = item.labelTemplate;
    if (!tpl) return fmtV(v);
    if (typeof tpl === 'string' && tpl.startsWith('=')) return toText(safe(tpl, pointCtx(ci), lc, who), null, ctx);
    const vars = { value: fmtV(v), category: data.categories[ci] ?? '', series: s?.name ?? '', percent: pct == null ? '' : `${Math.round(pct * 100)}%` };
    return String(tpl).slice(0, 500).replace(/\{(\w+)\}/g, (all, k) => (Object.hasOwn(vars, k.toLowerCase()) ? vars[k.toLowerCase()] : all));
  };
  // an overlay named in the legend (trend, moving average, band) needs no label of its own on the plot
  const inLegend = (o) => legendOn && o.legend !== false;
  const g = { inLegend, item, ctx, lc, data, out, links, X, W, H, top, bottom, fs, font, bold, ink, grid, text, measure, fmtV, pointFill, pointLink, pointCtx, pal, label, labelsOn, labelText, anim, who, axes, safe, valueAxis };

  if (MORE_TYPES.has(type)) paintMore(type, g);
  else if (ROUND_TYPES.has(type)) paintRound(type, g);
  else if (PER_ROW.has(type)) paintXY(type, g);
  else paintCartesian(type, g);
  // data exports (exportData): the chart's own numbers ride on its first item, so Excel can draw an editable chart
  if (lc.regions && out.length && NATIVE_XL.has(type)) out[0].xchart = nativeSpec(type, item, data, g, title, axes);
  return out.concat(links);
}

/** Chart types Excel draws natively (DrawingML c:chart); the others export as pictures. */
const NATIVE_XL = new Set(['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter', 'bubble', 'radar']);
const XL_CAP = 4000; // points per series in an exported chart
/** What a native Excel chart needs: categories and series values (or x/y points), titles, stacking, series kinds. */
function nativeSpec(type, item, data, g, title, axes) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const base = { type, title: title || null, stacked: item.stacked === 'percent' ? 'percent' : item.stacked ? 'stacked' : null,
    xTitle: axes.x?.title || item.xTitle || null, yTitle: axes.y?.title || null, format: axes.y?.format || item.valueFormat || null, legend: item.legend !== 'none' };
  if (g.xy) return { ...base, series: g.xy.slice(0, 50).map(st => ({ name: String(st.s.name ?? ''), color: st.s.color, x: st.pts.slice(0, XL_CAP).map(p => p.x), y: st.pts.slice(0, XL_CAP).map(p => p.y), size: type === 'bubble' ? st.pts.slice(0, XL_CAP).map(p => p.size) : undefined })) };
  const colors = type === 'pie' || type === 'donut' ? data.categories.slice(0, XL_CAP).map((_, i) => g.pointFill(i, g.pal[i % g.pal.length])) : undefined;
  return { ...base, colors, categories: data.categories.slice(0, XL_CAP).map(String),
    series: data.series.slice(0, 50).map(s => ({ name: String(s.name ?? ''), color: s.color, values: s.values.slice(0, XL_CAP).map(num),
      kind: ['column', 'bar', 'line', 'area'].includes(s.def?.type) ? s.def.type : undefined, secondary: s.def?.axis === 'secondary' || undefined })) };
}

/* ---------------------------------------------------------------- axes */

/**
 * A value axis from the data range and the author's axis settings.
 * @returns {{lo:number, hi:number, ticks:number[], frac:(v:number)=>number|null, fmt:(v:number)=>string, log:boolean}}
 */
/** Decimals a tick step needs to tell its ticks apart (0.2 → 1, 0.25 → 2, 5 → 0). */
const stepDecimals = (step) => { const t = String(Number(step.toPrecision(6))); const m = /\.(\d+)$/.exec(t); return t.includes('e-') ? Math.min(6, Number(t.split('e-')[1])) : m ? Math.min(6, m[1].length) : 0; };
/** autoFmt: no format was given: labels get the decimals the tick step needs (ticks 0, 0.2 … 0.8, not 0, 0, 0, 1, 1). */
function valueAxis(spec, lo, hi, minPos, { includeZero = true, len = 100, fs = 7.5, fmt, percent = false, pad = 0, lc, who, name, autoFmt }) {
  spec = spec && typeof spec === 'object' ? spec : {};
  const smin = numOrNull(spec.min), smax = numOrNull(spec.max);
  if (spec.log) {
    if (!(minPos > 0) && !(smin > 0)) lc.warn(`${who}: the ${name} axis is logarithmic but has no value above 0`);
    const a = smin > 0 ? smin : 10 ** Math.floor(Math.log10(minPos > 0 && minPos < Infinity ? minPos : 1));
    const b = smax > a ? smax : 10 ** Math.ceil(Math.log10(Math.max(hi, a * 10)));
    const ticks = logTicks(a, b).filter(t => t >= a * 0.999999 && t <= b * 1.000001);
    const la = Math.log10(a), lb = Math.log10(b);
    return { lo: a, hi: b, ticks, log: true, fmt, frac: (v) => (v > 0 ? (Math.log10(v) - la) / (lb - la) : null) };
  }
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (percent) { lo = lo < 0 ? -1 : 0; hi = 1; }
  // pad: the automatic range keeps a margin past the data, so the largest point is not drawn on the frame (explicit min/max are kept as given)
  if (pad > 0 && hi > lo) { const d = (hi - lo) * pad; if (smin == null) lo -= d; if (smax == null) hi += d; }
  const want = len < fs * 6 ? 3 : 5;
  const sc = niceScale(smin ?? lo, smax ?? hi, want);
  let a = sc.lo, b = sc.hi, ticks;
  if (smin != null || smax != null) {
    a = smin ?? sc.lo; b = smax ?? sc.hi;
    if (!(b > a)) b = a + (sc.step || 1);
    const s2 = niceScale(a, b, want);
    ticks = linearTicks(Math.ceil(a / s2.step - 1e-9) * s2.step, b, s2.step);
  } else ticks = linearTicks(a, b, sc.step);
  if (autoFmt && ticks.length > 1) { const d = stepDecimals(ticks[1] - ticks[0]); if (d > 0) fmt = autoFmt(d); }
  return { lo: a, hi: b, ticks, log: false, fmt, frac: (v) => (v - a) / (b - a) };
}

/** The values a reference line or band stands on: numbers, or expressions in the chart's scope (all its rows). */
function overlayValues(o, g) {
  const keys = o.type === 'band' ? ['from', 'to'] : o.type === 'line' ? ['value'] : [];
  const scope = { ...g.ctx, fields: g.data.rows[0] || null, aggRows: g.data.rows, aggIndex: undefined };
  const vals = [];
  for (const k of keys) {
    const v = typeof o[k] === 'number' ? o[k] : numOrNull(g.safe(o[k], scope, g.lc, g.who));
    if (v != null) vals.push(v);
  }
  return o.type === 'band' && vals.length !== 2 ? [] : vals;
}
/** Overlays the legend lists (each unless legend: false), with the key each draws: a line (dashed for trends) or a band. */
export function legendOverlays(item, type, data) {
  if (ROUND_TYPES.has(type) || type === 'polar') return [];
  const list = (Array.isArray(item.overlays) ? item.overlays : []).slice(0, CAPS.overlays).filter(o => o && typeof o === 'object' && o.legend !== false);
  const hex = (c, d) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d);
  const sname = (o) => data.series[Math.max(0, Math.min(data.series.length - 1, Math.floor(Number(o.series)) || 0))]?.name || '';
  const out = [];
  for (const o of list) {
    const lab = o.label != null && String(o.label).trim() ? String(o.label) : null;
    if (o.type === 'line') out.push({ name: lab || 'Reference line', color: hex(o.color, '#dc2626'), mark: 'line', dash: true });
    else if (o.type === 'band') out.push({ name: lab || 'Band', color: hex(o.color, '#f59e0b'), mark: 'band' });
    else if (o.type === 'trend') out.push({ name: lab || `Trend (${sname(o)})`, color: hex(o.color, '#475569'), mark: 'line', dash: true });
    else if (o.type === 'movingAverage' && !PER_ROW.has(type)) out.push({ name: lab || `Moving average ${Math.max(1, Math.round(Number(o.period ?? 3)) || 1)} (${sname(o)})`, color: hex(o.color, '#475569'), mark: 'line' });
  }
  return out;
}
function overlaysOf(item, lc, who) {
  const list = (Array.isArray(item.overlays) ? item.overlays : []).filter(o => o && typeof o === 'object');
  if (list.length > CAPS.overlays) lc.warn(`${who}: ${list.length} overlays; only the first ${CAPS.overlays} are drawn`);
  return list.slice(0, CAPS.overlays);
}

/* ---------------------------------------------------------------- cartesian */

const CAT_KINDS = new Set(['column', 'bar', 'line', 'area']);

function paintCartesian(type, g) {
  const { item, lc, data, out, X, W, top, bottom, fs, font, text, measure, pointFill, pointLink, label, labelsOn, labelText, anim, who, axes, ink, grid } = g;
  const m = lc.m;
  const horiz = type === 'bar';
  const financialChart = type === 'candlestick' || type === 'ohlc';
  const stackMode = item.stacked === 'percent' ? 'percent' : item.stacked ? 'stack' : null;
  // what each series draws: its own type in a combo, else the chart's
  const S = data.series.map((s, i) => {
    let kind = CAT_KINDS.has(s.def.type) ? s.def.type : financialChart ? 'column' : type;
    if (horiz && kind === 'column') kind = 'bar';
    if (!horiz && kind === 'bar') kind = 'column';
    const fin = financialChart && (s.open || s.close) ? type : null;
    const range = !fin && !!(s.low && s.high);
    const filled = kind === 'column' || kind === 'bar';
    const stacks = !!stackMode && !range && !fin && (filled || kind === 'area') && (CAT_KINDS.has(s.def.type) || type === 'column' || type === 'bar' || type === 'area');
    const mode = ['smooth', 'step', 'straight'].includes(s.def.line) ? s.def.line : ['smooth', 'step'].includes(item.line) ? item.line : 'straight';
    return { s, i, kind, fin, range, filled, stacks, mode, axis: s.def.axis === 'secondary' ? 1 : 0, pts: [], slot: 0 };
  });
  const n = data.categories.length;

  // stacks per axis and per kind (columns and areas stack apart); a 100% stack divides by the category's total
  const stackKey = (r) => `${r.axis}:${r.filled ? 'f' : 'a'}`;
  const totals = new Map();
  if (stackMode === 'percent') for (const r of S) if (r.stacks) {
    let t = totals.get(stackKey(r)); if (!t) totals.set(stackKey(r), t = new Array(n).fill(0));
    r.s.values.forEach((v, ci) => { if (v != null) t[ci] += Math.abs(v); });
  }
  const acc = new Map();
  const stackOf = (r) => { let st = acc.get(stackKey(r)); if (!st) acc.set(stackKey(r), st = { pos: new Array(n).fill(0), neg: new Array(n).fill(0), run: new Array(n).fill(0), axis: r.axis }); return st; };
  for (const r of S) {
    r.pts = r.s.values.map((v, ci) => {
      if (r.fin) {
        const o = r.s.open?.[ci] ?? null, h = r.s.high?.[ci] ?? null, l = r.s.low?.[ci] ?? null, c = r.s.close?.[ci] ?? null;
        if (h == null || l == null || (c == null && o == null)) return null;
        return { o: o ?? c, h, l, c: c ?? o, v: c ?? o, a: l, b: h };
      }
      if (r.range) { const l = r.s.low[ci], h = r.s.high[ci]; return l == null || h == null ? null : { a: l, b: h, v: h, l }; }
      if (v == null) return null;
      if (!r.stacks) return { a: 0, b: v, v };
      const t = stackMode === 'percent' ? totals.get(stackKey(r))[ci] : 0;
      const val = stackMode === 'percent' ? (t ? v / t : 0) : v;
      const st = stackOf(r);
      // the axis range comes from the positive and negative sums, as before Phase 5
      if (val >= 0) st.pos[ci] += val; else st.neg[ci] += val;
      const pct = stackMode === 'percent' ? val : null;
      if (!r.filled) { const a = st.run[ci]; st.run[ci] = a + val; return { a, b: a + val, v, pct }; } // areas: a running total
      const arr = val >= 0 ? st.posBar || (st.posBar = new Array(n).fill(0)) : st.negBar || (st.negBar = new Array(n).fill(0));
      const a = arr[ci]; arr[ci] = a + val;
      return { a, b: a + val, v, pct };
    });
  }

  const ovs = overlaysOf(item, lc, who).map(o => ({ ...o, axisI: o.axis === 'secondary' ? 1 : 0, vals: overlayValues(o, g) }));

  // value ranges per axis
  const rng = [0, 1].map(() => ({ lo: Infinity, hi: -Infinity, minPos: Infinity, any: false, allFin: true }));
  const see = (ai, v) => { if (v == null || !Number.isFinite(v)) return; const q = rng[ai]; q.lo = Math.min(q.lo, v); q.hi = Math.max(q.hi, v); if (v > 0) q.minPos = Math.min(q.minPos, v); };
  for (const r of S) {
    rng[r.axis].any = true;
    if (!r.fin) rng[r.axis].allFin = false;
    if (!r.stacks) for (const p of r.pts) if (p) { see(r.axis, p.a); see(r.axis, p.b); }
  }
  for (const st of acc.values()) for (let ci = 0; ci < n; ci++) { see(st.axis, st.pos[ci]); see(st.axis, st.neg[ci]); }
  for (const o of ovs) for (const v of o.vals) see(o.axisI, v);
  for (const q of rng) if (q.lo === Infinity) { q.lo = 0; q.hi = 0; }
  const hasY2 = rng[1].any;
  const ySpec = axes.y || {}, y2Spec = axes.y2 || {}, xSpec = axes.x || {};
  const fmtFor = (spec, fallback) => (v) => toText(v, stackMode === 'percent' && !spec.format ? 'P0' : spec.format || fallback, g.ctx);
  const fmt1 = fmtFor(ySpec, item.valueFormat || 'N0');
  const fmt2 = fmtFor(y2Spec, ySpec.format || item.valueFormat || 'N0');
  const auto = (spec, ...given) => (stackMode === 'percent' || spec.format || given.some(Boolean) ? undefined : (d) => (v) => toText(v, `N${d}`, g.ctx));

  // layout
  const catW = data.categories.reduce((m, c) => Math.max(m, measure(c).w), 10);
  const leftTitle = horiz ? xSpec.title : ySpec.title;
  const bottomTitle = horiz ? (ySpec.title || item.xTitle) : (xSpec.title || item.xTitle);
  // the x labels turn (-45°) when they do not fit flat, rather than thinning out; a label angle set by hand is kept
  const angleSet = !horiz ? Math.max(-90, Math.min(90, Number(xSpec.labelAngle) || 0)) : 0;
  const layoutAt = (angle) => {
    const sin = Math.abs(Math.sin(angle * Math.PI / 180)), cos = Math.abs(Math.cos(angle * Math.PI / 180));
    const catBand = angle ? Math.min(catW, (bottom - top) * 0.4) * sin + fs * cos + fs * 0.8 : fs * 1.8;
    const plotTop = top + fs * 0.6 + (horiz && hasY2 ? fs * 1.6 : 0);
    const plotBottom = bottom - (horiz ? fs * 1.6 : catBand) - (bottomTitle ? fs * 1.6 : 0);
    const opt = { len: horiz ? W * 0.6 : plotBottom - plotTop, fs, lc, who, percent: stackMode === 'percent' };
    const ax = [
      valueAxis(ySpec, rng[0].lo, rng[0].hi, rng[0].minPos, { ...opt, includeZero: !rng[0].allFin || !rng[0].any, fmt: fmt1, name: 'y', autoFmt: auto(ySpec, item.valueFormat) }),
      valueAxis(y2Spec, rng[1].lo, rng[1].hi, rng[1].minPos, { ...opt, includeZero: !rng[1].allFin, fmt: fmt2, name: 'secondary y', autoFmt: auto(y2Spec, ySpec.format, item.valueFormat) }),
    ];
    const valW = Math.max(10, ...ax[0].ticks.map(t => m.width(ax[0].fmt(t), font, fs)));
    const valW2 = hasY2 ? Math.max(10, ...ax[1].ticks.map(t => m.width(ax[1].fmt(t), font, fs))) : 0;
    const left = X + 4 + (leftTitle ? fs * 1.6 : 0) + (horiz ? Math.min(catW, W * 0.32) : valW) + 6;
    const right = X + W - 6 - (!horiz && hasY2 ? valW2 + 6 + (y2Spec.title ? fs * 1.6 : 0) : 0);
    return { angle, sin, cos, catBand, plotTop, plotBottom, ax, valW, valW2, left, right };
  };
  let lay = layoutAt(angleSet);
  if (!horiz && xSpec.labelAngle == null && catW + 6 > (lay.right - lay.left) / Math.max(1, n)) lay = layoutAt(-45);
  const { angle, sin, cos, catBand, plotTop, plotBottom, ax, valW, valW2, left, right } = lay;
  for (const r of S) if (ax[r.axis].log && r.pts.some(p => p && !r.fin && p.b <= 0)) { lc.warn(`${who}: values of 0 or less cannot be drawn on a logarithmic axis`); break; }
  if (bottomTitle) text(bottomTitle, (left + right) / 2, bottom - 2, { align: 'center', color: '#6b7280' });
  const midY = (plotTop + plotBottom) / 2;
  if (leftTitle) text(leftTitle, X + 4 + fs, midY, { align: 'center', color: '#6b7280', maxW: plotBottom - plotTop, rotate: { a: -90, cx: X + 4 + fs, cy: midY } });
  if (hasY2 && y2Spec.title) {
    if (horiz) text(y2Spec.title, (left + right) / 2, top + fs, { align: 'center', color: '#6b7280' });
    else text(y2Spec.title, X + W - 4 - fs, midY, { align: 'center', color: '#6b7280', maxW: plotBottom - plotTop, rotate: { a: 90, cx: X + W - 4 - fs, cy: midY } });
  }

  /** Position of a value on an axis: x in a bar chart, y otherwise. Outside the axis it is pinned to the edge. */
  const vpos = (ai, v) => {
    let fr = ax[ai].frac(v);
    fr = fr == null ? 0 : Math.max(0, Math.min(1, fr));
    const rev = (ai ? y2Spec : ySpec).reversed;
    if (horiz) return rev ? right - fr * (right - left) : left + fr * (right - left);
    return rev ? plotTop + fr * (plotBottom - plotTop) : plotBottom - fr * (plotBottom - plotTop);
  };
  const baseOf = (ai) => (ax[ai].log ? ax[ai].lo : Math.max(ax[ai].lo, Math.min(0, ax[ai].hi)));
  // a bar chart's value labels sit side by side: keep every k-th while they would touch
  const tickEvery = (a, w) => (!horiz || a.ticks.length < 2 ? 1 : Math.max(1, Math.ceil((w + 6) / (Math.abs(right - left) / (a.ticks.length - 1)))));

  // grid + value axis labels
  const e1 = tickEvery(ax[0], valW);
  ax[0].ticks.forEach((t, i) => {
    const p = vpos(0, t);
    const showGrid = ySpec.gridlines !== false;
    if (horiz) { if (showGrid) out.push({ t: 'line', x1: p, y1: plotTop, x2: p, y2: plotBottom, stroke: grid, strokeWidth: 0.5 }); if (i % e1 === 0) text(ax[0].fmt(t), p, plotBottom + fs * 1.3, { align: 'center' }); }
    else { if (showGrid) out.push({ t: 'line', x1: left, y1: p, x2: right, y2: p, stroke: grid, strokeWidth: 0.5 }); text(ax[0].fmt(t), left - 5, p + fs * 0.35, { align: 'right' }); }
  });
  if (hasY2) {
    const e2 = tickEvery(ax[1], valW2);
    ax[1].ticks.forEach((t, i) => {
      const p = vpos(1, t);
      if (y2Spec.gridlines) out.push(horiz ? { t: 'line', x1: p, y1: plotTop, x2: p, y2: plotBottom, stroke: grid, strokeWidth: 0.5, dash: [2, 2] } : { t: 'line', x1: left, y1: p, x2: right, y2: p, stroke: grid, strokeWidth: 0.5, dash: [2, 2] });
      if (horiz) { if (i % e2 === 0) text(ax[1].fmt(t), p, plotTop - fs * 0.5, { align: 'center' }); }
      else text(ax[1].fmt(t), right + 5, p + fs * 0.35);
    });
  }

  const span = horiz ? plotBottom - plotTop : right - left;
  const band = span / Math.max(1, n);
  /** The drawing position of a (fractional) category index. */
  const center = (i) => { const j = xSpec.reversed ? n - 1 - i : i; return (horiz ? plotTop : left) + band * (j + 0.5); };
  /** A point from a category position and a value position. */
  const P = (c, v) => (horiz ? { x: v, y: c } : { x: c, y: v });
  if (xSpec.gridlines) for (let i = 0; i <= n; i++) {
    const p = (horiz ? plotTop : left) + band * i;
    out.push(horiz ? { t: 'line', x1: left, y1: p, x2: right, y2: p, stroke: grid, strokeWidth: 0.5 } : { t: 'line', x1: p, y1: plotTop, x2: p, y2: plotBottom, stroke: grid, strokeWidth: 0.5 });
  }

  // bands behind the series
  for (const o of ovs) if (o.type === 'band' && o.vals.length === 2) {
    const ai = o.axisI && hasY2 ? 1 : 0;
    const p0 = vpos(ai, o.vals[0]), p1 = vpos(ai, o.vals[1]);
    const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#f59e0b';
    out.push(horiz ? { t: 'rect', x: Math.min(p0, p1), y: plotTop, w: Math.abs(p1 - p0), h: plotBottom - plotTop, fill: color + '26' }
      : { t: 'rect', x: left, y: Math.min(p0, p1), w: right - left, h: Math.abs(p1 - p0), fill: color + '26' });
    if (o.label && !g.inLegend(o)) text(String(o.label), horiz ? Math.max(p0, p1) - 2 : right - 2, horiz ? plotTop + fs : Math.min(p0, p1) + fs * 1.1, { align: 'right', color: '#92400e', size: fs * 0.9 });
  }

  const zero = vpos(0, baseOf(0));
  out.push(horiz ? { t: 'line', x1: zero, y1: plotTop, x2: zero, y2: plotBottom, stroke: '#9ca3af', strokeWidth: 0.75 }
    : { t: 'line', x1: left, y1: zero, x2: right, y2: zero, stroke: '#9ca3af', strokeWidth: 0.75 });

  // category labels (skip some when crowded; turned when the x axis has a label angle)
  if (angle) {
    const every = Math.max(1, Math.ceil(fs * 1.2 / Math.max(band * sin, 0.01)));
    const maxW = Math.max(10, (catBand - fs * cos - fs * 0.8) / Math.max(sin, 0.01));
    data.categories.forEach((c, i) => {
      if (i % every) return;
      const cx = center(i), cy = plotBottom + fs * 0.6;
      text(c, cx, cy + fs * 0.35 * cos, { align: angle < 0 ? 'right' : 'left', maxW, rotate: { a: angle, cx, cy } });
    });
    if (every > 1) lc.warn(`${who}: ${n - Math.ceil(n / every)} of ${n} category labels do not fit even turned, so they are not shown (every bar is drawn)`);
  } else {
    const every = Math.max(1, Math.ceil((horiz ? fs * 1.3 : catW + 6) / band));
    data.categories.forEach((c, i) => {
      if (i % every) return;
      if (horiz) text(c, left - 5, center(i) + fs * 0.35, { align: 'right', maxW: left - X - 8 - (leftTitle ? fs * 1.6 : 0) });
      else text(c, center(i), plotBottom + fs * 1.35, { align: 'center', maxW: band * every - 2 });
    });
    if (every > 1) lc.warn(`${who}: ${n - Math.ceil(n / every)} of ${n} category labels do not fit, so they are not shown (every bar is drawn)`);
  }

  const multi = data.series.length > 1;
  const tipOf = (r, ci, p) => {
    const head = `${data.categories[ci]}${multi ? ` · ${r.s.name}` : ''}: `;
    const fmt = r.axis && hasY2 ? ax[1].fmt : g.fmtV;
    if (r.fin) return `${head}open ${fmt(p.o)}, high ${fmt(p.h)}, low ${fmt(p.l)}, close ${fmt(p.c)}`;
    if (r.range) return `${head}${fmt(p.l)} – ${fmt(p.v)}`;
    return `${head}${fmt(p.v)}${p.pct != null ? ` (${Math.round(p.pct * 100)}%)` : ''}`;
  };
  /** Bars grow from the end that touches the baseline (the origin is a side of the bar's own box). */
  const growAnim = (rect, p0, i) => (anim === 'grow' ? { k: horiz ? 'growX' : 'growY', o: horiz ? (p0 <= rect.x + 0.01 ? 'left' : 'right') : (p0 >= rect.y + rect.h - 0.01 ? 'bottom' : 'top'), i } : anim ? { k: 'fade', i } : null);
  const fadeAnim = (i) => (anim ? { k: 'fade', i } : null);
  const pos = item.labelPosition;
  const shares = new Map();
  /** {percent} outside a 100% stack: the point's share of its series' total. */
  const share = (r, v) => {
    if (!item.labelTemplate || !/\{percent\}/i.test(String(item.labelTemplate))) return null;
    if (!shares.has(r)) { let t = 0; for (const p of r.pts) if (p) t += Math.abs(p.v || 0); shares.set(r, t); }
    const t = shares.get(r);
    return t ? v / t : null;
  };

  // areas first, then columns and candles, then lines, each in series order (a single-type chart keeps its old order)
  const order = [...S.filter(r => r.kind === 'area' && !r.fin), ...S.filter(r => r.filled && !r.fin), ...S.filter(r => r.fin), ...S.filter(r => r.kind === 'line' && !r.fin)];
  // column slots: every unstacked column series has its own, stacked ones share one per axis
  const slots = new Map();
  for (const r of S) if (r.filled && !r.fin) { const key = r.stacks ? `stack:${r.axis}` : `s${r.i}`; if (!slots.has(key)) slots.set(key, slots.size); r.slot = slots.get(key); }
  const groupW = band * 0.72;
  const bw = groupW / Math.max(1, slots.size);

  for (const r of order) {
    const s = r.s, ai = r.axis && hasY2 ? 1 : 0;
    if (r.fin) {
      const finW = Math.min(band * 0.6, 24);
      r.pts.forEach((p, ci) => {
        if (!p) return;
        const color = p.c >= p.o ? (item.upColor || '#16a34a') : (item.downColor || '#dc2626');
        const c = center(ci);
        const ph = vpos(ai, p.h), pl = vpos(ai, p.l), po = vpos(ai, p.o), pc = vpos(ai, p.c);
        const ln = (c1, v1, c2, v2, w = 1) => { const a = P(c1, v1), b = P(c2, v2); out.push(tag({ t: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, strokeWidth: w }, fadeAnim(ci))); };
        if (r.fin === 'candlestick') {
          ln(c, ph, c, pl);
          const a = Math.min(po, pc), len = Math.max(0.75, Math.abs(po - pc));
          out.push(tag(horiz ? { t: 'rect', x: a, y: c - finW / 2, w: len, h: finW, fill: color } : { t: 'rect', x: c - finW / 2, y: a, w: finW, h: len, fill: color }, fadeAnim(ci)));
        } else {
          ln(c, ph, c, pl, 1.25);
          ln(c - finW / 2, po, c, po, 1.25);
          ln(c, pc, c + finW / 2, pc, 1.25);
        }
        pointLink(ci, horiz ? { x: Math.min(ph, pl) - 2, y: c - band / 2, w: Math.abs(ph - pl) + 4, h: band } : { x: c - band / 2, y: Math.min(ph, pl) - 2, w: band, h: Math.abs(ph - pl) + 4 }, tipOf(r, ci, p));
        if (labelsOn) { const q = P(c, ph); if (horiz) label(labelText(ci, s, p.v), q.x + 3, q.y + fs * 0.35, { align: 'left' }); else label(labelText(ci, s, p.v), q.x, q.y - 3); }
      });
      continue;
    }
    if (r.filled) {
      r.pts.forEach((p, ci) => {
        if (!p) return;
        const p0 = vpos(ai, r.range || r.stacks ? p.a : baseOf(ai)), p1 = vpos(ai, p.b);
        const off = center(ci) - groupW / 2 + r.slot * bw;
        const fill = data.series.length === 1 ? pointFill(ci, s.color) : s.color;
        const rect = horiz
          ? { t: 'rect', x: Math.min(p0, p1), y: off + bw * 0.08, w: Math.abs(p1 - p0), h: bw * 0.84, fill }
          : { t: 'rect', x: off + bw * 0.08, y: Math.min(p0, p1), w: bw * 0.84, h: Math.abs(p1 - p0), fill };
        out.push(tag(rect, anim && growAnim(rect, p0, ci)));
        // the hit area spans the whole category band, so short bars are easy to click
        pointLink(ci, horiz ? { x: left, y: rect.y, w: right - left, h: rect.h } : { x: rect.x, y: plotTop, w: rect.w, h: plotBottom - plotTop }, tipOf(r, ci, p));
        if (!labelsOn) return;
        const str = labelText(ci, s, p.v, p.pct ?? share(r, p.v));
        const where = pos === 'inside' || pos === 'center' || pos === 'outside' ? pos : r.stacks ? 'center' : 'outside';
        const sz = fs * 0.9;
        const color = where === 'outside' ? ink : inkOn(fill);
        const back = horiz ? p1 < p0 : p1 > p0; // the bar runs towards the axis start (a negative value)
        if (where === 'center') label(str, rect.x + rect.w / 2, rect.y + rect.h / 2 + sz * 0.35, { color, size: sz });
        else if (where === 'inside') {
          if (horiz) label(str, back ? rect.x + 3 : rect.x + rect.w - 3, rect.y + rect.h / 2 + sz * 0.35, { align: back ? 'left' : 'right', color, size: sz });
          else label(str, rect.x + rect.w / 2, back ? rect.y + rect.h - 3 : rect.y + sz + 2, { color, size: sz });
        } else if (horiz) label(str, Math.max(p0, p1) + 3, rect.y + rect.h / 2 + fs * 0.35, { align: 'left', size: sz, alt: { x: Math.max(p0, p1) - 3, align: 'right', color: inkOn(fill) } });
        else label(str, rect.x + rect.w / 2, Math.min(p0, p1) - 3, { size: sz, alt: { y: Math.min(p0, p1) + sz + 2, color: inkOn(fill) } }); // no room outside: inside the bar
      });
      continue;
    }
    // line / area (and range bands)
    const pts = [];
    r.pts.forEach((p, ci) => { if (p) pts.push({ ...P(center(ci), vpos(ai, p.b)), base: P(center(ci), vpos(ai, r.range || r.stacks ? p.a : baseOf(ai))), v: p.v, p, ci }); });
    if (!pts.length) continue;
    const along = horiz ? 'y' : 'x';
    if (r.kind === 'area' || r.range) {
      let d;
      if (r.mode === 'straight' && !r.range) {
        const last = pts[pts.length - 1];
        d = `M ${f(pts[0].base.x)} ${f(pts[0].base.y)} ` + pts.map(q => `L ${f(q.x)} ${f(q.y)}`).join(' ') + ` L ${f(last.base.x)} ${f(last.base.y)} ` + [...pts].reverse().map(q => `L ${f(q.base.x)} ${f(q.base.y)}`).join(' ') + ' Z';
      } else {
        d = curvePath(pts, r.mode, { along }) + ' ' + curvePath([...pts].reverse().map(q => q.base), r.mode, { along, move: false }) + ' Z';
      }
      out.push(tag({ t: 'path', x: 0, y: 0, d, fill: s.color + '40', stroke: null }, fadeAnim(r.i)));
      if (r.range) out.push(tag({ t: 'path', x: 0, y: 0, d: curvePath(pts.map(q => q.base), r.mode, { along }), fill: null, stroke: s.color, strokeWidth: 1 }, fadeAnim(r.i)));
    }
    out.push(tag({ t: 'path', x: 0, y: 0, d: curvePath(pts, r.mode, { along }), fill: null, stroke: s.color, strokeWidth: r.range ? 1 : 1.6 }, fadeAnim(r.i)));
    if (r.kind === 'line' && !r.range && pts.length <= 40) for (const q of pts) out.push(tag({ t: 'ellipse', cx: q.x, cy: q.y, rx: 2, ry: 2, fill: '#ffffff', stroke: s.color, strokeWidth: 1.2 }, fadeAnim(q.ci)));
    for (const q of pts) pointLink(q.ci, horiz ? { x: left, y: q.y - band / 2, w: right - left, h: band } : { x: q.x - band / 2, y: plotTop, w: band, h: plotBottom - plotTop }, tipOf(r, q.ci, q.p));
    if (labelsOn) for (const q of pts) {
      const str = labelText(q.ci, s, q.v, q.p.pct ?? share(r, q.v));
      const sz = fs * 0.85;
      if (horiz) label(str, q.x + 4, q.y - 3, { align: 'left', size: sz, alt: q.y + sz + 3 });
      else if (pos === 'center' || pos === 'inside') label(str, q.x, q.y + sz * 0.35, { size: sz });
      else label(str, q.x, q.y - 4, { size: sz, alt: q.y + sz + 4 });
    }
  }

  // reference lines, trend lines and moving averages on top
  for (const o of ovs) {
    if (o.type === 'band') continue;
    const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : o.type === 'line' ? '#dc2626' : '#475569';
    if (o.type === 'line') {
      const ai = o.axisI && hasY2 ? 1 : 0;
      for (const v of o.vals) {
        const p = vpos(ai, v);
        out.push(horiz ? { t: 'line', x1: p, y1: plotTop, x2: p, y2: plotBottom, stroke: color, strokeWidth: 1, dash: [4, 3] } : { t: 'line', x1: left, y1: p, x2: right, y2: p, stroke: color, strokeWidth: 1, dash: [4, 3] });
        if (o.label) {
          const s = `${o.label}${o.showValue === false ? '' : ` ${ax[ai].fmt(v)}`}`;
          if (horiz) text(s, p + 2, plotTop + fs, { color, size: fs * 0.9 }); else text(s, right - 2, p - 2.5, { align: 'right', color, size: fs * 0.9 });
        }
      }
      continue;
    }
    if (o.type !== 'trend' && o.type !== 'movingAverage') continue;
    const r = S[Math.max(0, Math.min(S.length - 1, Math.floor(Number(o.series)) || 0))];
    if (!r) continue;
    const ai = r.axis && hasY2 ? 1 : 0;
    const vals = r.pts.map(p => (p ? (r.fin ? p.c : p.b) : null));
    const pts = [];
    if (o.type === 'movingAverage') {
      movingAverage(vals, o.period ?? 3).forEach((v, ci) => { if (v != null) pts.push(P(center(ci), vpos(ai, v))); });
    } else {
      const kind = o.kind === 'exp' || o.kind === 'poly' ? o.kind : 'linear';
      const fit = fitTrend(vals.map((v, ci) => [ci, v]).filter(([, v]) => v != null), kind, o.order);
      if (!fit) { lc.warn(`${who}: not enough values for the ${kind} trend line`); continue; }
      const steps = kind === 'linear' ? 1 : Math.min(60, Math.max(2, n * 4));
      for (let i = 0; i <= steps; i++) { const ci = (n - 1) * (i / steps); const v = fit.at(ci); if (Number.isFinite(v)) pts.push(P(center(ci), vpos(ai, v))); }
    }
    if (pts.length < 2) continue;
    out.push({ t: 'path', x: 0, y: 0, d: curvePath(pts, 'straight'), fill: null, stroke: color, strokeWidth: 1.2, ...(o.type === 'trend' ? { dash: [4, 3] } : {}) });
    if (o.label && !g.inLegend(o)) { const e = pts[pts.length - 1]; if (horiz) text(String(o.label), e.x + 3, e.y + fs * 0.35, { color, size: fs * 0.9 }); else text(String(o.label), Math.min(e.x, right) - 2, e.y - 4, { align: 'right', color, size: fs * 0.9 }); }
  }
}

/* ---------------------------------------------------------------- scatter, bubble, polar (one point per row) */

/**
 * The robust window of a set of values: its 1st and 99th percentiles (nearest rank). extreme: the full spread is more
 * than five times that window, so a few outliers would flatten the rest of the data.
 * @param {number[]} vals
 */
export function robustWindow(vals) {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length < 2) return null;
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
  const p1 = at(0.01), p99 = at(0.99);
  return { p1, p99, extreme: p99 > p1 && s[s.length - 1] - s[0] > 5 * (p99 - p1) };
}

function rowPoints(type, g) {
  const { item, ctx, lc, data, who } = g;
  const c = { ...ctx };
  // the cap is for the whole chart: every series evaluates every row
  const cap = Math.max(1, Math.floor(CAPS.points / Math.max(1, data.series.length)));
  let rows = data.rows;
  if (rows.length > cap) { lc.warn(`${who}: ${rows.length} rows; only the first ${cap} points are drawn`); rows = rows.slice(0, cap); }
  // a blank x or y is not a zero: Number(null) and Number('') are 0, which would draw the row on the axis
  const blank = (v) => v == null || v === '';
  const missing = new Set(); // rows (of this chart) with no x or y for any series, counted once
  const sets = data.series.map((s, si) => {
    const pts = [];
    rows.forEach((r, ri) => {
      c.fields = r;
      const rx = safe(item.xValue, c, lc, who), ry = safe(s.def.value || '=0', { ...c, aggRows: [r] }, lc, who);
      if (blank(rx) || blank(ry)) { missing.add(ri); return; }
      const x = Number(rx), y = Number(ry);
      if (!Number.isFinite(x) || !Number.isFinite(y)) { missing.add(ri); return; }
      let size = 1;
      if (type === 'bubble') { size = Number(safe(s.def.size || '=1', { ...c, aggRows: [r] }, lc, who)); if (!Number.isFinite(size) || size <= 0) return; }
      pts.push({ x, y, size });
    });
    return { s, pts, i: si };
  });
  if (missing.size) lc.warn(`${who}: ${missing.size} of ${rows.length} rows have no x or y value and are not drawn`);
  return sets;
}

function paintXY(type, g) {
  const { item, ctx, lc, out, X, W, top, bottom, fs, font, text, label, labelsOn, axes, who, grid, anim } = g;
  const sets = rowPoints(type, g);
  g.xy = sets; // the points, for a native Excel chart (paintChart)
  if (!sets.some(x => x.pts.length)) { text('No data', X + W / 2, (top + bottom) / 2, { align: 'center', color: '#9ca3af' }); return; }
  if (type === 'polar') { paintPolar(g, sets); return; }
  let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity, xmp = Infinity, ymp = Infinity, smax = 0;
  for (const st of sets) for (const p of st.pts) {
    xlo = Math.min(xlo, p.x); xhi = Math.max(xhi, p.x); ylo = Math.min(ylo, p.y); yhi = Math.max(yhi, p.y); smax = Math.max(smax, p.size);
    if (p.x > 0) xmp = Math.min(xmp, p.x);
    if (p.y > 0) ymp = Math.min(ymp, p.y);
  }
  const xs = axes.x || {}, ys = axes.y || {};
  const fmtY = (v) => toText(v, ys.format || item.valueFormat || 'N0', ctx);
  const fmtX = (v) => toText(v, xs.format || item.xFormat || 'N0', ctx);
  // outliers: 'clip' draws the axes on the 1st-99th percentiles and marks the points beyond them; 'none' keeps the full
  // range. Unset: 'clip' only where the spread is extreme (see robustWindow), else 'none'.
  const allX = sets.flatMap(st => st.pts.map(p => p.x)), allY = sets.flatMap(st => st.pts.map(p => p.y));
  const wx = robustWindow(allX), wy = robustWindow(allY);
  // ponytail: 20 points before the default clips; a percentile of a handful of points clips real data
  const clipOn = item.outliers === 'clip' || (item.outliers !== 'none' && allX.length >= 20 && !!(wx?.extreme || wy?.extreme));
  const clipX = clipOn && wx ? { lo: wx.p1, hi: wx.p99 } : null, clipY = clipOn && wy ? { lo: wy.p1, hi: wy.p99 } : null;
  const beyond = (p) => (clipX && (p.x < clipX.lo || p.x > clipX.hi)) || (clipY && (p.y < clipY.lo || p.y > clipY.hi));
  const clipped = clipOn ? sets.reduce((k, st) => k + st.pts.filter(beyond).length, 0) : 0;
  if (clipped) lc.warn(`${who}: ${clipped} of ${allX.length} points are outside the 1st-99th percentile range and are drawn at the edge (set outliers: 'none' to show the full range)`);
  if (clipX) { xlo = clipX.lo; xhi = clipX.hi; }
  if (clipY) { ylo = clipY.lo; yhi = clipY.hi; }
  // as before: scatter axes are nice scales of the data, not forced through 0
  const ay = valueAxis(ys, ylo, yhi, ymp, { includeZero: false, pad: 0.05, len: bottom - top, fs, fmt: fmtY, lc, who, name: 'y' });
  const axx = valueAxis(xs, xlo, xhi, xmp, { includeZero: false, pad: 0.05, len: W, fs, fmt: fmtX, lc, who, name: 'x' });
  const leftTitle = ys.title, bottomTitle = xs.title || item.xTitle;
  const left = X + 10 + (leftTitle ? fs * 1.6 : 0) + Math.max(...ay.ticks.map(t => lc.m.width(fmtY(t), font, fs)));
  const right = X + W - 6, pb = bottom - fs * 1.8 - (bottomTitle ? fs * 1.6 : 0), pt = top + fs * 0.6;
  // bubbles keep inside the plot: the scale is laid out on a plot inset by the largest radius
  const maxR = Math.max(4, Math.min(right - left, pb - pt) / 12);
  const ins = type === 'bubble' ? maxR : 0;
  const clamp = (v) => Math.max(0, Math.min(1, v ?? 0));
  const px = (v) => { const fr = clamp(axx.frac(v)); return xs.reversed ? right - ins - fr * (right - left - 2 * ins) : left + ins + fr * (right - left - 2 * ins); };
  const py = (v) => { const fr = clamp(ay.frac(v)); return ys.reversed ? pt + ins + fr * (pb - pt - 2 * ins) : pb - ins - fr * (pb - pt - 2 * ins); };
  if (bottomTitle) text(bottomTitle, (left + right) / 2, bottom - 2, { align: 'center', color: '#6b7280' });
  if (leftTitle) text(leftTitle, X + 4 + fs, (pt + pb) / 2, { align: 'center', color: '#6b7280', rotate: { a: -90, cx: X + 4 + fs, cy: (pt + pb) / 2 } });
  for (const t of ay.ticks) { if (ys.gridlines !== false) out.push({ t: 'line', x1: left, y1: py(t), x2: right, y2: py(t), stroke: grid, strokeWidth: 0.5 }); text(fmtY(t), left - 5, py(t) + fs * 0.35, { align: 'right' }); }
  const tw = Math.max(...axx.ticks.map(t => lc.m.width(fmtX(t), font, fs)));
  const every = Math.max(1, Math.ceil((tw + 6) / (Math.abs(right - left) / Math.max(1, axx.ticks.length - 1))));
  axx.ticks.forEach((t, i) => {
    if (xs.gridlines) out.push({ t: 'line', x1: px(t), y1: pt, x2: px(t), y2: pb, stroke: grid, strokeWidth: 0.5 });
    if (i % every === 0) text(fmtX(t), px(t), pb + fs * 1.35, { align: 'center' });
  });
  out.push({ t: 'line', x1: left, y1: pb, x2: right, y2: pb, stroke: '#9ca3af', strokeWidth: 0.75 });
  const overlays = overlaysOf(item, lc, who);
  for (const o of overlays) if (o.type === 'band') {
    const v = overlayValues(o, g); if (v.length !== 2) continue;
    out.push({ t: 'rect', x: left, y: Math.min(py(v[0]), py(v[1])), w: right - left, h: Math.abs(py(v[0]) - py(v[1])), fill: (/^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : '#f59e0b') + '26' });
  }
  const multi = sets.length > 1;
  for (const { s, pts, i: si } of sets) {
    const col = s.color || g.pal[si % g.pal.length];
    // bubbles: area ∝ size; big ones first so the small ones stay visible on top
    const list = type === 'bubble' ? [...pts].sort((a, b) => b.size - a.size) : pts;
    list.forEach((p, j) => {
      const r = type === 'bubble' ? Math.max(1.5, maxR * Math.sqrt(p.size / smax)) : 2.2;
      const e = type === 'bubble' ? { t: 'ellipse', cx: px(p.x), cy: py(p.y), rx: r, ry: r, fill: col + '99', stroke: col, strokeWidth: 0.75 } : { t: 'ellipse', cx: px(p.x), cy: py(p.y), rx: r, ry: r, fill: col + 'b3', stroke: null };
      out.push(tag(e, anim && { k: anim === 'grow' ? 'scale' : 'fade', i: j }));
      const isClipped = clipped && beyond(p);
      if (isClipped) out.push({ t: 'ellipse', cx: e.cx, cy: e.cy, rx: r + 1.6, ry: r + 1.6, fill: 'none', stroke: col, strokeWidth: 0.9 });
      if (item.tooltips !== false && (type === 'bubble' || multi || isClipped)) g.links.push({ t: 'link', x: e.cx - r, y: e.cy - r, w: r * 2, h: r * 2, action: null, tip: `${multi ? `${s.name}: ` : ''}${fmtX(p.x)}, ${fmtY(p.y)}${type === 'bubble' ? ` (${toText(p.size, null, ctx)})` : ''}${isClipped ? ' (outlier, drawn at the edge)' : ''}` });
      if (labelsOn) {
        const str = item.labelTemplate ? String(item.labelTemplate).slice(0, 500).replace(/\{(\w+)\}/g, (all, k) => ({ value: fmtY(p.y), x: fmtX(p.x), series: s.name, size: toText(p.size, null, ctx) })[k.toLowerCase()] ?? all) : fmtY(p.y);
        label(str, e.cx, e.cy - r - 2, { size: fs * 0.85 });
      }
    });
  }
  for (const o of overlays) {
    const color = /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : o.type === 'line' ? '#dc2626' : '#475569';
    if (o.type === 'line') {
      for (const v of overlayValues(o, g)) {
        out.push({ t: 'line', x1: left, y1: py(v), x2: right, y2: py(v), stroke: color, strokeWidth: 1, dash: [4, 3] });
        if (o.label) text(`${o.label} ${fmtY(v)}`, right - 2, py(v) - 2.5, { align: 'right', color, size: fs * 0.9 });
      }
    } else if (o.type === 'trend') {
      const set = sets[Math.max(0, Math.min(sets.length - 1, Math.floor(Number(o.series)) || 0))];
      const kind = o.kind === 'exp' || o.kind === 'poly' ? o.kind : 'linear';
      const fit = fitTrend(set.pts.map(p => [p.x, p.y]), kind, o.order);
      if (!fit) { lc.warn(`${who}: not enough values for the ${kind} trend line`); continue; }
      const steps = 60; // sampled, so a line that leaves the plot is cut where it leaves
      const pts = [];
      for (let i = 0; i <= steps; i++) { const x = axx.lo + (axx.hi - axx.lo) * i / steps; const y = fit.at(x); if (Number.isFinite(y) && y >= ay.lo && y <= ay.hi) pts.push({ x: px(x), y: py(y) }); }
      if (pts.length > 1) {
        out.push({ t: 'path', x: 0, y: 0, d: curvePath(pts, 'straight'), fill: null, stroke: color, strokeWidth: 1.2, dash: [4, 3] });
        if (o.label && !g.inLegend(o)) text(String(o.label), pts[pts.length - 1].x - 2, pts[pts.length - 1].y - 4, { align: 'right', color, size: fs * 0.9 });
      }
    }
  }
}

/** Polar: angle (degrees, 0 at the top, clockwise) from xValue, radius from the series value. */
function paintPolar(g, sets) {
  const { item, ctx, out, X, W, top, bottom, fs, text, grid, axes, lc, who, anim } = g;
  const cx = X + W / 2, cy = (top + bottom) / 2;
  const R = Math.max(6, Math.min(W, bottom - top) / 2 - fs * 2);
  let hi = 0, lo = 0;
  for (const st of sets) for (const p of st.pts) { hi = Math.max(hi, p.y); lo = Math.min(lo, p.y); }
  const fmtY = (v) => toText(v, axes.y?.format || item.valueFormat || 'N0', ctx);
  const ay = valueAxis(axes.y, lo, hi, Infinity, { includeZero: true, len: R * 2, fs, fmt: fmtY, lc, who, name: 'radius' });
  const rad = (v) => Math.max(0, Math.min(1, ay.frac(v) ?? 0)) * R;
  const at = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }; };
  for (const t of ay.ticks) { const r = rad(t); if (r > 0) out.push({ t: 'ellipse', cx, cy, rx: r, ry: r, fill: null, stroke: grid, strokeWidth: 0.5 }); }
  for (let d = 0; d < 360; d += 45) {
    const e = at(d, R), l = at(d, R + fs * 0.9);
    out.push({ t: 'line', x1: cx, y1: cy, x2: e.x, y2: e.y, stroke: grid, strokeWidth: 0.5 });
    text(`${d}°`, l.x, l.y + fs * 0.35, { align: Math.abs(l.x - cx) < 1 ? 'center' : l.x > cx ? 'left' : 'right', size: fs * 0.85, color: '#6b7280' });
  }
  for (const t of ay.ticks) if (rad(t) > 0 && rad(t) < R - 0.5) text(fmtY(t), cx + 3, cy - rad(t) + fs * 0.3, { size: fs * 0.8, color: '#6b7280' });
  for (const { s, pts, i } of sets) {
    const q = pts.map(p => ({ ...at(p.x, rad(p.y)), p }));
    if (s.def.type === 'line' || s.def.type === 'area') {
      const deg = (e) => ((e.p.x % 360) + 360) % 360;
      const sorted = [...q].sort((a, b) => deg(a) - deg(b));
      if (sorted.length > 1) out.push(tag({ t: 'path', x: 0, y: 0, d: curvePath(sorted, 'straight') + (s.def.type === 'area' ? ' Z' : ''), fill: s.def.type === 'area' ? s.color + '33' : null, stroke: s.color, strokeWidth: 1.4 }, anim && { k: 'fade', i }));
    }
    for (const e of q) {
      out.push(tag({ t: 'ellipse', cx: e.x, cy: e.y, rx: 2.4, ry: 2.4, fill: s.color, stroke: '#ffffff', strokeWidth: 0.5 }, anim && { k: 'fade', i }));
      if (item.tooltips !== false) g.links.push({ t: 'link', x: e.x - 3, y: e.y - 3, w: 6, h: 6, action: null, tip: `${sets.length > 1 ? `${s.name}: ` : ''}${toText(e.p.x, 'N0', ctx)}°, ${fmtY(e.p.y)}` });
    }
  }
}
