// @ts-check
// Design-time problems the canvas flags before a render does: items that overlap, items wider than the page (a matrix
// or table whose drawn width runs past the printable width moves its last columns to another page), and expressions
// that read fields the data set does not have. Pure: the canvas passes the drawn widths of live items (extents).
import { fieldIssues } from './fieldCheck.js';

const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const contains = (o, i) => i.x >= o.x - 0.5 && i.y >= o.y - 0.5 && i.x + i.w <= o.x + o.w + 0.5 && i.y + i.h <= o.y + o.h + 0.5;
const THIN = new Set(['line']); // a rule across a box is meant to overlap it

/**
 * @param {any} def the report
 * @param {{ key: string, items: any[], width: number }[]} bands every band with its items and printable width
 * @param {Record<string, { w: number }>} [extents] drawn widths of live items (a matrix grows with its data), by item id
 * @returns {{ id: string, name: string, kind: 'overlap' | 'wide' | 'field', other?: string, width?: number, room?: number, field?: string, suggest?: string | null }[]}
 */
export function designIssues(def, bands, extents = {}) {
  const out = [];
  const sets = def?.dataSets || [];
  const fieldsIn = (it, scope) => {
    const seen = new Set();
    const check = (v) => { if (typeof v !== 'string' || !v) return; for (const i of fieldIssues(v, sets, scope)) if (!seen.has(i.name)) { seen.add(i.name); out.push({ id: it.id, name: it.name, kind: 'field', field: i.name, suggest: i.suggest }); } };
    for (const k of ['value', 'hidden', 'src', 'category', 'text']) check(it[k]);
    for (const sr of it.series || []) check(sr.value);
    if (it.type === 'table') for (const part of ['header', 'detail', 'footer']) for (const r of it[part] || []) for (const c of r.cells || []) check(c?.value);
    if (it.type === 'table') for (const g of it.groups || []) { check(g.expr); for (const r of [...(g.header || []), ...(g.footer || [])]) for (const c of r.cells || []) check(c?.value); }
    if (it.type === 'matrix') for (const k of ['rowGroups', 'columnGroups', 'values']) for (const g of it[k] || []) { check(g?.expr); check(g?.value); check(g?.label); }
  };
  const walkList = (items, room, scope) => {
    const live = (items || []).filter(i => i && !THIN.has(i.type));
    for (const it of items || []) {
      if (!it) continue;
      const w = Math.max(it.w || 0, extents[it.id]?.w || 0);
      if (it.x + w > room + 0.5) out.push({ id: it.id, name: it.name, kind: 'wide', width: Math.round(it.x + w), room: Math.round(room) });
      fieldsIn(it, it.dataSet || scope);
      if (Array.isArray(it.items)) walkList(it.items, it.w, it.dataSet || scope);
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      // one inside the other is layering on purpose (a text box on a tile, a logo on a band of colour); a partial overlap is not
      if (overlap(a, b) && !contains(a, b) && !contains(b, a)) out.push({ id: b.id, name: b.name, kind: 'overlap', other: a.name });
    }
  };
  for (const b of bands) walkList(b.items, b.width, sets[0]?.name || null);
  return out;
}
