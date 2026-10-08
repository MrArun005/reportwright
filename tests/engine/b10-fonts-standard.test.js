// A1.2: the 14 standard PDF fonts. Named in the PDF, not embedded (Type1, WinAnsiEncoding, the AFM widths); layout
// measures with the same widths; characters WinAnsi lacks fall back to Inter with a warning; PDF/A and PDF/UA embed a
// stand-in instead; HTML, SVG and Office output name the font with a fallback list.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { render, TextMeasurer } from '../../src/engine/index.js';
import { resolveFontKey } from '../../src/engine/text/fonts.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportPdfStream } from '../../src/exporters/pdfstream.js';
import { pageToSvg } from '../../src/exporters/svg.js';
import { exportDocx } from '../../src/exporters/docx.js';
import { fontStore, report } from '../helpers.js';

const box = (fontFamily, value = 'Hello', y = 0, style = {}) => ({ type: 'textbox', x: 0, y, w: 300, h: 20, value, style: { fontFamily, ...style } });
const fontsOf = (model) => model.pages[0].items.filter(i => i.t === 'text').map(i => i.font);
const latin = (b) => Buffer.from(b).toString('latin1');
/** the font dictionaries of a PDF (object streams too), in brief: { type, base, enc, widths, embedded } */
const fontsIn = async (bytes) => {
  const { PDFDocument, PDFDict, PDFName } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const get = (d, k) => d.get(PDFName.of(k));
  const out = [];
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFDict) || String(get(o, 'Type')) !== '/Font' || String(get(o, 'Subtype')) === '/CIDFontType2') continue;
    const desc = String(get(o, 'Subtype')) === '/Type0' ? doc.context.lookup(doc.context.lookup(get(o, 'DescendantFonts')).get(0)).get(PDFName.of('FontDescriptor')) : get(o, 'FontDescriptor');
    const fd = desc && doc.context.lookup(desc);
    out.push({ type: String(get(o, 'Subtype')).slice(1), base: String(get(o, 'BaseFont')).slice(1), enc: get(o, 'Encoding') ? String(get(o, 'Encoding')).slice(1) : undefined,
      widths: get(o, 'Widths') ? doc.context.lookup(get(o, 'Widths')).size() : 0, embedded: !!fd && ['FontFile', 'FontFile2', 'FontFile3'].some(k => fd.get(PDFName.of(k))) });
  }
  return out;
};
const ICC = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'icc', 'sRGB-v2-magic.icc'));
const hasPdffonts = (() => { try { execFileSync('pdffonts', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('standard fonts: names and faces', () => {
  it('Helvetica, Times-Roman and Courier in four faces, Symbol and ZapfDingbats, by their PostScript names', () => {
    expect(['normal', 'bold'].flatMap(w => ['normal', 'italic'].map(s => resolveFontKey('Helvetica', w, s))))
      .toEqual(['Helvetica', 'Helvetica-Oblique', 'Helvetica-Bold', 'Helvetica-BoldOblique']);
    expect(resolveFontKey('Times-Roman', 'bold', 'italic')).toBe('Times-BoldItalic');
    expect(resolveFontKey('Courier', 'normal', 'italic')).toBe('Courier-Oblique');
    expect(resolveFontKey('Symbol')).toBe('Symbol');
    expect(resolveFontKey('ZapfDingbats')).toBe('ZapfDingbats');
  });
  it('aliases: Arial is Helvetica, Times New Roman is Times-Roman, Courier New is Courier', () => {
    expect(resolveFontKey('Arial', 'bold')).toBe('Helvetica-Bold');
    expect(resolveFontKey('Times New Roman')).toBe('Times-Roman');
    expect(resolveFontKey('Courier New')).toBe('Courier');
  });
  it('render uses them without a warning', async () => {
    const m = await render(report([box('Helvetica'), box('Times-Roman', 'x', 30), box('Courier', 'x', 60), box('Arial', 'x', 90)]), { fontStore });
    expect(m.warnings).toEqual([]);
    expect(fontsOf(m)).toEqual(['Helvetica', 'Times-Roman', 'Courier', 'Helvetica']);
  });
});

describe('standard fonts: layout uses the AFM widths', () => {
  it('"Hello" in Helvetica 10 pt is 22.78 pt (H 722, e 556, l 222, l 222, o 556)', async () => {
    await fontStore.load(['Helvetica', 'Courier']);
    const m = new TextMeasurer(fontStore);
    expect(m.width('Hello', 'Helvetica', 10)).toBeCloseTo(22.78, 5);
    expect(m.width('iiii', 'Courier', 10)).toBeCloseTo(24, 5); // monospaced: 600 each
  });
  it('a right-aligned line sits where Helvetica\'s widths put it', async () => {
    const m = await render(report([box('Helvetica', 'Hello', 0, { textAlign: 'right', fontSize: 10, padding: 0 })]), { fontStore });
    expect(m.pages[0].items[0].lines[0].x).toBeCloseTo(36 + 300 - 22.78, 1); // the 36 pt margin
  });
});

describe('standard fonts: characters WinAnsi lacks', () => {
  it('fall back to Inter for those characters, with one warning', async () => {
    const m = await render(report([box('Helvetica', 'Łódź → ok'), box('Helvetica', 'Łx', 30)]), { fontStore });
    expect(m.warnings).toEqual(['Font "Helvetica" can\'t show "Łź→"; used Inter for them.']);
    const runs = m.pages[0].items[0].lines[0].runs.map(r => [r.font, r.text]);
    expect(runs).toContainEqual(['Inter-Regular', 'Ł']);
    expect(runs).toContainEqual(['Helvetica', 'ód']);
  });
});

describe('standard fonts: PDF', () => {
  it('a Type1 font with WinAnsiEncoding and widths, nothing embedded', async () => {
    const m = await render(report([box('Helvetica', 'Total (EUR) 1,234.50 €'), box('Helvetica', 'Bold', 30, { fontWeight: 'bold' })]), { fontStore });
    const fonts = await fontsIn(await exportPdf(m, fontStore, {}));
    expect(fonts).toContainEqual({ type: 'Type1', base: 'Helvetica', enc: 'WinAnsiEncoding', widths: 224, embedded: false });
    expect(fonts).toContainEqual({ type: 'Type1', base: 'Helvetica-Bold', enc: 'WinAnsiEncoding', widths: 224, embedded: false });
    expect(fonts.filter(f => f.embedded)).toEqual([]);
  });
  it.skipIf(!hasPdffonts)('pdffonts lists Helvetica with emb no; pdftotext reads the text', async () => {
    const m = await render(report([box('Helvetica', 'Invoice (No. 42) — €10')]), { fontStore });
    const file = path.join(fs.mkdtempSync(path.join(import.meta.dirname, '..', '..', 'node_modules', '.b10-')), 'h.pdf');
    fs.writeFileSync(file, await exportPdf(m, fontStore, {}));
    expect(execFileSync('pdffonts', [file], { encoding: 'utf8' })).toMatch(/^Helvetica\s+Type 1\s+WinAnsi\s+no\s+no\s+no/m);
    expect(execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' })).toContain('Invoice (No. 42) — €10');
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
  it('PDF/A and PDF/UA embed the stand-in and warn once per family', async () => {
    const m = await render(report([box('Helvetica'), box('Helvetica', 'More', 30), box('Courier', 'x', 60)]), { fontStore, exportData: true });
    for (const opt of [{ pdfa: { icc: ICC } }, { tagged: { lang: 'en' } }]) {
      const warnings = [];
      const fonts = await fontsIn(await exportPdf(m, fontStore, { ...opt, onWarning: w => warnings.push(w) }));
      expect(fonts.length).toBeGreaterThan(0);
      expect(fonts.filter(f => !f.embedded)).toEqual([]);
      expect(warnings.filter(w => w.includes('"Helvetica"'))).toHaveLength(1);
      expect(warnings.find(w => w.includes('"Helvetica"'))).toMatch(/drawn in Inter.*widths differ/);
      expect(warnings.find(w => w.includes('"Courier"'))).toMatch(/drawn in JetBrains Mono/);
    }
    expect(fontsOf(m)).toEqual(['Helvetica', 'Helvetica', 'Courier']); // the model is not changed
  });
});

describe('standard fonts: streaming', () => {
  const def = () => ({
    ...report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 300, h: 40, columns: [{ width: 150 }, { width: 150 }], style: { fontFamily: 'Helvetica' },
      header: [{ height: 14, cells: [{ value: 'Item' }, { value: 'Amount' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.item' }, { value: '=Fields.amount' }] }] }],
    { data: { rows: Array.from({ length: 30 }, (_, i) => ({ item: `Item ${i}`, amount: i * 10 })) } }),
  });
  const sink = () => { const chunks = []; return { chunks, write: (b) => { chunks.push(Buffer.from(b)); } }; };
  it('exportPdfStream names Helvetica as a Type1 font', async () => {
    const s = sink();
    const r = await exportPdfStream(def(), { fontStore }, s);
    expect(r.streamed).toBe(true);
    const fonts = await fontsIn(Buffer.concat(s.chunks));
    expect(fonts).toContainEqual({ type: 'Type1', base: 'Helvetica', enc: 'WinAnsiEncoding', widths: 224, embedded: false });
  });
  it('a tagged stream embeds the stand-in and warns', async () => {
    const s = sink();
    const r = await exportPdfStream(def(), { fontStore, tagged: { lang: 'en' } }, s);
    const fonts = await fontsIn(Buffer.concat(s.chunks));
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.filter(f => !f.embedded)).toEqual([]);
    expect(r.warnings.some(w => /"Helvetica" is a standard font/.test(w))).toBe(true);
  });
});

describe('standard fonts: HTML, SVG and Office', () => {
  it('SVG names the font with a fallback list and its weight', async () => {
    const m = await render(report([box('Helvetica', 'Hi', 0, { fontWeight: 'bold' })]), { fontStore });
    const svg = pageToSvg(m.pages[0], m);
    expect(svg).toContain('font-family="Helvetica, Arial, &quot;Liberation Sans&quot;, sans-serif" font-weight="700"');
  });
  it('Word names Arial for Helvetica and Times New Roman for Times', async () => {
    const m = await render(report([box('Helvetica', 'A'), box('Times-Roman', 'B', 30)]), { fontStore, exportData: true });
    const { unzipSync, strFromU8 } = await import('fflate');
    const xml = strFromU8(unzipSync(await exportDocx(m))['word/document.xml']);
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).toContain('w:ascii="Times New Roman"');
  });
});
