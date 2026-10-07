// @ts-check
/**
 * A small .xlsx writer: what the Excel export needs and nothing more (typed cells, number formats, bold, a header
 * fill, merges, outline levels, a frozen header, column widths, pictures, formulas with cached results). Each row is
 * written to XML as it is added, so a sheet costs its XML text, not an object per cell (ExcelJS kept ~20 KB a row).
 * Replaces ExcelJS (and its deprecated dependency tree) in the engine.
 */
import { zipSync, strToU8 } from 'fflate';
import { esc } from './xlsxchart.js';

/** Excel's column letters for a 1-based column. */
export const colName = (c) => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (list) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : `${R}/${type}`}" Target="${target}"/>`).join('')}</Relationships>`;
const HEADER_FILL = 'FFE8EEF3';

/**
 * @typedef {{ numFmt?: string|null, bold?: boolean, fill?: boolean }} CellStyle
 * @typedef {{ v?: any, f?: string, style?: CellStyle }} Cell
 */

export class Sheet {
  /** @param {Book} book @param {string} name */
  constructor(book, name) {
    this.book = book; this.name = name;
    /** @type {string[]} */ this.xml = []; // <row> elements, written as rows are added
    /** @type {number[]} */ this.widths = [];
    /** @type {string[]} */ this.merges = [];
    /** @type {{ bytes: Uint8Array, ext: string, col: number, row: number, w: number, h: number }[]} */ this.images = [];
    this.rowCount = 0; this.frozenRows = 0; this.outlineLevelRow = 0;
  }
  /**
   * Add a row (1-based number returned). cells: one per column (null = empty).
   * @param {(Cell|null)[]} cells @param {{ outlineLevel?: number }} [opt]
   */
  addRow(cells, opt = {}) {
    const n = ++this.rowCount;
    let s = `<row r="${n}"${opt.outlineLevel ? ` outlineLevel="${opt.outlineLevel}" hidden="0"` : ''}>`;
    cells.forEach((c, i) => { if (c) s += this.book.cell(`${colName(i + 1)}${n}`, c); });
    this.xml.push(s + '</row>');
    return n;
  }
  /** Merge (1-based, inclusive). */
  merge(r1, c1, r2, c2) { if (r2 > r1 || c2 > c1) this.merges.push(`${colName(c1)}${r1}:${colName(c2)}${r2}`); }
  /** A picture with its top-left at (col, row), 0-based, w × h pixels. */
  addImage(bytes, ext, col, row, w, h) { this.images.push({ bytes, ext, col, row, w, h }); }
  /** @param {number} i */
  toXml(i) {
    const cols = this.widths.map((w, c) => (w ? `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>` : '')).join('');
    const view = this.frozenRows ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${this.frozenRows}" topLeftCell="A${this.frozenRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheetPr><outlinePr summaryBelow="1"/></sheetPr>${view}<sheetFormatPr defaultRowHeight="15"${this.outlineLevelRow ? ` outlineLevelRow="${this.outlineLevelRow}"` : ''}/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${this.xml.join('')}</sheetData>${this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${this.images.length ? `<drawing r:id="rId1"/>` : ''}</worksheet>`;
  }
}

export class Book {
  constructor({ title = 'Report', creator = 'ReportWright' } = {}) {
    this.title = title; this.creator = creator; this.fullCalcOnLoad = false;
    /** @type {Sheet[]} */ this.sheets = [];
    /** @type {Map<string, number>} */ this.styles = new Map([['||', 0]]);
    /** @type {Map<string, number>} */ this.numFmts = new Map();
  }
  /** @param {string} name */
  addSheet(name) { const s = new Sheet(this, name); this.sheets.push(s); return s; }
  /** cellXfs index for a style */
  style(/** @type {CellStyle|undefined} */ st) {
    if (!st) return 0;
    let fmt = 0;
    if (st.numFmt) { if (!this.numFmts.has(st.numFmt)) this.numFmts.set(st.numFmt, 164 + this.numFmts.size); fmt = /** @type {number} */ (this.numFmts.get(st.numFmt)); }
    const key = `${fmt}|${st.bold ? 1 : 0}|${st.fill ? 1 : 0}`;
    if (!this.styles.has(key)) this.styles.set(key, this.styles.size);
    return /** @type {number} */ (this.styles.get(key));
  }
  /** One <c> element. @param {string} ref @param {Cell} c */
  cell(ref, c) {
    const s = this.style(c.style), sa = s ? ` s="${s}"` : '';
    let v = c.v;
    if (v instanceof Date) v = Number.isFinite(v.getTime()) ? v.getTime() / 86400000 + 25569 : null; // Excel's serial (1900 system), from the UTC parts
    if (c.f) return `<c r="${ref}"${sa}${typeof v === 'string' ? ' t="str"' : typeof v === 'boolean' ? ' t="b"' : ''}><f>${esc(c.f)}</f>${v == null ? '' : `<v>${typeof v === 'boolean' ? +v : esc(v)}</v>`}</c>`;
    if (v == null) return s ? `<c r="${ref}"${sa}/>` : '';
    if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${sa}><v>${v}</v></c>` : `<c r="${ref}"${sa} t="inlineStr"><is><t>${esc(String(v))}</t></is></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}"${sa} t="b"><v>${+v}</v></c>`;
    return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</t></is></c>`;
  }
  stylesXml() {
    const fmts = [...this.numFmts].map(([f, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(f)}"/>`).join('');
    const xfs = [...this.styles.keys()].map(k => {
      const [fmt, bold, fill] = k.split('|').map(Number);
      return `<xf numFmtId="${fmt || 0}" fontId="${bold ? 1 : 0}" fillId="${fill ? 2 : 0}" borderId="0" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}${bold ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}/>`;
    }).join('');
    return `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fmts ? `<numFmts count="${this.numFmts.size}">${fmts}</numFmts>` : ''}<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${HEADER_FILL}"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.styles.size}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
  /** The .xlsx bytes. */
  write() {
    /** @type {Record<string, Uint8Array>} */
    const files = {};
    const put = (p, s) => { files[p] = typeof s === 'string' ? strToU8(s) : s; };
    const over = [];
    let img = 0;
    this.sheets.forEach((sh, i) => {
      const n = i + 1;
      put(`xl/worksheets/sheet${n}.xml`, sh.toXml(i));
      sh.xml = []; // released as soon as it is in the zip input
      over.push([`/xl/worksheets/sheet${n}.xml`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']);
      if (!sh.images.length) return;
      put(`xl/worksheets/_rels/sheet${n}.xml.rels`, rels([['rId1', 'drawing', `../drawings/drawing${n}.xml`]]));
      const anchors = sh.images.map((im, k) => {
        img++;
        put(`xl/media/image${img}.${im.ext}`, im.bytes);
        return `<xdr:oneCellAnchor><xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${im.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(im.w * 9525)}" cy="${Math.round(im.h * 9525)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="Picture ${k + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${k + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(im.w * 9525)}" cy="${Math.round(im.h * 9525)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
      });
      let first = img - sh.images.length;
      put(`xl/drawings/_rels/drawing${n}.xml.rels`, rels(sh.images.map((im, k) => [`rId${k + 1}`, 'image', `../media/image${++first}.${im.ext}`])));
      put(`xl/drawings/drawing${n}.xml`, `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}">${anchors.join('')}</xdr:wsDr>`);
      over.push([`/xl/drawings/drawing${n}.xml`, 'application/vnd.openxmlformats-officedocument.drawing+xml']);
    });
    put('xl/styles.xml', this.stylesXml());
    put('xl/workbook.xml', `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><bookViews><workbookView/></bookViews><sheets>${this.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="171027"${this.fullCalcOnLoad ? ' fullCalcOnLoad="1"' : ''}/></workbook>`);
    put('xl/_rels/workbook.xml.rels', rels([...this.sheets.map((s, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]), [`rId${this.sheets.length + 1}`, 'styles', 'styles.xml']]));
    put('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(this.title)}</dc:title><dc:creator>${esc(this.creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
    put('_rels/.rels', rels([['rId1', 'officeDocument', 'xl/workbook.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml']]));
    put('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${over.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`);
    return zipSync(files, { level: 6 });
  }
}
