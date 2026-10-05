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
    out.push({ action: it.action, ...box, tip: it.tip ? String(it.tip) : '', text: words.join(' ').replace(/^[▶▼]\s*/, '').replace(/\s*[↑↓]$/, '').trim() });
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
