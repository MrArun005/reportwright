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
