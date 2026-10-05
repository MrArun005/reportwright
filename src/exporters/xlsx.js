// @ts-check
import { mergedRegions, textRows, needsTableData } from './regions.js';
import { figures, figurePicture, altOf, b64 } from './figures.js';
import { toWall } from '../engine/expr/format.js';
import { chartTable, addCharts } from './xlsxchart.js';

/** .NET-style format → Excel number format. */
export function excelFormat(fmt, currencySymbol = '', locale) {
  if (!fmt) return null;
  const m = /^([CcNnFfPpDd])(\d{0,2})$/.exec(fmt);
  if (m) {
    const d = m[2] === '' ? 2 : Number(m[2]);
    const dec = d ? '.' + '0'.repeat(d) : '';
    // en-IN groups lakhs and crores (12,34,56,789): Excel has no such grouping, so conditions pick the commas
    const g = /-IN$/i.test(locale || '') ? (s) => `[>=10000000]${s}##\\,##\\,##\\,##0${dec};[>=100000]${s}##\\,##\\,##0${dec};${s}##,##0${dec}` : null;
    switch (m[1].toUpperCase()) {
      case 'C': return g ? g(`"${currencySymbol}"`) : `"${currencySymbol}"#,##0${dec}`;
      case 'N': return g ? g('') : `#,##0${dec}`;
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

/** Excel's column letters for a 1-based column. */
const colName = (c) => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
/** decimals a .NET format shows (N2 → 2, C0 → 0, P1 → 1, #,##0.00 → 2), or null when unknown */
const decimalsOf = (fmt) => {
  const m = /^[CcNnFfPp](\d{0,2})$/.exec(fmt || '');
  if (m) return (m[1] === '' ? 2 : Number(m[1])) + (/^[Pp]/.test(fmt) ? 2 : 0);
  const d = /\.(0+)/.exec(fmt || '');
  return d ? d[1].length : fmt ? 0 : null;
};

/**
 * A group footer's or table footer's total as a live formula: SUBTOTAL over the detail rows it covers, when the shown
 * value is the sum, count, average, minimum or maximum of those rows (checked here, to the format's decimals).
 * Otherwise null: the value stays a value. SUBTOTAL leaves out the subtotals inside a range, so a grand total
 * over the whole data area does not count the group subtotals twice.
 * @param {any[]} rows the sheet's rows ({ kind, level, cells, n: sheet row }) @param {number} at this row's index
 * @param {{ colIndex: number, value: any, format?: string }} c
 * @param {Map<string, string>} made `${row}|${col}` → formula already given (the cells a range may include)
 */
function totalFormula(rows, at, c, made) {
  const row = rows[at];
  if (typeof c.value !== 'number' || !Number.isFinite(c.value)) return null;
  // the detail rows this total covers: back to this group's start (its header, or the footer of the group before)
  const covered = [];
  for (let k = at - 1; k >= 0; k--) {
    const r = rows[k];
    if (r.kind === 'header') break;
    if (row.kind === 'groupFooter' && (r.kind === 'groupFooter' || r.kind === 'groupHeader') && r.level <= row.level) break;
    if (r.kind === 'detail') covered.push(k);
  }
  if (!covered.length) return null;
  covered.reverse();
  const vals = covered.map(k => rows[k].cells.find(x => x.colIndex === c.colIndex)?.value).filter(v => v != null && v !== '');
  const nums = vals.filter(v => typeof v === 'number' && Number.isFinite(v));
  const d = decimalsOf(c.format);
  const tol = d == null ? 1e-9 * Math.max(1, Math.abs(c.value)) : 0.5 * 10 ** -d + 1e-9;
  const same = (v) => Math.abs(v - c.value) <= tol;
  let fn = null;
  const sum = nums.reduce((s, v) => s + v, 0);
  if (nums.length && same(sum)) fn = 9;
  else if (same(vals.length)) fn = nums.length === vals.length ? 2 : 3; // COUNT, or COUNTA when there is text
  // average, minimum, maximum: only when the values differ (a column of equal ratios matches all three by chance)
  else if (nums.length > 1 && nums.some(v => v !== nums[0])) {
    if (same(sum / nums.length)) fn = 1;
    else if (same(Math.min(...nums))) fn = 5;
    else if (same(Math.max(...nums))) fn = 4;
  }
  if (!fn) return null;
  const col = colName(c.colIndex + 1);
  // runs of consecutive covered rows
  const runs = [];
  for (const k of covered) {
    const last = runs[runs.length - 1];
    if (last && rows[k].n === last[1] + 1) last[1] = rows[k].n; else runs.push([rows[k].n, rows[k].n]);
  }
  let refs = runs.map(([a, b]) => (a === b ? `${col}${a}` : `${col}${a}:${col}${b}`));
  if (refs.length > 30) {
    // one range over the whole span, when everything else in it is a subtotal formula or empty (SUBTOTAL skips subtotals)
    const first = covered[0], last = covered[covered.length - 1];
    for (let k = first; k <= last; k++) {
      if (rows[k].kind === 'detail') continue;
      const v = rows[k].cells.find(x => x.colIndex === c.colIndex)?.value;
      if (v != null && v !== '' && !made.has(`${k}|${c.colIndex}`)) return null;
    }
    refs = [`${col}${rows[first].n}:${col}${rows[last].n}`];
  }
  return `SUBTOTAL(${fn},${refs.join(',')})`;
}

/**
 * Excel workbook in "data mode": one sheet per table, typed cells, number formats,
 * bold header and group rows, and outline levels for grouped detail rows. Group and table totals that are a sum,
 * count, average, minimum or maximum of their column are live SUBTOTAL formulas (formulas: false keeps values).
 * Charts and pictures go on a sheet of their own as pictures (PNG; needs a rasteriser, see figures.js).
 * @param {any} model  render() output
 * @param {any} ExcelJS  the exceljs module (passed in so the browser can load it lazily)
 * @param {{ currency?: string, title?: string, formulas?: boolean, pictures?: boolean, fontStore?: any,
 *   fetchImage?: (src: string) => Promise<Uint8Array|null>, rasterize?: any }} [opt]
 * @returns {Promise<Uint8Array>}
 */
export async function exportXlsx(model, ExcelJS, { currency, title, formulas = true, pictures = true, charts = true, fontStore, fetchImage, rasterize, timeZone } = {}) {
  needsTableData(model, 'Excel');
  // Excel dates have no zone: ExcelJS writes a Date's UTC parts, so a date goes in as its wall clock in the zone the
  // report showed it in (a local midnight east of UTC was a day early)
  const tz = timeZone ?? model.timeZone ?? undefined;
  const cellValue = (v) => (v === '' ? null : v instanceof Date ? new Date(toWall(v, tz)) : v);
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
    const rows = r.rows.map(row => ({ ...row, n: 0 }));
    const made = new Map();
    rows.forEach((row, ri) => {
      const values = new Array(r.columns.length).fill(null);
      for (const c of row.cells) if (c.colIndex >= 0) values[c.colIndex] = cellValue(c.value);
      const xr = ws.addRow(values);
      row.n = xr.number;
      if (row.kind === 'header') headerRows++;
      if (row.kind === 'detail' && row.level > 0) xr.outlineLevel = Math.min(7, row.level);
      for (const c of row.cells) {
        if (c.colIndex < 0) continue;
        const cell = xr.getCell(c.colIndex + 1);
        const nf = excelFormat(c.format, SYMBOL[currency] || currency || '', model.locale);
        if (nf && (typeof c.value === 'number' || c.value instanceof Date)) cell.numFmt = nf;
        else if (c.value instanceof Date) cell.numFmt = 'dd mmm yyyy';
        if (c.bold || row.kind !== 'detail') cell.font = { bold: c.bold || row.kind === 'header' };
        if (c.span > 1 || c.rowSpan > 1) merges.push([xr.number, c.colIndex + 1, xr.number + Math.max(1, c.rowSpan || 1) - 1, c.colIndex + Math.max(1, c.span || 1)]);
        if (formulas && (row.kind === 'groupFooter' || row.kind === 'footer') && !(c.span > 1)) {
          const f = totalFormula(rows, ri, c, made);
          if (f) { cell.value = { formula: f, result: c.value }; made.set(`${ri}|${c.colIndex}`, f); }
        }
      }
      if (row.kind === 'header') xr.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF3' } }; });
    });
    const last = ws.rowCount;
    for (const [r1, c1, r2, c2] of merges) { try { ws.mergeCells(r1, c1, Math.min(r2, last), c2); } catch { /* overlaps a merge already made */ } }
    if (headerRows) ws.views = [{ state: 'frozen', ySplit: headerRows }];
    ws.properties.outlineLevelRow = Math.max(0, ...r.rows.map(x => (x.kind === 'detail' ? x.level : 0)));
  }
  // charts Excel can draw: a sheet each, with the chart's data at A1 and an editable chart bound to it (xlsxchart.js)
  const native = [];
  const nativeFigs = new Set();
  if (charts) {
    for (const pg of model.pages) for (const f of figures(pg.items)) {
      const spec = f.tag.k === 'chart' ? f.items.find(it => it.xchart)?.xchart : null;
      if (!spec || native.length >= 100) continue;
      const ws = wb.addWorksheet(sheetName(spec.title || f.tag.alt || `Chart ${native.length + 1}`));
      const rows = chartTable(spec);
      rows.forEach((r, ri) => { const xr = ws.addRow(r); if (ri === 0) xr.font = { bold: true }; });
      rows[0].forEach((_, ci) => { ws.getColumn(ci + 1).width = ci === 0 && spec.categories ? 18 : 12; });
      native.push({ sheet: ws.name, spec, at: { col: rows[0].length + 1, row: 1 } });
      nativeFigs.add(f.tag);
    }
  }
  if (pictures) {
    // charts, pictures, maps, barcodes: one below the other on their own sheet, each with its description above it
    let ws = null, row = 1;
    for (const pg of model.pages) for (const f of figures(pg.items)) {
      if (f.tag.k === 'shape' || f.tag.k === 'line' || nativeFigs.has(f.tag)) continue; // decoration, not data; native charts are above
      const pic = await figurePicture(f, { fontStore, fetchImage, rasterize });
      const bytes = pic.png || pic.jpeg;
      if (!bytes) continue;
      ws ||= wb.addWorksheet(sheetName('Charts'));
      ws.getCell(row, 1).value = altOf(f.tag);
      ws.getCell(row, 1).font = { bold: true };
      const id = wb.addImage({ base64: `data:image/${pic.png ? 'png' : 'jpeg'};base64,${b64(bytes)}`, extension: pic.png ? 'png' : 'jpeg' });
      const w = Math.round(pic.w * 4 / 3), h = Math.round(pic.h * 4 / 3); // points → pixels
      ws.addImage(id, { tl: { col: 0, row }, ext: { width: w, height: h }, editAs: 'oneCell' });
      row += 2 + Math.ceil(h / 20); // default rows are 20 px
    }
  }
  if (formulas) wb.calcProperties.fullCalcOnLoad = true; // Excel works the totals out again on open
  const buf = await wb.xlsx.writeBuffer();
  return addCharts(new Uint8Array(buf), native);
}
