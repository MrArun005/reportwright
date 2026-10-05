// @ts-check
/**
 * Reuse (Phase 8): master reports, report part libraries, shared stylesheets and themes. All four are ordinary
 * saved reports, referenced by id and read through the render's `loadReport` (the subreport path), so the
 * server's permissions apply to them too. Definitions are untrusted: every report is loaded at most once per
 * render, at most REUSE_LIMITS.reports of them, nesting is capped, and a report that reaches itself is skipped
 * with a warning instead of being followed.
 */
import { evalValue } from './expr/evaluate.js';

/**
 * depth: masters or parts inside parts; reports: distinct reports per render; items: items drawn through report parts per
 * render, subreports included (a part of 10 parts of 10 parts… is refused, not expanded); reportItems: items in one loaded
 * report; parts: parts one library lists; layers; styleDepth: named style parents; repeats: overflow continuation pages.
 */
export const REUSE_LIMITS = { depth: 4, reports: 50, items: 20000, reportItems: 20000, parts: 500, layers: 200, styleDepth: 10, repeats: 500 };
const fmt = (n) => n.toLocaleString('en-US');
/** Items in a definition (nested ones too), counting no further than `stop`. */
function countItems(def, stop = Infinity) {
  let n = 0;
  eachItem(def, () => { n++; }, () => n > stop);
  return n;
}
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isId = (v) => typeof v === 'string' && ID.test(v);

/**
 * A loader for one render (and its subreports): each id loaded once, at most REUSE_LIMITS.reports ids.
 * @param {((id: string) => Promise<any>) | undefined} load
 * @param {Map<string, Promise<any>>} [cache]
 */
export function makeLoader(load, cache = new Map()) {
  return (id) => {
    if (!isId(id)) return Promise.reject(new Error(`"${String(id).slice(0, 80)}" is not a report id`));
    let p = cache.get(id);
    if (!p) {
      if (!load) return Promise.reject(new Error('this render has no report loader (render it on the server or in the viewer)'));
      if (cache.size >= REUSE_LIMITS.reports) return Promise.reject(new Error(`the report uses more than ${REUSE_LIMITS.reports} reports`));
      p = Promise.resolve().then(() => load(id)).then((d) => {
        if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('it is not a report');
        if (countItems(d, REUSE_LIMITS.reportItems) > REUSE_LIMITS.reportItems) throw new Error(`it has more than ${fmt(REUSE_LIMITS.reportItems)} items`);
        return d;
      });
      cache.set(id, p);
    }
    return p;
  };
}

/** Report ids a definition reuses by a fixed id (not expressions): master, stylesheet, theme and part libraries. */
export function reuseRefs(def) {
  const out = new Set();
  if (!def || typeof def !== 'object') return out;
  for (const v of [def.master, def.styles?.sheet, def.theme]) if (isId(v)) out.add(v);
  eachItem(def, (it) => { if (it.type === 'part' && isId(it.library)) out.add(it.library); });
  return out;
}

/** Every item of every band, nested items included (not table cells). */
function eachItem(def, fn, stop = () => false) {
  const go = (list, depth) => { if (!Array.isArray(list) || depth > 64) return; for (const it of list) { if (stop()) return; if (!it || typeof it !== 'object') continue; fn(it); go(it.items, depth + 1); } };
  for (const s of Object.values(def.sections || {})) for (const b of Array.isArray(s) ? s : [s]) go(b?.items, 0);
}
export function findItemNamed(def, name) {
  let hit = null;
  eachItem(def, (it) => { if (!hit && it.name === name) hit = it; });
  return hit;
}
/** a + b by name: b wins a clash. */
function byName(a, b) {
  const al = Array.isArray(a) ? a : [], bl = Array.isArray(b) ? b : [];
  const names = new Set(bl.map(x => x?.name));
  return [...al.filter(x => !names.has(x?.name)), ...bl];
}

/* ------------------------------------------------------------------ masters */
/**
 * The content report merged with its master (and the master's master, up to REUSE_LIMITS.depth).
 * @param {any} def @param {(id: string) => Promise<any>} get @param {(m: string) => void} warn @param {string[]} [chain]
 */
export async function applyMaster(def, get, warn, chain = []) {
  if (def.master == null || def.master === '') return def;
  const { master: id, ...content } = def;
  if (chain.includes(id)) { warn(`Master "${id}" would include itself; it is left out.`); return content; }
  if (chain.length >= REUSE_LIMITS.depth) { warn(`Master reports are nested more than ${REUSE_LIMITS.depth} levels; "${id}" is left out.`); return content; }
  let m;
  try { m = await get(id); } catch (e) { warn(`The master report "${id}" did not load: ${e.message}`); return content; }
  m = await applyMaster(m, get, warn, [...chain, id]);
  return mergeMaster(content, m, warn);
}

