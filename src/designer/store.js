'use client';
import { create } from 'zustand';
import { produce } from 'immer';
import { ITEMS } from '@/engine/items/index.js';
import { resolvePage } from '@/engine/units.js';
import { t } from '@/i18n/index.js';

export const SECTIONS = [
  { key: 'pageHeader', label: 'Page header' },
  { key: 'body', label: 'Body' },
  { key: 'pageFooter', label: 'Page footer' },
];
export const NESTING = new Set(['container', 'list']);

/**
 * Body sections (spec §3.8): sections.body is one band or an array of bands, each with its own page.
 * Keys: 'pageHeader', 'body' (the first body section), 'body:1', 'body:2' …, 'pageFooter'.
 */
export function secOf(d, key) {
  const [k, i] = String(key).split(':');
  const s = d?.sections?.[k];
  return Array.isArray(s) ? s[Number(i || 0)] : s;
}
export const isBodyKey = (key) => String(key).split(':')[0] === 'body';
/** Every band of the report, in page order. */
export function sectionList(def) {
  const b = def?.sections?.body;
  const bodies = Array.isArray(b) ? b.map((x, i) => ({ key: i ? `body:${i}` : 'body', label: x?.name || `Section ${i + 1}`, index: i })) : [{ key: 'body', label: 'Body', index: 0 }];
  return [SECTIONS[0], ...bodies, SECTIONS[2]];
}
/** The page of a band: the report's page, with a body section's own page settings on top. */
export function pageOf(def, key = 'body') {
  const sec = isBodyKey(key) && Array.isArray(def.sections?.body) ? secOf(def, key) : null;
  return resolvePage({ ...(def.page || {}), ...(sec?.page || {}) });
}

const rid = () => Math.random().toString(36).slice(2, 10);

/** Visit every item, nested ones included. fn(item, list, index, parent, section) */
export function walk(def, fn) {
  const go = (list, parent, section) => list.forEach((it, i) => { fn(it, list, i, parent, section); if (Array.isArray(it.items)) go(it.items, it, section); });
  for (const { key } of sectionList(def)) go(secOf(def, key)?.items || [], null, key);
}
export const allNames = (d) => { const s = new Set(); walk(d, it => { if (it.name) s.add(it.name); }); return s; };

/** Give every item an id and a unique name. Runs once on load. */
export function normalize(def) {
  return produce(def, (d) => {
    d.sections ||= {};
    for (const { key } of SECTIONS) d.sections[key] ||= { height: key === 'body' ? 420 : 0, items: [] };
    if (Array.isArray(d.sections.body) && !d.sections.body.length) d.sections.body = { height: 420, items: [] };
    for (const { key } of sectionList(d)) secOf(d, key).items ||= [];
    const used = allNames(d);
    walk(d, (it) => {
      it.id ||= rid();
      if (!it.name) it.name = uniqueName(used, ITEMS[it.type]?.label.replace(/\s/g, '') || 'Item');
      if (NESTING.has(it.type)) it.items ||= [];
      // a table's height is its rows': kept in step, so items below it do not shift when it is first edited
      if (it.type === 'table' && Array.isArray(it.columns)) tableSync(it);
    });
    // a body lower than its lowest item grows to it (no extra room added: opening a report never moves a band)
    for (const b of Array.isArray(d.sections.body) ? d.sections.body : [d.sections.body]) {
      const bottom = Math.max(0, ...b.items.map(i => i.y + i.h));
      if (!b.height) b.height = Math.ceil(bottom + 60);
      else if (b.height < bottom) b.height = Math.ceil(bottom);
    }
  });
}
export function uniqueName(used, base) {
  let i = 1;
  while (used.has(`${base}${i}`)) i++;
  used.add(`${base}${i}`);
  return `${base}${i}`;
}

/** Find an item anywhere. Returns { section, list, index, item, parent } or null. */
export function findItem(def, id) {
  let hit = null;
  walk(def, (it, list, index, parent, section) => { if (!hit && it.id === id) hit = { section, list, index, item: it, parent }; });
  return hit;
}

