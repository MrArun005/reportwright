import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, texts, report } from '../helpers.js';

const footer = { height: 20, items: [{ type: 'textbox', name: 'pn', x: 0, y: 4, w: 300, h: 12, value: 'Page {Globals.PageNumber} of {Globals.TotalPages} · {Globals.OverallPageNumber}/{Globals.OverallTotalPages}' }] };
const pageLines = (out) => out.pages.map(p => texts(p).find(t => t.startsWith('Page ')));

describe('page numbers per section (newSection)', () => {
  // invoices with 60, 10 and 100 lines: 2, 1 and 3 pages
  const lines = [...Array.from({ length: 60 }, (_, i) => ({ inv: 'A', n: i })), ...Array.from({ length: 10 }, (_, i) => ({ inv: 'B', n: i })), ...Array.from({ length: 100 }, (_, i) => ({ inv: 'C', n: i }))];
  const tbl = (g) => ({ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }],
    groups: [{ name: 'Inv', expr: '=Fields.inv', header: [{ height: 16, cells: [{ value: '="Invoice " & Fields.inv' }] }], ...g }],
    detail: [{ height: 14, cells: [{ value: '=Fields.n' }] }] });
  it('a table group restarts PageNumber and TotalPages; Overall* count the report', async () => {
    const out = await render(report([tbl({ newSection: true })], { data: { rows: lines }, footer }), { fontStore });
    expect(pageLines(out)).toEqual(['Page 1 of 2 · 1/6', 'Page 2 of 2 · 2/6', 'Page 1 of 1 · 3/6', 'Page 1 of 3 · 4/6', 'Page 2 of 3 · 5/6', 'Page 3 of 3 · 6/6']);
    expect(texts(out.pages[2])[0]).toBe('Invoice B');
  });
  it('a list with newSection: each record its own numbering', async () => {
    const invs = { rows: [{ id: 'X', n: 3 }, { id: 'Y', n: 70 }] };
    const sets = [{ name: 'Rows', source: 'src', path: '$.rows' }];
    const inner = { type: 'table', name: 'Lines', x: 0, y: 20, w: 200, h: 16, dataSet: 'Nums', columns: [{ width: 200 }], detail: [{ height: 14, cells: [{ value: '=Fields.k' }] }], filters: [{ expr: '=Fields.k', op: '<', value: '=Parent.n' }] };
    const list = { type: 'list', name: 'L', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', newSection: true, keepTogether: false, items: [{ type: 'textbox', name: 'h', x: 0, y: 0, w: 200, h: 14, value: '="Invoice " & Fields.id' }, inner] };
    const def = report([list], { data: { ...invs, nums: Array.from({ length: 70 }, (_, k) => ({ k })) }, footer, def: { dataSets: [...sets, { name: 'Nums', source: 'src', path: '$.nums' }] } });
    const out = await render(def, { fontStore });
    expect(pageLines(out)).toEqual(['Page 1 of 1 · 1/3', 'Page 1 of 2 · 2/3', 'Page 2 of 2 · 3/3']);
  });
});

describe('multi-section reports', () => {
  const cover = { type: 'textbox', name: 'c', x: 0, y: 0, w: 300, h: 20, value: 'Cover' };
  const wideRows = Array.from({ length: 40 }, (_, i) => ({ n: i }));
  const tbl = { type: 'table', name: 'T', x: 0, y: 0, w: 700, h: 40, dataSet: 'Rows', columns: [{ width: 700 }], detail: [{ height: 14, cells: [{ value: '=Fields.n' }] }] };
  const def = () => {
    const d = report([], { data: { rows: wideRows }, footer });
    d.sections.body = [{ name: 'Cover', items: [cover] }, { name: 'Data', page: { orientation: 'landscape' }, items: [tbl] }];
    return d;
  };
  it('each body section has its own page size; numbering continues', async () => {
    const out = await render(def(), { fontStore });
    expect(out.pages.length).toBe(3);
    expect([out.width, out.height]).toEqual([595.28, 841.89]);
    expect(out.pages[0].width).toBeUndefined();
    expect([out.pages[1].width, out.pages[1].height]).toEqual([841.89, 595.28]);
    expect(pageLines(out)).toEqual(['Page 1 of 3 · 1/3', 'Page 2 of 3 · 2/3', 'Page 3 of 3 · 3/3']);
    expect(texts(out.pages[0])[0]).toBe('Cover');
    expect(texts(out.pages[1])[0]).toBe('0');
    // the landscape page's footer sits at its own bottom
    const pn = out.pages[1].items.find(i => i.t === 'text' && i.lines[0].text.startsWith('Page'));
    expect(pn.clip.y).toBeCloseTo(595.28 - 36 - 20 + 4, 2);
  });
  it('validate: an array body is fine, an empty one is not', () => {
    expect(validate(def()).errors).toEqual([]);
    const d = def(); d.sections.body = [];
    expect(validate(d).errors).toContain('The report has no body section');
    d.sections.body = [{ items: [], page: 'A4' }];
    expect(validate(d).errors.join()).toMatch(/"page" must be an object/);
  });
});