/**
 * ActiveReports-style: the master's page, header and footer; the content inside the master's content placeholders.
 * The body goes in the first placeholder; sections.content ([{ placeholder: name, items }]) fills the others by name
 * (in the first body section). A placeholder no content names stays empty.
 */
function mergeMaster(c, m, warn = (_m) => {}) {
  const ms = m.sections || {}, cs = c.sections || {};
  const mBody = (Array.isArray(ms.body) ? ms.body[0] : ms.body) || {};
  const mItems = Array.isArray(mBody.items) ? mBody.items : [];
  const phs = mItems.filter(i => i?.type === 'placeholder');
  const ph = phs[0];
  const others = mItems.filter(i => i && i.type !== 'placeholder');
  const named = (Array.isArray(cs.content) ? cs.content : []).filter(x => x && typeof x === 'object' && !Array.isArray(x));
  const extra = phs.slice(1);
  for (const e of named) if (!extra.some(p => p.name != null && p.name === e.placeholder)) warn(`The master has no other content placeholder "${String(e.placeholder ?? '').slice(0, 80)}"; its content is left out.`);
  const blank = { border: 'none', backgroundColor: null, backgroundImage: null, padding: 0 };
  const boxOf = (p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0, w: Number(p.w) || 0, h: Number(p.h) || 0 });
  const below = others.length ? Math.max(...others.map(i => (Number(i.y) || 0) + (Number(i.h) || 0))) + 6 : 0;
  const wrap = (b, k) => {
    const items = Array.isArray(b?.items) ? b.items : [];
    const box = ph
      ? boxOf(ph)
      : { x: 0, y: below, w: Math.max(0, ...items.map(i => (Number(i.x) || 0) + (Number(i.w) || 0))), h: Math.max(0, ...items.map(i => (Number(i.y) || 0) + (Number(i.h) || 0))) };
    // a container that does not keep together: the content still grows, splits across pages and pushes the master's items below it
    const content = { type: 'container', name: k ? `MasterContent${k + 1}` : 'MasterContent', ...box, keepTogether: false, style: blank, items };
    // every body section gets the master's items; copies after the first get their own names (names are unique)
    const mine = k ? others.map(i => (i.name ? { ...i, name: `${i.name}_${k + 1}` } : i)) : others;
    // the other placeholders, by name (the first body section only): each a container that grows like the main one
    const more = k ? [] : extra.map((p, j) => {
      const e = named.find(x => p.name != null && x.placeholder === p.name);
      return { type: 'container', name: `MasterContent_${String(p.name ?? j + 2).replace(/\W/g, '_').slice(0, 64)}`, ...boxOf(p), keepTogether: false, style: blank, items: Array.isArray(e?.items) ? e.items : [] };
    });
    return { ...(b || {}), items: [...mine, content, ...more] };
  };
  const body = Array.isArray(cs.body) ? cs.body.map(wrap) : wrap(cs.body, 0);
  const st = (x) => x.styles || {};
  return {
    ...c,
    $schema: c.$schema ?? m.$schema,
    locale: c.locale ?? m.locale,
    currency: c.currency ?? m.currency,
    nullPropagation: c.nullPropagation ?? m.nullPropagation,
    page: m.page || c.page,
    parameters: byName(m.parameters, c.parameters),
    dataSources: byName(m.dataSources, c.dataSources),
    dataSets: byName(m.dataSets, c.dataSets),
    functions: byName(m.functions, c.functions),
    layers: byName(m.layers, c.layers),
    images: { ...(m.images || {}), ...(c.images || {}) },
    styles: { ...st(m), ...st(c), base: { ...(st(m).base || {}), ...(st(c).base || {}) }, named: { ...(st(m).named || {}), ...(st(c).named || {}) } },
    theme: c.theme ?? m.theme,
    themeDef: c.themeDef ?? m.themeDef,
    // the content's own page header and footer are replaced by the master's (its items are not in the report)
    sections: { ...cs, content: undefined, pageHeader: ms.pageHeader || { height: 0, items: [] }, pageFooter: ms.pageFooter || { height: 0, items: [] }, body },
  };
}

