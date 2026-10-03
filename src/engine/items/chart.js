// @ts-check
/**
 * Charts drawn as page-model primitives (rect, line, path, text), so every
 * renderer and exporter supports them with no extra code.
 */
import { evalValue, toText } from '../expr/evaluate.js';
import { resolveFontKey } from '../text/fonts.js';
import { applyFilters, applySort } from '../data/index.js';

export const PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#64748b', '#f97316'];
export const CHART_TYPES = ['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter'];

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

function safe(v, ctx, lc, who) {
  try { return evalValue(v, ctx); } catch (e) { lc.warn(`${who}: ${e.message}`); return null; }
}
const keyOf = (k) => (k instanceof Date ? `d${k.getTime()}` : `${typeof k}:${k}`);

/** Categories × series values from the data. */
export function chartData(item, ctx, lc) {
  let rows = item.dataSet ? lc.dataSets[item.dataSet] || [] : ctx.aggRows || [];
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
  let cats = bucket(rows, item.category);
  if (item.categorySort === 'asc' || item.categorySort === 'desc') {
    const d = item.categorySort === 'desc' ? -1 : 1;
    cats.sort((a, b) => (a.key instanceof Date ? a.key.getTime() : a.key) > (b.key instanceof Date ? b.key.getTime() : b.key) ? d : -d);
  }
  if (item.maxCategories > 0) cats = cats.slice(0, item.maxCategories);
  const defs = item.series?.length ? item.series : [{ name: 'Value', value: '=Count(Fields)' }];
  const agg = (rs, expr) => {
    if (!rs.length) return null;
    const v = safe(expr, { ...ctx, fields: rs[0], aggRows: rs, aggIndex: undefined }, lc, who);
    return v == null || v === '' ? null : Number(v);
  };
  const labelOf = (k) => toText(k, item.categoryFormat || (k instanceof Date ? 'MMM yyyy' : null), ctx);
  const series = [];
  if (item.seriesGroup) {
    const groups = bucket(rows, item.seriesGroup).sort((a, b) => String(a.key).localeCompare(String(b.key)));
    let ci = 0;
    for (const g of groups) for (const sd of defs) {
      const set = new Set(g.rows);
      series.push({ name: defs.length > 1 ? `${toText(g.key, null, ctx)} · ${sd.name}` : toText(g.key, null, ctx), color: PALETTE[ci++ % PALETTE.length],
        values: cats.map(cat => agg(cat.rows.filter(r => set.has(r)), sd.value)) });
    }
  } else {
    defs.forEach((sd, i) => series.push({ name: sd.name || `Series ${i + 1}`, color: sd.color || PALETTE[i % PALETTE.length], values: cats.map(cat => agg(cat.rows, sd.value)) }));
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
  const out = [];
  const text = (s, x, y, { size = fs, f = font, color = ink, align = 'left', maxW = 9999 } = {}) => {
    let str = String(s);
    if (m.width(str, f, size) > maxW) str = m.ellipsize(str, f, size, maxW);
    const w = m.width(str, f, size);
    const lx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    out.push({ t: 'text', font: f, size, color, lines: [{ x: lx, y, text: str, w }] });
    return w;
  };
  if (item.background) out.push({ t: 'rect', x: X, y: 0, w: W, h: H, fill: item.background });

  const data = chartData(item, ctx, lc);
  const type = CHART_TYPES.includes(item.chartType) ? item.chartType : 'column';
  // Interactivity per point: pointAction (any action, usually "params" to filter the report), pointColor and tooltips.
  // The point's scope is its category: Fields = first row, aggregates over the category's rows.
  const links = [];
  const pointCtx = (ci) => { const b = data.buckets[ci]; return { ...ctx, fields: b?.rows[0] || null, aggRows: b?.rows || [], aggIndex: undefined }; };
  const pointFill = (ci, fallback) => { if (!item.pointColor) return fallback; const v = safe(item.pointColor, pointCtx(ci), lc, item.name || 'Chart'); return v ? String(v) : fallback; };
  const pointLink = (ci, rect, tip, d) => {
    let l = item.pointAction ? lc.linkFor({ action: item.pointAction, name: item.name }, pointCtx(ci), rect) : null;
    if (!l && item.tooltips === false) return;
    if (!l) l = { t: 'link', ...rect, action: null };
    if (tip && item.tooltips !== false) l.tip = tip;
    if (d) { l.d = d; l.x0 = rect.x; l.y0 = rect.y; }
    links.push(l);
  };
  let top = 4, bottom = H - 4;
  const title = item.title ? String(safe(item.title, ctx, lc, item.name) ?? '') : '';
  if (title) { text(title, X + 4, top + fs * 1.4, { size: fs * 1.35, f: bold, color: '#111827', maxW: W - 8 }); top += fs * 2.1; }

  // legend at the bottom
  const pie = type === 'pie' || type === 'donut';
  const legendItems = pie ? data.categories.map((c, i) => ({ name: c, color: pointFill(i, PALETTE[i % PALETTE.length]) })) : data.series.map(s => ({ name: s.name, color: s.color }));
  if (item.legend !== 'none' && (pie || data.series.length > 1)) {
    const rowsL = [];
    let line = [], lw = 0;
    for (const li of legendItems) {
      const w = 10 + m.width(li.name, font, fs) + 12;
      if (lw + w > W - 8 && line.length) { rowsL.push(line); line = []; lw = 0; }
      line.push({ ...li, w }); lw += w;
    }
    if (line.length) rowsL.push(line);
    const lh = fs * 1.6;
    bottom -= rowsL.length * lh;
    rowsL.forEach((ln, ri) => {
      let lx = X + (W - ln.reduce((s, l) => s + l.w, 0)) / 2;
      const ly = bottom + ri * lh + lh * 0.75;
      for (const l of ln) {
        out.push({ t: 'rect', x: lx, y: ly - fs * 0.75, w: 7, h: 7, fill: l.color, radius: 1.5 });
        text(l.name, lx + 10, ly, { maxW: l.w - 10 });
        lx += l.w;
      }
    });
    bottom -= 4;
  }
  if (!data.categories.length && type !== 'scatter') {
    text('No data', X + W / 2, (top + bottom) / 2, { align: 'center', color: '#9ca3af' });
    return out;
  }

  const fmtV = (v) => toText(v, item.valueFormat || 'N0', ctx);

  if (pie) {
    const vals = (data.series[0]?.values || []).map(v => Math.max(0, v || 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = X + W / 2, cy = (top + bottom) / 2;
    const r = Math.max(4, Math.min(W, bottom - top) / 2 - 6);
    const ri = type === 'donut' ? r * 0.58 : 0;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      if (v > 0) {
        const d = arc(cx, cy, r, ri, a0, Math.min(a1, a0 + Math.PI * 2 - 1e-4));
        out.push({ t: 'path', x: 0, y: 0, d, fill: pointFill(i, PALETTE[i % PALETTE.length]), stroke: '#ffffff', strokeWidth: 0.75 });
        pointLink(i, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, `${data.categories[i]}: ${fmtV(v)} (${Math.round((v / total) * 100)}%)`, d);
      }
      const mid = (a0 + a1) / 2, frac = v / total;
      if (frac >= 0.05 && item.showValues !== false) {
        const lr = ri ? (r + ri) / 2 : r * 0.62;
        text(`${Math.round(frac * 100)}%`, cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr + fs * 0.35, { align: 'center', color: '#ffffff', f: bold });
      }
      a0 = a1;
    });
    if (type === 'donut' && item.centerText !== false) {
      text(fmtV(total), cx, cy + fs * 0.45, { align: 'center', size: fs * 1.4, f: bold, color: '#111827' });
    }
    return out.concat(links);
  }

  const stacked = !!item.stacked && (type === 'column' || type === 'bar' || type === 'area');
  if (type === 'scatter') return paintScatter(item, ctx, lc, data, out, { X, W, top, bottom, fs, font, text, fmtV, grid, ink });

  // value range
  let vmin = 0, vmax = 0;
  if (stacked) {
    data.categories.forEach((_, ci) => {
      let pos = 0, neg = 0;
      for (const s of data.series) { const v = s.values[ci] || 0; if (v >= 0) pos += v; else neg += v; }
      vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg);
    });
  } else for (const s of data.series) for (const v of s.values) if (v != null) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
  const sc = niceScale(vmin, vmax, 5);
  const ticks = [];
  for (let v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) ticks.push(Math.round(v * 1e9) / 1e9);

  const horiz = type === 'bar';
  const catW = Math.max(...data.categories.map(c => m.width(c, font, fs)), 10);
  const valW = Math.max(...ticks.map(t => m.width(fmtV(t), font, fs)), 10);
  const left = X + 4 + (horiz ? Math.min(catW, W * 0.32) : valW) + 6;
  const right = X + W - 6;
  const plotBottom = bottom - (horiz ? fs * 1.6 : fs * 1.8) - (item.xTitle ? fs * 1.6 : 0);
  const plotTop = top + fs * 0.6;
  if (item.xTitle) text(item.xTitle, (left + right) / 2, bottom - 2, { align: 'center', color: '#6b7280' });

  const vpos = horiz
    ? (v) => left + ((v - sc.lo) / (sc.hi - sc.lo)) * (right - left)
    : (v) => plotBottom - ((v - sc.lo) / (sc.hi - sc.lo)) * (plotBottom - plotTop);
  // grid + value axis labels
  for (const t of ticks) {
    const p = vpos(t);
    if (horiz) { out.push({ t: 'line', x1: p, y1: plotTop, x2: p, y2: plotBottom, stroke: grid, strokeWidth: 0.5 }); text(fmtV(t), p, plotBottom + fs * 1.3, { align: 'center' }); }
    else { out.push({ t: 'line', x1: left, y1: p, x2: right, y2: p, stroke: grid, strokeWidth: 0.5 }); text(fmtV(t), left - 5, p + fs * 0.35, { align: 'right' }); }
  }
  const zero = vpos(Math.max(sc.lo, Math.min(0, sc.hi)));
  out.push(horiz ? { t: 'line', x1: zero, y1: plotTop, x2: zero, y2: plotBottom, stroke: '#9ca3af', strokeWidth: 0.75 }
    : { t: 'line', x1: left, y1: zero, x2: right, y2: zero, stroke: '#9ca3af', strokeWidth: 0.75 });

  const n = data.categories.length;
  const span = horiz ? plotBottom - plotTop : right - left;
  const band = span / n;
  const center = (i) => (horiz ? plotTop : left) + band * (i + 0.5);
  // category labels (skip some when crowded)
  const every = Math.max(1, Math.ceil((horiz ? fs * 1.3 : catW + 6) / band));
  data.categories.forEach((c, i) => {
    if (i % every) return;
    if (horiz) text(c, left - 5, center(i) + fs * 0.35, { align: 'right', maxW: left - X - 8 });
    else text(c, center(i), plotBottom + fs * 1.35, { align: 'center', maxW: band * every - 2 });
  });

  if (type === 'column' || type === 'bar') {
    const groupW = band * 0.72;
    const k = stacked ? 1 : data.series.length;
    const bw = groupW / k;
    const posAcc = new Array(n).fill(0), negAcc = new Array(n).fill(0);
    data.series.forEach((s, si) => {
      s.values.forEach((v, ci) => {
        if (v == null) return;
        let a, b;
        if (stacked) { const base0 = v >= 0 ? posAcc[ci] : negAcc[ci]; a = base0; b = base0 + v; if (v >= 0) posAcc[ci] = b; else negAcc[ci] = b; }
        else { a = 0; b = v; }
        const p0 = vpos(a), p1 = vpos(b);
        const off = center(ci) - groupW / 2 + (stacked ? 0 : si * bw);
        const rect = horiz
          ? { t: 'rect', x: Math.min(p0, p1), y: off + bw * 0.08, w: Math.abs(p1 - p0), h: bw * 0.84, fill: data.series.length === 1 ? pointFill(ci, s.color) : s.color }
          : { t: 'rect', x: off + bw * 0.08, y: Math.min(p0, p1), w: bw * 0.84, h: Math.abs(p1 - p0), fill: data.series.length === 1 ? pointFill(ci, s.color) : s.color };
        out.push(rect);
        // the hit area spans the whole category band, so short bars are easy to click
        const hit = horiz ? { x: left, y: rect.y, w: right - left, h: rect.h } : { x: rect.x, y: plotTop, w: rect.w, h: plotBottom - plotTop };
        pointLink(ci, hit, `${data.categories[ci]}${data.series.length > 1 ? ` · ${s.name}` : ''}: ${fmtV(v)}`);
        if (item.showValues && !stacked) {
          if (horiz) text(fmtV(v), Math.max(p0, p1) + 3, rect.y + rect.h / 2 + fs * 0.35, { size: fs * 0.9 });
          else text(fmtV(v), rect.x + rect.w / 2, Math.min(p0, p1) - 3, { align: 'center', size: fs * 0.9 });
        }
      });
    });
  } else {
    // line / area
    const acc = new Array(n).fill(0);
    data.series.forEach((s) => {
      const pts = [];
      s.values.forEach((v, ci) => {
        if (v == null) return;
        const base0 = stacked ? acc[ci] : 0;
        const val = stacked ? base0 + v : v;
        if (stacked) acc[ci] = val;
        pts.push({ x: center(ci), y: vpos(val), b: vpos(base0), v, ci });
      });
      if (!pts.length) return;
      if (type === 'area') {
        const d = `M ${f(pts[0].x)} ${f(pts[0].b)} ` + pts.map(p => `L ${f(p.x)} ${f(p.y)}`).join(' ') + ` L ${f(pts[pts.length - 1].x)} ${f(pts[pts.length - 1].b)} ` + [...pts].reverse().map(p => `L ${f(p.x)} ${f(p.b)}`).join(' ') + ' Z';
        out.push({ t: 'path', x: 0, y: 0, d, fill: s.color + '40', stroke: null });
      }
      out.push({ t: 'path', x: 0, y: 0, d: 'M ' + pts.map(p => `${f(p.x)} ${f(p.y)}`).join(' L '), fill: null, stroke: s.color, strokeWidth: 1.6 });
      if (type === 'line' && pts.length <= 40) for (const p of pts) out.push({ t: 'ellipse', cx: p.x, cy: p.y, rx: 2, ry: 2, fill: '#ffffff', stroke: s.color, strokeWidth: 1.2 });
      for (const p of pts) pointLink(p.ci, { x: p.x - band / 2, y: plotTop, w: band, h: plotBottom - plotTop }, `${data.categories[p.ci]}${data.series.length > 1 ? ` · ${s.name}` : ''}: ${fmtV(p.v)}`);
      if (item.showValues) for (const p of pts) text(fmtV(p.v), p.x, p.y - 4, { align: 'center', size: fs * 0.85 });
    });
  }
  return out.concat(links);
}

