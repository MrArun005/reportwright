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

describe('B2: PNG and JPEG images through @reportwright/pdf', async () => {
  const { CORPUS } = await import('../../scripts/parity-corpus.mjs');
  const def = (/** @type {string} */ id) => CORPUS.find((/** @type {any} */ c) => c.id === id).def;
  const CUT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAf';
  const img = (/** @type {string} */ name, /** @type {string} */ src, /** @type {number} */ y) => ({ type: 'image', name, x: 0, y, w: 60, h: 40, src, alt: name });
  afterEach(() => { delete process.env.PW_FORCE_PDFLIB; });
  it('the logo invoice (PNG 8 and 16 bit, alpha, JPEG, EXIF JPEG) leaves pdf-lib; pdfWriter legacy keeps it there', async () => {
    const m = await render(def('images-invoice'), { fontStore });
    expect(viaLibrary(await exportPdf(m, fontStore, {}))).toBe(true);
    expect(viaLibrary(await exportPdf(m, fontStore, { pdfWriter: 'legacy' }))).toBe(false);
  });
  it('an image it cannot embed is left out with the warning pdf-lib gave', async () => {
    // a cut PNG, and one whose header says 20000 × 20000 pixels (over IMAGE_LIMITS.pixels): both data URIs of a PNG, so
    // the new path takes them (a GIF or a URL picture stays on pdf-lib)
    const ihdr = Buffer.from('89504e470d0a1a0a0000000d4948445200004e2000004e200806000000', 'hex');
    const HUGE = `data:image/png;base64,${Buffer.concat([ihdr, Buffer.alloc(4), Buffer.from('0000000049454e44ae426082', 'hex')]).toString('base64')}`;
    const m = await render(report([img('Cut', CUT, 0), img('Huge', HUGE, 50), img('Cut again', CUT, 100)]), { fontStore });
    const run = async () => { const w = /** @type {string[]} */ ([]); const b = await exportPdf(m, fontStore, { onWarning: (x) => w.push(x) }); return { b, w }; };
    const neu = await run();
    process.env.PW_FORCE_PDFLIB = '1';
    const old = await run();
    expect(viaLibrary(neu.b)).toBe(true);
    expect(neu.w).toEqual(old.w);
    expect(neu.w).toHaveLength(3);
  });
});