/* ------------------------------------------------------------------ styles */
/** Named styles with `parent` resolved: each style is its parents' properties with its own on top. */
export function flattenNamed(named, warn = (_m) => {}) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!named || typeof named !== 'object') return out;
  const get = (name, seen) => {
    if (out[name]) return out[name];
    const s = named[name];
    if (!s || typeof s !== 'object') return null;
    const { parent, ...own } = s;
    let base = null;
    if (parent != null && parent !== '') {
      if (seen.includes(parent)) warn(`Named style "${name}": its parent "${parent}" leads back to itself; the chain is cut there.`);
      else if (seen.length >= REUSE_LIMITS.styleDepth) warn(`Named style "${name}": more than ${REUSE_LIMITS.styleDepth} parents; the chain is cut there.`);
      else if (!named[parent]) warn(`Named style "${name}": there is no named style "${parent}" to inherit from.`);
      else base = get(parent, [...seen, parent]);
    }
    return (out[name] = base ? { ...base, ...own } : own);
  };
  for (const k of Object.keys(named)) get(k, [k]);
  return out;
}

/** styles.sheet: another report's named styles and default text, under this report's own. */
async function applySheet(def, get, warn) {
  const id = def.styles?.sheet;
  if (id == null || id === '') return def;
  let sheet;
  try { sheet = await get(id); } catch (e) { warn(`The stylesheet "${id}" did not load: ${e.message}`); return def; }
  const s = sheet.styles || {};
  return { ...def, styles: { ...def.styles, base: { ...(s.base || {}), ...(def.styles.base || {}) }, named: { ...(s.named || {}), ...(def.styles.named || {}) } } };
}

/* ------------------------------------------------------------------ parts */
/**
 * Every part the report's instances use: `${library}\0${part}` → { item, props } or { error }. Each part once,
 * however many instances; a part that contains an instance of itself (directly or through other parts) gets
 * that inner instance marked `__cycle`, which draws a placeholder.
 */
async function loadParts(def, get, warn, budget) {
  /** @type {Map<string, any>} */
  const parts = new Map();
  const libs = new Map(); // library id → definition, for its data sets
  const keyOf = (it) => `${it.library}\u0000${it.part}`;
  const resolve = async (lib, name, chain) => {
    const key = `${lib}\u0000${name}`;
    if (parts.has(key)) return;
    if (chain.length >= REUSE_LIMITS.depth) { parts.set(key, { error: `parts are nested more than ${REUSE_LIMITS.depth} levels` }); return; }
    let d;
    try { d = await get(lib); } catch (e) { parts.set(key, { error: `the library "${lib}" did not load: ${e.message}` }); return; }
    const p = (Array.isArray(d.parts) ? d.parts.slice(0, REUSE_LIMITS.parts) : []).find(x => x?.name === name);
    const src = p && findItemNamed(d, p.item);
    if (!p || !src) { parts.set(key, { error: `the library "${lib}" has no part "${name}"` }); return; }
    const item = structuredClone(src);
    const props = {};
    for (const q of Array.isArray(p.properties) ? p.properties : []) if (q?.name) props[q.name] = q.default ?? null;
    const inner = [];
    let own = 0;
    const walk = (list) => { for (const x of list || []) { if (!x || typeof x !== 'object') continue; own++; if (x.type === 'part') inner.push(x); walk(x.items); } };
    walk([item]);
    // own: its items; inner: the instances inside it, each drawing its own part's items (counted once resolved)
    parts.set(key, { item, props, own, inner: inner.filter(x => x !== item) });
    libs.set(lib, d);
    for (const x of inner) {
      if (x === item) continue;
      const k2 = keyOf(x);
      if (k2 === key || chain.includes(k2)) { x.__cycle = true; warn(`Part "${name}" of "${lib}" would include itself; that inner part is left out.`); }
      else await resolve(x.library, x.part, [...chain, key]);
    }
  };
  const used = [];
  eachItem(def, (it) => { if (it.type === 'part') used.push(it); });
  for (const it of used) await resolve(String(it.library ?? ''), String(it.part ?? ''), []);
  // What the instances would draw: each part's items plus, for each instance inside it, that part's total. Memoised per
  // part (linear in parts), so a fan-out (a part of 10 parts of 10 parts…) is priced, not expanded, and refused here.
  const size = new Map();
  const sizeOf = (key) => {
    if (size.has(key)) return size.get(key);
    size.set(key, 1); // a cycle is marked __cycle and never drawn; this only stops the recursion
    const e = parts.get(key);
    let n = 1;
    if (e && !e.error) { n = e.own; for (const x of e.inner) if (!x.__cycle) n += sizeOf(`${x.library}\u0000${x.part}`); }
    size.set(key, n);
    return n;
  };
  let total = 0;
  for (const it of used) total += sizeOf(`${String(it.library ?? '')}\u0000${String(it.part ?? '')}`);
  budget.items += total;
  if (budget.items > REUSE_LIMITS.items) {
    const msg = `the report parts would draw more than ${fmt(REUSE_LIMITS.items)} items (with subreports); they are left out`;
    for (const k of parts.keys()) parts.set(k, { error: msg });
    warn(`Report parts: ${msg}.`);
  }
  return { parts, libs: [...libs.values()] };
}

