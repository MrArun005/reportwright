'use client';
import { createStore, useStore } from 'zustand';
import { createContext, useContext } from 'react';
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
  const [k, i, sub] = String(key).split(':');
  const s = d?.sections?.[k];
  const b = Array.isArray(s) ? s[Number(i || 0)] : s;
  return sub ? b?.[sub] : b;
}
/** A body section's key ('body', 'body:2'); not its own page header or footer ('body:2:pageHeader'). */
export const isBodyKey = (key) => { const p = String(key).split(':'); return p[0] === 'body' && !p[2]; };
/** The body section a band belongs to: itself, or the section whose own page header or footer it is. */
export const bodyKeyOf = (key) => { const p = String(key).split(':'); return p[0] === 'body' ? (p[1] && p[1] !== '0' ? `body:${p[1]}` : 'body') : null; };
/** A named placeholder's content in a content report ('content:0' → sections.content[0]); it lies in the master's body. */
export const isContentKey = (key) => String(key).split(':')[0] === 'content';
/** A body section's own page header or footer (an object, not hidden): it gets a band of its own. */
export const ownBand = (b, k) => !!(b && b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && !b[k].hidden);
/** Every band of the report, in page order. */
export function sectionList(def) {
  const b = def?.sections?.body;
  // the built-in band names in the UI language (a body section's own name stays as written)
  const lang = typeof useDesigner === 'function' ? useDesigner.getState().lang : 'en';
  const L = (k, en) => { const s = t(lang, k); return s === k ? en : s; };
  const bodies = Array.isArray(b) ? b.map((x, i) => ({ key: i ? `body:${i}` : 'body', label: x?.name || L('band_section', `Section ${i + 1}`).replace('{n}', i + 1), index: i })) : [{ key: 'body', label: L('band_body', 'Body'), index: 0 }];
  // a body section with its own page header or footer: those bands sit above and below it
  const list = Array.isArray(b) ? b : [b];
  const withOwn = bodies.flatMap((s) => {
    const x = list[s.index];
    return [
      ...(ownBand(x, 'pageHeader') ? [{ key: `body:${s.index}:pageHeader`, label: L('band_sectionHeader', '{section} · page header').replace('{section}', s.label), index: s.index, own: 'pageHeader' }] : []),
      s,
      ...(ownBand(x, 'pageFooter') ? [{ key: `body:${s.index}:pageFooter`, label: L('band_sectionFooter', '{section} · page footer').replace('{section}', s.label), index: s.index, own: 'pageFooter' }] : []),
    ];
  });
  // a content report's named placeholders (sections.content): the canvas draws them inside the master's body
  const content = (Array.isArray(def?.sections?.content) ? def.sections.content : []).map((c, i) => ({ key: `content:${i}`, label: L('band_placeholder', 'Placeholder “{name}”').replace('{name}', String(c?.placeholder ?? i + 1)), index: i }));
  return [{ ...SECTIONS[0], label: L('band_pageHeader', SECTIONS[0].label) }, ...withOwn, ...content, { ...SECTIONS[2], label: L('band_pageFooter', SECTIONS[2].label) }];
}
/** The page of a band: the report's page, with a body section's own page settings on top. */
export function pageOf(def, key = 'body') {
  const bk = bodyKeyOf(key); // a section's own page header and footer have its page
  const sec = bk && Array.isArray(def.sections?.body) ? secOf(def, bk) : null;
  return resolvePage({ ...(def.page || {}), ...(sec?.page || {}) });
}

