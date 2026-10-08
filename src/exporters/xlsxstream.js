// @ts-check
/**
 * The Excel export of a streaming plan (engine/stream.js; docs/research/STREAMING-1M.md §5), written as its rows come:
 * the sheet's XML row by row into a streaming zip (fflate Zip + ZipDeflate), the styles, workbook and other parts last,
 * once every style and sheet is known. The same cells as exportXlsx (xlsxCell, the same Book and its styles), the same
 * SUBTOTAL formulas, decided from running column totals (colStats, subtotalFn) instead of the rows: memory does not
 * grow with the rows. Past maxRows (Excel's 1,048,576) the table continues on a new sheet "Name (2)", its header rows
 * again; a total whose rows span two sheets is written as its value.
 */
import { Zip, ZipDeflate, strToU8 } from 'fflate';
import { Book, colName, sheetHead, sheetTail } from './xlsxwriter.js';
import { xlsxCell, sheetNamer, currencySymbol, colStats, subtotalFn } from './xlsx.js';
import { currencyOf } from '../engine/expr/format.js';

export const EXCEL_ROWS = 1048576, EXCEL_COLS = 16384;
const SHEET_PART_MAX = 3.5 * 1024 ** 3; // the streaming zip writes no Zip64: a sheet part stays well under 4 GiB
const CHUNK = 64 * 1024;

/** The rows a total covers, kept as they pass: runs of sheet rows (consecutive detail rows) and each column's stats. */
function tracker(ncols) {
  return { runs: /** @type {number[][]} */ ([]), many: false, first: 0, last: 0, any: false, crossed: false,
    cols: Array.from({ length: ncols }, () => ({ st: colStats(), pending: false, blocked: false })) };
}

/**
 * @param {{ name: string, title: string, columns: number[], timeZone: string|null, locale: string|null, currency: string|null, rows: () => AsyncGenerator<any> }} plan
 * @param {(bytes: Uint8Array) => any} put the zip's bytes as they come (awaited: back-pressure)
 * @param {{ currency?: string, title?: string, formulas?: boolean, maxRows?: number, timeZone?: string }} [opt]
 */
