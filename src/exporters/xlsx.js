// @ts-check
import { mergedRegions, textRows } from './regions.js';

/** .NET-style format → Excel number format. */
export function excelFormat(fmt, currencySymbol = '₹') {
  if (!fmt) return null;
  const m = /^([CcNnFfPpDd])(\d{0,2})$/.exec(fmt);
  if (m) {
    const d = m[2] === '' ? 2 : Number(m[2]);
    const dec = d ? '.' + '0'.repeat(d) : '';
    switch (m[1].toUpperCase()) {
      case 'C': return `"${currencySymbol}"#,##0${dec}`;
      case 'N': return `#,##0${dec}`;
      case 'F': return `0${dec}`;
      case 'P': return `0${dec}%`;
      case 'D': return '0'.repeat(Math.max(1, d));
    }
  }
  if (/[yMd]/.test(fmt) && !/[#0]/.test(fmt)) return fmt.replace(/M/g, 'm').replace(/mmmm/g, 'mmmm').replace(/tt/g, 'AM/PM').replace(/HH/g, 'hh');
  if (/[#0]/.test(fmt)) return fmt;
  return null;
}

const SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };

/**
 * Excel workbook in "data mode": one sheet per table, typed cells, number formats,
 * bold header and group rows, and outline levels for grouped detail rows.
 * @param {any} model  render() output
 * @param {any} ExcelJS  the exceljs module (passed in so the browser can load it lazily)
 * @returns {Promise<Uint8Array>}
 */
export async function exportXlsx(model, ExcelJS, { currency = 'INR', title } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pagewright';
  wb.created = new Date();
  wb.title = title || model.name || 'Report';
  const regions = mergedRegions(model);
  const used = new Set();
  const sheetName = (n) => {
    let s = String(n || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Sheet';
    let k = s, i = 2;
    while (used.has(k.toLowerCase())) k = `${s} ${i++}`;
    used.add(k.toLowerCase());
    return k;
  };
  if (!regions.length) {
    const ws = wb.addWorksheet(sheetName(title || 'Report'));
    model.pages.forEach((p, pi) => {
      for (const l of textRows(p.items)) ws.addRow([pi + 1, l]);
    });
    ws.getColumn(1).width = 6; ws.getColumn(2).width = 80;
  }
  for (const r of regions) {
    const ws = wb.addWorksheet(sheetName(r.name));
    r.columns.forEach((w, i) => { ws.getColumn(i + 1).width = Math.max(6, Math.round(w / 5.5)); });
    let headerRows = 0;
    const merges = []; // applied after the rows exist (a merge down would otherwise create rows ahead of addRow)
    for (const row of r.rows) {
      const values = new Array(r.columns.length).fill(null);
      for (const c of row.cells) if (c.colIndex >= 0) values[c.colIndex] = c.value === '' ? null : c.value;
      const xr = ws.addRow(values);
      if (row.kind === 'header') headerRows++;
      if (row.kind === 'detail' && row.level > 0) xr.outlineLevel = Math.min(7, row.level);
      for (const c of row.cells) {
        if (c.colIndex < 0) continue;
        const cell = xr.getCell(c.colIndex + 1);
        const nf = excelFormat(c.format, SYMBOL[currency] || currency);
        if (nf && (typeof c.value === 'number' || c.value instanceof Date)) cell.numFmt = nf;
        else if (c.value instanceof Date) cell.numFmt = 'dd mmm yyyy';
        if (c.bold || row.kind !== 'detail') cell.font = { bold: c.bold || row.kind === 'header' };
        if (c.span > 1 || c.rowSpan > 1) merges.push([xr.number, c.colIndex + 1, xr.number + Math.max(1, c.rowSpan || 1) - 1, c.colIndex + Math.max(1, c.span || 1)]);
      }
      if (row.kind === 'header') xr.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF3' } }; });
    }
    const last = ws.rowCount;
    for (const [r1, c1, r2, c2] of merges) { try { ws.mergeCells(r1, c1, Math.min(r2, last), c2); } catch { /* overlaps a merge already made */ } }
    if (headerRows) ws.views = [{ state: 'frozen', ySplit: headerRows }];
    ws.properties.outlineLevelRow = Math.max(0, ...r.rows.map(x => (x.kind === 'detail' ? x.level : 0)));
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}
