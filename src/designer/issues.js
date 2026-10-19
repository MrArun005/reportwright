// @ts-check
// Design-time problems the canvas flags before a render does: items that overlap, items wider than the page (a matrix
// or table whose drawn width runs past the printable width moves its last columns to another page), and expressions
// that read fields the data set does not have. Pure: the canvas passes the drawn widths of live items (extents).
import { fieldIssues } from './fieldCheck.js';
import { resolvePage } from '../engine/units.js';

const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const contains = (o, i) => i.x >= o.x - 0.5 && i.y >= o.y - 0.5 && i.x + i.w <= o.x + o.w + 0.5 && i.y + i.h <= o.y + o.h + 0.5;
const THIN = new Set(['line']); // a rule across a box is meant to overlap it

/**
 * @param {any} def the report
 * @param {{ key: string, items: any[], width: number }[]} bands every band with its items and printable width
 * @param {Record<string, { w: number }>} [extents] drawn widths of live items (a matrix grows with its data), by item id
 * @returns {{ id: string | null, name: string, kind: 'overlap' | 'loose' | 'wide' | 'field' | 'below' | 'past' | 'tall' | 'room' | 'shared', other?: string, width?: number, room?: number, field?: string, suggest?: string | null, y?: number, bottom?: number, height?: number, header?: number, footer?: number, band?: string, orient?: string }[]}
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
    for (const it of items || []) {
      if (!it) continue;
      const w = Math.max(it.w || 0, extents[it.id]?.w || 0);
      if (it.x + w > room + 0.5) out.push({ id: it.id, name: it.name, kind: 'wide', width: Math.round(it.x + w), room: Math.round(room) });
      fieldsIn(it, it.dataSet || scope);
      if (Array.isArray(it.items)) walkList(it.items, it.w, it.dataSet || scope);
    }
  };
  for (const b of bands) {
    walkList(b.items, b.width, sets[0]?.name || null);
    overlaps(b.items, out);
  }
  if (!def?.master) pageIssues(def, out);
  return out;
}

/** Items that hold other items: one lying on such a box without being in it does not move or grow with it (#1a). */
const holds = (it) => it.type === 'container' || it.type === 'list' || Array.isArray(it.items);

/**
 * Overlaps in one band, by the items' places on the page: children are compared with the items outside their box too
 * (a container that grew over an item, a child that runs out of its box). One item fully on another is layering on
 * purpose (a text box on a tile, a logo on a band of colour), except on a container or list it is not in (#1a).
 * @param {any[]} items @param {any[]} out
 */
function overlaps(items, out) {
  /** @type {{ it: any, x: number, y: number, w: number, h: number, chain: any[] }[]} */
  const flat = [];
  /** @param {any[]} list @param {number} dx @param {number} dy @param {any[]} chain @param {number} depth */
  const go = (list, dx, dy, chain, depth) => {
    if (depth > 64) return;
    for (const it of list || []) {
      if (!it || typeof it !== 'object') continue;
      const x = dx + (Number(it.x) || 0), y = dy + (Number(it.y) || 0);
      if (!THIN.has(it.type)) flat.push({ it, x, y, w: Number(it.w) || 0, h: Number(it.h) || 0, chain });
      if (Array.isArray(it.items)) go(it.items, x, y, [...chain, it], depth + 1);
    }
  };
  go(items, 0, 0, [], 0);
  if (flat.length > 2000) return; // a huge band: the pairs would take too long for a live check
  for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) {
    const a = flat[i], b = flat[j];
    if (!overlap(a, b) || a.chain.includes(b.it) || b.chain.includes(a.it)) continue; // a child in its own box is fine
    const outer = contains(a, b) ? a : contains(b, a) ? b : null;
    if (outer) {
      const inner = outer === a ? b : a;
      if (holds(outer.it)) out.push({ id: inner.it.id, name: inner.it.name, kind: 'loose', other: outer.it.name });
      continue;
    }
    out.push({ id: b.it.id, name: b.it.name, kind: 'overlap', other: a.it.name });
  }
}

/** Items that grow and continue on the next page (a table's rows): their designed height says little about the page. */
const GROWS = new Set(['table', 'matrix', 'list', 'subreport', 'richtext', 'toc', 'overflow', 'part', 'placeholder']);

/**
 * Body sections against their page (#30, #16): an item past the room a page has for the body, a page header and footer
 * that leave little room, a section whose page is wider or narrower than the report's but that uses the shared header
 * or footer (laid out at the report's width). The engine's geometry (src/engine/index.js) in short.
 * @param {any} def @param {any[]} out
 */
