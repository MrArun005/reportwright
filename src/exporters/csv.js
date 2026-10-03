// @ts-check
import { mergedRegions } from './regions.js';
import { formatValue } from '../engine/expr/format.js';

const q = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * CSV of the first table (or every table, one after another with a blank line).
 * Numbers stay raw; dates use ISO form so spreadsheets read them.
 */
export function exportCsv(model, { all = true, locale, currency } = {}) {
  const regions = mergedRegions(model);
  if (!regions.length) {
    // no tables: one text line per row of the page model
    return model.pages.flatMap(p => p.items.filter(i => i.t === 'text').flatMap(i => i.lines.map(l => q(l.text)))).join('\r\n');
  }
  const out = [];
  for (const r of all ? regions : regions.slice(0, 1)) {
    if (regions.length > 1) out.push(q(r.name));
    for (const row of r.rows) {
      const line = new Array(r.columns.length).fill('');
      for (const c of row.cells) {
        const v = c.value instanceof Date ? c.value.toISOString().slice(0, 10) : typeof c.value === 'number' ? c.value : c.value === true || c.value === false ? String(c.value) : formatValue(c.value, null, { locale, currency });
        if (c.colIndex >= 0) line[c.colIndex] = q(v);
      }
      out.push(line.join(','));
    }
    out.push('');
  }
  return '﻿' + out.join('\r\n');
}
