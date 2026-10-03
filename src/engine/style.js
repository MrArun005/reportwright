// @ts-check
import { evalValue, isDynamic } from './expr/evaluate.js';
import { normBox } from './units.js';

export const BASE_STYLE = {
  fontFamily: 'Inter',
  fontSize: 9,
  fontWeight: 'normal',
  fontStyle: 'normal',
  color: '#1f2328',
  backgroundColor: null,
  textAlign: 'auto',      // auto = numbers right, text left
  verticalAlign: 'top',
  padding: 2,
  lineHeight: 1.25,
  border: null,           // "1 solid #ccc" for all sides
  borderTop: null, borderRight: null, borderBottom: null, borderLeft: null,
  format: null,
  wrap: true,
  // shapes and lines
  fill: null,
  stroke: '#1f2328',
  strokeWidth: 1,
  strokeDash: 'solid',
  radius: 0,
};

/**
 * Merge style layers. Later layers win. Values that hold expressions
 * are evaluated in the given context (conditional formatting).
 * @param {(object|null|undefined)[]} layers @param {any} ctx
 */
export function resolveStyle(layers, ctx) {
  // Fast path: every layer is static → reuse one merged object per layer combination.
  let node = null, allStatic = true;
  for (const l of layers) {
    if (!l) continue;
    if (hasDynamic(l)) { allStatic = false; break; }
  }
  if (allStatic) {
    let map = CACHE;
    for (const l of layers) {
      if (!l) continue;
      let next = map.get(l);
      if (!next) { next = { map: new WeakMap(), value: null }; map.set(l, next); }
      node = next;
      map = next.map;
    }
    if (node?.value) return node.value;
  }
  const out = {};
  for (const l of layers) {
    if (!l) continue;
    for (const k in l) {
      const v = l[k];
      if (v === undefined) continue;
      out[k] = isDynamic(v) ? safe(v, ctx) : v;
    }
  }
  if (allStatic && node) node.value = Object.freeze(out);
  return out;
}
const CACHE = new WeakMap();
const DYN = new WeakMap();
function hasDynamic(l) {
  let d = DYN.get(l);
  if (d === undefined) {
    d = false;
    for (const k in l) if (isDynamic(l[k])) { d = true; break; }
    DYN.set(l, d);
  }
  return d;
}
function safe(v, ctx) {
  try { return evalValue(v, ctx); } catch { return undefined; }
}

/** "1 solid #ccc" | "none" | {width, style, color} → {width, style, color} | null */
export function parseBorder(b) {
  if (!b || b === 'none') return null;
  if (typeof b === 'object') return b.width > 0 ? { width: b.width, style: b.style || 'solid', color: b.color || '#000' } : null;
  const parts = String(b).trim().split(/\s+/);
  let width = 1, style = 'solid', color = '#000000';
  for (const p of parts) {
    if (/^[\d.]+(pt)?$/.test(p)) width = parseFloat(p);
    else if (['solid', 'dashed', 'dotted', 'double'].includes(p)) style = p;
    else if (p !== 'none') color = p;
  }
  return width > 0 ? { width, style, color } : null;
}

/** Four borders after side overrides. */
export function borders(st) {
  const all = parseBorder(st.border);
  const side = (k) => (st[k] != null ? parseBorder(st[k]) : all);
  return { top: side('borderTop'), right: side('borderRight'), bottom: side('borderBottom'), left: side('borderLeft') };
}

export const padding = (st) => normBox(st.padding ?? 0);

export const DASH = { solid: null, dashed: [4, 3], dotted: [1, 2] };