const rid = () => Math.random().toString(36).slice(2, 10);
/** An id from the item's place (band, path) and name: opening the same file twice gives the same ids (N38). FNV-1a. */
export function stableId(key, taken) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let id = `i${(h >>> 0).toString(36)}`;
  for (let k = 2; taken.has(id); k++) id = `i${(h >>> 0).toString(36)}_${k}`;
  taken.add(id);
  return id;
}

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
    for (const { key } of sectionList(d)) { const x = secOf(d, key); if (x && typeof x === 'object') x.items ||= []; }
    const used = allNames(d);
    const ids = new Set();
    walk(d, (it) => { if (it.id) ids.add(it.id); });
    const path = new Map(); // item → its place, e.g. body/2/0 (the third item's first child)
    walk(d, (it, list, i, parent, section) => {
      path.set(it, `${parent ? path.get(parent) : section}/${i}`);
      if (!it.name) it.name = uniqueName(used, ITEMS[it.type]?.label.replace(/\s/g, '') || 'Item');
      it.id ||= stableId(`${path.get(it)}/${it.name}`, ids);
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
const nextFree = new WeakMap(); // used → base → the number to try first (a paste of 10,000 items counted up from 1 each time)
export function uniqueName(used, base) {
  let hint = nextFree.get(used);
  if (!hint) nextFree.set(used, hint = new Map());
  let i = hint.get(base) || 1;
  while (used.has(`${base}${i}`)) i++;
  used.add(`${base}${i}`);
  hint.set(base, i + 1);
  return `${base}${i}`;
}

/** Find an item anywhere. Returns { section, list, index, item, parent } or null. */
export function findItem(def, id) {
  let hit = null;
  walk(def, (it, list, index, parent, section) => { if (!hit && it.id === id) hit = { section, list, index, item: it, parent }; });
  return hit;
}

/** A designer's state. One per Designer (two designers on a page never share one: N17). */
export const newDesignerStore = () => createStore((set, get) => ({
  id: null,
  def: null,
  saved: true,
  saving: false,
  rev: null, // the server revision this designer edits from (If-Match on save)
  conflict: null, // { rev, error }: a save met someone else's newer save (ConflictBar)
  saveError: null,
  saveCheck: null, // { missing }: what the server found on the last save (drill-through reports that do not exist)
  past: [],
  future: [],
  /** selection: {kind:'report'} | {kind:'section', section} | {kind:'items', ids} | {kind:'cell', id, part, row, col} */
  sel: { kind: 'report' },
  tab: 'design',
  zoom: 'fit', // the page fits the canvas width; the zoom picked last (this browser) wins
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
    get().selectChanged(def);
  },
  redo() {
    const { past, def, future } = get();
    if (!future.length || get().readOnly) return;
    set({ def: future[0], future: future.slice(1), past: [...past, def], saved: false, lastKey: null });
    get().selectChanged(def);
  },
  /**
   * After undo or redo: select the items the step brought back or changed (#25), e.g. the item a redo inserts again, the
   * items an undo of a delete restores, the item an undo of a move puts back. A step that changed no item (or a table's
   * cells, while a cell is selected) keeps the selection, without what is gone.
   */
  selectChanged(before) {
    const { def, sel } = get();
    const old = new Map();
    walk(before, (it) => { if (it.id) old.set(it.id, it); });
    const added = [], changed = [];
    const ancestors = new Set(); // a changed child changes its container too (immer): the child is what changed
    walk(def, (it, _l, _i, parent) => {
      const o = old.get(it.id);
      if (o === it) return;
      (o ? changed : added).push(it);
      for (let p = parent; p; p = findItem(def, p.id)?.parent) ancestors.add(p.id);
    });
    const top = (list) => list.filter(it => !list.some(p => p !== it && p.items?.includes(it))).map(it => it.id);
    const ids = added.length ? top(added) : top(changed.filter(it => !ancestors.has(it.id)));
    const keepCell = sel.kind === 'cell' && ids.length === 1 && ids[0] === sel.id;
    if (ids.length && !keepCell) set({ sel: { kind: 'items', ids } });
    else get().fixSelection();
  },
  fixSelection() {
    const { sel, def } = get();
    if (sel.kind === 'items') {
      const ids = sel.ids.filter(id => findItem(def, id));
      set({ sel: ids.length ? { kind: 'items', ids } : { kind: 'report' } });
    } else if (sel.kind === 'cell') {
      const f = findItem(def, sel.id);
      if (!f || !rowsOf(f.item, sel.part)?.[sel.row]) set({ sel: f ? { kind: 'items', ids: [sel.id] } : { kind: 'report' } });
      else if (sel.cells) { const cells = sel.cells.filter(c => rowsOf(f.item, c.part)?.[c.row]?.cells?.[c.col]); set({ sel: { ...sel, cells: cells.length > 1 ? cells : undefined } }); }
    }
  },
  select(sel) { set({ sel, lastKey: null }); },
  setUi(patch) { set(patch); },

  /**
   * Save to the server, as the revision this designer opened (If-Match: rev). Someone else's save since then is a
   * 409: nothing is overwritten, and `conflict` { rev } asks the user to choose (Designer.jsx ConflictBar): overwrite
   * on purpose (save({ overwrite: true }): If-Match is their revision) or take theirs (reload).
   * @param {{ overwrite?: boolean }} [o]
   */
  async save({ overwrite = false } = {}) {
    const { id, def, embed, readOnly, rev, conflict } = get();
    if (readOnly) return;
    set({ saving: true, saveError: null });
    try {
      // embedded: the host app saves (onSave gets a plain copy), or the ReportWright server it named
      if (embed?.onSave) await embed.onSave(JSON.parse(JSON.stringify(def)));
      else {
        if (!id) throw new Error('This report has no id to save to');
        // no revision known (a new report, an embed without one): a new id needs none, an existing one is a 428
        const match = overwrite && conflict?.rev ? conflict.rev : rev;
        const res = await fetch(`${embed?.server || ''}/api/reports/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...(match ? { 'if-match': `"${match}"` } : {}) }, body: JSON.stringify(def) });
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 || res.status === 428) { set({ conflict: { rev: body.rev || null, error: body.error || '' } }); return; }
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        set({ rev: body.rev || null, conflict: null, saveCheck: { missing: Array.isArray(body.missing) ? body.missing : [] } });
      }
      if (get().def === def) set({ saved: true });
    } catch (e) {
      set({ saveError: e.message });
    } finally { set({ saving: false }); }
  },
  /** Take the other save: load the report as it is on the server now (my unsaved changes are dropped). */
  async takeTheirs() {
    const { id, embed } = get();
    const res = await fetch(`${embed?.server || ''}/api/reports/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) { set({ saveError: `HTTP ${res.status}` }); return; }
    const def = await res.json();
    get().init(id, def);
    set({ rev: (res.headers.get('etag') || '').replace(/^W\/|"/g, '') || null, conflict: null });
  },
}));

/**
 * The store of the designer in use. Hooks read the store of their own Designer (DesignerStore context). The commands
 * below and useDesigner.getState() read the active one: a Designer makes its store active when it renders and on
 * every event inside it (Designer.jsx), so a click in one designer edits that designer.
 */
let active = newDesignerStore();
export const DesignerStore = createContext(null);
export const activateStore = (store) => { active = store; };
export const activeStore = () => active;
/** The store of the Designer this component is in (for effects and async work, which may run while another is active). */
export const useDesignerStore = () => useContext(DesignerStore) || active;
/** @type {any} */
export const useDesigner = (sel) => useStore(useDesignerStore(), sel);
useDesigner.getState = () => active.getState();
useDesigner.setState = (...a) => active.setState(...a);
useDesigner.subscribe = (fn) => active.subscribe(fn);

/* ------------------------------------------------------------ commands */
const S = () => active.getState();

export function bodyWidth(def, key = 'body') { return pageOf(def, key).bodyWidth; }
/** Width available to an item: the band width, or its parent's width. */
function roomFor(d, f) { return f.parent ? f.parent.w : bodyWidth(d, f.section); }
/** Items on a locked or hidden layer: drawn (or not), never selected, moved, aligned or deleted. */
export function lockedIds(def) {
  const lay = new Set((def?.layers || []).filter(l => l && (l.locked || l.visible === false)).map(l => l.name));
  const out = new Set();
  if (lay.size) walk(def, (it) => { if (it.layer != null && lay.has(it.layer)) out.add(it.id); });
  return out;
}
/** Every item's place in one walk (findItem per id walks the whole report each time: 1,000 items took seconds). */
function indexItems(d) {
  const m = new Map();
  walk(d, (item, list, index, parent, section) => { if (!m.has(item.id)) m.set(item.id, { item, list, index, parent, section }); });
  return m;
}
/** growToFit, then each container around it in turn: a child that grew never pushes its container past its band. */
function growUp(d, f, idx = null) {
  for (let cur = f; cur;) {
    growToFit(d, cur);
    if (!cur.parent) return;
    cur = idx?.get(cur.parent.id) || findItem(d, cur.parent.id);
  }
}
/** A table, matrix or subreport in the item or anywhere inside it. */
export const holdsBodyOnly = (it) => !!it && (BODY_ONLY.has(it.type) || (Array.isArray(it.items) && it.items.some(holdsBodyOnly)));

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
      // the container grew: its own container and its band grow with it, not over the next band (#1b)
      for (let pf = findItem(d, parent.id); pf; pf = pf.parent ? findItem(d, pf.parent.id) : null) growToFit(d, pf);
    } else {
      const sec = secOf(d, section);
      sec.items.push(it);
      if (it.y + it.h > (sec.height || 0)) sec.height = Math.ceil(it.y + it.h + (isBodyKey(section) ? 24 : 4)); // also a 0 pt band
    }
  });
  S().select({ kind: 'items', ids: [id] });
  return id;
}

/** The band a selection is in: the selected band, the band of the (first) selected item or cell, else the body. */
export function selectedBand(def, sel) {
  if (sel?.kind === 'section' && secOf(def, sel.section)) return sel.section;
  const id = sel?.kind === 'items' ? sel.ids?.[0] : sel?.kind === 'cell' ? sel.id : null;
  return (id && findItem(def, id)?.section) || 'body';
}
/** Items that only go in a body section (or a content report's placeholder), never in a page header or footer. */
export const BODY_ONLY = new Set(['table', 'matrix', 'subreport']);
/** The y below a list of items (8 pt gap, on a 4 pt step); 0 for none. */
const belowItems = (items) => (items.length ? Math.ceil((items.reduce((m, i) => Math.max(m, i.y + i.h), -Infinity) + 8) / 4) * 4 : 0);
/**
 * Where the toolbox's Insert puts a new item (#12): inside the selected list or container (below its items); else in
 * the selected band, or the band (or container) of the selected item, below its items; nothing selected: the body.
 * A table, matrix or subreport for a page header or footer goes to the body. `type` is the item to insert.
 * @returns {{ section: string, parentId: string|null, y: number }}
 */
export function insertSpot(def, sel, type = null) {
  const id = sel?.kind === 'items' ? sel.ids?.[0] : sel?.kind === 'cell' ? sel.id : null;
  const f = id ? findItem(def, id) : null;
  const one = sel?.kind === 'items' && sel.ids?.length === 1;
  let at = null;
  if (f && one && Array.isArray(f.item.items)) at = { section: f.section, parentId: f.item.id, y: belowItems(f.item.items) };
  else if (f?.parent) at = { section: f.section, parentId: f.parent.id, y: belowItems(f.parent.items) };
  else if (f) at = { section: f.section, parentId: null, y: belowItems(secOf(def, f.section)?.items || []) };
  else if (sel?.kind === 'section' && secOf(def, sel.section)) at = { section: sel.section, parentId: null, y: belowItems(secOf(def, sel.section).items || []) };
  if (at && type && BODY_ONLY.has(type) && !isBodyKey(at.section) && !isContentKey(at.section)) at = null;
  return at || { section: 'body', parentId: null, y: belowItems(secOf(def, 'body').items) };
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
  S().apply((d) => {
    const f = findItem(d, id);
    if (!f) return;
    recipe(f.item, d, f.section, f);
    minSize(f.item);
    const nf = findItem(d, id); // the recipe may have moved it
    if (nf) growUp(d, nf); // a table that got taller (a group added) pushes its band down, not over the next one
  }, key);
}
/** No item smaller than 1 pt (a 0 × 0 box can neither be seen nor clicked: N33); a line may be 0 one way, not both. */
export function minSize(it) {
  for (const k of ['w', 'h']) if (typeof it[k] === 'number' && !(it[k] >= 0)) it[k] = 0;
  if (it.type === 'line') { if (it.w === 0 && it.h === 0) it.w = 1; return; }
  for (const k of ['w', 'h']) if (typeof it[k] === 'number' && it[k] < 1) it[k] = 1;
}

/** A drag keeps items inside their band; a keyboard nudge ({ nudge: true }) moves the whole step (E12: an item as wide
 * as the body had 0.28 pt of room on A4 with margins), never before the band's start; the Issues panel flags overflow. */
export function moveItems(ids, dx, dy, { nudge = false, to = null } = {}) {
  const locked = lockedIds(S().def);
  if (locked.size) ids = ids.filter(id => !locked.has(id));
  if (!ids.length) return;
  if (to && moveToBand(ids, dx, dy, to)) return;
  if (!dx && !dy) return;
  if (S().cells && wouldOverlap(S().def, ids, (it) => ({ x: it.x + dx, y: it.y + dy, w: it.w, h: it.h }))) { S().setUi({ saveError: CELL_TAKEN() }); setTimeout(() => S().setUi({ saveError: null }), 2500); return; }
  S().apply((d) => {
    const idx = indexItems(d);
    for (const id of ids) {
      const f = idx.get(id);
      if (!f) continue;
      const room = roomFor(d, f);
      f.item.x = round(nudge ? Math.max(0, f.item.x + dx) : clamp(f.item.x + dx, 0, Math.max(0, room - f.item.w)));
      f.item.y = round(Math.max(0, f.item.y + dy));
      growUp(d, f, idx);
    }
  });
}

/**
 * A drag that ends over another band moves the items into it (#12), in one undo step. to: { section, ox, oy }: the
 * band dropped on and where its top left is from the top left of the items' band, in pt. Only items of one band, none
 * inside a container, and never a table, matrix or subreport into a page header or footer.
 * @returns {boolean} whether they moved (false: an ordinary move in their own band)
 */
function moveToBand(ids, dx, dy, to) {
  const { def } = S();
  const fs = ids.map(id => findItem(def, id));
  if (!fs.length || !secOf(def, to.section) || fs.some(f => !f || f.parent || f.section !== fs[0].section)) return false;
  if (fs[0].section === to.section) return false;
  if (!isBodyKey(to.section) && !isContentKey(to.section) && fs.some(f => holdsBodyOnly(f.item))) return false; // also one inside a container
  const room = bodyWidth(def, to.section);
  // the bands are not a whole number of grid steps apart: the y in the new band snaps again (to the grid, or to cells)
  const { snap, grid, cells, cellSize } = S();
  const step = cells ? cellSize : snap ? grid : 0;
  const snapY = (v) => (step ? Math.round(v / step) * step : v);
  const place = (it) => ({ x: round(clamp(it.x + dx - (to.ox || 0), 0, Math.max(0, room - it.w))), y: round(Math.max(0, snapY(it.y + dy - (to.oy || 0)))) });
  if (S().cells && fs.some(f => overlapsAny({ ...f.item, ...place(f.item) }, secOf(def, to.section).items || []))) { S().setUi({ saveError: CELL_TAKEN() }); setTimeout(() => S().setUi({ saveError: null }), 2500); return true; }
  S().apply((d) => {
    const dest = secOf(d, to.section);
    dest.items ||= [];
    for (const id of ids) {
      const f = findItem(d, id);
      if (!f) continue;
      f.list.splice(f.index, 1);
      Object.assign(f.item, place(f.item));
      dest.items.push(f.item);
      growToFit(d, { section: to.section, parent: null, item: f.item });
    }
  });
  return true;
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

/**
 * The outline's drag and drop (and its keyboard moves): put an item at `index` in the list of `parentId` (a container or
 * list; null for the band). The canvas's rules: an item stays in its band, any item can go into a container or list but
 * never into itself or one of its own children; it keeps its place on the page, kept inside its new parent's width, and
 * the parent (or band) grows to fit it. `index` counts the destination list as it is before the move.
 * @returns {boolean} whether it moved
 */
export function moveItemTo(id, parentId, index) {
  let moved = false;
  S().apply((d) => {
    const f = findItem(d, id);
    if (!f) return;
    const dp = parentId ? findItem(d, parentId) : null;
    if (parentId && (!dp || !NESTING.has(dp.item.type) || dp.section !== f.section)) return;
    for (let q = dp; q; q = q.parent ? findItem(d, q.parent.id) : null) if (q.item.id === id) return; // into itself
    // where each list's x/y 0 is on the band: the sum of its parents' positions
    const origin = (ff) => { let x = 0, y = 0; for (let q = ff; q?.parent;) { q = findItem(d, q.parent.id); x += q.item.x; y += q.item.y; } return { x, y }; };
    const from = origin(f);
    const to = dp ? (({ x, y }) => ({ x: x + dp.item.x, y: y + dp.item.y }))(origin(dp)) : { x: 0, y: 0 };
    const dest = dp ? (dp.item.items ||= []) : secOf(d, f.section).items;
    let at = Math.max(0, Math.min(dest.length, Math.round(Number(index)) || 0));
    if (dest === f.list) { if (at > f.index) at--; if (at === f.index) return; }
    const it = f.item;
    f.list.splice(f.index, 1);
    const room = dp ? dp.item.w : bodyWidth(d, f.section);
    if (it.type !== 'table') it.w = Math.min(it.w, room);
    it.x = round(clamp(it.x + from.x - to.x, 0, Math.max(0, room - it.w)));
    it.y = round(Math.max(0, it.y + from.y - to.y));
    dest.splice(at, 0, it);
    const nf = findItem(d, id);
    growToFit(d, nf);
    if (nf.parent) { const pf = findItem(d, nf.parent.id); if (pf) growToFit(d, pf); }
    moved = true;
  });
  return moved;
}

export function deleteSelection() {
  const { sel } = S();
  if (sel.kind !== 'items') return;
  const locked = lockedIds(S().def);
  S().apply((d) => {
    for (const id of sel.ids) { if (locked.has(id)) continue; const f = findItem(d, id); if (f) f.list.splice(f.index, 1); }
  });
  const kept = sel.ids.filter(id => locked.has(id) && findItem(S().def, id));
  S().select(kept.length ? { kind: 'items', ids: kept } : { kind: 'report' });
}

/** Ctrl+A (#6): select every item of the selected band, or of the selected item's band; nothing selected: the body. */
export function selectAllItems() {
  const { def, sel } = S();
  const locked = lockedIds(def);
  const ids = (secOf(def, selectedBand(def, sel))?.items || []).map(i => i.id).filter(id => !locked.has(id));
  if (ids.length) S().select({ kind: 'items', ids });
  return ids.length;
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
      offsetCopy(f.list, copy); // as a paste: not on top of the original, nor of an earlier copy (N37)
      // cell mode: whole cells, and the first free place at or below (as Insert does)
      if (S().cells) { snapCells(copy); for (let k = 0; k < 400 && overlapsAny(copy, f.list); k++) copy.y += S().cellSize; }
      f.list.push(copy);
      growUp(d, { ...f, item: copy });
      newIds.push(copy.id);
    }
  });
  if (newIds.length) S().select({ kind: 'items', ids: newIds });
}

