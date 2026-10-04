// @ts-check
/** Merge table regions that share a name (a table repeated inside a list). */
export function mergedRegions(model) {
  const map = new Map();
  for (const r of model.regions || []) {
    const m = map.get(r.name);
    if (!m) map.set(r.name, { ...r, rows: [...r.rows] });
    else m.rows.push(...r.rows.filter(row => row.kind !== 'header' || !m.rows.some(x => x.kind === 'header')));
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
    if (!it.rich) { if (groupId !== null) flushGroup(); out.push(...visualLines(it)); continue; }
    if (it.rich.id !== groupId) { if (groupId !== null) flushGroup(); groupId = it.rich.id; }
    const k = String(it.rich.l);
    let r = group.get(k);
    if (!r) { r = { y: it.rich.l, frags: [] }; group.set(k, r); }
    r.frags.push(...it.lines);
  }
  if (groupId !== null) flushGroup();
  return out;
}
