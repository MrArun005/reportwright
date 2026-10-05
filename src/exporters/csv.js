// @ts-check
import { mergedRegions, textRows, needsTableData } from './regions.js';
import { formatValue, isoDate, roundHalfAway } from '../engine/expr/format.js';

const q = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// Text starting with = + - @ (or tab / CR) runs as a formula in a spreadsheet; a leading ' keeps it text.
const text = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

/**
 * CSV of the first table (or every table, one after another with a blank line).
 * Numbers stay raw; dates use ISO form so spreadsheets read them.
 */
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

export function exportCsv(model, { all = true, locale, currency } = {}) {
  needsTableData(model, 'CSV');
  const regions = mergedRegions(model);
  if (!regions.length) {
    // no tables: one text line per row of the page model
    return model.pages.flatMap(p => textRows(p.items).map(l => q(text(l)))).join('\r\n');
  }
  const out = [];
  for (const r of all ? regions : regions.slice(0, 1)) {
    if (regions.length > 1) out.push(q(r.name));
    for (const row of r.rows) {
      const line = new Array(r.columns.length).fill('');
      for (const c of row.cells) {
        const v = c.value instanceof Date ? isoDate(c.value, model.timeZone || undefined) : typeof c.value === 'number' ? shown(c.value, c.format) : c.value === true || c.value === false ? String(c.value) : text(formatValue(c.value, null, { locale, currency }));
        if (c.colIndex >= 0) line[c.colIndex] = q(v);
      }
      out.push(line.join(','));
    }
    out.push('');
  }
  return '﻿' + out.join('\r\n');
}