/* ---- clipboard: copy / paste items, also across reports (JSON on the system clipboard) ---- */
const PASTE_OFFSET = 12;
/** A copy goes 12 pt right and down, and 12 more while an item already sits there (an earlier copy): repeated copies
 *  cascade instead of stacking (N37). keep (a cut item pasted back): its own place while nothing sits there (#14).
 *  @param {any[]} list the items the copy joins @param {any} c @param {boolean} [keep] */
function offsetCopy(list, c, keep = false, taken = null) {
  // pasted JSON is not trusted: a coordinate that is not a finite number (1e309 parses to Infinity) starts at 0, and
  // the steps are bounded (list.length + 1 spots cannot all be taken; past 2^53, += 12 changes nothing)
  for (const k of ['x', 'y']) if (!Number.isFinite(c[k])) c[k] = 0;
  // the places already taken, as a set (several copies pasted at once pass theirs: one scan of the band, not one per step)
  const at = taken || new Set(list.filter(i => i !== c).map(i => `${i.x}|${i.y}`));
  const free = () => !at.has(`${c.x}|${c.y}`);
  if (!(keep && free())) {
    for (let n = 0; n <= list.length; n++) { c.x += PASTE_OFFSET; c.y += PASTE_OFFSET; if (free()) break; }
  }
  at.add(`${c.x}|${c.y}`);
}
const CLIP = 'pagewright/items@1'; // kept after the rename: copy and paste between 0.8 and 0.9 tabs
export async function copySelection({ cut = false } = {}) {
  const { sel, def } = S();
  if (sel.kind !== 'items') return 0;
  const fs = sel.ids.map(id => findItem(def, id)).filter(Boolean);
  const items = fs.map(f => f.item);
  // the band they come from (items of one band, none inside a container): a paste there cascades, elsewhere it fits (#13)
  const from = fs.length && fs.every(f => !f.parent && f.section === fs[0].section) ? fs[0].section : undefined;
  // a cut remembers its band and container: pasted right away, the items go back there (#14), a container's child too
  const one = fs.length && fs.every(f => f.section === fs[0].section && (f.parent?.id || null) === (fs[0].parent?.id || null));
  const at = cut && one ? { section: fs[0].section, parentId: fs[0].parent?.id || null } : undefined;
  const text = JSON.stringify({ kind: CLIP, items, from, ...(cut ? { cut: true } : {}), ...(at ? { at } : {}) });
  memClip = text; // before the await: a paste (or cut's delete) right after sees this copy
  writing = text;
  try { await navigator.clipboard.writeText(text); sysClip = text; } catch { /* clipboard blocked: keep the in-memory copy */ }
  if (writing === text) writing = null;
  return items.length;
}
let memClip = null;
/** The copy whose clipboard write has not ended yet, and the last copy the system clipboard took: while a paste event
 *  brings one of this tab's older copies, the in-memory copy is newer (a slow or blocked write, #14) */
