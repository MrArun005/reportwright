// @ts-check
// Viewer logic that needs no browser: search, toolbar arrangement, galley view, frozen headers, range values.
import { resolvePage } from '../engine/units.js';

/**
 * Built-in toolbar items minus `hide`, plus custom `add` items placed after the item they name (else at the end).
 * A custom item joins the group of the item it follows. A custom id that clashes with a built-in id is ignored.
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
  const hidden = new Set(hide);
  return out.filter(i => i.custom || !hidden.has(i.id));
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
 * Find text in a page model, one visual line at a time: a justified line is one run per word, so runs on one
 * baseline are joined (in x order, with spaces) before matching.
 * @returns {{page: number, x: number, y: number, w: number, h: number, text: string}[]} boxes in points
 */
export function findText(model, q, { matchCase = false, wholeWord = false } = {}) {
  if (!q || !model) return [];
  const W = '[\\p{L}\\p{M}\\p{N}_]'; // a word character, including combining marks (Indic vowel signs)
  const re = new RegExp(wholeWord ? `(?<!${W})${escapeRe(q)}(?!${W})` : escapeRe(q), `u${matchCase ? '' : 'i'}`);
  const out = [];
  model.pages.forEach((pg, pi) => {
    for (const it of pg.items) if (it.t === 'text') {
      const rows = new Map();
      for (const l of it.lines) { const r = rows.get(l.y); if (r) r.push(l); else rows.set(l.y, [l]); }
      for (const [y, row] of rows) {
        row.sort((a, b) => a.x - b.x);
        const text = row.map(l => l.text).join(' ');
        if (!re.test(text)) continue;
        const x0 = row[0].x, last = row[row.length - 1];
        const x1 = last.x + (last.w || it.size * last.text.length * 0.5);
        out.push({ page: pi, x: x0 - 1, y: y - it.size * 0.95, w: x1 - x0 + 2, h: it.size * 1.25, text });
      }
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