function paintScatter(item, ctx, lc, data, out, g) {
  const { X, W, top, bottom, fs, text, fmtV, grid } = g;
  const c = { ...ctx };
  const pts = [];
  for (const r of data.rows) {
    c.fields = r;
    const x = Number(safe(item.xValue, c, lc, item.name)), y = Number(safe(item.series?.[0]?.value || '=0', { ...c, aggRows: [r] }, lc, item.name));
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  if (!pts.length) { text('No data', X + W / 2, (top + bottom) / 2, { align: 'center', color: '#9ca3af' }); return out; }
  const sx = niceScale(Math.min(...pts.map(p => p.x)), Math.max(...pts.map(p => p.x)), 5);
  const sy = niceScale(Math.min(...pts.map(p => p.y)), Math.max(...pts.map(p => p.y)), 5);
  const ticksY = []; for (let v = sy.lo; v <= sy.hi + sy.step / 2; v += sy.step) ticksY.push(v);
  const ticksX = []; for (let v = sx.lo; v <= sx.hi + sx.step / 2; v += sx.step) ticksX.push(v);
  const left = X + 10 + Math.max(...ticksY.map(t => lc.m.width(fmtV(t), g.font, fs)));
  const right = X + W - 6, pb = bottom - fs * 1.8, pt = top + fs * 0.6;
  const px = (v) => left + ((v - sx.lo) / (sx.hi - sx.lo)) * (right - left);
  const py = (v) => pb - ((v - sy.lo) / (sy.hi - sy.lo)) * (pb - pt);
  for (const t of ticksY) { out.push({ t: 'line', x1: left, y1: py(t), x2: right, y2: py(t), stroke: grid, strokeWidth: 0.5 }); text(fmtV(t), left - 5, py(t) + fs * 0.35, { align: 'right' }); }
  for (const t of ticksX) text(toText(t, item.xFormat || 'N0', ctx), px(t), pb + fs * 1.35, { align: 'center' });
  out.push({ t: 'line', x1: left, y1: pb, x2: right, y2: pb, stroke: '#9ca3af', strokeWidth: 0.75 });
  const col = data.series[0]?.color || PALETTE[0];
  for (const p of pts) out.push({ t: 'ellipse', cx: px(p.x), cy: py(p.y), rx: 2.2, ry: 2.2, fill: col + 'b3', stroke: null });
  return out;
}

const f = (v) => Math.round(v * 100) / 100;
function arc(cx, cy, r, ri, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${f(cx + Math.cos(a) * rad)} ${f(cy + Math.sin(a) * rad)}`;
  if (!ri) return `M ${f(cx)} ${f(cy)} L ${p(r, a0)} A ${f(r)} ${f(r)} 0 ${large} 1 ${p(r, a1)} Z`;
  return `M ${p(r, a0)} A ${f(r)} ${f(r)} 0 ${large} 1 ${p(r, a1)} L ${p(ri, a1)} A ${f(ri)} ${f(ri)} 0 ${large} 0 ${p(ri, a0)} Z`;
}