import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportDocx } from '../../src/exporters/docx.js';
import { exportXlsx } from '../../src/exporters/xlsx.js';
import { exportHtml } from '../../src/exporters/html.js';

describe('exporters: page sizes per section, merged cells', () => {
  const twoSizes = async () => {
    const d = report([], { data: { rows: [{ n: 1 }] } });
    d.sections.body = [{ items: [{ type: 'textbox', name: 'a', x: 0, y: 0, w: 200, h: 14, value: 'Portrait' }] },
      { page: { orientation: 'landscape' }, items: [{ type: 'textbox', name: 'b', x: 0, y: 0, w: 200, h: 14, value: 'Landscape' }] }];
    return render(d, { fontStore });
  };
  it('PDF: each page has its section\'s size', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await exportPdf(await twoSizes(), fontStore));
    expect(doc.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([[595, 842], [842, 595]]);
  });
  it('Word: a section break carries the portrait size, the last section is landscape', async () => {
    const doc = strFromU8(unzipSync(await exportDocx(await twoSizes()))['word/document.xml']);
    expect(doc).toMatch(/<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"\/>/);
    expect(doc).toMatch(/<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"\/>[^]*<\/w:body>/);
  });
  it('HTML: the landscape page is drawn at its own size', async () => {
    const html = await exportHtml(await twoSizes(), fontStore);
    expect(html).toMatch(/viewBox="0 0 841.89 595.28"/);
    expect(html).toMatch(/viewBox="0 0 595.28 841.89"/);
  });
  const spanned = async () => {
    const t = { type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
      header: [{ height: 18, cells: [{ value: 'Name', rowSpan: 2 }, { value: 'Amounts', colSpan: 2 }, null] }, { height: 18, cells: [null, { value: 'Paid' }, { value: 'Due' }] }],
      detail: [{ height: 16, cells: [{ value: '=Fields.n' }, { value: '=Fields.n * 2' }, { value: '=Fields.n * 3' }] }] };
    return render(report([t], { data: { rows: [{ n: 1 }, { n: 2 }] } }), { fontStore });
  };
  it('Word: a cell merged down becomes vMerge restart + continue', async () => {
    const doc = strFromU8(unzipSync(await exportDocx(await spanned()))['word/document.xml']);
    expect(doc).toContain('<w:vMerge w:val="restart"/>');
    expect((doc.match(/<w:vMerge\/>/g) || []).length).toBe(1);
  });
  it('Excel: header cells merged across and down', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportXlsx(await spanned(), ExcelJS));
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('Name');
    expect(ws.getCell('A2').isMerged).toBe(true);
    expect(ws.getCell('C1').isMerged).toBe(true);
    expect(ws.getCell('A3').value).toBe(1);
    expect(ws.rowCount).toBe(4);
  });
});

describe('review fixes: sections and pivot shrink', () => {
  it('the first body section can have its own page', async () => {
    const d = report([], { data: { rows: [] } });
    d.sections.body = [{ page: { orientation: 'landscape' }, items: [{ type: 'textbox', name: 'a', x: 0, y: 0, w: 200, h: 14, value: 'A' }] }, { items: [{ type: 'textbox', name: 'b', x: 0, y: 0, w: 200, h: 14, value: 'B' }] }];
    const out = await render(d, { fontStore });
    expect([out.width, out.height]).toEqual([841.89, 595.28]);
    expect([out.pages[1].width, out.pages[1].height]).toEqual([595.28, 841.89]);
  });
  it('a pivot that shrinks to fit with several values stays on the page', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ r: 'x', c: `C${String(i).padStart(2, '0')}`, v: i }));
    const m = { type: 'matrix', name: 'P', x: 0, y: 0, w: 500, h: 40, dataSet: 'Rows', overflow: 'shrink', rowGroups: [{ expr: '=Fields.r', width: 60 }], columnGroups: [{ expr: '=Fields.c', sort: 'asc', total: 'after' }],
      values: [{ value: '=Sum(Fields.v)' }, { value: '=Count(Fields)' }, { value: '=Max(Fields.v)' }] };
    const out = await render(report([m], { data: { rows } }), { fontStore });
    const right = Math.max(...out.pages[0].items.filter(i => i.t === 'text').map(i => i.clip.x + i.clip.w));
    expect(right).toBeLessThanOrEqual(595.28 - 36 + 0.5);
  });
});
