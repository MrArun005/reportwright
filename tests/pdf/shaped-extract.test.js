// Shaped text comes back once, in logical order, from our extractText, poppler's pdftotext and pdf.js (0.1.0-beta.1:
// beta.0 doubled every multi-glyph cluster: "किकिताताब"). And the reader: ActualText replaces its glyphs; a code with
// no Unicode reads as U+FFFD, one mapped to nothing on purpose as nothing.
//
// pdf.js is not a dependency: its part runs when pdfjs-dist can be imported (installed, or PDFJS_DIR=<dir with
// node_modules/pdfjs-dist>) on Node 22 or later (pdf.js 6 needs Promise.withResolvers), and is skipped otherwise:
//   npm i --prefix /tmp/pdfjs pdfjs-dist@6.4.299 && PDFJS_DIR=/tmp/pdfjs npx vitest run tests/pdf/shaped-extract.test.js
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { toBytes, loadPdf } from '../../packages/pdf/src/index.js';
import { harfbuzzShaper } from '../../packages/pdf/examples/harfbuzz-shaper.mjs';
import { ROOT, HAS, run, save } from './tools.js';
import { onePage, rawPdf } from './reader-tools.js';

const font = (n) => fs.readFileSync(path.join(ROOT, 'public/fonts', n));
const CASES = [
  ['Devanagari', 'NotoSansDevanagari-Regular.ttf', 'किताब हिन्दी क्षत्रिय श्री', 'ltr'],
  ['Kannada', 'NotoSansKannada-Regular.ttf', 'ಕನ್ನಡ ಭಾಷೆ', 'ltr'],
  ['Kannada (the tester\'s)', 'NotoSansKannada-Regular.ttf', 'ಕನ್ನಡ ನಮಸ್ಕಾರ ಬೆಂಗಳೂರು', 'ltr'],
  ['Telugu', 'NotoSansTelugu-Regular.ttf', 'తెలుగు భాష', 'ltr'],
  ['Tamil', 'NotoSansTamil-Regular.ttf', 'தமிழ் மொழி', 'ltr'],
  ['Bengali', 'NotoSansBengali-Regular.ttf', 'বাংলা ভাষা', 'ltr'],
  ['Arabic', 'NotoSansArabic-Regular.ttf', 'مرحبا بالعالم', 'rtl'],
  ['Arabic (lam-alef, tanwin)', 'NotoSansArabic-Regular.ttf', 'السلام عليكم لا إله مرحبًا', 'rtl'],
];
const norm = (s) => s.replace(/[‪-‮‎‏]/g, '').replace(/\s+/g, ' ').trim();
const shaped = (file, text, direction) => toBytes(async (pdf) => {
  const b = font(file);
  pdf.addPage({ width: 600, height: 120 }).text(text, { x: 20, y: 20, size: 24, font: await pdf.embedFont(b, { shaper: harfbuzzShaper(b) }), direction });
}, { creationDate: new Date('2026-01-01') });

let pdfjs = null;
if (typeof Promise.withResolvers === 'function') {
  const dir = process.env.PDFJS_DIR;
  try { pdfjs = await import(dir ? path.join(dir, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs') : 'pdfjs-dist/legacy/build/pdf.mjs'); } catch { /* not installed: skipped */ }
}
async function pdfjsText(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }), d = await task.promise;
  const tc = await (await d.getPage(1)).getTextContent();
  await task.destroy();
  return tc.items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join('');
}

describe('shaped text extracts exactly, once', () => {
  for (const [name, file, text, dir] of CASES) {
    it(`${name}: ours${HAS.poppler ? ', poppler' : ''}`, async () => {
      const out = await shaped(file, text, dir);
      expect(norm((await loadPdf(out)).page(0).extractText())).toBe(text);
      if (HAS.poppler) expect(norm(run('pdftotext', [save(out), '-']))).toBe(text);
    });
    it.skipIf(!pdfjs)(`${name}: pdf.js`, async () => {
      expect(norm(await pdfjsText(await shaped(file, text, dir)))).toBe(text);
    });
  }

  it('a glyph that stands for different text in different places gets a code for each (a CIDToGIDMap), never one text twice', async () => {
    const out = await toBytes(async (pdf) => {
      const b = font('NotoSansDevanagari-Regular.ttf');
      pdf.addPage().text('क कि क्ष', { x: 20, y: 20, size: 20, font: await pdf.embedFont(b, { shaper: harfbuzzShaper(b) }) });
    }, { creationDate: new Date('2026-01-01'), compress: false });
    expect(Buffer.from(out).toString('latin1')).toMatch(/\/CIDToGIDMap \d+ 0 R/);
    expect(norm((await loadPdf(out)).page(0).extractText())).toBe('क कि क्ष');
  });
});

/** a page drawing hex codes with a Type0 font whose ToUnicode maps 0001 → A, 0002 → nothing, and not 0003 */
const type0 = (content) => rawPdf([
  '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /Properties << /P0 << /ActualText (Named) >> >> >> >>',
  [`<< /Length ${content.length} >>`, content],
  '<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
  '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 >>',
  (() => { const s = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <ffff> endcodespacerange 2 beginbfchar <0001> <0041> <0002> <> endbfchar endcmap end end'; return [`<< /Length ${s.length} >>`, s]; })(),
]);

describe('extractText: ActualText, and codes with no Unicode', () => {
  it('a span with /ActualText reads as its text in place of its glyphs (inline or a /Properties name), never both', async () => {
    const t = (c) => loadPdf(onePage(c)).then((d) => d.page(0).extractText());
    expect(await t('BT /F1 12 Tf 10 10 Td (a) Tj /Span << /ActualText (Hi) >> BDC (xy) Tj EMC (z) Tj ET')).toBe('aHiz');
    expect(await t('BT /F1 12 Tf 10 10 Td /Span << /ActualText <feff0915093f> >> BDC (xy) Tj /Span << /ActualText (no) >> BDC (q) Tj EMC BMC (r) Tj EMC EMC ET')).toBe('कि'); // the outer one wins
    expect(await t('BT /F1 12 Tf 10 10 Td /Span << /ActualText <feff> >> BDC (xy) Tj EMC (z) Tj ET')).toBe('z'); // nothing, on purpose
    expect(await t('BT /F1 12 Tf 10 10 Td /Span << /MCID 0 >> BDC (xy) Tj EMC EMC EMC (z) Tj ET')).toBe('xyz'); // no ActualText; unbalanced EMCs ignored
    expect(await t('BT /F1 12 Tf 10 10 Td /Span << /ActualText (Hi) >> BDC ET')).toBe(''); // no glyphs, nothing
    expect((await loadPdf(type0('BT /F1 12 Tf 10 10 Td /Span /P0 BDC <0001> Tj EMC ET'))).page(0).extractText()).toBe('Named');
  });
});
