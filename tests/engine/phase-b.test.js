// Phase B (every PDF through @reportwright/pdf): the parity gate's baseline switch, and each item type the paged
// writer takes over from pdf-lib.
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportPdfStream } from '../../src/exporters/pdfstream.js';
import { fontStore, report } from '../helpers.js';

/** @reportwright/pdf's header carries the binary comment %âãÏÓ; pdf-lib's does not */
const viaLibrary = (/** @type {Uint8Array} */ b) => Buffer.from(b.subarray(0, 16)).toString('latin1').includes('âãÏÓ');
const text = report([{ type: 'textbox', x: 0, y: 0, w: 100, h: 20, value: 'Hello' }]);
const rows = Array.from({ length: 40 }, (_, i) => ({ n: i, g: i % 3 }));
const table = () => report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 300, h: 40, columns: [{ width: 150 }, { width: 150 }],
  groups: [{ name: 'G', expr: '=Fields.g', newSection: true, header: [{ cells: [{ value: '=Fields.g' }, { value: '' }] }] }],
  header: [{ height: 16, cells: [{ value: 'N' }, { value: 'G' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.n' }, { value: '=Fields.g' }] }] }], { data: { rows } });
const sink = () => { const parts = /** @type {Buffer[]} */ ([]); return { parts, write: async (/** @type {Uint8Array} */ u8) => { parts.push(Buffer.from(u8)); } }; };

describe('PW_FORCE_PDFLIB (the parity gate baseline)', () => {
  afterEach(() => { delete process.env.PW_FORCE_PDFLIB; });
  it('sends a plain report through pdf-lib instead of @reportwright/pdf', async () => {
    const m = await render(text, { fontStore });
    expect(viaLibrary(await exportPdf(m, fontStore, {}))).toBe(true);
    process.env.PW_FORCE_PDFLIB = '1';
    expect(viaLibrary(await exportPdf(m, fontStore, {}))).toBe(false);
  });
  it('makes exportPdfStream render whole, and says why', async () => {
    process.env.PW_FORCE_PDFLIB = '1';
    const r = await exportPdfStream(text, { fontStore }, sink());
    expect(r.streamed).toBe(false);
    expect(r.why).toBe('PW_FORCE_PDFLIB');
  });
});

describe('exportPdfStream rendered whole', () => {
  it('an accessible PDF that cannot stream renders its table data (it threw "needs the report\'s table data")', async () => {
    const s = sink();
    const r = await exportPdfStream(table(), { fontStore, tagged: { lang: 'en' }, title: 'T' }, s);
    expect(r.streamed).toBe(false);
    expect(Buffer.concat(s.parts).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('B1: page sizes that differ, page numbering that restarts', async () => {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const { CORPUS } = await import('../../scripts/parity-corpus.mjs');
  const def = (/** @type {string} */ id) => CORPUS.find((/** @type {any} */ c) => c.id === id).def;
  /** the page labels' starts, page sizes and the outline's targets (page index, top) */
  const read = async (/** @type {Uint8Array} */ b) => {
    const doc = await PDFDocument.load(b);
    const refs = doc.getPages().map(p => p.ref.toString());
    const nums = /** @type {any} */ (doc.catalog.lookup(PDFName.of('PageLabels'))).lookup(PDFName.of('Nums')).asArray();
    const outline = [];
    const root = /** @type {any} */ (doc.catalog.lookup(PDFName.of('Outlines')));
    for (let o = root?.lookup(PDFName.of('First')); o; o = o.lookup(PDFName.of('Next'))) { const d = o.lookup(PDFName.of('Dest')).asArray(); outline.push([refs.indexOf(d[0].toString()), d[3].asNumber()]); }
    return { starts: nums.filter((/** @type {any} */ _, /** @type {number} */ i) => i % 2 === 0).map((/** @type {any} */ n) => n.asNumber()), sizes: doc.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())]), outline };
  };
  afterEach(() => { delete process.env.PW_FORCE_PDFLIB; });
  for (const id of ['page-sizes', 'restart-numbers']) {
    it(`${id}: through @reportwright/pdf, with pdf-lib's labels, sizes and outline`, async () => {
      const m = await render(def(id), { fontStore });
      const neu = await exportPdf(m, fontStore, {});
      process.env.PW_FORCE_PDFLIB = '1';
      const old = await exportPdf(m, fontStore, {});
      expect(viaLibrary(neu)).toBe(true);
      expect(await read(neu)).toEqual(await read(old));
    });
  }
});