let writing = null, sysClip = null;
/** Ctrl+X (#14): copy the selected items, then delete them (one undo step). @returns {Promise<number>} how many */
export function cutSelection() {
  if (S().sel.kind !== 'items') return Promise.resolve(0);
  const n = copySelection({ cut: true }); // sets the in-memory copy synchronously, before the items go
  deleteSelection();
  cutBack = { text: memClip, sel: S().sel };
  return n;
}
/** A cut not pasted yet, and the selection it left: a paste while that selection stands puts the items back where they
 *  were (their band, their container), whatever band the caller names (#14) */
let cutBack = null;
/** How deep pasted items may nest: deeper JSON is refused (the history and the canvas recurse once per level). */
const MAX_DEPTH = 256;
const depthOk = (list, n = 0) => n <= MAX_DEPTH && list.every(it => !Array.isArray(it?.items) || depthOk(it.items, n + 1));
const clipOf = (text) => { try { const d = JSON.parse(text); return d?.kind === CLIP && Array.isArray(d.items) && depthOk(d.items) ? d : null; } catch { return null; } };
/**
 * Pasted JSON is not trusted: only items of a known type are kept (nested ones too); a place that is not a finite number
 * starts at 0 and none is negative; a size that is not a finite number of at least 1 pt takes the item's default size.
 */
