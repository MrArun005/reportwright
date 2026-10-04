// @ts-check
import { ITEMS, withPartProps } from './items/index.js';

const EPS = 0.01;
const FIGURES = new Set(['image', 'chart', 'map', 'barcode', 'shape', 'line', 'sparkline', 'databar', 'bullet', 'iconset', 'rangebar']);

/**
 * Lay out a set of free-positioned items (a band body, a container, one list row).
 * Applies the RDL push rule: when an item grows by Δ, every item below it that
 * overlaps it horizontally moves down by Δ.
 *
 * @param {any[]} items
 * @param {any} lc  layout context
 * @param {{ dx?: number }} [opt]  x offset of the parent
 * @returns {{ units: any[], tables: any[], height: number }}
 *   units and tables in coordinates relative to the top of this set
 */
export function layoutItems(items, lc, { dx = 0 } = {}) {
  // items on a layer that is hidden, or not for this render's target (screen, print, export), take no part
  const shown = lc.layerOff ? (items || []).filter(it => !lc.layerOff(it)) : items || [];
  const sorted = [...shown].sort((a, b) => a.y - b.y || a.x - b.x);
  const laid = sorted.map((it0) => {
    const it = dx ? { ...it0, x: it0.x + dx } : it0;
    const spec = ITEMS[it.type];
    if (!spec) { lc.warn(`Unknown item type "${it.type}"`); return { it, res: { height: 0, units: [] } }; }
    // a copy of a report part: its expressions read PartProperties
    return { it, res: spec.layout(it, it.partProps && typeof it.partProps === 'object' ? withPartProps(lc, it.partProps) : lc) };
  });

  const shift = new Array(laid.length).fill(0);
  const units = [], tables = [];
  let height = 0;
  laid.forEach((L, i) => {
    const it = L.it;
    let s = 0;
    for (let j = 0; j < i; j++) {
      const J = laid[j].it;
      const overlapX = J.x < it.x + Math.max(it.w, 1) - EPS && it.x < J.x + Math.max(J.w, 1) - EPS;
      if (overlapX && J.y + J.h <= it.y + EPS) {
        let delta = laid[j].res.height - J.h;
        if (delta < 0 && !(J.canShrink || laid[j].res.units.length === 0)) delta = 0;
        s = Math.max(s, shift[j] + delta);
      }
    }
    shift[i] = s;
    const top = it.y + s;
    const x0 = it.x, x1 = it.x + (L.res.width ?? it.w);
    const own = L.res.table ? { id: lc.nextId(), ...L.res.table } : null;
    const us = L.res.units;
    const tag = it.alt || it.headingLevel || FIGURES.has(it.type) ? { k: it.type, alt: it.alt || undefined, h: Number(it.headingLevel) || undefined } : null; // exports (Word, PowerPoint, tagged PDF): what drew these items
    // units are fresh from the item's layout and used once: placed in this set's coordinates in place, not copied
    for (let k = 0; k < us.length; k++) {
      const u = us[k];
      u.x0 = u.x0 ?? x0; u.x1 = u.x1 ?? x1;
      u.top = top + u.top;
      u.tableId = own ? own.id : u.tableId;
      u.breakBefore = u.breakBefore || (k === 0 && !!it.pageBreakBefore);
      u.breakAfter = u.breakAfter || (k === us.length - 1 && !!it.pageBreakAfter);
      if (tag) for (const d of u.items) d.tag ??= tag;
      units.push(u);
    }
    if (own) tables.push({ ...own, top, bottom: top + L.res.height, x0, x1 });
    for (const t of L.res.tables || []) tables.push({ ...t, top: t.top + top, bottom: t.bottom + top });
    height = Math.max(height, top + (us.length ? L.res.height : 0), L.res.units.length ? 0 : 0);
  });
  // keep the designed extent of the set (its lowest item) unless items collapsed
  for (let i = 0; i < laid.length; i++) {
    const L = laid[i];
    if (L.res.units.length) height = Math.max(height, L.it.y + shift[i] + L.res.height);
  }
  units.sort((a, b) => a.top - b.top);
  return { units, tables, height };
}

/**
 * Which items a render leaves out because of their layer: `layers: [{ name, target, visible }]`. Targets follow
 * ActiveReports' TargetDevice: all, screen, print (paper), export, design (none: the designer only).
 * @returns {((it: any) => boolean) | null}
 */
export function layerFilter(layers, target) {
  const off = new Set();
  for (const l of Array.isArray(layers) ? layers : []) {
    if (!l || typeof l.name !== 'string') continue;
    const t = l.target || 'all';
    if (l.visible === false || t === 'design' || (t !== 'all' && t !== target)) off.add(l.name);
  }
  return off.size ? (it) => it.layer != null && off.has(it.layer) : null;
}
