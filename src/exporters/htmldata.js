// @ts-check
// The light interactive layer of the HTML export: next to the pages, a "Tables" view of the report's tables as real
// HTML tables, built in the browser by one small inline script from data embedded in the file (no network, no
// eval, no inline handlers: it runs under a CSP that allows only its own hash, which the file declares). The view
// re-sorts the columns the report made sortable (interactive sort), opens and closes groups, and filters rows by
// the values of a column. Without the script (blocked), the file is the static pages.
import { mergedRegions } from './regions.js';
import { formatValue, isoDate, toWall } from '../engine/expr/format.js';

/** A date's sort key: its wall clock as a UTC timestamp (the report's zone, else the host's clock fields), so the key does not depend on the host's zone (a date-only value is host-local midnight). */
const dateKey = (d, tz) => (tz ? toWall(d, tz) : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()));

/** Most rows a file carries for the Tables view (beyond it, the file stays pages only). */
export const MAX_DATA_ROWS = 20000;

/** Strings the view shows, in the viewer's language when the caller passes them. */
export const DATA_STRINGS = { pages: 'Pages', tables: 'Tables', all: 'All', filter: 'Filter', toggle: 'Show or hide the rows of this group', sortAsc: 'Sort ascending', sortDesc: 'Sort descending' };

/**
 * The tables of a model as the view's data, or null (no tables, or too many rows).
 * Each row: { k: kind, l: level, c: [[col, text, key, span]] } (key: a number, or text in lower case, for sorting).
 * sort: the columns the report sorts on click (its interactive-sort header cells, matched by position).
 * @param {any} model @param {{ locale?: string, currency?: string }} [o]
 */
export function tablesData(model, o = {}) {
  const regions = mergedRegions(model);
  if (!regions.length || regions.reduce((n, r) => n + r.rows.length, 0) > MAX_DATA_ROWS) return null;
  // interactive-sort columns: a sort link over a header cell of that table
  const sortable = new Map();
  for (const pg of model.pages) {
    const heads = pg.items.filter(i => i.t === 'text' && i.cell?.kind === 'header' && i.clip);
    for (const l of pg.items) {
      if (l.t !== 'link' || l.action?.type !== 'sort') continue;
      const h = heads.find(t => t.cell.table === l.action.table && Math.abs(t.clip.x - l.x) < 1);
      if (h) (sortable.get(h.cell.table) || sortable.set(h.cell.table, new Set()).get(h.cell.table)).add(h.cell.col);
    }
  }
  const show = (c) => (c.value instanceof Date ? isoDate(c.value, model.timeZone || undefined) : typeof c.value === 'boolean' ? String(c.value) : formatValue(c.value, c.format, { locale: o.locale, currency: o.currency }));
  return regions.map(r => ({
    name: String(r.name || 'Table'),
    cols: r.columns.length,
    sort: [...(sortable.get(r.name) || [])],
    rows: r.rows.map(row => ({
      k: row.kind, l: row.level || 0,
      c: row.cells.filter(c => c.colIndex >= 0).map(c => [c.colIndex, String(show(c) ?? ''), c.value instanceof Date ? dateKey(c.value, model.timeZone || undefined) : typeof c.value === 'number' ? c.value : String(c.value ?? '').toLowerCase(), c.span || 1]),
    })),
  }));
}

