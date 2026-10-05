// @ts-check
/**
 * A page model rendered without exportData (the default: a view, a plain PDF) has no table data and no cell tags:
 * the exports that rebuild tables refuse it rather than write a file without its tables.
 */
export function needsTableData(model, what) {
  if (model && model.regions === null) throw Object.assign(new Error(`${what} needs the report's table data: render it with { exportData: true }`), { code: 'NO_EXPORT_DATA' });
}
/** True when an export of this format needs the table data: render(def, { exportData: needsExportData(format, options) }). */
export const needsExportData = (fmt, o = {}) => ['xlsx', 'csv', 'docx', 'pptx', 'html', 'json'].includes(fmt) || (fmt === 'pdf' && !!(o.pdfua || o.ua || o.tagged));
/** Merge table regions that share a name (a table repeated inside a list). */
export function mergedRegions(model) {
  const map = new Map();
  for (const r of model.regions || []) {
    const m = map.get(r.name);
    if (!m) map.set(r.name, { ...r, rows: [...r.rows] });
    else { const hasHeader = m.rows.some(x => x.kind === 'header'); for (const row of r.rows) if (row.kind !== 'header' || !hasHeader) m.rows.push(row); }
  }
  return [...map.values()];
}

/**
 * The visual lines of a text item, as strings. A justified line is one run per word on the same
 * baseline; this joins them back (in x order) so text exports and search see whole lines.
 * @param {{ lines: { x: number, y: number, text: string }[] }} it
 * @returns {string[]}
 */
export function visualLines(it) {
  const rows = new Map();
  for (const l of it.lines) {
    let r = rows.get(l.y);
    if (!r) { r = []; rows.set(l.y, r); }
    r.push(l);
  }
  return [...rows.keys()].sort((a, b) => a - b).map(y => rows.get(y).sort((a, b) => a.x - b.x).map(l => l.text).join(' '));
}

/** True when a text item is justified: some visual line has several runs. */
export const isJustified = (it) => new Set(it.lines.map(l => l.y)).size < it.lines.length;

/**
 * The visual lines of a page's text items, as strings. Rich text draws one text item per styled
 * fragment (`rich: {id, l}`); the fragments of one box on one line (superscripts included) are joined in x order with
 * nothing between them (they keep their own spaces). Other items give their visualLines().
 * @param {any[]} items page-model items (anything that is not text is skipped)
 * @returns {string[]}
 */
export function textRows(items) {
  const out = [];
  /** @type {Map<string, { y: number, frags: any[] }>} */
  let group = new Map(), groupId = null;
  const flushGroup = () => {
    for (const r of [...group.values()].sort((a, b) => a.y - b.y)) out.push(r.frags.sort((a, b) => a.x - b.x).map(l => l.text).join(''));
    group = new Map(); groupId = null;
  };
  for (const it of items) {
    if (it.t !== 'text' || !it.lines?.length) continue;
    if (!it.rich) { if (groupId !== null) flushGroup(); for (const l of visualLines(it)) out.push(l); continue; }
    if (it.rich.id !== groupId) { if (groupId !== null) flushGroup(); groupId = it.rich.id; }
    const k = String(it.rich.l);
    let r = group.get(k);
    if (!r) { r = { y: it.rich.l, frags: [] }; group.set(k, r); }
    for (const l of it.lines) r.frags.push(l);
  }
  if (groupId !== null) flushGroup();
  return out;
}
