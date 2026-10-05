// @ts-check
import { mergedRegions, textRows, needsTableData } from './regions.js';
import { formatValue, isoDate, roundHalfAway } from '../engine/expr/format.js';

const q = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// Text starting with = + - @ (or tab / CR) runs as a formula in a spreadsheet; a leading ' keeps it text.
const text = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

/**
 * A number as the page shows it: rounded to the decimals of its format (N2, C0, P1 keeps 3), half away from zero as
 * the formatter rounds. Tables keep the full value (Excel rounds with its number format); CSV is text, so it gets
 * what the reader saw.
 */
function shown(v, fmt) {
  const m = /^([CcNnFfPp])(\d{0,2})$/.exec(fmt || '');
  if (!m) return Number.isInteger(v) ? v : roundHalfAway(v, 6);
  return roundHalfAway(v, (m[2] === '' ? 2 : Number(m[2])) + (m[1].toUpperCase() === 'P' ? 2 : 0));
}

/**
 * CSV of the report's data: one header row and the detail rows of the main table (the one with the most detail rows),
 * numbers without symbols or separators, dates in ISO form. Group headers, subtotals, totals and other tables are left
 * out. layout: true gives the printed layout instead: every table with its name and every row (group lines, totals).
 * @param {any} model @param {{ all?: boolean, layout?: boolean, locale?: string, currency?: string }} [o]
 */
export function exportCsv(model, { all = true, layout = false, locale, currency } = {}) {
  needsTableData(model, 'CSV');
  const regions = mergedRegions(model);
  if (!regions.length) {
    // no tables: one text line per row of the page model
    return model.pages.flatMap(p => textRows(p.items).map(l => q(text(l)))).join('\r\n');
  }
  const cell = (c) => (c.value instanceof Date ? isoDate(c.value, model.timeZone || undefined) : typeof c.value === 'number' ? shown(c.value, c.format) : c.value === true || c.value === false ? String(c.value) : text(formatValue(c.value, null, { locale, currency })));
  const line = (r, row) => {
    const out = new Array(r.columns.length).fill('');
    for (const c of row.cells) if (c.colIndex >= 0) out[c.colIndex] = q(cell(c));
    return out.join(',');
  };
  const out = [];
  if (!layout) {
    const details = (r) => r.rows.reduce((n, x) => n + (x.kind === 'detail' ? 1 : 0), 0);
    const main = regions.reduce((a, b) => (details(b) > details(a) ? b : a));
    // header rows stacked into one: a cell spanning columns names each of them ("Who Id", "Who Name")
    const names = main.columns.map(() => /** @type {string[]} */ ([]));
    for (const row of main.rows) {
      if (row.kind !== 'header') continue;
      for (const c of row.cells) {
        const t = c.value == null ? '' : String(c.value).trim();
        if (!t || c.colIndex < 0) continue;
        for (let k = c.colIndex; k < Math.min(names.length, c.colIndex + Math.max(1, c.span || 1)); k++) if (names[k][names[k].length - 1] !== t) names[k].push(t);
      }
    }
    out.push(names.map((n, i) => q(text(n.join(' ') || `Column ${i + 1}`))).join(','));
    for (const row of main.rows) if (row.kind === 'detail') out.push(line(main, row));
    return '\uFEFF' + out.join('\r\n');
  }
  for (const r of all ? regions : regions.slice(0, 1)) {
    if (regions.length > 1) out.push(q(r.name));
    for (const row of r.rows) out.push(line(r, row));
    out.push('');
  }
  return '\uFEFF' + out.join('\r\n');
}