export const useDesigner = create((set, get) => ({
  id: null,
  def: null,
  saved: true,
  saving: false,
  saveError: null,
  past: [],
  future: [],
  /** selection: {kind:'report'} | {kind:'section', section} | {kind:'items', ids} | {kind:'cell', id, part, row, col} */
  sel: { kind: 'report' },
  tab: 'design',
  zoom: 1.25,
  grid: 4,
  snap: true,
  /** cell-based design (Phase 8): items snap to whole cells of cellSize pt and may not overlap */
  cells: false,
  cellSize: 12,
  /** reports this one reuses, fetched for display: id → definition (or { __error }) */
  reused: {},
  pivotWizard: null,
  instantVisuals: null,
  unit: 'pt',
  sample: null,
  /** fonts uploaded to the server: [{ id, family, weight, style, bytes }] */
  fonts: [],
  /** chart gallery dialog: {mode:'insert', section, x, y, extra, parentId} | {mode:'edit', id} */
  wizard: null,
  tableWizard: null,
  /** interface language (?lang=), for the parts of the designer that are translated */
  lang: 'en',
  lastKey: null,
  lastAt: 0,

  /** set by mountDesigner: { onSave, onOpen, readOnly, toolbox, panels, dataSourceTemplates, server } */
  embed: null,
  readOnly: false,
  init(id, def) { set({ id, def: normalize(def), saved: true, past: [], future: [], sel: { kind: 'report' } }); },

  /** Apply an immer recipe to the definition and record history. Same key within 800 ms merges. */
  apply(recipe, key = null) {
    const { def, past, lastKey, lastAt, readOnly } = get();
    if (readOnly) return; // every edit comes through here: read-only stops them all
    const next = produce(def, recipe);
    if (next === def) return;
    const now = Date.now();
    const merge = key && key === lastKey && now - lastAt < 800;
    set({ def: next, past: merge ? past : [...past.slice(-199), def], future: [], saved: false, lastKey: key, lastAt: now });
  },
  undo() {
    const { past, def, future } = get();
    if (!past.length || get().readOnly) return;
    set({ def: past[past.length - 1], past: past.slice(0, -1), future: [def, ...future].slice(0, 200), saved: false, lastKey: null });
    get().fixSelection();
  },
  redo() {
    const { past, def, future } = get();
    if (!future.length || get().readOnly) return;
    set({ def: future[0], future: future.slice(1), past: [...past, def], saved: false, lastKey: null });
    get().fixSelection();
  },
  fixSelection() {
    const { sel, def } = get();
    if (sel.kind === 'items') {
      const ids = sel.ids.filter(id => findItem(def, id));
      set({ sel: ids.length ? { kind: 'items', ids } : { kind: 'report' } });
    } else if (sel.kind === 'cell') {
      const f = findItem(def, sel.id);
      if (!f || !rowsOf(f.item, sel.part)?.[sel.row]) set({ sel: f ? { kind: 'items', ids: [sel.id] } : { kind: 'report' } });
    }
  },
  select(sel) { set({ sel, lastKey: null }); },
  setUi(patch) { set(patch); },

  async save() {
    const { id, def, embed, readOnly } = get();
    if (readOnly) return;
    set({ saving: true, saveError: null });
    try {
      // embedded: the host app saves (onSave gets a plain copy), or the Pagewright server it named
      if (embed?.onSave) await embed.onSave(JSON.parse(JSON.stringify(def)));
      else {
        if (!id) throw new Error('This report has no id to save to');
        const res = await fetch(`${embed?.server || ''}/api/reports/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(def) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      }
      if (get().def === def) set({ saved: true });
    } catch (e) {
      set({ saveError: e.message });
    } finally { set({ saving: false }); }
  },
}));

/* ------------------------------------------------------------ commands */
const S = () => useDesigner.getState();

export function bodyWidth(def, key = 'body') { return pageOf(def, key).bodyWidth; }
/** Width available to an item: the band width, or its parent's width. */
function roomFor(d, f) { return f.parent ? f.parent.w : bodyWidth(d, f.section); }

/** Add a body section after the others (the body becomes a list of sections). */
export function addBodySection() {
  S().apply((d) => {
    if (!Array.isArray(d.sections.body)) d.sections.body = [{ name: 'Section1', ...d.sections.body }];
    d.sections.body.push({ name: `Section${d.sections.body.length + 1}`, height: 300, items: [] });
  });
  S().select({ kind: 'section', section: `body:${S().def.sections.body.length - 1}` });
}
/** Remove a body section and its items; one left: the body is a single band again (unless it has its own page). */
export function removeBodySection(key) {
  S().apply((d) => {
    if (!Array.isArray(d.sections.body) || d.sections.body.length < 2) return;
    d.sections.body.splice(Number(String(key).split(':')[1] || 0), 1);
    if (d.sections.body.length === 1 && !d.sections.body[0].page) { const { name: _n, ...one } = d.sections.body[0]; d.sections.body = one; }
  });
  S().select({ kind: 'report' });
}

export function addItem(type, section, x, y, extra = {}, parentId = null) {
  const spec = ITEMS[type];
  const id = rid();
  S().apply((d) => {
    const used = allNames(d);
    const it = { ...spec.defaults(), ...extra, id, name: uniqueName(used, spec.label.replace(/\s/g, '')) };
    const parent = parentId ? findItem(d, parentId)?.item : null;
    const room = parent ? parent.w : bodyWidth(d, section);
    if (type === 'table') tableSync(it); // width and height come from its columns and rows
    else it.w = Math.min(it.w, room);
    it.x = clamp(x, 0, Math.max(0, room - it.w));
    it.y = Math.max(0, y);
    // cell mode: whole cells, and the first free place at or below the drop point
    const sibs = parent ? parent.items : secOf(d, section).items;
    if (S().cells) { snapCells(it); for (let k = 0; k < 400 && overlapsAny(it, sibs); k++) it.y += S().cellSize; }
    if (parent) {
      parent.items.push(it);
      if (it.y + it.h > parent.h) parent.h = Math.ceil(it.y + it.h);
    } else {
      const sec = secOf(d, section);
      sec.items.push(it);
      if (it.y + it.h > sec.height) sec.height = Math.ceil(it.y + it.h + (isBodyKey(section) ? 24 : 4));
    }
  });
  S().select({ kind: 'items', ids: [id] });
  return id;
}

/** Insert from the toolbox or a drop. Charts open the chart gallery first (when the report has data), other items go straight in. */
export function insertItem(type, section, x, y, extra = {}, parentId = null) {
  if (type === 'chart' && (S().def.dataSets || []).length) {
    S().setUi({ wizard: { mode: 'insert', section, x, y, extra, parentId } });
    return null;
  }
  // tables and matrices open the table gallery (list, grouped, summary, matrix) when the report has data
  if ((type === 'table' || type === 'matrix') && (S().def.dataSets || []).some(d => (d.fields || []).length)) {
    S().setUi({ tableWizard: { type, section, x, y, extra, parentId } });
    return null;
  }
  return addItem(type, section, x, y, extra, parentId);
}

export function updateItem(id, recipe, key) {
  S().apply((d) => { const f = findItem(d, id); if (f) recipe(f.item, d, f.section, f); }, key);
}

export function moveItems(ids, dx, dy) {
  if (!dx && !dy) return;
  if (S().cells && wouldOverlap(S().def, ids, (it) => ({ x: it.x + dx, y: it.y + dy, w: it.w, h: it.h }))) { S().setUi({ saveError: CELL_TAKEN() }); setTimeout(() => S().setUi({ saveError: null }), 2500); return; }
  S().apply((d) => {
    for (const id of ids) {
      const f = findItem(d, id);
      if (!f) continue;
      const room = roomFor(d, f);
      f.item.x = round(clamp(f.item.x + dx, 0, Math.max(0, room - f.item.w)));
      f.item.y = round(Math.max(0, f.item.y + dy));
      growToFit(d, f);
    }
  });
}

/** An item placed below its band (or container) grows it to the item's bottom, visibly, never more. */
export function growToFit(d, f) {
  const bottom = Math.ceil(f.item.y + f.item.h);
  if (f.parent) { if (bottom > f.parent.h) f.parent.h = bottom; }
  else { const sec = secOf(d, f.section); if (sec && bottom > (sec.height || 0)) sec.height = bottom; }
}

/** Move an item one place earlier (by -1) or later (+1) among its siblings: later items are drawn on top. */
export function reorderItem(id, by) {
  S().apply((d) => {
    const f = findItem(d, id);
    if (!f) return;
    const j = f.index + by;
    if (j < 0 || j >= f.list.length) return;
    [f.list[f.index], f.list[j]] = [f.list[j], f.list[f.index]];
  });
}
/** Take an item out of its container or list: it goes right after the parent, at the same place on the page. */
export function moveOutOfParent(id) {
  S().apply((d) => {
    const f = findItem(d, id);
    if (!f?.parent) return;
    const p = findItem(d, f.parent.id);
    const it = f.item;
    f.list.splice(f.index, 1);
    it.x = round(p.item.x + it.x);
    it.y = round(p.item.y + it.y);
    const room = roomFor(d, p);
    it.x = round(clamp(it.x, 0, Math.max(0, room - it.w)));
    p.list.splice(p.index + 1, 0, it);
    if (p.parent) { if (it.y + it.h > p.parent.h) p.parent.h = Math.ceil(it.y + it.h); }
    else { const sec = secOf(d, p.section); if (it.y + it.h > sec.height) sec.height = Math.ceil(it.y + it.h); }
  });
}

export function deleteSelection() {
  const { sel } = S();
  if (sel.kind !== 'items') return;
  S().apply((d) => {
    for (const id of sel.ids) { const f = findItem(d, id); if (f) f.list.splice(f.index, 1); }
  });
  S().select({ kind: 'report' });
}

export function cloneWithIds(it, used) {
  const c = JSON.parse(JSON.stringify(it));
  const fix = (x) => { x.id = rid(); x.name = uniqueName(used, String(x.name || 'Item').replace(/\d+$/, '')); (x.items || []).forEach(fix); };
  fix(c);
  return c;
}

export function duplicateSelection() {
  const { sel } = S();
  if (sel.kind !== 'items') return;
  const newIds = [];
  S().apply((d) => {
    const used = allNames(d);
    for (const id of sel.ids) {
      const f = findItem(d, id);
      if (!f) continue;
      const copy = cloneWithIds(f.item, used);
      copy.x += 8; copy.y += 8;
      f.list.push(copy);
      newIds.push(copy.id);
    }
  });
  if (newIds.length) S().select({ kind: 'items', ids: newIds });
}

/* ---- clipboard: copy / paste items, also across reports (JSON on the system clipboard) ---- */
const CLIP = 'pagewright/items@1';
export async function copySelection() {
  const { sel, def } = S();
  if (sel.kind !== 'items') return 0;
  const items = sel.ids.map(id => findItem(def, id)?.item).filter(Boolean);
  const text = JSON.stringify({ kind: CLIP, items });
  try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked: keep the in-memory copy */ }
  memClip = text;
  return items.length;
}
let memClip = null;
export async function pasteItems(section = 'body') {
  let text = null;
  try { text = await navigator.clipboard.readText(); } catch { text = memClip; }
  if (!text || !text.includes(CLIP)) text = memClip;
  let data;
  try { data = JSON.parse(text); } catch { return 0; }
  if (data?.kind !== CLIP || !Array.isArray(data.items)) return 0;
  const ids = [];
  S().apply((d) => {
    const used = allNames(d);
    for (const it of data.items) {
      const c = cloneWithIds(it, used);
      c.x += 12; c.y += 12;
      if (c.type === 'table' && !isBodyKey(section)) continue;
      secOf(d, section).items.push(c);
      ids.push(c.id);
    }
  });
  if (ids.length) S().select({ kind: 'items', ids });
  return ids.length;
}

/* ---- table parts: header, group headers, detail, group footers, footer ---- */
export const PARTS = ['header', 'detail', 'footer'];

/** Rows of a part id: 'header' | 'detail' | 'footer' | 'g<level>h' | 'g<level>f'. */
export function rowsOf(t, part, create = false) {
  const m = /^g(\d+)([hf])$/.exec(part);
  const holder = m ? t.groups?.[Number(m[1])] : t;
  if (!holder) return null;
  const key = m ? (m[2] === 'h' ? 'header' : 'footer') : part;
  if (!holder[key]) { if (!create) return []; holder[key] = []; }   // never write to frozen state while rendering
  return holder[key];
}
/** Parts in display order with labels and gutter tags. */
export function tableParts(t) {
  const gs = t.groups || [];
  return [
    { part: 'header', tag: 'H', label: 'Header' },
    ...gs.map((g, i) => ({ part: `g${i}h`, tag: `G${i + 1}`, label: `${g.name || `Group ${i + 1}`} header` })),
    { part: 'detail', tag: 'D', label: 'Detail' },
    ...gs.map((g, i) => ({ part: `g${i}f`, tag: `F${i + 1}`, label: `${g.name || `Group ${i + 1}`} footer` })).reverse(),
    { part: 'footer', tag: 'F', label: 'Footer' },
  ];
}
const allRows = (t) => tableParts(t).flatMap(p => rowsOf(t, p.part) || []);
const blankRow = (n, height = 18) => ({ height, cells: Array.from({ length: n }, () => ({ value: '' })) });

export function tableSync(t) {
  t.w = round(t.columns.reduce((s, c) => s + c.width, 0));
  t.h = round(allRows(t).reduce((a, r) => a + (r.height || 18), 0));
}
/** Which cell covers each column of each row of one part: g[row][col] = { r, c } of the merged (or plain) cell, or null. */
function owners(rows, n) {
  const g = rows.map(() => new Array(n).fill(null));
  rows.forEach((row, r) => {
    for (let c = 0; c < n; c++) {
      const cell = row.cells?.[c];
      if (!cell || g[r][c]) continue;
      const cs = Math.max(1, Math.min(cell.colSpan || 1, n - c)), rs = Math.max(1, Math.min(cell.rowSpan || 1, rows.length - r));
      for (let i = 0; i < rs; i++) for (let k = 0; k < cs; k++) g[r + i][c + k] ||= { r, c };
    }
  });
  return g;
}
/** A row's cells as a full-width array: a merged cell's other columns hold null (a row may list only its merged cell). */
const padded = (row, n) => Array.from({ length: n }, (_, c) => row.cells?.[c] ?? null);
const setSpan = (cell, n) => { if (n > 1) cell.colSpan = n; else delete cell.colSpan; };

/** Add a column before column `at`. Inside a merged cell the merge grows (on every row it covers); elsewhere an empty cell. */
export function tableInsertColumn(id, at) {
  updateItem(id, (t) => {
    const n = t.columns.length;
    t.columns.splice(at, 0, { width: 72 });
    for (const { part } of tableParts(t)) {
      const rows = rowsOf(t, part) || [];
      const g = owners(rows, n);
      rows.forEach((row, r) => {
        const cells = padded(row, n);
        const a = at > 0 ? g[r][at - 1] : null, b = at < n ? g[r][at] : null;
        if (a && b && a.r === b.r && a.c === b.c) {
          cells.splice(at, 0, null);
          if (r === a.r) setSpan(cells[a.c], (cells[a.c].colSpan || 1) + 1);
        } else cells.splice(at, 0, { value: '' });
        row.cells = cells;
      });
    }
    tableSync(t);
  });
}
/** Remove column `at`. A merged cell over it shrinks (and moves right if it started there); nothing slides under a merge. */
export function tableDeleteColumn(id, at) {
  updateItem(id, (t) => {
    const n = t.columns.length;
    if (n <= 1) return;
    t.columns.splice(at, 1);
    for (const { part } of tableParts(t)) {
      const rows = rowsOf(t, part) || [];
      const g = owners(rows, n);
      rows.forEach((row, r) => {
        const cells = padded(row, n);
        const o = g[r][at];
        if (o && o.r === r && (cells[o.c].colSpan || 1) > 1) {
          const cell = cells[o.c];
          if (o.c === at) { const moved = { ...cell }; setSpan(moved, (cell.colSpan || 1) - 1); cells[at + 1] = moved; }
          else setSpan(cell, cell.colSpan - 1);
        }
        cells.splice(at, 1);
        row.cells = cells;
      });
    }
    tableSync(t);
  });
}
export function tableInsertRow(id, part, at) {
  updateItem(id, (t) => { rowsOf(t, part, true).splice(at, 0, blankRow(t.columns.length)); tableSync(t); });
}
export function tableDeleteRow(id, part, at) {
  updateItem(id, (t) => {
    const rows = rowsOf(t, part);
    if (part === 'detail' && rows.length <= 1 && !(t.groups || []).length) return;
    rows.splice(at, 1);
    tableSync(t);
  });
}
export function tableSetColumnWidth(id, col, width, key) {
  updateItem(id, (t) => { t.columns[col].width = round(Math.max(12, width)); tableSync(t); }, key);
}
export function tableMergeRight(id, part, row, col) {
  updateItem(id, (t) => {
    const cells = rowsOf(t, part)[row].cells;
    const c = cells[col];
    const span = c.colSpan || 1;
    if (col + span >= cells.length) return;
    cells[col + span] = null;
    c.colSpan = span + 1;
  });
}
export function tableSplit(id, part, row, col) {
  updateItem(id, (t) => {
    const cells = rowsOf(t, part)[row].cells;
    const c = cells[col];
    const span = c.colSpan || 1;
    for (let k = 1; k < span; k++) cells[col + k] = { value: '' };
    delete c.colSpan;
  });
}
/** Merge a cell with the cell below it (rowSpan), within the same rows of the table (header, a group's rows, detail, footer). */
export function tableMergeDown(id, part, row, col) {
  updateItem(id, (t) => {
    const rows = rowsOf(t, part);
    const c = rows[row].cells[col];
    const rs = c.rowSpan || 1;
    if (row + rs >= rows.length) return;
    for (let k = 0; k < (c.colSpan || 1); k++) rows[row + rs].cells[col + k] = null;
    c.rowSpan = rs + 1;
  });
}
export function tableSplitRows(id, part, row, col) {
  updateItem(id, (t) => {
    const rows = rowsOf(t, part);
    const c = rows[row].cells[col];
    for (let r = 1; r < (c.rowSpan || 1); r++) if (rows[row + r]) rows[row + r].cells[col] = { value: '' };
    delete c.rowSpan;
  });
}
/** Add an innermost group. The header shows the group value; the footer sums number columns. */
export function tableAddGroup(id, field, numericCols = []) {
  updateItem(id, (t) => {
    t.groups ||= [];
    const n = t.columns.length;
    const used = new Set(t.groups.map(g => g.name));
    let name = field ? field.replace(/^./, c => c.toUpperCase()) : 'Group';
    while (used.has(name)) name += '_';
    const header = blankRow(n);
    header.style = { fontWeight: 'bold', backgroundColor: '#f8fafc' };
    header.cells[0].value = field ? `=Fields.${field}` : '';
    const footer = blankRow(n);
    footer.style = { fontWeight: '600', borderTop: '0.5 solid #cbd5e1' };
    footer.cells[0].value = field ? `Subtotal {Fields.${field}}` : 'Subtotal';
    for (const [ci, f] of numericCols) if (ci > 0 && ci < n) footer.cells[ci] = { value: `=Sum(Fields.${f})`, style: { format: 'N2' } };
    t.groups.push({ name, expr: field ? `=Fields.${field}` : '', sort: 'asc', header: [header], footer: [footer] });
    tableSync(t);
  });
}
export function tableRemoveGroup(id, level) {
  updateItem(id, (t) => { t.groups.splice(level, 1); tableSync(t); });
}

export const round = (v) => Math.round(v * 100) / 100;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---- cell-based design: whole cells, no overlap (stored as plain x/y/w/h) ---- */
const CELL_TAKEN = () => t(S().lang, 'cellTaken');
const overlap = (a, b) => a.x < b.x + Math.max(b.w, 1) - 0.01 && b.x < a.x + Math.max(a.w, 1) - 0.01 && a.y < b.y + Math.max(b.h, 1) - 0.01 && b.y < a.y + Math.max(a.h, 1) - 0.01;
export const overlapsAny = (it, list) => list.some(o => o !== it && o.id !== it.id && overlap(it, o));
export function snapCells(it) {
  const c = S().cellSize;
  for (const k of ['x', 'y']) it[k] = Math.round(it[k] / c) * c;
  for (const k of ['w', 'h']) if (it.type !== 'line' && it.type !== 'table') it[k] = Math.max(c, Math.round(it[k] / c) * c);
}
/** Would moving or resizing these items (rectOf gives each new box) overlap an item beside them? */
export function wouldOverlap(def, ids, rectOf) {
  for (const id of ids) {
    const f = findItem(def, id);
    if (!f) continue;
    const r = rectOf(f.item);
    if (f.list.some(o => !ids.includes(o.id) && overlap(r, o))) return true;
  }
  return false;
}
