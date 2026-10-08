// @ts-check
// Viewer logic that needs no browser: search, toolbar arrangement, galley view, frozen headers, range values.
import { resolvePage } from '../engine/units.js';

/**
 * The toolbar.hide keys that name a group of built-in items. `export` is the Export menu's formats and its options
 * gear (Print is its own key); `navigation` is the paging group (first, previous, page number, next, last).
 * @type {Record<string, (i: {id: string, group?: string}) => boolean>}
 */
export const TOOLBAR_GROUP_KEYS = {
  export: (i) => i.group === 'export' && i.id !== 'print',
  search: (i) => i.group === 'search',
  zoom: (i) => i.group === 'zoom',
  navigation: (i) => i.group === 'paging',
};
/** The toolbar.hide keys that name one or more built-in items by id; any other key is taken as an item id. */
export const TOOLBAR_ID_KEYS = { sidebar: ['thumbnails', 'documentMap'] };

/**
 * Built-in toolbar items minus `hide`, plus custom `add` items placed after the item they name (else at the end).
 * A custom item joins the group of the item it follows. A custom id that clashes with a built-in id is ignored.
 * Hiding every export format also hides the Export options gear (no empty gear).
 * @template {{id: string, group?: string}} T
 * @param {T[]} builtIns
 * @param {{ hide?: string[], add?: any[] }} [opt]
 */
export function arrangeToolbar(builtIns, { hide = [], add = [] } = {}) {
  if (!hide.length && !add.length) return builtIns;
  /** @type {any[]} */
  const out = [...builtIns];
  const taken = new Set(builtIns.map(i => i.id));
  for (const a of add) {
    if (!a || !a.id || taken.has(a.id)) continue;
    taken.add(a.id);
    const at = out.findIndex(i => i.id === a.after);
    const item = { ...a, custom: true, group: at >= 0 ? out[at].group : `custom:${a.id}` };
    if (at >= 0) out.splice(at + 1, 0, item); else out.push(item);
  }
  const hiddenIds = new Set();
  const hiddenBy = [];
  for (const k of hide) {
    if (Object.hasOwn(TOOLBAR_GROUP_KEYS, k)) hiddenBy.push(TOOLBAR_GROUP_KEYS[k]);
    else for (const id of Object.hasOwn(TOOLBAR_ID_KEYS, k) ? TOOLBAR_ID_KEYS[k] : [k]) hiddenIds.add(id);
  }
  let kept = out.filter(i => i.custom || !(hiddenIds.has(i.id) || hiddenBy.some(f => f(i))));
  if (!kept.some(i => i.format)) kept = kept.filter(i => i.custom || i.id !== 'exportOptions');
  return kept;
}

/** The same report as one long page (the engine's pageless layout), as wide as its normal page. */
export function galleyDefinition(def) {
  const pg = resolvePage(def.page);
  if (pg.pageless) return def;
  const m = pg.margins;
  return { ...def, page: { size: 'Pageless', width: pg.width, margins: [m.top, m.right, m.bottom, m.left] } };
}

/**
 * The table header to pin at the top of the view: a page's `frozen` region whose header has scrolled out
 * of view (`y` is the scroll position on the page, in points) while the table goes on below.
 * @param {{ frozen?: {x: number, y: number, w: number, h: number, end: number}[] } | undefined} page
 * @param {number} y
 */
