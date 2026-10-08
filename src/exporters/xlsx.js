// @ts-check
import { mergedRegions, textRows, needsTableData } from './regions.js';
import { figures, figurePicture, altOf } from './figures.js';
import { toWall, standardDate, currencyOf } from '../engine/expr/format.js';
import { chartTable, addCharts } from './xlsxchart.js';
import { withDeadline } from './deadline.js';
import { Book, colName } from './xlsxwriter.js';

/** A .NET date pattern → an Excel date format (months m, minutes after an hour, tt → AM/PM, 24-hour H). */
const excelDate = (f) => f.replace(/'([^']*)'/g, (_, t) => (/^[\s./:,-]*$/.test(t) ? t : `"${t}"`)).replace(/M/g, 'm').replace(/tt?/g, 'AM/PM').replace(/HH?/g, 'hh').replace(/f+/g, (x) => `.${'0'.repeat(Math.min(3, x.length))}`).replace(/\s*zzz?/g, '');
/** A Java/ICU date pattern ("java:dd/MM/yyyy") → Excel's. */
const javaDateToExcel = (f) => f.replace(/'([^']*)'/g, '"$1"').replace(/E{4,}/g, 'dddd').replace(/E{1,3}/g, 'ddd').replace(/a+/g, 'AM/PM').replace(/H+/g, 'hh').replace(/M/g, 'm').replace(/[kKuDwWFGzZXL]+/g, '');

/**
 * Report format → Excel number format. value: the cell's value, so a date gets a date format (N6: "d" is a date,
 * not two decimals) and an en-IN number its own lakh grouping (N22: Excel's conditions cannot cover negatives).
 * @param {string|null|undefined} fmt @param {string} [currencySymbol] @param {string} [locale] @param {any} [value]
 */
