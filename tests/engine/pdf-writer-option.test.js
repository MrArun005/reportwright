// 0.14: PDFs go through @reportwright/pdf; pdfWriter: 'legacy' keeps the engine's old writer for one release.
// scripts/writer-parity.mjs is the full gate (pixels, text, validity, features, determinism) over the corpus.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportPdfStream, dictEntries } from '../../src/exporters/pdfstream.js';
import { fontStore, report } from '../helpers.js';

const def = report([{ type: 'textbox', x: 0, y: 0, w: 300, h: 20, value: 'Hello (world) \\ again', bookmark: 'Hi' }]);
const now = new Date('2026-01-01T00:00:00Z');
const bytes = async (o) => { const parts = []; await exportPdfStream(def, { fontStore, now, creationDate: now, ...o }, { write: async (u) => { parts.push(Buffer.from(u)); } }); return Buffer.concat(parts); };

describe('pdfWriter', () => {
  it('the default and legacy writers both write the file; the default one is the same bytes on every run', async () => {
    const a = await bytes({}), b = await bytes({}), old = await bytes({ pdfWriter: 'legacy' });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(old)).toBe(false);
    for (const f of [a, old]) expect(f.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('exportPdf takes it too, and an unknown writer is a 400', async () => {
    const m = await render(def, { fontStore, now });
    expect(Buffer.from(await exportPdf(m, fontStore, { creationDate: now, pdfWriter: 'legacy' })).subarray(0, 5).toString()).toBe('%PDF-');
    await expect(exportPdf(m, fontStore, { pdfWriter: 'pdf-lib' })).rejects.toMatchObject({ status: 400 });
  });
  it('dictEntries splits a dictionary body into entries, nested values whole', () => {
    expect(dictEntries(' /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> /Lang (e\\)n /x) /OutputIntents [7 0 R] /PageMode /UseOutlines /S <feff00>'))
      .toEqual([['StructTreeRoot', '5 0 R'], ['MarkInfo', '<< /Marked true >>'], ['Lang', '(e\\)n /x)'], ['OutputIntents', '[7 0 R]'], ['PageMode', '/UseOutlines'], ['S', '<feff00>']]);
  });
});