export function frozenAt(page, y) {
  for (const r of page?.frozen || []) if (y > r.y && y < r.end - r.h) return r;
  return null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find text in a page model, one visual line at a time, joined as textRows() in src/exporters/regions.js joins
 * them for the text exports: a justified line is one run per word on one baseline (joined with spaces); rich text
 * is one item per styled fragment, `rich: {id, l}` (the fragments of one line joined with nothing: they keep their
 * own spaces). textRows() gives strings only; search also needs each line's box, so it groups the runs itself.
 * @returns {{page: number, x: number, y: number, w: number, h: number, text: string}[]} boxes in points
 */
export function findText(model, q, { matchCase = false, wholeWord = false } = {}) {
  if (!q || !model) return [];
  const W = '[\\p{L}\\p{M}\\p{N}_]'; // a word character, including combining marks (Indic vowel signs)
  const re = new RegExp(wholeWord ? `(?<!${W})${escapeRe(q)}(?!${W})` : escapeRe(q), `u${matchCase ? '' : 'i'}`);
  const out = [];
  model.pages.forEach((pg, pi) => {
    const rows = new Map();
    pg.items.forEach((it, k) => {
      if (it.t !== 'text') return;
      for (const l of it.lines) {
        const key = it.rich ? `r${it.rich.id}\u0001${it.rich.l}` : `${k}\u0001${l.y}`;
        const r = rows.get(key);
        if (r) r.lines.push(l); else rows.set(key, { rich: !!it.rich, size: it.size, lines: [l] });
      }
    });
    for (const { rich, size, lines: row } of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      const text = row.map(l => l.text).join(rich ? '' : ' ');
      if (!re.test(text)) continue;
      const x0 = row[0].x, last = row[row.length - 1];
      const x1 = last.x + (last.w || size * last.text.length * 0.5);
      const y = Math.max(...row.map(l => l.y));
      out.push({ page: pi, x: x0 - 1, y: y - size * 0.95, w: x1 - x0 + 2, h: size * 1.25, text });
    }
  });
  return out;
}

/**
 * A range or date-range editor's two bounds as one list value ("from,to"). A missing bound takes the
 * editor's limit (`min`/`max`), else the other bound; both empty means no value.
 * @param {string} a @param {string} b @param {{min?: any, max?: any}} p
 */
export function rangeValue(a, b, p) {
  if (a === '' && b === '') return '';
  const lo = a !== '' ? a : String(p.min ?? b);
  const hi = b !== '' ? b : String(p.max ?? a);
  return `${lo},${hi}`;
}

/** The box of an SVG path from its absolute commands (M L H V C S Q T A Z; an arc by its end point). Viewer overlays only. */
export function pathBox(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0;
  const add = (x, y) => { cx = x; cy = y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const [, c, args] of String(d || '').matchAll(/([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi)) {
    const n = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
    const C = c.toUpperCase();
    if (C === 'H') n.forEach(x => add(x, cy));
    else if (C === 'V') n.forEach(y => add(cx, y));
    else if (C === 'A') for (let i = 0; i + 6 < n.length; i += 7) add(n[i + 5], n[i + 6]);
    else if (C !== 'Z') for (let i = 0; i + 1 < n.length; i += 2) add(n[i], n[i + 1]);
  }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const itemsOf = (page) => (page?.items || []).flatMap(i => (i.t === 'field' ? i.draw || [] : [i]));

/**
 * The page's interactive spots (toggles, sort headers, drill-through, links, chart points) for the accessible overlay:
 * the action, the box in points, the tooltip, and the text under it (what a screen reader says), in reading order.
 * @returns {{ action: any, x: number, y: number, w: number, h: number, tip: string, text: string }[]}
 */
export function pageLinks(page) {
  const items = itemsOf(page);
  const texts = items.filter(i => i.t === 'text');
  const out = [];
  for (const it of items) {
    if (it.t !== 'link' || !it.action) continue;
    let box = { x: it.x, y: it.y, w: it.w, h: it.h };
    if (it.d) { const b = pathBox(it.d); if (!b) continue; box = { ...b, x: b.x + (it.x - (it.x0 ?? it.x)), y: b.y + (it.y - (it.y0 ?? it.y)) }; }
    if (!(box.w > 0 && box.h > 0)) continue;
    const words = [];
    for (const t of texts) for (const l of t.lines || []) {
      const top = l.y - (t.size || 9) * 0.9, w = l.w || (t.size || 9) * String(l.text).length * 0.5;
      if (l.x < box.x + box.w && l.x + w > box.x && top < box.y + box.h && l.y > box.y) words.push(String(l.text));
    }
    out.push({ action: it.action, ...box, path: !!it.d, tip: it.tip ? String(it.tip) : '', text: words.join(' ').replace(/^[▶▼]\s*/, '').replace(/\s*[↑↓]$/, '').trim() });
  }
  return out.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x));
}

/** The page's text in reading order (top to bottom, then left to right), one string per visual line: a text alternative. */
export function readingText(page) {
  const rows = new Map();
  for (const it of itemsOf(page)) {
    if (it.t !== 'text') continue;
    for (const l of it.lines || []) {
      const k = Math.round(l.y);
      const r = rows.get(k);
      if (r) r.push(l); else rows.set(k, [l]);
    }
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, ls]) => ls.sort((a, b) => a.x - b.x).map(l => l.text).join(' ').trim()).filter(Boolean);
}

/**
 * Export options the viewer offers (its Export options menu) and their defaults. HTML: "tables" (the pages, fonts
 * subset to the characters used, and the Tables view of the rendered tables); "interactive" (the whole viewer, full
 * fonts and a data snapshot: megabytes) and "static" (pages only) are choices.
 */
export const EXPORT_DEFAULTS = { pdfua: false, pdfa: false, formulas: true, html: 'tables' };

/**
 * The export options from what this browser stored. Before v2 every option was stored on any change, so a stored
 * "html" was mostly the old default "interactive" (a 10 MB file for one page), not a choice: it is dropped.
 * @param {any} stored
 */
export function exportOptionsFrom(stored) {
  const { v, ...rest } = stored && typeof stored === 'object' ? stored : {};
  if (v !== 2) delete rest.html;
  return { ...EXPORT_DEFAULTS, ...rest };
}

