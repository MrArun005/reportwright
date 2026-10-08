// N10 (0.13.0 retest): the CJK fonts @reportwright/fonts-cjk downloads are variable TrueType fonts whose default is
// Thin. The subset is cut at Regular and renamed (subset.js), but the PDF's BaseFont was built from the full font's
// PostScript name, so pdffonts said NotoSansJP-Thin. Both writers now name the face by the subset they embed.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { render, FontStore } from '../../src/engine/index.js';
import { fontFile } from '../../src/engine/text/fonts.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportPdfStream } from '../../src/exporters/pdfstream.js';
import { createSubsetter, sfntTables, buildSfnt, setNameStrings } from '../../src/exporters/subset.js';
import { fontPath } from '../../packages/fonts-cjk/src/index.mjs';
import { report } from '../helpers.js';

const root = path.join(import.meta.dirname, '..', '..');
const subset = createSubsetter(async () => fs.readFileSync(path.join(root, 'public', 'harfbuzz-subset.wasm')));
const publicFont = (k) => fs.readFileSync(path.join(root, 'public', 'fonts', fontFile(k)));
// Inter made variable (fvar wght 100..900, default 100) and named Thin, as the Noto CJK downloads are
const variableThin = () => {
  const bytes = new Uint8Array(publicFont('Inter-Regular'));
  const t = sfntTables(bytes);
  const fvar = new Uint8Array(36), dv = new DataView(fvar.buffer);
  dv.setUint16(0, 1); dv.setUint16(2, 0); dv.setUint16(4, 16); dv.setUint16(6, 2); dv.setUint16(8, 1); dv.setUint16(10, 20);
  fvar.set([...'wght'].map(c => c.charCodeAt(0)), 16);
  dv.setInt32(20, 100 * 65536); dv.setInt32(24, 100 * 65536); dv.setInt32(28, 900 * 65536); dv.setUint16(32, 0); dv.setUint16(34, 256);
  t.set('fvar', fvar);
  t.set('name', setNameStrings(t.get('name'), new Map([[1, 'Inter Thin'], [2, 'Thin'], [4, 'Inter Thin'], [6, 'Inter-Thin'], [17, 'Thin']])));
  return buildSfnt(bytes, t);
};
/** the BaseFont of every Type0 font in a PDF (object streams too) */
const baseFonts = async (bytes) => {
  const { PDFDocument, PDFDict, PDFName } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = [];
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    if (o instanceof PDFDict && String(o.get(PDFName.of('Subtype'))) === '/Type0') out.push(String(o.get(PDFName.of('BaseFont'))).slice(1));
  }
  return out;
};
const table = (value, rows = 30) => report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 300, h: 40, columns: [{ width: 300 }],
  detail: [{ height: 14, cells: [{ value }] }] }], { data: { rows: Array.from({ length: rows }, (_, i) => ({ s: `${i}` })) } });
const sink = () => { const chunks = []; return { chunks, write: (b) => { chunks.push(Buffer.from(b)); } }; };
const both = async (def, fontStore) => {
  const classic = await exportPdf(await render(def, { fontStore }), fontStore, { subset });
  const s = sink();
  const r = await exportPdfStream(def, { fontStore, subset }, s);
  expect(r.streamed).toBe(true);
  return { classic, streamed: Buffer.concat(s.chunks) };
};

describe('N10: a variable font is named in the PDF by the weight it is drawn at', () => {
  const store = new FontStore(async (k) => (k === 'Inter-Regular' ? variableThin() : publicFont(k)));
  it('exportPdf and exportPdfStream say Inter-Regular, not the default instance Inter-Thin', async () => {
    const { classic, streamed } = await both(table('="Hello " & Fields.s'), store);
    for (const pdf of [classic, streamed]) {
      const names = await baseFonts(pdf);
      expect(names.some(n => /^[A-Z]{6}\+Inter-Regular$/.test(n))).toBe(true);
      expect(names.some(n => /Thin/.test(n))).toBe(false);
    }
  });
});

// the real fonts, when downloaded (npx reportwright-fonts-cjk, or REPORTWRIGHT_FONTS_DIR): skipped otherwise
const jp = fontPath('NotoSansJP.ttf'), kr = fontPath('NotoSansKR.ttf');
const hasPoppler = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
describe.skipIf(!jp || !kr)('N10: the downloaded Noto Sans JP and KR', () => {
  const store = new FontStore(async (k) => (k === 'NotoSansJP' ? fs.readFileSync(/** @type {string} */ (jp)) : k === 'NotoSansKR' ? fs.readFileSync(/** @type {string} */ (kr)) : publicFont(k)));
  it('are named -Regular in both PDFs, and the text still extracts', async () => {
    const { classic, streamed } = await both(table('="日本語 한국어 " & Fields.s'), store);
    for (const pdf of [classic, streamed]) {
      const names = await baseFonts(pdf);
      expect(names.filter(n => /NotoSans(JP|KR)/.test(n)).map(n => n.slice(7)).sort()).toEqual(['NotoSansJP-Regular', 'NotoSansKR-Regular']);
      if (hasPoppler) expect(execFileSync('pdftotext', ['-', '-'], { input: pdf }).toString()).toContain('日本語 한국어 0');
    }
  });
});