/** What a library brings that the report lacks (by name): data sources, data sets, parameters, functions, images, named styles. */
function mergeLibraries(def, libs) {
  let d = def;
  for (const l of libs) {
    d = {
      ...d,
      dataSources: byName(l.dataSources, d.dataSources),
      dataSets: byName(l.dataSets, d.dataSets),
      parameters: byName(l.parameters, d.parameters),
      functions: byName(l.functions, d.functions),
      images: { ...(l.images || {}), ...(d.images || {}) },
      styles: { ...(d.styles || {}), named: { ...(l.styles?.named || {}), ...(d.styles?.named || {}) } },
    };
  }
  return d;
}

/**
 * Masters, stylesheet and part libraries, before validation. Themes come later (they may depend on parameters).
 * @returns {Promise<{ def: any, parts: Map<string, any> | null }>}
 */
export async function resolveReuse(def, get, warn, chain = [], budget = { items: 0 }) {
  let d = await applyMaster(def, get, warn, chain);
  d = await applySheet(d, get, warn);
  if (Array.isArray(d.layers) && d.layers.length > REUSE_LIMITS.layers) {
    warn(`The report has more than ${REUSE_LIMITS.layers} layers; the others are ignored.`);
    d = { ...d, layers: d.layers.slice(0, REUSE_LIMITS.layers) };
  }
  let parts = null;
  let hasPart = false;
  eachItem(d, (it) => { if (it.type === 'part') hasPart = true; });
  if (hasPart) {
    const r = await loadParts(d, get, warn, budget);
    parts = r.parts;
    d = mergeLibraries(d, r.libs);
  }
  return { def: d, parts };
}

/* ------------------------------------------------------------------ themes */
/** The Office default theme, so Theme.* always has a value. */
export const DEFAULT_THEME = {
  colors: { Dark1: '#000000', Light1: '#FFFFFF', Dark2: '#44546A', Light2: '#E7E6E6', Accent1: '#4472C4', Accent2: '#ED7D31', Accent3: '#A5A5A5', Accent4: '#FFC000', Accent5: '#5B9BD5', Accent6: '#70AD47', Hyperlink: '#0563C1' },
  fonts: { major: { family: 'Inter', size: 14, weight: 'bold', style: 'normal' }, minor: { family: 'Inter', size: 9, weight: 'normal', style: 'normal' } },
  constants: {},
};
export const THEME_COLORS = Object.keys(DEFAULT_THEME.colors);

/** A theme definition as expressions read it: Theme.Colors.Accent1, Theme.Fonts.MajorFont.Family, Theme.Constants.Name. */
export function themeContext(td) {
  const t = td && typeof td === 'object' ? td : {};
  const font = (k) => {
    const f = { ...DEFAULT_THEME.fonts[k], ...(t.fonts?.[k] && typeof t.fonts[k] === 'object' ? t.fonts[k] : {}) };
    return { Family: f.family, Size: f.size, Weight: f.weight, Style: f.style };
  };
  const consts = t.constants && typeof t.constants === 'object' && !Array.isArray(t.constants) ? t.constants : {};
  return { Colors: { ...DEFAULT_THEME.colors, ...(t.colors && typeof t.colors === 'object' ? t.colors : {}) }, Fonts: { MajorFont: font('major'), MinorFont: font('minor') }, Constants: { ...consts } };
}

/** The render's theme: `theme` (a report id, or an expression giving one), else the report's own `themeDef`, else the default. */
export async function resolveTheme(def, ctx, get, warn) {
  let td = def.themeDef;
  const src = def.theme;
  if (typeof src === 'string' && src.trim()) {
    let id = src;
    if (src.startsWith('=')) {
      try { id = evalValue(src, ctx); } catch (e) { warn(`Theme: ${e.message}`); id = null; }
    }
    if (id != null && id !== '') {
      try {
        const t = await get(String(id));
        if (t.themeDef && typeof t.themeDef === 'object') td = t.themeDef;
        else warn(`The report "${id}" has no theme (set its colours and fonts under Report → Theme).`);
      } catch (e) { warn(`The theme "${id}" did not load: ${e.message}`); }
    }
  }
  return themeContext(td);
}