/**
 * The data snapshot an interactive HTML file carries, with only what the reports can read: a scalar under a key no
 * report mentions anywhere (fields, expressions, paths, filters) is left out; arrays and objects stay, in order.
 * ponytail: a field picked at run time by name (Fields(Parameters.col)) is not mentioned, so it is left out of the
 * offline fallback; the live data source still has it. Mark such keys as data-set fields to keep them.
 * @param {Record<string, any>} snapshot URL → parsed JSON
 * @param {any[]} defs the report and every report it can drill into
 */
export function pruneSnapshot(snapshot, defs) {
  const text = defs.map(d => JSON.stringify(d)).join('\n');
  const seen = new Map();
  const used = (k) => { let u = seen.get(k); if (u === undefined) { u = text.includes(JSON.stringify(k).slice(1, -1)); seen.set(k, u); } return u; };
  /** @returns {any} */
  const walk = (x) => {
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== 'object') return x;
    /** @type {Record<string, any>} */
    const o = {};
    for (const [k, y] of Object.entries(x)) if ((y && typeof y === 'object') || used(k)) o[k] = walk(y);
    return o;
  };
  return Object.fromEntries(Object.entries(snapshot).map(([url, x]) => [url, walk(x)]));
}

/** Past these the browser PDF writer is slow (100k rows: 142 s in a browser, 9 s on the server). */
export const SERVER_PDF_ROWS = 20000, SERVER_PDF_PAGES = 800;
/**
 * The server's PDF of a saved report (/api/reports/<id>/pdf with the current parameters and the viewer's time zone)
 * when the report is large, else null: small reports, an unsaved design (dirty), no server (no reportId) and
 * multi-value parameters keep the browser PDF.
 * @param {any} model @param {{ reportId?: string, params?: Record<string, any>, origin: string, timeZone?: string, dirty?: boolean }} o
 * @returns {string|null}
 */
export function serverPdfUrl(model, { reportId, params = {}, origin, timeZone, dirty = false }) {
  if (!reportId || dirty || !model) return null;
  const rows = Object.values(model.stats?.rows || {}).reduce((a, n) => a + (Number(n) || 0), 0);
  if (rows <= SERVER_PDF_ROWS && (model.pages?.length || 0) <= SERVER_PDF_PAGES) return null;
  const q = new URLSearchParams();
  for (const [k, v0] of Object.entries(params)) {
    const v = Array.isArray(v0) ? (v0.length > 1 ? undefined : v0[0]) : v0;
    if (v === undefined && Array.isArray(v0)) return null;
    if (v == null) continue;
    q.set(k, v instanceof Date ? v.toISOString() : String(v));
  }
  if (timeZone) q.set('timeZone', timeZone);
  const s = q.toString();
  return `${origin}/api/reports/${encodeURIComponent(reportId)}/pdf${s ? `?${s}` : ''}`;
}

/**
 * The choices shown for each parameter: a parameter with fixed `options` and `optionsFrom` keeps its fixed options
 * ("All") first, then the fetched list, without repeats. `fetched` is what the engine's parameter options call returned.
 * @param {{ parameters?: any[] }} def @param {Record<string, {value: any, label: string}[]>} fetched
 */
export function paramChoices(def, fetched) {
  const out = { ...fetched };
  for (const p of def?.parameters || []) {
    if (!Array.isArray(p.options) || !p.optionsFrom || !Array.isArray(fetched?.[p.name])) continue;
    const fixed = p.options.map(o => (typeof o === 'object' && o ? { value: o.value, label: String(o.label ?? o.value) } : { value: o, label: String(o) }));
    const seen = new Set(fixed.map(o => String(o.value)));
    out[p.name] = [...fixed, ...fetched[p.name].filter(o => !seen.has(String(o.value)))];
  }
  return out;
}

/**
 * Cascading parameters: a value the parameter's list no longer offers (its parent changed) is cleared in the state the
 * run uses, not only in the panel. A multi-value keeps the items still offered. A single value becomes the default if still offered, else the first choice. Returns `params` itself when nothing changed.
 * @param {any} def @param {Record<string, any>} params @param {Record<string, {value: any}[]>} choices from paramChoices
 */
export function clearStaleParams(def, params, choices) {
  let out = params;
  for (const p of def?.parameters || []) {
    const list = choices?.[p.name], v = params[p.name];
    if (!p.optionsFrom || !Array.isArray(list) || v == null || v === '') continue;
    const ok = new Set(list.map(o => String(o.value)));
    // an empty value would make the engine use the default, which may be as stale as the value: take the default if it is
    // still offered, else the first choice (none offered: empty)
    const fresh = ok.has(String(p.default)) ? String(p.default) : list.length ? String(list[0].value) : '';
    const next = p.multi ? String(v).split(',').filter(x => ok.has(x)).join(',') : (ok.has(String(v)) ? v : fresh);
    if (next !== v) out = { ...out, [p.name]: next };
  }
  return out;
}