function pageIssues(def, out) {
  const s = def?.sections || {};
  const many = Array.isArray(s.body);
  const bodies = many ? s.body : [s.body || {}];
  const base = resolvePage(def?.page || {});
  if (base.pageless) return;
  /** @param {string} k */
  const shared = (k) => (s[k]?.height ? s[k] : null);
  /** @param {any} b @param {string} k */
  const own = (b, k) => {
    const o = b?.[k];
    if (!o || typeof o !== 'object' || Array.isArray(o)) return shared(k);
    return o.hidden || !(Number(o.height) > 0) ? null : o;
  };
  bodies.forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    const pg = b.page ? resolvePage({ ...(def.page || {}), ...b.page }) : base;
    if (pg.pageless) return;
    const label = many ? b.name || `Section ${i + 1}` : null; // the body: issueLine names it in the UI language
    const hdr = own(b, 'pageHeader'), ftr = own(b, 'pageFooter');
    const hH = Number(hdr?.height) || 0, fH = Number(ftr?.height) || 0;
    const page = pg.height - pg.margins.top - pg.margins.bottom;
    const room = page - hH - fH;
    if (room < page / 3) out.push({ id: null, name: label, kind: 'room', header: Math.round(hH), footer: Math.round(fH), room: Math.round(room) });
    else {
      // what does not fit the first page: an item taller than a page is cut (each one said); the rest moves on to a
      // later page, said once per section (a long static layout is fine, but should not be a surprise)
      const late = [];
      for (const it of b.items || []) {
        if (!it || typeof it !== 'object' || it.hidden === true) continue;
        const y = Number(it.y) || 0, h = Number(it.h) || 0, grows = GROWS.has(it.type);
        if (!grows && h > room + 0.5) out.push({ id: it.id, name: it.name, kind: 'tall', height: Math.round(h), room: Math.round(room), section: label });
        else if (y + (grows ? 0 : h) > room + 0.5) late.push({ it, y, h });
      }
      late.sort((p, q) => p.y - q.y);
      const f = late[0];
      if (f) out.push(f.y >= room - 0.5
        ? { id: f.it.id, name: f.it.name, kind: 'below', y: Math.round(f.y), room: Math.round(room), section: label, more: late.length - 1 }
        : { id: f.it.id, name: f.it.name, kind: 'past', bottom: Math.round(f.y + f.h), room: Math.round(room), section: label, more: late.length - 1 });
    }
    // a shared page header or footer is laid out at the report's width (#16): on a wider (landscape) page it stops
    // short of the right edge, on a narrower one it runs past it
    if (Math.abs(pg.bodyWidth - base.bodyWidth) > 0.5) {
      const h = !!hdr && hdr === shared('pageHeader') && (hdr.items || []).length > 0;
      const f = !!ftr && ftr === shared('pageFooter') && (ftr.items || []).length > 0;
      if (h || f) out.push({ id: null, name: label, kind: 'shared', band: h && f ? 'both' : h ? 'header' : 'footer', orient: pg.width > pg.height ? 'landscape' : 'portrait', width: Math.round(pg.bodyWidth), room: Math.round(base.bodyWidth) });
    }
  });
}

/**
 * Problems validate() finds (an unknown function, a barcode symbology, an expression that does not parse) and the
 * server's save warnings (a drill-through report that does not exist), as issues. Each message starts with the name
 * of its item ("Ledger cell: …"): that item is selected on a click.
 * @param {{ items: any[] }[]} bands @param {string[]} messages
 * @returns {{ id: string | null, name: string, kind: 'check', text: string }[]}
 */
export function checkIssues(bands, messages) {
  const ids = new Map();
  const go = (items, depth) => { if (depth > 64) return; for (const it of items || []) { if (!it) continue; if (it.name && !ids.has(it.name)) ids.set(it.name, it.id); if (Array.isArray(it.items)) go(it.items, depth + 1); } };
  for (const b of bands) go(b.items, 0);
  return [...new Set(messages)].map(text => {
    // "Ledger cell: …", "Ledger, filter 1 has no expr; …": the name ends at the colon or at ", filter N"
    const name = String(text).split(':')[0].replace(/, filter \d+\b[\s\S]*$/, '').replace(/ (cell|group|header cell|detail cell|footer cell)$/, '');
    return { id: ids.get(name) ?? null, name, kind: 'check', text: String(text) };
  });
}