/** The script of the Tables view (a constant: its hash goes in the file's CSP). @type {string} */
export const DATA_SCRIPT = `(() => {
const d = JSON.parse(document.getElementById('pw-data').textContent), S = d.strings;
const bar = document.getElementById('pw-bar'), box = document.getElementById('pw-tables');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
bar.hidden = false;
bar.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  const tables = b.dataset.view === 'tables';
  document.body.classList.toggle('pw-show-tables', tables);
  box.hidden = !tables;
  for (const x of bar.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  if (tables && !box.firstChild) for (const t of d.tables) box.appendChild(view(t));
});
function view(t) {
  const sec = el('section', 'pw-t');
  sec.appendChild(el('h2', null, t.name));
  const heads = t.rows.filter(r => r.k === 'header');
  const body = t.rows.filter(r => r.k !== 'header');
  const label = (c) => { for (const h of heads) for (const x of h.c) if (x[0] === c) return x[1]; return String(c + 1); };
  // filters: text columns of detail rows with a few distinct values
  const active = new Map();
  const bar2 = el('div', 'pw-f');
  for (let c = 0; c < t.cols; c++) {
    const vals = new Set(); let text = true;
    for (const r of body) if (r.k === 'detail') for (const x of r.c) if (x[0] === c && x[1] !== '') { vals.add(x[1]); if (typeof x[2] === 'number') text = false; }
    if (!text || vals.size < 2 || vals.size > 30) continue;
    const lab = el('label', null, label(c) + ' ');
    const s = el('select');
    s.appendChild(new Option(S.all, ''));
    for (const v of [...vals].sort()) s.appendChild(new Option(v, v));
    s.addEventListener('change', () => { if (s.value) active.set(c, s.value); else active.delete(c); draw(); });
    lab.appendChild(s);
    bar2.appendChild(lab);
  }
  if (bar2.firstChild) { bar2.prepend(el('span', 'pw-fl', S.filter)); sec.appendChild(bar2); }
  const table = el('table'), thead = el('thead'), tbody = el('tbody');
  let order = null; // { c, dir }
  const closed = new Set();
  for (const h of heads) {
    const tr = el('tr');
    for (const x of h.c) {
      const th = el('th');
      th.scope = 'col';
      if (x[3] > 1) th.colSpan = x[3];
      if (t.sort.includes(x[0])) {
        const b = el('button', 'pw-s', x[1]);
        b.type = 'button';
        b.title = S.sortAsc;
        b.addEventListener('click', () => {
          order = order && order.c === x[0] && order.dir === 1 ? { c: x[0], dir: -1 } : { c: x[0], dir: 1 };
          for (const o of thead.querySelectorAll('th')) o.removeAttribute('aria-sort');
          th.setAttribute('aria-sort', order.dir === 1 ? 'ascending' : 'descending');
          b.title = order.dir === 1 ? S.sortDesc : S.sortAsc;
          draw();
        });
        th.appendChild(b);
      } else th.textContent = x[1];
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  }
  table.append(thead, tbody);
  sec.appendChild(table);
  const key = (r) => { const x = r.c.find(y => y[0] === order.c); return x ? x[2] : ''; };
  const cmp = (a, b) => { const p = key(a), q = key(b); return (typeof p === typeof q ? (p < q ? -1 : p > q ? 1 : 0) : typeof p === 'number' ? -1 : 1) * order.dir; };
  function draw() {
    // detail rows sorted within each run between group rows; groups keep their place
    let rows = body;
    if (order) {
      rows = [];
      for (let i = 0; i < body.length;) {
        if (body[i].k !== 'detail') { rows.push(body[i++]); continue; }
        const run = [];
        while (i < body.length && body[i].k === 'detail') run.push(body[i++]);
        for (const x of run.sort(cmp)) rows.push(x);
      }
    }
    const keep = (r) => { for (const [c, v] of active) { const x = r.c.find(y => y[0] === c); if (!x || x[1] !== v) return false; } return true; };
    tbody.textContent = '';
    let hideFrom = -1; // the level of a closed group whose rows are hidden
    rows.forEach((r) => {
      if (hideFrom >= 0 && (r.k === 'header' || r.k === 'footer' || (r.k === 'groupHeader' && r.l <= hideFrom) || (r.k === 'groupFooter' && r.l <= hideFrom))) hideFrom = -1;
      if (hideFrom >= 0) return;
      if (r.k === 'detail' && !keep(r)) return;
      const tr = el('tr', 'pw-' + r.k);
      let c0 = true;
      for (const x of r.c) {
        const td = el('td', typeof x[2] === 'number' ? 'pw-n' : null);
        if (x[3] > 1) td.colSpan = x[3];
        if (c0 && r.k === 'groupHeader') {
          const b = el('button', 'pw-g', closed.has(r) ? '▶' : '▼');
          b.type = 'button';
          b.title = S.toggle;
          b.setAttribute('aria-expanded', String(!closed.has(r)));
          b.addEventListener('click', () => { if (closed.has(r)) closed.delete(r); else closed.add(r); draw(); });
          td.append(b, ' ');
        }
        td.append(x[1]);
        tr.appendChild(td);
        c0 = false;
      }
      tbody.appendChild(tr);
      if (r.k === 'groupHeader' && closed.has(r)) hideFrom = r.l;
    });
  }
  draw();
  return sec;
}
})();`;

/** CSS of the bar and the Tables view. @type {string} */
export const DATA_CSS = `.pw-bar{position:sticky;top:0;z-index:2;display:flex;gap:4px;padding:4px;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.pw-bar button{font:inherit;border:1px solid #c9d1d9;background:#fff;border-radius:6px;padding:4px 12px;cursor:pointer}.pw-bar button[aria-pressed=true]{background:#1f2937;color:#fff;border-color:#1f2937}
body.pw-show-tables .page{display:none}#pw-tables{width:100%;max-width:none;display:flex;flex-direction:column;gap:24px}
.pw-t{background:#fff;padding:16px;border-radius:8px;overflow-x:auto}.pw-t h2{font-size:16px;margin:0 0 8px}
.pw-t table{border-collapse:collapse;width:100%;font-size:13px}.pw-t th,.pw-t td{border-bottom:1px solid #e5e7eb;padding:4px 8px;text-align:left}.pw-t td.pw-n{text-align:right;font-variant-numeric:tabular-nums}
.pw-t th{background:#f1f5f9}.pw-t .pw-groupHeader td,.pw-t .pw-groupFooter td,.pw-t .pw-footer td{font-weight:600}
.pw-s,.pw-g{font:inherit;border:0;background:none;padding:0;cursor:pointer;color:inherit}.pw-s:after{content:" ⇅";opacity:.5}
.pw-f{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:8px;font-size:13px}.pw-fl{font-weight:600}
@media print{.pw-bar,#pw-tables{display:none}}`;

/** sha256 of a text, base64 (a CSP hash). */
export async function cspHash(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const u8 = new Uint8Array(d);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}
