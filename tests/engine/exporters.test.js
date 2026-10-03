import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { render } from '../../src/engine/index.js';
import { exportCsv } from '../../src/exporters/csv.js';
import { exportXlsx, excelFormat } from '../../src/exporters/xlsx.js';
import { exportHtml } from '../../src/exporters/html.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontStore, report } from '../helpers.js';

const data = { rows: [
  { region: 'South', city: 'Bengaluru', amt: 1234.5, on: '2026-01-05' },
  { region: 'North', city: 'Delhi, NCR', amt: 50, on: '2026-02-01' },
  { region: 'South', city: 'Chennai', amt: 200, on: '2026-03-10' },
] };
const def = () => {
  const d = report([{
    type: 'table', name: 'Sales', x: 0, y: 0, w: 300, h: 54, dataSet: 'Rows', columns: [{ width: 120 }, { width: 100 }, { width: 80 }],
    header: [{ height: 18, cells: [{ value: 'City' }, { value: 'On' }, { value: 'Amount' }] }],
    groups: [{ name: 'Region', expr: '=Fields.region', sort: 'asc', header: [{ height: 18, cells: [{ value: '=Fields.region', colSpan: 3 }, null, null] }], footer: [] }],
    detail: [{ height: 18, cells: [{ value: '=Fields.city' }, { value: '=Fields.on', style: { format: 'dd MMM yyyy' } }, { value: '=Fields.amt', style: { format: 'N2' } }] }],
    footer: [{ height: 18, cells: [{ value: 'Total', colSpan: 2 }, null, { value: '=Sum(Fields.amt)', style: { format: 'C2' } }] }],
    bookmark: 'Sales',
  }, { type: 'textbox', name: 'Link', x: 0, y: 80, w: 100, h: 14, value: 'Site', action: { type: 'url', url: 'https://example.com' }, bookmark: 'Footer link' }], { data });
  d.dataSets[0].fields = [{ name: 'region', type: 'string' }, { name: 'city', type: 'string' }, { name: 'amt', type: 'number' }, { name: 'on', type: 'date' }];
  return d;
};

describe('exporters', () => {
  it('writes CSV with raw numbers, ISO dates and quoting', async () => {
    const out = await render(def(), { fontStore });
    const csv = exportCsv(out);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Delhi, NCR",2026-02-01,50');
    expect(csv).toContain('Bengaluru,2026-01-05,1234.5');
    expect(csv).toContain('Total,,1484.5');
  });

  it('writes an Excel sheet with types, formats, merges and outline levels', async () => {
    const out = await render(def(), { fontStore });
    const bytes = await exportXlsx(out, ExcelJS, { currency: 'INR' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.getWorksheet('Sales');
    expect(ws.getRow(1).getCell(1).value).toBe('City');
    expect(ws.getRow(2).getCell(1).value).toBe('North');               // group header, sorted
    const r3 = ws.getRow(3);
    expect(r3.getCell(1).value).toBe('Delhi, NCR');
    expect(r3.getCell(2).value).toBeInstanceOf(Date);
    expect(r3.getCell(3).value).toBe(50);
    expect(r3.getCell(3).numFmt).toBe('#,##0.00');
    expect(r3.outlineLevel).toBe(1);
    const last = ws.getRow(ws.rowCount);
    expect(last.getCell(3).value).toBe(1484.5);
    expect(last.getCell(3).numFmt).toBe('"₹"#,##0.00');
    expect(ws.model.merges.length).toBeGreaterThan(0);
    expect(excelFormat('dd MMM yyyy')).toBe('dd mmm yyyy');
  });

  it('writes self-contained HTML with subset-free fallback fonts and live URL links', async () => {
    const out = await render(def(), { fontStore });
    const html = await exportHtml(out, fontStore, { title: 'T' });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('@font-face');
    expect(html).toContain('<svg');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).not.toContain('data-action');
  });

  it('adds URL annotations and an outline to the PDF', async () => {
    const out = await render(def(), { fontStore });
    expect(out.bookmarks.map(b => b.label)).toEqual(['Footer link']);
    const bytes = await exportPdf(out, fontStore);
    const { PDFDocument, PDFName } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
    const link = doc.context.lookup(annots.get(0));
    expect(String(link.lookup(PDFName.of('A')).lookup(PDFName.of('URI')))).toContain('https://example.com');
    expect(doc.catalog.lookup(PDFName.of('Outlines'))).toBeTruthy();
  });
});
