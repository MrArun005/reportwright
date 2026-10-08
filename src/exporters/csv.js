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
    return '\uFEFF' + model.pages.flatMap(p => textRows(p.items).map(l => q(text(l)))).join('\r\n');
  }
  const line = csvLine({ timeZone: model.timeZone, locale, currency });
  const out = [];
  if (!layout) {
    const details = (r) => r.rows.reduce((n, x) => n + (x.kind === 'detail' ? 1 : 0), 0);
    const main = regions.reduce((a, b) => (details(b) > details(a) ? b : a));
    const names = csvNames(main.columns.length);
    for (const row of main.rows) if (row.kind === 'header') names.add(row);
    out.push(names.line());
    for (const row of main.rows) if (row.kind === 'detail') out.push(line(main.columns.length, row));
    return '\uFEFF' + out.join('\r\n');
  }
  for (const r of all ? regions : regions.slice(0, 1)) {
    if (regions.length > 1) out.push(q(r.name));
    for (const row of r.rows) out.push(line(r.columns.length, row));
    out.push('');
  }
  return '\uFEFF' + out.join('\r\n');
}

/**
 * A CSV line from a region row (one value per column, empty where no cell starts). Shared by exportCsv and the streaming
 * writer (writeCsvStream), so both write the same bytes.
 * @param {{ timeZone?: string|null, locale?: string, currency?: string }} o
 */
export function csvLine({ timeZone, locale, currency }) {
  const cell = (c) => (c.value instanceof Date ? isoDate(c.value, timeZone || undefined) : typeof c.value === 'number' ? shown(c.value, c.format) : c.value === true || c.value === false ? String(c.value) : text(formatValue(c.value, null, { locale, currency })));
  return (ncols, row) => {
    const out = new Array(ncols).fill('');
    for (const c of row.cells) if (c.colIndex >= 0) out[c.colIndex] = q(cell(c));
    return out.join(',');
  };
}

/** The data CSV's header line: header rows stacked into one, a cell spanning columns naming each of them ("Who Id"). */
export function csvNames(ncols) {
  const names = Array.from({ length: ncols }, () => /** @type {string[]} */ ([]));
  return {
    /** @param {{ cells: any[] }} row */
    add(row) {
      for (const c of row.cells) {
        const t = c.value == null ? '' : String(c.value).trim();
        if (!t || c.colIndex < 0) continue;
        for (let k = c.colIndex; k < Math.min(names.length, c.colIndex + Math.max(1, c.span || 1)); k++) if (names[k][names[k].length - 1] !== t) names[k].push(t);
      }
    },
    line: () => names.map((n, i) => q(text(n.join(' ') || `Column ${i + 1}`))).join(','),
  };
}

/**
 * The data CSV of a streaming plan (engine/stream.js), written as its rows come: the same bytes exportCsv writes for the
 * model of that report. put(text) may return a promise (back-pressure): it is awaited.
 * @param {{ columns: number[], timeZone: string|null, rows: () => AsyncGenerator<any> }} plan
 * @param {(s: string) => any} put @param {{ locale?: string, currency?: string }} [o]
 */
export async function writeCsvStream(plan, put, { locale, currency } = {}) {
  const n = plan.columns.length;
  const line = csvLine({ timeZone: plan.timeZone, locale, currency });
  const names = csvNames(n);
  let started = false;
  for await (const row of plan.rows()) {
    if (row.kind === 'header') { names.add(row); continue; }
    if (row.kind !== 'detail') continue;
    if (!started) { started = true; await put('\uFEFF' + names.line()); }
    await put('\r\n' + line(n, row));
  }
  if (!started) await put('\uFEFF' + names.line());
}