export async function writeXlsxStream(plan, put, opt = {}) {
  const { formulas = true, maxRows = EXCEL_ROWS } = opt;
  const ncols = plan.columns.length;
  if (ncols > EXCEL_COLS) throw Object.assign(new Error(`The table has ${ncols} columns; Excel takes at most ${EXCEL_COLS}.`), { status: 413 });
  const tz = opt.timeZone ?? plan.timeZone ?? undefined;
  const sym = currencySymbol(opt.currency || plan.currency || currencyOf(plan.locale), plan.locale);
  const toCell = xlsxCell({ sym, locale: plan.locale, tz });
  const wb = new Book({ title: opt.title || plan.title || 'Report' });
  wb.fullCalcOnLoad = !!formulas;
  const sheetName = sheetNamer();
  const widths = plan.columns.map(w => Math.max(6, Math.round(w / 5.5)));

  // the zip: fflate hands its output to ondata as each part is pushed; it goes out after every push
  let out = [], zerr = null;
  const zip = new Zip((err, chunk) => { if (err) zerr = err; else out.push(chunk); });
  const drain = async () => { if (zerr) throw zerr; const o = out; out = []; for (const c of o) await put(c); };
  const over = [];

  // the sheet being written
  let entry = null, n = 0, rowCount = 0, xml = '', partBytes = 0, merges = [];
  const flush = async (final = false) => {
    const u8 = strToU8(xml);
    xml = '';
    partBytes += u8.length;
    entry.push(u8, final);
    await drain();
  };
  const startSheet = async (name, frozenRows, outlineLevelRow) => {
    n++;
    wb.addSheet(name);
    entry = new ZipDeflate(`xl/worksheets/sheet${n}.xml`, { level: 6 });
    zip.add(entry);
    over.push([`/xl/worksheets/sheet${n}.xml`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']);
    rowCount = 0; partBytes = 0; merges = [];
    xml = sheetHead({ widths, frozenRows, outlineLevelRow });
  };
  const endSheet = async () => { xml += sheetTail(merges); await flush(true); entry = null; };
  /** One sheet row (Sheet.addRow's XML). */
  const addRow = async (cells, outlineLevel) => {
    const r = ++rowCount;
    let s = `<row r="${r}"${outlineLevel ? ` outlineLevel="${outlineLevel}" hidden="0"` : ''}>`;
    for (let i = 0; i < cells.length; i++) if (cells[i]) s += wb.cell(`${colName(i + 1)}${r}`, cells[i]);
    xml += s + '</row>';
    if (xml.length >= CHUNK) await flush();
    return r;
  };

  // SUBTOTAL: a tracker per group level (its footer covers the detail rows since a header or a group band of its level
  // or above) and one for the table footer (the detail rows since the header), as totalFormula walks back
  let levels = [], foot = tracker(ncols);
  const trackerFor = (row) => (row.kind === 'footer' ? foot : levels[row.level] || tracker(ncols));
  const all = () => [...levels.filter(Boolean), foot];
  const formula = (row, c) => {
    if (typeof c.value !== 'number' || !Number.isFinite(c.value)) return null;
    const t = trackerFor(row);
    if (!t.any || t.crossed) return null;
    const col = t.cols[c.colIndex];
    if (!col) return null;
    const fn = subtotalFn(c, col.st);
    if (!fn) return null;
    const L = colName(c.colIndex + 1);
    let refs;
    if (!t.many) refs = t.runs.map(([a, b]) => (a === b ? `${L}${a}` : `${L}${a}:${L}${b}`));
    else { if (col.blocked) return null; refs = [`${L}${t.first}:${L}${t.last}`]; } // more than 30 runs: one range, when nothing else in it counts
    return `SUBTOTAL(${fn},${refs.join(',')})`;
  };
  const onDetail = (row, r) => {
    for (let l = 0; l < row.level; l++) levels[l] ||= tracker(ncols); // a level's rows start with its first detail row
    for (const t of all()) {
      if (!t.any) { t.any = true; t.first = r; }
      t.last = r;
      if (!t.many) { const lr = t.runs[t.runs.length - 1]; if (lr && lr[1] === r - 1) lr[1] = r; else if (t.runs.length < 30) t.runs.push([r, r]); else t.many = true; }
      for (const col of t.cols) if (col.pending) { col.blocked = true; col.pending = false; }
    }
    for (const c of row.cells) if (c.colIndex >= 0) for (const t of all()) t.cols[c.colIndex]?.st.add(c.value);
  };
  /** A band row: a value in it (not a total formula) between covered rows keeps a >30-run total from one range. */
  const onBand = (row, made) => {
    for (const t of all()) if (t.any) for (const c of row.cells) { const v = c.value; if (c.colIndex >= 0 && v != null && v !== '' && !made.has(c.colIndex) && t.cols[c.colIndex]) t.cols[c.colIndex].pending = true; }
    // what this row ends: a header ends every total's rows; a group band ends its level's and the levels inside it
    if (row.kind === 'header') { levels = []; foot = tracker(ncols); }
    else if (row.kind === 'groupHeader' || row.kind === 'groupFooter') for (let l = row.level; l < levels.length; l++) levels[l] = undefined;
  };

  /** Write one region row to the sheet. */
  const write = async (row) => {
    const header = row.kind === 'header';
    const cells = new Array(ncols).fill(null);
    const made = new Set();
    const r = rowCount + 1;
    for (const c of row.cells) {
      if (c.colIndex < 0) continue;
      const cell = toCell(c, header);
      if (c.span > 1) merges.push(`${colName(c.colIndex + 1)}${r}:${colName(c.colIndex + Math.max(1, c.span))}${r}`);
      if (formulas && (row.kind === 'groupFooter' || row.kind === 'footer') && !(c.span > 1)) {
        const f = formula(row, c);
        if (f) { cell.f = f; made.add(c.colIndex); }
      }
      cells[c.colIndex] = cell;
    }
    if (header) for (let i = 0; i < cells.length; i++) cells[i] ||= { v: null, style: { fill: true } };
    await addRow(cells, row.kind === 'detail' && row.level > 0 ? Math.min(7, row.level) : 0);
    if (row.kind === 'detail') onDetail(row, r); else onBand(row, made);
  };

  // the rows: the header rows (and any band before the first detail) are held until the first detail row, so the sheet's
  // head (frozen rows, outline depth) is known before <sheetData>
  const heads = [], held = [];
  let base = '', frozen = 0, outline = 0, started = false, part = 1;
  const begin = async (detailLevel) => {
    started = true;
    frozen = heads.length;
    outline = detailLevel == null ? 0 : Math.min(7, detailLevel);
    base = sheetName(plan.name);
    await startSheet(base, frozen, outline);
    for (const row of held) await write(row);
  };
  for await (const row of plan.rows()) {
    if (!started) {
      if (row.kind === 'header') heads.push(row);
      held.push(row);
      if (row.kind === 'detail') { held.pop(); await begin(row.level || 0); await write(row); }
      continue;
    }
    // a full sheet (or a part near the zip's 4 GiB): the table goes on in "Name (2)", its header rows first; totals
    // whose rows began on the sheet before are written as values
    if (rowCount >= maxRows || partBytes > SHEET_PART_MAX) {
      await endSheet();
      part++;
      await startSheet(sheetName(plan.name, ` (${part})`), frozen, outline);
      for (const t of all()) if (t.any) t.crossed = true;
      for (const h of heads) {
        // a repeated header must not end the totals' rows, as a first one would
        const keep = [levels, foot];
        await write(h);
        [levels, foot] = keep;
      }
    }
    await write(row);
  }
  if (!started) await begin(null);
  await endSheet();
  for (const [p, x] of wb.bookParts(over)) {
    const f = new ZipDeflate(p, { level: 6 });
    zip.add(f);
    f.push(strToU8(x), true);
    await drain();
  }
  zip.end();
  await drain();
}
