// The PDF writer's size and speed rules: subset fonts flagged as subsets, one Resources dictionary for every
// page, compressed page streams, no repeated graphics state, no clip around text that fits its cell.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { fontStore, report } from '../helpers.js';

const subset = createSubsetter(async () => fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'harfbuzz-subset.wasm')));
const rows = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, name: `Name ${i}`, amt: i * 13.37 }));
const table = (extra = {}) => {
  const d = report([{
    type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 36, dataSet: 'Rows', columns: [{ width: 60 }, { width: 140 }, { width: 100 }],
    header: [{ height: 16, cells: [{ value: 'ID', style: { background: '#e8e8e8', fontWeight: 'bold' } }, { value: 'Name', style: { background: '#e8e8e8', fontWeight: 'bold' } }, { value: 'Amount', style: { background: '#e8e8e8', fontWeight: 'bold' } }] }],
    detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }, { value: '=Fields.amt', style: { format: 'N2', textAlign: 'right' } }] }],
    repeatHeader: true, ...extra,
  }], { data: { rows } });
  d.dataSets[0].fields = [{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }, { name: 'amt', type: 'number' }];
  return d;
};
const contents = (doc, i) => {
  const s = doc.context.lookup(/** @type {PDFRef} */ (doc.getPage(i).node.get(PDFName.of('Contents'))));
  expect(s).toBeInstanceOf(PDFRawStream);
  expect(String(/** @type {any} */ (s).dict.get(PDFName.of('Filter')))).toBe('/FlateDecode');
  return Buffer.from(decodePDFRawStream(/** @type {any} */ (s)).decode()).toString('latin1');
};

describe('compact PDF', () => {
  it('flags subset fonts with a tag, embeds each once, and shares one Resources dictionary', async () => {
    const model = await render(table(), { fontStore });
    expect(model.pages.length).toBeGreaterThan(3);
    const doc = await PDFDocument.load(await exportPdf(model, fontStore, { subset }));
    const res = doc.getPages().map(p => p.node.get(PDFName.of('Resources')));
    expect(res[0]).toBeInstanceOf(PDFRef);
    expect(new Set(res.map(String)).size).toBe(1);
    const fonts = /** @type {PDFDict} */ (doc.context.lookup(res[0], PDFDict).lookup(PDFName.of('Font'), PDFDict));
    const base = fonts.values().map(r => String(/** @type {PDFDict} */ (doc.context.lookup(r)).get(PDFName.of('BaseFont'))));
    expect(base.length).toBe(2); // regular and bold, once each
    for (const b of base) expect(b).toMatch(/^\/[A-Z]{6}\+Inter-/);
  });

  it('writes no clip around text that fits, sets a colour once, and keeps lines in one text object', async () => {
    const model = await render(table(), { fontStore });
    const doc = await PDFDocument.load(await exportPdf(model, fontStore, { subset }));
    const ops = contents(doc, 1);
    expect(ops).not.toMatch(/\bW n\b/);
    expect(ops).not.toMatch(/\bgs\b/); // everything opaque: no graphics state at all
    const text = ops.slice(ops.indexOf('BT'));
    expect(text.match(/ rg\n/g)?.length ?? 0).toBeLessThanOrEqual(3); // header grey, text colour, …: not one per cell
    expect(ops.match(/\bTd\b/g)?.length).toBeGreaterThan(100);
    expect(ops.match(/\bBT\b/g)?.length).toBeLessThan(5);
  });

  it('keeps the clip when text overflows its cell', async () => {
    const d = table();
    Object.assign(d.sections.body.items[0].detail[0].cells[1], { value: '="A very long name that cannot fit in its column at all " & Fields.name', style: { wrap: false } });
    const doc = await PDFDocument.load(await exportPdf(await render(d, { fontStore }), fontStore, { subset }));
    expect(contents(doc, 0)).toMatch(/re W n/);
  });

  it('stays small: a few kilobytes a page', async () => {
    const model = await render(table(), { fontStore });
    const bytes = await exportPdf(model, fontStore, { subset });
    expect(bytes.length / model.pages.length).toBeLessThan(8000);
  });
});