export function excelFormat(fmt, currencySymbol = '', locale, value) {
  if (!fmt) return null;
  if (fmt.startsWith('java:') || fmt.startsWith('icu:')) {
    const p = fmt.slice(fmt.indexOf(':') + 1).replace(/\{RoundingMode=\w+\}/, '');
    if (!p || p.startsWith('@')) return value instanceof Date ? (p.includes('time') && !p.includes('date') ? 'h:mm AM/PM' : 'm/d/yyyy') : null;
    if (value instanceof Date) return javaDateToExcel(p) || null;
    if (/[‰\u2030]|E0/.test(p)) return null; // no per-mille or engineering E in Excel: General
    return p.replace(/¤+/g, `"${currencySymbol}"`).replace(/'([^']*)'/g, '"$1"');
  }
  if (value instanceof Date && fmt.length === 1) {
    const US = { d: 'm/d/yyyy', D: 'dddd, mmmm d, yyyy', t: 'h:mm AM/PM', T: 'h:mm:ss AM/PM', g: 'm/d/yyyy h:mm AM/PM', G: 'm/d/yyyy h:mm:ss AM/PM', M: 'mmmm d', m: 'mmmm d', Y: 'mmmm yyyy', y: 'mmmm yyyy', f: 'dddd, mmmm d, yyyy h:mm AM/PM', F: 'dddd, mmmm d, yyyy h:mm:ss AM/PM', s: 'yyyy-mm-ddThh:mm:ss' };
    if (!locale || /^en-US$/i.test(locale)) return US[fmt] || null;
    const g = (k) => { const p = standardDate(k, locale); return p ? excelDate(p) : null; };
    const both = (a, b) => { const x = g(a), y = g(b); return x && y ? `${x} ${y}` : null; };
    return ({ g: () => both('d', 't'), G: () => both('d', 'T'), f: () => both('D', 't'), F: () => both('D', 'T') })[fmt]?.() ?? g(fmt) ?? US[fmt] ?? null;
  }
  const m = /^([CcNnFfPpDd])(\d{0,2})$/.exec(fmt);
  if (m) {
    const d = m[2] === '' ? 2 : Number(m[2]);
    const dec = d ? '.' + '0'.repeat(d) : '';
    // en-IN groups lakhs and crores (12,34,56,789); Excel has no such grouping, so conditions pick the commas. They
    // cannot also cover negatives (two conditions at most), so a negative cell gets the commas its own value needs (N22)
    const lakh = /-IN$/i.test(locale || '') ? (s) => {
      if (typeof value === 'number' && value < 0) {
        const a = Math.abs(value);
        return a >= 1e7 ? `${s}##\\,##\\,##\\,##0${dec}` : a >= 1e5 ? `${s}##\\,##\\,##0${dec}` : `${s}##,##0${dec}`;
      }
      return `[>=10000000]${s}##\\,##\\,##\\,##0${dec};[>=100000]${s}##\\,##\\,##0${dec};${s}##,##0${dec}`;
    } : null;
    switch (m[1].toUpperCase()) {
      case 'C': return lakh ? lakh(`"${currencySymbol}"`) : `"${currencySymbol}"#,##0${dec}`;
      case 'N': return lakh ? lakh('') : `#,##0${dec}`;
      case 'F': return `0${dec}`;
      case 'P': return `0${dec}%`;
      case 'D': return '0'.repeat(Math.max(1, d));
    }
  }
  if (/[yMd]/.test(fmt) && !/[#0]/.test(fmt)) return excelDate(fmt);
  if (/[#0]/.test(fmt)) return fmt;
  return null;
}

/** The currency symbol for a code in the report locale ("INR" → ₹), else the code. */
export function currencySymbol(iso, locale) {
  if (!iso) return '';
  try { return new Intl.NumberFormat(locale || 'en-US', { style: 'currency', currency: iso }).formatToParts(1).find(p => p.type === 'currency')?.value || iso; } catch { return SYMBOL[iso] || iso; }
}

const SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };

/** decimals a .NET format shows (N2 → 2, C0 → 0, P1 → 1, #,##0.00 → 2), or null when unknown */
const decimalsOf = (fmt) => {
  const m = /^[CcNnFfPp](\d{0,2})$/.exec(fmt || '');
  if (m) return (m[1] === '' ? 2 : Number(m[1])) + (/^[Pp]/.test(fmt) ? 2 : 0);
  const d = /\.(0+)/.exec(fmt || '');
  return d ? d[1].length : fmt ? 0 : null;
};

/** A column's values over the rows a total covers, kept as they pass: what subtotalFn needs, in O(1) memory. */
export function colStats() {
  const s = { vals: 0, nums: 0, sum: 0, min: Infinity, max: -Infinity, first: undefined, differ: false,
    /** @param {any} v a region cell's value */
    add(v) {
      if (v == null || v === '') return;
      s.vals++;
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      if (s.nums === 0) s.first = v; else if (v !== s.first) s.differ = true;
      s.nums++; s.sum += v;
      if (v < s.min) s.min = v;
      if (v > s.max) s.max = v;
    },
  };
  return s;
}

/**
 * The SUBTOTAL function a total's shown value is, over its column's values (colStats), or null: 9 the sum, 2/3 the
 * count (COUNTA when there is text), 1 the average, 5 the minimum, 4 the maximum, each within the format's precision.
 * @param {{ value: any, format?: string }} c @param {ReturnType<typeof colStats>} st
 */
export function subtotalFn(c, st) {
  const d = decimalsOf(c.format);
  const tol = d == null ? 1e-9 * Math.max(1, Math.abs(c.value)) : 0.5 * 10 ** -d + 1e-9;
  const same = (v) => Math.abs(v - c.value) <= tol;
  if (st.nums && same(st.sum)) return 9;
  if (same(st.vals)) return st.nums === st.vals ? 2 : 3; // COUNT, or COUNTA when there is text
  // average, minimum, maximum: only when the values differ (a column of equal ratios matches all three by chance)
  if (st.nums > 1 && st.differ) {
    if (same(st.sum / st.nums)) return 1;
    if (same(st.min)) return 5;
    if (same(st.max)) return 4;
  }
  return null;
}

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
  const st = colStats();
  for (const k of covered) st.add(rows[k].cells.find(x => x.colIndex === c.colIndex)?.value);
  const fn = subtotalFn(c, st);
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

 /** Excel's sheet names, unique in a workbook: no \\ / ? * [ ] :, no control characters, not starting or ending with ', at
 *  most 31 characters (28 here, room for a " 2"). suffix: kept whole (a split sheet's " (2)"). */
export function sheetNamer() {
  const used = new Set();
  return (n, suffix = '') => {
    let s = String(n || 'Sheet').replace(/[\\/?*[\]:\u0000-\u001f\u007f\uFFFE\uFFFF]|[\uD800-\uDFFF]/g, ' ').replace(/^['\s]+|['\s]+$/g, '').slice(0, 28).trim() || 'Sheet';
    if (suffix) s = `${s.slice(0, 31 - suffix.length)}${suffix}`;
    let k = s, i = 2;
    while (used.has(k.toLowerCase())) k = `${s.slice(0, 28)} ${i++}`;
    used.add(k.toLowerCase());
    return k;
  };
}

/** A region cell → an Excel cell: its value (dates as the report's wall clock), number format, bold and header fill. */
export function xlsxCell({ sym, locale, tz }) {
  const cellValue = (v) => (v === '' ? null : v instanceof Date ? new Date(toWall(v, tz)) : v);
  /** @param {any} c @param {boolean} header */
  return (c, header) => {
    const nf = excelFormat(c.format, sym, locale, c.value);
    const numFmt = nf && (typeof c.value === 'number' || c.value instanceof Date) ? nf : c.value instanceof Date ? 'dd mmm yyyy' : null;
    return /** @type {any} */ ({ v: cellValue(c.value), style: { numFmt, bold: !!(c.bold || header), fill: header } });
  };
}

/**
 * Excel workbook in "data mode": one sheet per table, typed cells, number formats,
 * bold header and group rows, and outline levels for grouped detail rows. Group and table totals that are a sum,
 * count, average, minimum or maximum of their column are live SUBTOTAL formulas (formulas: false keeps values).
 * Charts are native Excel charts; pictures go on a sheet of their own (PNG; needs a rasteriser, see figures.js).
 * Written by xlsxwriter.js (no ExcelJS).
 * @param {any} model  render() output
 * @param {{ currency?: string, title?: string, formulas?: boolean, pictures?: boolean, charts?: boolean, fontStore?: any, fonts?: any,
 *   fetchImage?: (src: string) => Promise<Uint8Array|null>, rasterize?: any, timeZone?: string }} [opt]
 * @returns {Promise<Uint8Array>}
 */
export function exportXlsx(model, opt = {}, legacy = undefined) {
  // 0.7 signature: exportXlsx(model, ExcelJS, opt) (ExcelJS is no longer used)
  if (legacy || (opt && (typeof opt === 'function' || /** @type {any} */ (opt).Workbook))) opt = legacy || {};
  return withDeadline(xlsxOf(model, opt), /** @type {any} */ (opt).timeoutMs);
}
/** @param {any} model @param {any} opt */
async function xlsxOf(model, opt) {
  const { currency, title, formulas = true, pictures = true, charts = true, fetchImage, rasterize, timeZone } = opt;
  const fontStore = opt.fontStore || opt.fonts;
  needsTableData(model, 'Excel');
  // Excel dates have no zone: a date goes in as its wall clock in the zone the report showed it in (a local midnight
  // east of UTC was a day early); xlsxwriter writes a Date's UTC parts
  const tz = timeZone ?? model.timeZone ?? undefined;
  // the page's currency when none is passed: the report's, else the locale's own (en-IN ₹), as C2 shows it (N7)
  const sym = currencySymbol(currency || model.currency || currencyOf(model.locale), model.locale);
  const toCell = xlsxCell({ sym, locale: model.locale, tz });
  const wb = new Book({ title: title || model.name || 'Report' });
  const regions = mergedRegions(model);
  const sheetName = sheetNamer();
  if (!regions.length) {
    const ws = wb.addSheet(sheetName(title || 'Report'));
    model.pages.forEach((p, pi) => {
      for (const l of textRows(p.items)) ws.addRow([{ v: pi + 1 }, { v: l }]);
    });
    ws.widths = [6, 80];
  }
  for (const r of regions) {
    const ws = wb.addSheet(sheetName(r.name));
    ws.widths = r.columns.map(w => Math.max(6, Math.round(w / 5.5)));
    let headerRows = 0;
    const merges = []; // applied after the rows exist (clipped to the last row)
    const rows = r.rows.map(row => ({ ...row, n: 0 }));
    const made = new Map();
    rows.forEach((row, ri) => {
      row.n = ws.rowCount + 1;
      /** @type {any[]} */
      const cells = new Array(r.columns.length).fill(null);
      const header = row.kind === 'header';
      for (const c of row.cells) {
        if (c.colIndex < 0) continue;
        const cell = toCell(c, header);
        if (c.span > 1 || c.rowSpan > 1) merges.push([row.n, c.colIndex + 1, row.n + Math.max(1, c.rowSpan || 1) - 1, c.colIndex + Math.max(1, c.span || 1)]);
        if (formulas && (row.kind === 'groupFooter' || row.kind === 'footer') && !(c.span > 1)) {
          const f = totalFormula(rows, ri, c, made);
          if (f) { cell.f = f; made.set(`${ri}|${c.colIndex}`, f); }
        }
        cells[c.colIndex] = cell;
      }
      if (header) for (let i = 0; i < cells.length; i++) cells[i] ||= { v: null, style: { fill: true } };
      ws.addRow(cells, { outlineLevel: row.kind === 'detail' && row.level > 0 ? Math.min(7, row.level) : 0 });
      if (header) headerRows++;
    });
    const last = ws.rowCount, taken = new Set();
    for (const [r1, c1, r2, c2] of merges) {
      const box = []; let clash = false;
      for (let y = r1; y <= Math.min(r2, last); y++) for (let x = c1; x <= c2; x++) { const k = `${y},${x}`; if (taken.has(k)) clash = true; box.push(k); }
      if (clash) continue; // overlaps a merge already made
      box.forEach(k => taken.add(k));
      ws.merge(r1, c1, Math.min(r2, last), c2);
    }
    ws.frozenRows = headerRows;
    ws.outlineLevelRow = Math.min(7, r.rows.reduce((m, x) => Math.max(m, x.kind === 'detail' ? x.level || 0 : 0), 0));
  }
  // charts Excel can draw: a sheet each, with the chart's data at A1 and an editable chart bound to it (xlsxchart.js)
  const native = [];
  const nativeFigs = new Set();
  if (charts) {
    for (const pg of model.pages) for (const f of figures(pg.items)) {
      const spec = f.tag.k === 'chart' ? f.items.find(it => it.xchart)?.xchart : null;
      if (!spec || native.length >= 100) continue;
      const ws = wb.addSheet(sheetName(spec.title || f.tag.alt || `Chart ${native.length + 1}`));
      const rows = chartTable(spec);
      rows.forEach((r, ri) => ws.addRow(r.map(v => ({ v, style: ri === 0 ? { bold: true } : undefined }))));
      ws.widths = rows[0].map((_, ci) => (ci === 0 && spec.categories ? 18 : 12));
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
      ws ||= wb.addSheet(sheetName('Charts'));
      while (ws.rowCount < row - 1) ws.addRow([]);
      ws.addRow([{ v: altOf(f.tag), style: { bold: true } }]);
      const w = Math.round(pic.w * 4 / 3), h = Math.round(pic.h * 4 / 3); // points → pixels
      ws.addImage(bytes, pic.png ? 'png' : 'jpeg', 0, row, w, h);
      row += 2 + Math.ceil(h / 20); // default rows are 20 px
    }
  }
  wb.fullCalcOnLoad = !!formulas; // Excel works the totals out again on open
  return addCharts(wb.write(), native);
}
