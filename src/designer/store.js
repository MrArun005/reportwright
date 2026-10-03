'use client';
import { create } from 'zustand';
import { produce } from 'immer';
import { ITEMS } from '@/engine/items/index.js';
import { resolvePage } from '@/engine/units.js';

export const SECTIONS = [
  { key: 'pageHeader', label: 'Page header' },
  { key: 'body', label: 'Body' },
  { key: 'pageFooter', label: 'Page footer' },
];
export const NESTING = new Set(['container', 'list']);

const rid = () => Math.random().toString(36).slice(2, 10);

/** Visit every item, nested ones included. fn(item, list, index, parent, section) */
export function walk(def, fn) {
  const go = (list, parent, section) => list.forEach((it, i) => { fn(it, list, i, parent, section); if (Array.isArray(it.items)) go(it.items, it, section); });
  for (const { key } of SECTIONS) go(def.sections?.[key]?.items || [], null, key);
}
const allNames = (d) => { const s = new Set(); walk(d, it => { if (it.name) s.add(it.name); }); return s; };

/** Give every item an id and a unique name. Runs once on load. */
export function normalize(def) {
  return produce(def, (d) => {
    d.sections ||= {};
    for (const { key } of SECTIONS) {
      d.sections[key] ||= { height: key === 'body' ? 420 : 0, items: [] };
      d.sections[key].items ||= [];
    }
    const used = allNames(d);
    walk(d, (it) => {
      it.id ||= rid();
      if (!it.name) it.name = uniqueName(used, ITEMS[it.type]?.label.replace(/\s/g, '') || 'Item');
      if (NESTING.has(it.type)) it.items ||= [];
    });
    const b = d.sections.body;
    const bottom = Math.max(0, ...b.items.map(i => i.y + i.h));
    if (!b.height || b.height < bottom + 24) b.height = Math.ceil(bottom + 60);
  });
}
function uniqueName(used, base) {
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
  unit: 'pt',
  sample: null,
  /** chart gallery dialog: {mode:'insert', section, x, y, extra, parentId} | {mode:'edit', id} */
  wizard: null,
  lastKey: null,
  lastAt: 0,

  init(id, def) { set({ id, def: normalize(def), saved: true, past: [], future: [], sel: { kind: 'report' } }); },

  /** Apply an immer recipe to the definition and record history. Same key within 800 ms merges. */
  apply(recipe, key = null) {
    const { def, past, lastKey, lastAt } = get();
    const next = produce(def, recipe);
    if (next === def) return;
    const now = Date.now();
    const merge = key && key === lastKey && now - lastAt < 800;
    set({ def: next, past: merge ? past : [...past.slice(-199), def], future: [], saved: false, lastKey: key, lastAt: now });
  },
  undo() {
    const { past, def, future } = get();
    if (!past.length) return;
    set({ def: past[past.length - 1], past: past.slice(0, -1), future: [def, ...future].slice(0, 200), saved: false, lastKey: null });
    get().fixSelection();
  },
  redo() {
    const { past, def, future } = get();
    if (!future.length) return;
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
    const { id, def } = get();
    set({ saving: true, saveError: null });
    try {
      const res = await fetch(`/api/reports/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(def) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      if (get().def === def) set({ saved: true });
    } catch (e) {
      set({ saveError: e.message });
    } finally { set({ saving: false }); }
  },
}));

/* ------------------------------------------------------------ commands */
const S = () => useDesigner.getState();

export function bodyWidth(def) { return resolvePage(def.page).bodyWidth; }
/** Width available to an item: the band width, or its parent's width. */
function roomFor(d, f) { return f.parent ? f.parent.w : bodyWidth(d); }

export function addItem(type, section, x, y, extra = {}, parentId = null) {
  const spec = ITEMS[type];
  const id = rid();
  S().apply((d) => {
    const used = allNames(d);
    const it = { ...spec.defaults(), ...extra, id, name: uniqueName(used, spec.label.replace(/\s/g, '')) };
    const parent = parentId ? findItem(d, parentId)?.item : null;
    const room = parent ? parent.w : bodyWidth(d);
    if (type === 'table') it.w = it.columns.reduce((s, c) => s + c.width, 0);
    else it.w = Math.min(it.w, room);
    it.x = clamp(x, 0, Math.max(0, room - it.w));
    it.y = Math.max(0, y);
    if (parent) {
      parent.items.push(it);
      if (it.y + it.h > parent.h) parent.h = Math.ceil(it.y + it.h);
    } else {
      d.sections[section].items.push(it);
      const sec = d.sections[section];
      if (it.y + it.h > sec.height) sec.height = Math.ceil(it.y + it.h + (section === 'body' ? 24 : 4));
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
  return addItem(type, section, x, y, extra, parentId);
}

export function updateItem(id, recipe, key) {
  S().apply((d) => { const f = findItem(d, id); if (f) recipe(f.item, d, f.section, f); }, key);
}

export function moveItems(ids, dx, dy) {
  if (!dx && !dy) return;
  S().apply((d) => {
    for (const id of ids) {
      const f = findItem(d, id);
      if (!f) continue;
      const room = roomFor(d, f);
      f.item.x = round(clamp(f.item.x + dx, 0, Math.max(0, room - f.item.w)));
      f.item.y = round(Math.max(0, f.item.y + dy));
      if (f.parent) { if (f.item.y + f.item.h > f.parent.h) f.parent.h = Math.ceil(f.item.y + f.item.h); }
      else { const sec = d.sections[f.section]; if (f.item.y + f.item.h > sec.height) sec.height = Math.ceil(f.item.y + f.item.h); }
    }
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

function cloneWithIds(it, used) {
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
      if (c.type === 'table' && section !== 'body') continue;
      d.sections[section].items.push(c);
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
export function tableInsertColumn(id, at) {
  updateItem(id, (t) => {
    t.columns.splice(at, 0, { width: 72 });
    for (const r of allRows(t)) r.cells.splice(at, 0, { value: '' });
    tableSync(t);
  });
}
export function tableDeleteColumn(id, at) {
  updateItem(id, (t) => {
    if (t.columns.length <= 1) return;
    t.columns.splice(at, 1);
    for (const r of allRows(t)) {
      r.cells.splice(at, 1);
      for (let i = 0; i < r.cells.length; i++) { const c = r.cells[i]; if (c && c.colSpan > 1 && i + c.colSpan > r.cells.length) c.colSpan = r.cells.length - i; }
      for (let i = 0; i < r.cells.length; i++) if (r.cells[i] === null && !coveredBySpan(r.cells, i)) r.cells[i] = { value: '' };
    }
    tableSync(t);
  });
}
function coveredBySpan(cells, i) {
  for (let k = 0; k < i; k++) { const c = cells[k]; if (c && (c.colSpan || 1) > i - k) return true; }
  return false;
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