function cleanItems(list) {
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || Array.isArray(it) || !Object.hasOwn(ITEMS, it.type)) continue;
    const d = ITEMS[it.type].defaults?.() || {};
    for (const k of ['x', 'y']) { const v = Number(it[k]); it[k] = Number.isFinite(v) ? Math.max(0, v) : 0; }
    for (const k of ['w', 'h']) { const v = Number(it[k]); it[k] = Number.isFinite(v) && v >= 0 ? v : Number(d[k]) || 1; }
    minSize(it);
    if (Array.isArray(it.items)) it.items = cleanItems(it.items);
    else if (NESTING.has(it.type)) it.items = [];
    out.push(it);
  }
  return out;
}
/**
 * Paste items: from the text of a paste event (e.clipboardData: no permission prompt, N36), else the copy made in this
 * tab. @returns {number} how many were pasted (0: nothing to paste, the caller says so)
 */
export function pasteItems(section = 'body', text = null) {
  const st = active; // the designer pasted into
  const stale = memClip !== null && text !== memClip && (writing === memClip || (text != null && text === sysClip));
  // a paste event's text is what was copied last: this tab's own copy only stands in for it when there is no text, or
  // when the system clipboard never took that copy (a blocked write). Text copied in another app is not an old copy.
  const own = text == null || text === '' ? true : sysClip !== memClip;
  const data = (stale && clipOf(memClip)) || clipOf(text) || (own ? clipOf(memClip) : null);
  if (!data) return 0;
  const fresh = cleanItems(JSON.parse(JSON.stringify(data.items)));
  if (!fresh.length) return 0;
  // the first paste right after a cut, in the cut's band: back into the container it came from (#14)
  const back = data.cut && data.at && cutBack?.text === memClip && cutBack.sel === st.getState().sel && (text == null || text === memClip) && secOf(st.getState().def, data.at.section) ? data.at : null;
  cutBack = null;
  if (back) section = back.section;
  // a table, matrix or subreport goes to the body when the band cannot hold it, as Insert does (also one in a container)
  if (!isBodyKey(section) && !isContentKey(section) && fresh.some(holdsBodyOnly)) section = 'body';
  const ids = [];
  st.getState().apply((d) => {
    const used = allNames(d);
    const parent = back?.parentId ? findItem(d, back.parentId)?.item : null;
    const band = parent || secOf(d, section);
    const list = parent ? parent.items : band.items;
    const copies = fresh.map(it => cloneWithIds(it, used));
    const hOf = (c) => c.h, wOf = (c) => c.w;
    // the same band: 12 pt right and down (N37). Another band (or one not known, where the copies would not fit): at the
    // top of its free space, moved up as far as needed to fit, keeping their places relative to each other (#13)
    const fits = copies.every(c => c.y + PASTE_OFFSET + hOf(c) <= ((parent ? parent.h : band.height) || 0));
    if (parent || data.from === section || (data.from === undefined && fits)) {
      const taken = new Set(list.map(i => `${i.x}|${i.y}`));
      for (const c of copies) { offsetCopy(list, c, data.cut === true, taken); list.push(c); }
    } else if (copies.length) {
      const top = copies.reduce((m, c) => Math.min(m, c.y), Infinity), tall = copies.reduce((m, c) => Math.max(m, c.y + hOf(c)), -Infinity) - top;
      const y0 = Math.max(0, Math.min(belowItems(band.items), (band.height || 0) - tall));
      const room = bodyWidth(d, section);
      for (const c of copies) { c.y = round(y0 + c.y - top); c.x = round(clamp(c.x, 0, Math.max(0, room - wOf(c)))); band.items.push(c); }
    }
    const pf = parent ? findItem(d, parent.id) : null;
    for (const c of copies) { growUp(d, { section, parent: pf?.item || null, item: c }); ids.push(c.id); }
  });
  if (ids.length) st.getState().select({ kind: 'items', ids });
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

/* ---- several cells selected (sel.cells): Shift for a range, Cmd/Ctrl to add or remove one, a column or row handle ---- */
/** Every row of a table in display order: [{ part, row }]. */
export const tableRowList = (t) => tableParts(t).flatMap(({ part }) => (rowsOf(t, part) || []).map((_, row) => ({ part, row })));
/** The cells that start in the rectangle from cell a to cell b (rows in display order; merged-over places are left out). */
export function cellRange(t, a, b) {
  const list = tableRowList(t);
  const ia = list.findIndex(r => r.part === a.part && r.row === a.row), ib = list.findIndex(r => r.part === b.part && r.row === b.row);
  if (ia < 0 || ib < 0) return [{ part: b.part, row: b.row, col: b.col }];
  const [r0, r1] = [Math.min(ia, ib), Math.max(ia, ib)], [c0, c1] = [Math.min(a.col, b.col), Math.max(a.col, b.col)];
  const out = [];
  for (let i = r0; i <= r1; i++) {
    const { part, row } = list[i];
    const cells = rowsOf(t, part)?.[row]?.cells || [];
    for (let c = c0; c <= c1; c++) if (cells[c]) out.push({ part, row, col: c });
  }
  return out;
}
/** All cells of a column (every part) or of one row. */
export const columnCells = (t, col) => tableRowList(t).filter(({ part, row }) => rowsOf(t, part)?.[row]?.cells?.[col]).map(r => ({ ...r, col }));
export const rowCells = (t, part, row) => (rowsOf(t, part)?.[row]?.cells || []).map((c, col) => (c ? { part, row, col } : null)).filter(Boolean);
/** The selected cells of a cell selection: its list, or the one cell. */
export const selCells = (sel) => (sel?.kind !== 'cell' ? [] : sel.cells?.length ? sel.cells : [{ part: sel.part, row: sel.row, col: sel.col }]);
/** Select cells of a table: the first is the one the Inspector edits alone; an anchor keeps Shift ranges from it. */
export function selectCells(id, list, anchor) {
  const seen = new Set();
  const cells = list.filter(c => { const k = `${c.part}|${c.row}|${c.col}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!cells.length) return;
  const [f] = cells;
  S().select({ kind: 'cell', id, part: f.part, row: f.row, col: f.col, ...(cells.length > 1 ? { cells } : {}), anchor: anchor || f });
}

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
const setRowSpan = (cell, n) => { if (n > 1) cell.rowSpan = n; else delete cell.rowSpan; };
/** The columns and rows a cell covers, kept within its part (as owners() counts them). */
const spanOf = (rows, n, r, c) => {
  const cell = rows[r].cells[c];
  return { cs: Math.max(1, Math.min(cell.colSpan || 1, n - c)), rs: Math.max(1, Math.min(cell.rowSpan || 1, rows.length - r)) };
};
/** Pad every row of a part to the columns (before a change that needs a cell or a null at each column). */
const padAll = (rows, n) => { for (const row of rows) if (row.cells?.length !== n) row.cells = padded(row, n); };
/**
 * Merge the cell at (r, c) over rows r..r1 and columns c..c1. The area grows until no merge lies partly inside it;
 * the cell keeps its value and moves to the area's top left, every other place in it becomes null.
 */
function mergeArea(rows, n, r, c, r1, c1) {
  padAll(rows, n);
  const g = owners(rows, n);
  let top = r, left = c, bottom = r1, right = c1, grown = true;
  while (grown) {
    grown = false;
    for (let i = top; i <= bottom; i++) for (let k = left; k <= right; k++) {
      const o = g[i][k];
      if (!o) continue;
      const { cs, rs } = spanOf(rows, n, o.r, o.c);
      if (o.r < top || o.c < left || o.r + rs - 1 > bottom || o.c + cs - 1 > right) {
        top = Math.min(top, o.r); left = Math.min(left, o.c); bottom = Math.max(bottom, o.r + rs - 1); right = Math.max(right, o.c + cs - 1);
        grown = true;
      }
    }
  }
  const keep = rows[r].cells[c];
  for (let i = top; i <= bottom; i++) for (let k = left; k <= right; k++) rows[i].cells[k] = null;
  rows[top].cells[left] = keep;
  setSpan(keep, right - left + 1);
  setRowSpan(keep, bottom - top + 1);
}

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
/** Add a row before row `at` of a part. Inside a vertical merge the merge grows over it; elsewhere empty cells. */
export function tableInsertRow(id, part, at) {
  updateItem(id, (t) => {
    const n = t.columns.length, rows = rowsOf(t, part, true), add = blankRow(n);
    if (at > 0 && at < rows.length) {
      padAll(rows, n);
      const g = owners(rows, n);
      for (let c = 0; c < n; c++) {
        const a = g[at - 1][c], b = g[at][c];
        if (!a || !b || a.r !== b.r || a.c !== b.c) continue;
        add.cells[c] = null;
        if (c === a.c) setRowSpan(rows[a.r].cells[a.c], spanOf(rows, n, a.r, a.c).rs + 1);
      }
    }
    rows.splice(at, 0, add);
    tableSync(t);
  });
}
/** Remove row `at` of a part. A vertical merge over it shrinks (and moves down if it started there). */
export function tableDeleteRow(id, part, at) {
  updateItem(id, (t) => {
    const n = t.columns.length, rows = rowsOf(t, part);
    if (!rows?.[at]) return;
    if (part === 'detail' && rows.length <= 1 && !(t.groups || []).length) return;
    padAll(rows, n);
    const g = owners(rows, n);
    for (let c = 0; c < n; c++) {
      const o = g[at][c];
      if (!o || c !== o.c) continue; // each merge once, at its first column
      const { rs } = spanOf(rows, n, o.r, o.c);
      if (rs <= 1) continue;
      const cell = rows[o.r].cells[o.c];
      if (o.r === at) { const moved = { ...cell }; setRowSpan(moved, rs - 1); rows[at + 1].cells[o.c] = moved; }
      else setRowSpan(cell, rs - 1);
    }
    rows.splice(at, 1);
    tableSync(t);
  });
}
export function tableSetColumnWidth(id, col, width, key) {
  updateItem(id, (t) => { t.columns[col].width = round(Math.max(12, width)); tableSync(t); }, key);
}
/** Merge a cell with the cell to its right (and all of a merge there). A place no cell covers (a short row): nothing. */
export function tableMergeRight(id, part, row, col) {
  updateItem(id, (t) => {
    const n = t.columns.length, rows = rowsOf(t, part);
    if (!rows?.[row]?.cells?.[col]) return;
    const { cs, rs } = spanOf(rows, n, row, col);
    if (col + cs >= n) return;
    mergeArea(rows, n, row, col, row + rs - 1, col + cs);
  });
}
/** Split a cell's columns: each other column gets an empty cell over the same rows. */
export function tableSplit(id, part, row, col) {
  updateItem(id, (t) => {
    const n = t.columns.length, rows = rowsOf(t, part);
    if (!rows?.[row]?.cells?.[col]) return;
    const { cs, rs } = spanOf(rows, n, row, col);
    padAll(rows, n);
    const cells = rows[row].cells;
    for (let k = 1; k < cs; k++) { cells[col + k] = { value: '' }; setRowSpan(cells[col + k], rs); }
    delete cells[col].colSpan;
  });
}
/** Merge a cell with the cell below it (rowSpan), within the same rows of the table (header, a group's rows, detail, footer). */
export function tableMergeDown(id, part, row, col) {
  updateItem(id, (t) => {
    const n = t.columns.length, rows = rowsOf(t, part);
    if (!rows?.[row]?.cells?.[col]) return;
    const { cs, rs } = spanOf(rows, n, row, col);
    if (row + rs >= rows.length) return;
    mergeArea(rows, n, row, col, row + rs, col + cs - 1);
  });
}
/** Split a cell's rows: each other row gets an empty cell over the same columns. */
export function tableSplitRows(id, part, row, col) {
  updateItem(id, (t) => {
    const n = t.columns.length, rows = rowsOf(t, part);
    if (!rows?.[row]?.cells?.[col]) return;
    const { cs, rs } = spanOf(rows, n, row, col);
    padAll(rows, n);
    for (let r = 1; r < rs; r++) { const c = { value: '' }; setSpan(c, cs); rows[row + r].cells[col] = c; }
    delete rows[row].cells[col].rowSpan;
  });
}
/** Add an innermost group. The header shows the group value; the footer sums number columns. */
export function tableAddGroup(id, field, numericCols = [], { drill = false } = {}) {
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
    // a subtotal has its column's format (a count stays 440, not 440.00)
    for (const [ci, f] of numericCols) if (ci > 0 && ci < n) footer.cells[ci] = { value: `=Sum(Fields.${f})`, style: { format: t.detail?.[0]?.cells?.[ci]?.style?.format || 'N2' } };
    // the group header shows the value: a detail cell that shows the same field would print it twice, so it is emptied
    if (field) for (const r of t.detail || []) for (const c of r.cells || []) if (c && c.value === `=Fields.${field}`) c.value = '';
    // drill-down: the groups start collapsed behind a ▶ toggle
    t.groups.push({ name, expr: field ? `=Fields.${field}` : '', sort: 'asc', ...(drill ? { collapsible: true, initiallyCollapsed: true } : {}), header: [header], footer: [footer] });
    tableSync(t);
  });
}
export function tableRemoveGroup(id, level) {
  updateItem(id, (t) => {
    t.groups.splice(level, 1);
    // the last group gone with no detail row: an empty detail row, as Delete row keeps one
    if (!t.groups.length && !(t.detail || []).length) t.detail = [blankRow(t.columns.length)];
    tableSync(t);
  });
}

const IMAGE_MAX = 10 * 1024 * 1024; // the engine's limit per image
/**
 * Put image files in the report (images: { name: data URI }). Returns the names given and the first problem, if any.
 * Used by Report → Images, the Image item's Upload button and a file dropped on the page.
 */
export async function uploadImages(files, T) {
  const st = active; // the designer the images go to
  const names = [];
  let err = null;
  for (const f of files) {
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(f.type)) { err = T('imageType', { name: f.name }); continue; }
    if (f.size > IMAGE_MAX) { err = T('imageTooBig', { name: f.name }); continue; }
    const uri = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
    const base = f.name.replace(/\.[^.]+$/, '').replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || 'image';
    st.getState().apply(d => { d.images ||= {}; let n = base, k = 2; while (d.images[n]) n = `${base}${k++}`; d.images[n] = uri; names.push(n); });
  }
  return { names, err };
}

/**
 * Align, distribute or size items: to each other, or (toPage, or a single item) to their band or container.
 * how: left | hcenter | right | top | vmiddle | bottom | hdist | vdist | width | height
 */
export function alignItems(ids, how, toPage = false) {
  const { def, cells } = S();
  const locked = lockedIds(def);
  ids = ids.filter(id => !locked.has(id));
  const rects = alignedRects(def, ids, how, toPage);
  if (!rects) return;
  // cell mode: no item on top of another (the selected ones among themselves too), as a move or a resize
  if (cells) {
    const fs = ids.map(id => findItem(def, id)).filter(Boolean);
    const box = (it) => rects.get(it.id) || it;
    if (fs.some(f => f.list.some(o => o.id !== f.item.id && overlap(box(f.item), box(o))))) { S().setUi({ saveError: CELL_TAKEN() }); setTimeout(() => S().setUi({ saveError: null }), 2500); return; }
  }
  S().apply((d) => {
    const idx = indexItems(d);
    for (const [id, r] of rects) { const f = idx.get(id); if (!f) continue; Object.assign(f.item, r); growUp(d, f, idx); }
  });
}

/**
 * Where alignItems puts each item: id → its new { x, y, w, h } in its own band or container. Items of different
 * containers (or a container's child and a band item) line up on the page: their places are compared on the band.
 */
function alignedRects(def, ids, how, toPage) {
  const fs = ids.map(id => findItem(def, id)).filter(Boolean);
  if (!fs.length) return null;
  // where each item's list has its 0, 0 on the band: the sum of its containers' places
  const origin = (f) => { let x = 0, y = 0; for (let q = f; q?.parent;) { q = findItem(def, q.parent.id); x += q.item.x; y += q.item.y; } return { x, y }; };
  const same = fs.every(f => (f.parent?.id || null) === (fs[0].parent?.id || null) && f.section === fs[0].section);
  const its = fs.map(f => { const o = origin(f); return { f, o, x: f.item.x + o.x, y: f.item.y + o.y, w: f.item.w, h: f.item.h, type: f.item.type }; });
  const page = toPage || its.length === 1;
  // the area "to page" means: the items' container (all in one), else the band of the first item
  const po = same ? its[0].o : { x: 0, y: 0 };
  const room = same ? roomFor(def, fs[0]) : bodyWidth(def, fs[0].section);
  const bandH = same && fs[0].parent ? fs[0].parent.h : secOf(def, fs[0].section)?.height || 0;
  const L = page ? po.x : Math.min(...its.map(i => i.x)), R = page ? po.x + room : Math.max(...its.map(i => i.x + i.w));
  const Tp = page ? po.y : Math.min(...its.map(i => i.y)), B = page ? po.y + bandH : Math.max(...its.map(i => i.y + i.h));
  const dist = (k, s) => {
    if (its.length < 3) return;
    const o = [...its].sort((a, b) => a[k] - b[k]);
    const gap = (o[o.length - 1][k] + o[o.length - 1][s] - o[0][k] - o.reduce((a, i) => a + i[s], 0)) / (o.length - 1);
    let at = o[0][k];
    for (const i of o) { i[k] = round(at); at += i[s] + gap; }
  };
  for (const i of its) {
    if (how === 'left') i.x = round(L);
    else if (how === 'right') i.x = round(R - i.w);
    else if (how === 'hcenter') i.x = round((L + R) / 2 - i.w / 2);
    else if (how === 'top') i.y = round(Tp);
    else if (how === 'bottom') i.y = round(B - i.h);
    else if (how === 'vmiddle') i.y = round((Tp + B) / 2 - i.h / 2);
    else if (how === 'width' && i.type !== 'table') i.w = Math.max(...its.map(x => x.w));
    else if (how === 'height' && i.type !== 'table') i.h = Math.max(...its.map(x => x.h));
  }
  if (how === 'hdist') dist('x', 'w');
  if (how === 'vdist') dist('y', 'h');
  const out = new Map();
  for (const i of its) {
    // back to the item's own container, and kept inside its width
    const own = roomFor(def, i.f);
    const w = i.type === 'table' ? i.w : Math.min(i.w, own);
    out.set(i.f.item.id, { x: round(clamp(i.x - i.o.x, 0, Math.max(0, own - w))), y: round(Math.max(0, i.y - i.o.y)), w, h: i.h });
  }
  return out;
}

export const round = (v) => Math.round(v * 100) / 100;
/** The arrow keys' step in pt: 1, or one grid step with Snap to grid, or one cell in cell mode; Shift: ten of them. */
export const nudgeStep = ({ snap, grid, cells, cellSize }, shift) => (cells ? cellSize : snap ? grid : 1) * (shift ? 10 : 1);
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

/**
 * A matrix value's "Show" changed. A share printed with N0 reads 0 or 1, so a percentage gets P1 while the format is
 * still the default (N0 or none); back to the value, P1 goes back to N0. A format chosen by hand is kept.
 */
export function setMatrixShow(v, show) {
  const pct = !!show && show !== 'value';
  if (pct) v.show = show; else delete v.show;
  if (pct && (!v.format || v.format === 'N0')) v.format = 'P1';
  else if (!pct && v.format === 'P1') v.format = 'N0';
}
