// @ts-check
/** Small in-cell visuals: sparkline, data bar, bullet. Used by table cells and as items. */
import { evalValue, toText, isDynamic } from '../expr/evaluate.js';
import { resolveFontKey } from '../text/fonts.js';

const f = (v) => Math.round(v * 100) / 100;
function num(expr, ctx, lc, who) {
  if (expr == null || expr === '') return null;
  try { const v = evalValue(expr, ctx); return v == null || v === '' ? null : Number(v); } catch (e) { lc.warn(`${who}: ${e.message}`); return null; }
}

/**
 * @param {{type: 'sparkline'|'databar'|'bullet', value?: string, values?: string, max?: string, target?: string, color?: string, showValue?: boolean, format?: string}} v
 * @param {{x:number, y:number, w:number, h:number}} box
 */
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
      try { const arr = evalValue(v.values, ctx); if (Array.isArray(arr)) vals = arr.map(Number); } catch (e) { lc.warn(`${who}: ${e.message}`); }
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
      const keys = [...buckets.keys()].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
      vals = keys.map(k => { const rs = buckets.get(k); return num(v.value, { ...ctx, fields: rs[0], aggRows: rs, aggIndex: undefined }, lc, who); });
    } else {
      const rows = ctx.aggRows || [];
      const c = { ...ctx };
      vals = rows.map(r => { c.fields = r; return num(v.value, c, lc, who); });
    }
    vals = vals.filter(n => Number.isFinite(n));
    if (vals.length < 2) return out;
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const px = (i) => x + (i / (vals.length - 1)) * w, py = (n) => y + h - ((n - lo) / span) * h;
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
