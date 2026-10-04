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
  const { item, data, out, X, W, top, bottom, fs, bold, text, measure, fmtV, pointFill, pointLink, pal, label, labelText, anim } = g;
  const vals = (data.series[0]?.values || []).map(v => Math.max(0, v || 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const showL = item.showValues !== false;
  const outside = item.labelPosition === 'outside' && showL;
  const pctOf = (v) => `${Math.round((v / total) * 100)}%`;
  // outside: "Category: 12%" (or the template) beside the pie, joined to its slice by a leader line
  const texts = outside ? vals.map((v, i) => (item.labelTemplate ? labelText(i, data.series[0], v, v / total) : `${data.categories[i]}: ${pctOf(v)}`)) : null;
  // outside: the widest label on each side sets the room beside the pie (a label's side does not depend on the radius)
  const lw = [0, 0];
  if (outside) {
    let b0 = -Math.PI / 2;
    vals.forEach((v, i) => { const b1 = b0 + (v / total) * Math.PI * 2; if (v > 0 && i < 400) { const k = Math.cos((b0 + b1) / 2) >= 0 ? 1 : 0; lw[k] = Math.max(lw[k], measure(texts[i]).w); } b0 = b1; });
  }
  let r, cx = X + W / 2;
  const cy = (top + bottom) / 2;
  if (outside) {
    const gap = 20, minR = Math.min(W, bottom - top) * 0.25;
    const fit = (W - lw[0] - lw[1] - gap * 2) / 2;
    if (fit < minR) { const k = Math.max(0, (W - gap * 2 - minR * 2) / Math.max(1, lw[0] + lw[1])); lw[0] *= k; lw[1] *= k; }
    r = Math.max(4, Math.min((W - lw[0] - lw[1] - gap * 2) / 2, (bottom - top) / 2 - fs));
    const slack = W - lw[0] - lw[1] - gap * 2 - r * 2;
    cx = X + gap + lw[0] + r + slack / 2;
  } else r = Math.max(4, Math.min(W, bottom - top) / 2 - 6);
  const ri = type === 'donut' ? r * 0.58 : 0;
  const sides = [[], []]; // left, right
  let a0 = -Math.PI / 2;
  vals.forEach((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    const fill = pointFill(i, pal[i % pal.length]);
    if (v > 0) {
      const d = arc(cx, cy, r, ri, a0, Math.min(a1, a0 + Math.PI * 2 - 1e-4));
      out.push(tag({ t: 'path', x: 0, y: 0, d, fill, stroke: '#ffffff', strokeWidth: 0.75 }, anim && { k: anim === 'grow' ? 'scale' : 'fade', i }));
      pointLink(i, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, `${data.categories[i]}: ${fmtV(v)} (${pctOf(v)})`, d);
    }
    const mid = (a0 + a1) / 2, frac = v / total;
    if (outside && v > 0) sides[Math.cos(mid) >= 0 ? 1 : 0].push({ i, v, mid, y: cy + Math.sin(mid) * (r + 10) });
    else if (!outside && frac >= 0.05 && showL) {
      const s = item.labelTemplate ? labelText(i, data.series[0], v, frac) : pctOf(v);
      const lr = ri ? (r + ri) / 2 : r * 0.62;
      label(s, cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr + fs * 0.35, { color: inkOn(fill), f: bold, size: fs });
    }
    a0 = a1;
  });
  if (outside) placeOutside(sides, { cx, cy, r, lw, lh: fs * 1.3, lo: top + fs * 0.9, hi: bottom - fs * 0.4, out, text, texts, fs, ink: g.ink });
  if (type === 'donut' && item.centerText !== false) {
    text(fmtV(total), cx, cy + fs * 0.45, { align: 'center', size: fs * 1.4, f: bold, color: '#111827' });
  }
}

/**
 * Outside pie labels: one column each side; on a side the labels keep their slice order and are pushed apart (down, then
 * back up from the bottom) so none overlap. When a side has more labels than fit, the smallest slices lose theirs.
 * Each label is joined to its slice: from the rim, out to an elbow, then across to the label.
 */
export function placeOutside(sides, { cx, cy, r, lw, lh, lo, hi, out, text, texts, fs, ink }) {
  sides.forEach((list, right) => {
    const room = Math.max(1, Math.floor((hi - lo) / lh) + 1);
    if (list.length > room) {
      const keep = new Set([...list].sort((a, b) => b.v - a.v).slice(0, room));
      list = list.filter(l => keep.has(l));
    }
    list.sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const l of list) { l.y = Math.max(l.y, prev + lh, lo); prev = l.y; }
    let next = Infinity;
    for (let k = list.length - 1; k >= 0; k--) { const l = list[k]; l.y = Math.min(l.y, next - lh, hi); next = l.y; }
    const dir = right ? 1 : -1;
    for (const l of list) {
      const c = Math.cos(l.mid), s = Math.sin(l.mid);
      const ex = cx + c * (r + 8), ey = cy + s * (r + 8);
      const kx = cx + dir * (r + 12);
      out.push({ t: 'path', x: 0, y: 0, d: `M ${f(cx + c * r)} ${f(cy + s * r)} L ${f(ex)} ${f(ey)} L ${f(kx)} ${f(l.y)}`, fill: null, stroke: '#9ca3af', strokeWidth: 0.6 });
      text(texts[l.i], kx + dir * 3, l.y + fs * 0.35, { align: right ? 'left' : 'right', maxW: Math.max(fs, lw[right] + 1), color: ink });
    }
  });
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
  // tick values up the first spoke; not 0 (the centre) nor the outer ring (the first category's label is there)
  for (const t of ticks) if (rad(t) > 0 && rad(t) < R - 0.5) text(fmtV(t), cx + 3, cy - rad(t) + fs * 0.3, { size: fs * 0.8, color: '#6b7280' });
  data.categories.forEach((c, i) => {
    const p = at(i, R + 4), cos = Math.cos(ang(i));
    text(c, p.x, p.y + fs * 0.35 + (Math.sin(ang(i)) > 0.5 ? fs * 0.5 : 0), { align: Math.abs(cos) < 0.2 ? 'center' : cos > 0 ? 'left' : 'right', maxW: catW });
  });
  data.series.forEach((s, si) => {
    const pts = s.values.map((v, i) => (v == null ? null : { ...at(i, rad(v)), v, i })).filter(Boolean);
    if (!pts.length) return;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${f(p.x)} ${f(p.y)}`).join(' ') + ' Z';
    out.push(tag({ t: 'path', x: 0, y: 0, d, fill: s.color + (s.def.type === 'line' ? '00' : '2e'), stroke: s.color, strokeWidth: 1.4 }, anim && { k: anim === 'grow' ? 'scale' : 'fade', i: si }));
    if (n <= 40) for (const p of pts) out.push({ t: 'ellipse', cx: p.x, cy: p.y, rx: 1.8, ry: 1.8, fill: s.color, stroke: null });
    for (const p of pts) pointLink(p.i, { x: p.x - 4, y: p.y - 4, w: 8, h: 8 }, `${data.categories[p.i]}${data.series.length > 1 ? ` · ${s.name}` : ''}: ${fmtV(p.v)}`);
    if (labelsOn || item.labelTemplate) for (const p of pts) label(labelText(p.i, s, p.v), p.x, p.y - 3, { size: fs * 0.85 });
  });
}

/** Gauge shapes: [start angle, sweep], clockwise in page coordinates (0 = right, PI/2 = down). */
export const GAUGE_SHAPES = { half: [Math.PI, Math.PI], threeQuarter: [Math.PI * 0.75, Math.PI * 1.5], full: [-Math.PI / 2, Math.PI * 2] };
export const GAUGE_INDICATORS = ['needle', 'pointer', 'bar'];

/**
 * Gauge: a half circle (min left, max right), a three-quarter circle (open at the bottom) or a full circle (min and max at
 * the top). Bands colour the track (ranges), line overlays mark targets; the value is shown by a needle, a pointer on the
 * track's inner edge, or a bar along the track. Tick marks and values run round the scale when there is room.
 */
function paintGauge(g) {
  const { item, data, out, X, W, top, bottom, fs, bold, text, fmtV, pointLink, axes, lc, who, safe, ctx } = g;
  const v = data.series[0]?.values?.[0] ?? null;
  const ys = axes.y || {};
  const num = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
  const lo = num(ys.min) ?? 0;
  let hi = num(ys.max) ?? niceScale(lo, Math.max(lo + 1, v ?? 0), 5).hi;
  if (!(hi > lo)) hi = lo + 1;
  const shape = Object.hasOwn(GAUGE_SHAPES, item.gaugeShape) ? item.gaugeShape : 'half';
  const indicator = GAUGE_INDICATORS.includes(item.gaugeIndicator) ? item.gaugeIndicator : 'needle';
  const [start, sweep] = GAUGE_SHAPES[shape];
  const frac = (x) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  const ang = (x) => start + frac(x) * sweep;
  const end = start + sweep - (shape === 'full' ? 1e-4 : 0);
  const cx = X + W / 2, H = bottom - top;
  let R, cy;
  if (shape === 'full') { R = Math.max(8, Math.min(W / 2 - 8, H / 2 - 4)); cy = (top + bottom) / 2; }
  else if (shape === 'threeQuarter') { R = Math.max(8, Math.min(W / 2 - 8, (H - fs * 1.4 - 4) / (1 + Math.SQRT1_2))); cy = top + 4 + R; }
  else { R = Math.max(8, Math.min(W / 2 - 8, H - fs * 3.6)); cy = top + 4 + R; }
  const th = R * 0.22;
  const at = (a, rad) => ({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
  const scope = { ...ctx, fields: data.rows[0] || null, aggRows: data.rows, aggIndex: undefined };
  const val = (o, k) => (typeof o[k] === 'number' ? o[k] : num(safe(o[k], scope, lc, who)));
  const overlays = (Array.isArray(item.overlays) ? item.overlays : []).slice(0, 20).filter(o => o && typeof o === 'object');
  const bands = overlays.filter(o => o.type === 'band');
  out.push({ t: 'path', x: 0, y: 0, d: arc(cx, cy, R, R - th, start, end), fill: '#e5e7eb', stroke: null });
  const BAND = ['#16a34a', '#f59e0b', '#dc2626', '#2563eb', '#8b5cf6'];
  bands.forEach((o, i) => {
    const a = val(o, 'from'), b = val(o, 'to');
    if (a == null || b == null) return;
    const a0 = ang(Math.min(a, b)), a1 = Math.min(end, ang(Math.max(a, b)));
    if (a1 - a0 > 1e-4) out.push({ t: 'path', x: 0, y: 0, d: arc(cx, cy, R, R - th, a0, a1), fill: typeof o.color === 'string' && o.color ? o.color : BAND[i % BAND.length], stroke: null });
  });
  const color = data.series[0]?.color || g.pal[0];
  // the value as a bar along the track: the whole track width, or a thinner bar over the bands
  if (v != null && frac(v) > 0 && (indicator === 'bar' || !bands.length)) {
    const [ro, rin] = bands.length ? [R - th * 0.3, R - th * 0.7] : [R, R - th];
    out.push(tag({ t: 'path', x: 0, y: 0, d: arc(cx, cy, ro, rin, start, Math.min(end, Math.max(start + 1e-4, ang(v)))), fill: color, stroke: null }, g.anim && { k: 'fade', i: 0 }));
  }
  for (const o of overlays) if (o.type === 'line') {
    const t = val(o, 'value'); if (t == null) continue;
    const a = ang(t), p1 = at(a, R - th - 2), p2 = at(a, R + 2);
    out.push({ t: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: o.color || '#111827', strokeWidth: 1.5 });
  }
  // ticks: major marks with their values inside the track, minor marks between; end values only when it is too small
  const sc = niceScale(lo, hi, shape === 'half' ? 5 : 7);
  const ticks = linearTicks(Math.ceil(lo / sc.step - 1e-9) * sc.step, hi, sc.step).filter(t => t >= lo - 1e-9 && t <= hi + 1e-9);
  const tickOn = item.gaugeTicks !== false && R >= fs * 5 && ticks.length > 1;
  if (tickOn) {
    const ri = R - th - 1;
    const minor = sc.step / 5;
    for (let t = ticks[0] - sc.step, k = 0; t <= hi + 1e-9 && k < 200; t += minor, k++) {
      if (t < lo - 1e-9) continue;
      const isMajor = ticks.some(m => Math.abs(m - t) < minor / 2);
      const a = ang(t), p1 = at(a, ri), p2 = at(a, ri - th * (isMajor ? 0.4 : 0.2));
      out.push({ t: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: isMajor ? '#6b7280' : '#9ca3af', strokeWidth: isMajor ? 0.9 : 0.5 });
    }
    const lr = ri - th * 0.4 - fs * 1.1;
    ticks.forEach((t, k) => {
      if (shape === 'full' && k === ticks.length - 1 && Math.abs(frac(t) - 1) < 1e-9) return; // max sits on min at the top
      const p = at(ang(t), lr);
      text(fmtV(t), p.x, p.y + fs * 0.3, { align: 'center', size: fs * 0.8, color: '#6b7280' });
    });
  } else if (shape !== 'full') {
    const e0 = at(start, R - th / 2), e1 = at(start + sweep, R - th / 2);
    text(fmtV(lo), e0.x, e0.y + fs * 1.3, { align: 'center', color: '#6b7280' });
    text(fmtV(hi), e1.x, e1.y + fs * 1.3, { align: 'center', color: '#6b7280' });
  }
  const vy = shape === 'half' ? cy + fs * 2.6 : cy + R * 0.5 + fs * 0.6;
  if (v == null) { text('No data', cx, shape === 'half' ? cy - R / 3 : cy + fs * 0.35, { align: 'center', color: '#9ca3af' }); return; }
  const a = ang(v), ink = typeof item.pointerColor === 'string' && /^#[0-9a-f]{6}$/i.test(item.pointerColor) ? item.pointerColor : '#1f2937';
  if (indicator === 'needle') {
    // a thin triangle from the hub to just inside the track
    const len = R - th * 0.4, bw = Math.max(1.5, R * 0.03);
    const tip = at(a, len), n1 = at(a + Math.PI / 2, bw), n2 = at(a - Math.PI / 2, bw);
    const d = `M ${f(n1.x)} ${f(n1.y)} L ${f(tip.x)} ${f(tip.y)} L ${f(n2.x)} ${f(n2.y)} Z`;
    out.push(tag({ t: 'path', x: 0, y: 0, d, fill: ink, stroke: null }, g.anim && { k: 'fade', i: 0 }));
    out.push({ t: 'ellipse', cx, cy, rx: bw * 1.4, ry: bw * 1.4, fill: ink, stroke: null });
  } else if (indicator === 'pointer') {
    // a marker on the track's inner edge, pointing out at the value
    const tip = at(a, R - th * 0.85), half = Math.max(0.05, Math.min(0.2, (th * 0.55) / Math.max(1, R - th)));
    const b1 = at(a - half, R - th * 1.7), b2 = at(a + half, R - th * 1.7);
    const d = `M ${f(b1.x)} ${f(b1.y)} L ${f(tip.x)} ${f(tip.y)} L ${f(b2.x)} ${f(b2.y)} Z`;
    out.push(tag({ t: 'path', x: 0, y: 0, d, fill: ink, stroke: '#ffffff', strokeWidth: 0.6 }, g.anim && { k: 'fade', i: 0 }));
  }
  text(item.labelTemplate ? g.labelText(0, data.series[0], v) : fmtV(v), cx, indicator === 'needle' || shape === 'half' ? vy : cy + fs * 0.55, { align: 'center', size: fs * 1.6, f: bold, color: '#111827' });
  pointLink(0, { x: cx - R, y: cy - R, w: R * 2, h: shape === 'half' ? R : R * 2 }, `${data.series[0]?.name || 'Value'}: ${fmtV(v)}`);
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
      else { const lx = cx + (tw + Math.min(tw, bw)) / 4 + 6; text(s, lx, y + sh / 2 + sz * 0.35, { size: sz, maxW: X + W - lx - 2 }); }
    }
    y += sh + gap;
  });
}
