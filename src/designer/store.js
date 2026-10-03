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

const rid = () => Math.random().toString(36).slice(2, 10);

/** Give every item an id and a unique name. Runs once on load. */
export function normalize(def) {
  return produce(def, (d) => {
    d.sections ||= {};
    for (const { key } of SECTIONS) {
      d.sections[key] ||= { height: key === 'body' ? 420 : 0, items: [] };
      d.sections[key].items ||= [];
    }
    const used = new Set();
    for (const { key } of SECTIONS) for (const it of d.sections[key].items) { if (it.name) used.add(it.name); }
    for (const { key } of SECTIONS) {
      for (const it of d.sections[key].items) {
        it.id ||= rid();
        if (!it.name) it.name = uniqueName(used, ITEMS[it.type]?.label.replace(/\s/g, '') || 'Item');
      }
    }
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

export function findItem(def, id) {
  for (const { key } of SECTIONS) {
    const items = def.sections?.[key]?.items || [];
    const index = items.findIndex(i => i.id === id);
    if (index >= 0) return { section: key, index, item: items[index] };
  }
  return null;
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
  sample: null, // { dataSets, error, loading }
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
    } else if (sel.kind === 'cell' && !findItem(def, sel.id)) set({ sel: { kind: 'report' } });
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

export function addItem(type, section, x, y, extra = {}) {
  const spec = ITEMS[type];
  const id = rid();
  S().apply((d) => {
    const used = new Set(SECTIONS.flatMap(s => d.sections[s.key].items.map(i => i.name)));
    const it = { ...spec.defaults(), ...extra, id, name: uniqueName(used, spec.label.replace(/\s/g, '')) };
    const bw = bodyWidth(d);
    it.w = Math.min(it.w, bw);
    it.x = clamp(x, 0, Math.max(0, bw - it.w));
    it.y = Math.max(0, y);
    if (type === 'table') it.w = it.columns.reduce((s, c) => s + c.width, 0);
    d.sections[section].items.push(it);
    const sec = d.sections[section];
    if (it.y + it.h > sec.height) sec.height = Math.ceil(it.y + it.h + (section === 'body' ? 24 : 4));
  });
  S().select({ kind: 'items', ids: [id] });
  return id;
}

export function updateItem(id, recipe, key) {
  S().apply((d) => { const f = findItem(d, id); if (f) recipe(f.item, d, f.section); }, key);
}

export function moveItems(ids, dx, dy) {
  if (!dx && !dy) return;
  S().apply((d) => {
    const bw = bodyWidth(d);
    for (const id of ids) {
      const f = findItem(d, id);
      if (!f) continue;
      f.item.x = round(clamp(f.item.x + dx, 0, Math.max(0, bw - f.item.w)));
      f.item.y = round(Math.max(0, f.item.y + dy));
      const sec = d.sections[f.section];
      if (f.item.y + f.item.h > sec.height) sec.height = Math.ceil(f.item.y + f.item.h);
    }
  });
}

export function deleteSelection() {
  const { sel } = S();
  if (sel.kind !== 'items') return;
  S().apply((d) => {
    for (const id of sel.ids) { const f = findItem(d, id); if (f) d.sections[f.section].items.splice(f.index, 1); }
  });
  S().select({ kind: 'report' });
}

export function duplicateSelection() {
  const { sel } = S();
  if (sel.kind !== 'items') return;
  const newIds = [];
  S().apply((d) => {
    const used = new Set(SECTIONS.flatMap(s => d.sections[s.key].items.map(i => i.name)));
    for (const id of sel.ids) {
      const f = findItem(d, id);
      if (!f) continue;
      const copy = JSON.parse(JSON.stringify(f.item));
      copy.id = rid();
      copy.name = uniqueName(used, f.item.name.replace(/\d+$/, ''));
      copy.x += 8; copy.y += 8;
      d.sections[f.section].items.push(copy);
      newIds.push(copy.id);
    }
  });
  if (newIds.length) S().select({ kind: 'items', ids: newIds });
}

/* ---- table commands ---- */
export const PARTS = ['header', 'detail', 'footer'];
const blankRow = (n, height = 18) => ({ height, cells: Array.from({ length: n }, () => ({ value: '' })) });

export function tableSync(t) {
  t.w = round(t.columns.reduce((s, c) => s + c.width, 0));
  t.h = round(PARTS.reduce((s, p) => s + (t[p] || []).reduce((a, r) => a + (r.height || 18), 0), 0));
}
export function tableInsertColumn(id, at) {
  updateItem(id, (t) => {
    const w = 72;
    t.columns.splice(at, 0, { width: w });
    for (const p of PARTS) for (const r of t[p] || []) r.cells.splice(at, 0, { value: '' });
    tableSync(t);
  });
}
export function tableDeleteColumn(id, at) {
  updateItem(id, (t) => {
    if (t.columns.length <= 1) return;
    t.columns.splice(at, 1);
    for (const p of PARTS) for (const r of t[p] || []) {
      r.cells.splice(at, 1);
      // a span that covered the removed column shrinks
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
  updateItem(id, (t) => { t[part] ||= []; t[part].splice(at, 0, blankRow(t.columns.length)); tableSync(t); });
}
export function tableDeleteRow(id, part, at) {
  updateItem(id, (t) => {
    if (part === 'detail' && (t.detail || []).length <= 1) return;
    t[part].splice(at, 1);
    tableSync(t);
  });
}
export function tableSetColumnWidth(id, col, width, key) {
  updateItem(id, (t) => { t.columns[col].width = round(Math.max(12, width)); tableSync(t); }, key);
}
export function tableMergeRight(id, part, row, col) {
  updateItem(id, (t) => {
    const cells = t[part][row].cells;
    const c = cells[col];
    const span = c.colSpan || 1;
    if (col + span >= cells.length) return;
    cells[col + span] = null;
    c.colSpan = span + 1;
  });
}
export function tableSplit(id, part, row, col) {
  updateItem(id, (t) => {
    const cells = t[part][row].cells;
    const c = cells[col];
    const span = c.colSpan || 1;
    for (let k = 1; k < span; k++) cells[col + k] = { value: '' };
    delete c.colSpan;
  });
}

export const round = (v) => Math.round(v * 100) / 100;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
