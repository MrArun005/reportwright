// Indic, RTL and CJK text: shaping (HarfBuzz), bidi order, line breaking, font fallback, and the same
// glyphs and widths in the page model, the SVG and the PDF.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import * as hb from 'harfbuzzjs';
import { PDFDocument, PDFName, PDFRawStream, PDFDict } from 'pdf-lib';
import { render, TextMeasurer, FontStore } from '../../src/engine/index.js';
import { SHAPER } from '../../src/engine/text/fonts.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { pageToSvg } from '../../src/exporters/svg.js';
import { exportHtml } from '../../src/exporters/html.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { fontStore, report } from '../helpers.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const FONTS = path.join(ROOT, 'public', 'fonts');
const subset = createSubsetter(async () => fs.readFileSync(path.join(ROOT, 'public', 'harfbuzz-subset.wasm')));

/** HarfBuzz itself (harfbuzzjs), as the reference the engine must match. */
const refFonts = new Map();
function ref(file, text, dir) {
  let f = refFonts.get(file);
  if (!f) { const face = new hb.Face(new hb.Blob(fs.readFileSync(file))); f = { font: new hb.Font(face), upem: face.upem }; refFonts.set(file, f); }
  const buf = new hb.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  if (dir) buf.setDirection(dir === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
  hb.shape(f.font, buf);
  const pos = buf.getGlyphPositions();
  return { upem: f.upem, glyphs: buf.getGlyphInfos().map((g, i) => ({ id: g.codepoint, ax: pos[i].xAdvance, dx: pos[i].xOffset, dy: pos[i].yOffset })) };
}
const refWidth = (file, text, size, dir) => { const r = ref(file, text, dir); return r.glyphs.reduce((a, g) => a + g.ax, 0) * size / r.upem; };
const DEVA = path.join(FONTS, 'NotoSansDevanagari-Regular.ttf');
const ARAB = path.join(FONTS, 'NotoSansArabic-Regular.ttf');

const box = (value, extra = {}) => ({ type: 'textbox', name: 'T', x: 0, y: 0, w: extra.w || 400, h: extra.h || 20, value, style: { fontSize: 10, ...(extra.style || {}) } });
const lines = (model) => model.pages[0].items.filter(i => i.t === 'text').flatMap(i => i.lines.map(l => ({ ...l, font: i.font, size: i.size })));
const ids = (run) => run.glyphs.filter((_, i) => i % 4 === 0);

describe('Devanagari', () => {
  it('measures conjuncts with HarfBuzz widths, not a sum of character advances', async () => {
    const store = new FontStore(fontStore.loader);
    await store.load(['NotoSansDevanagari-Regular', SHAPER]);
    const m = new TextMeasurer(store);
    for (const s of ['क्षत्रिय', 'प्रधानमंत्री', 'कार्यालय', 'राष्ट्रीय']) {
      expect(m.width(s, 'NotoSansDevanagari-Regular', 10), s).toBeCloseTo(refWidth(DEVA, s, 10), 6);
    }
  });

  it('falls back from Inter to the bundled Devanagari font and draws the shaped glyphs', async () => {
    const model = await render(report([box('मासिक किस्त क्षत्रिय')]), { fontStore });
    const [l] = lines(model);
    expect(l.runs.map(r => r.font)).toContain('NotoSansDevanagari-Regular');
    const run = l.runs.find(r => r.text === 'क्षत्रिय');
    expect(ids(run)).toEqual(ref(DEVA, 'क्षत्रिय').glyphs.map(g => g.id));
    expect(model.warnings).toEqual([]);
  });

  it('keeps each run as wide as its glyph advances, and the line as wide as its runs', async () => {
    const model = await render(report([box('ऋण विवरण: EMI ₹12,345 प्रति माह')]), { fontStore });
    const [l] = lines(model);
    let x = 0;
    for (const r of l.runs) {
      expect(r.x).toBeCloseTo(x, 6);
      x += r.w;
    }
    expect(x).toBeCloseTo(l.w, 6);
    const r = l.runs.find(q => q.text === 'विवरण');
    expect(r.w).toBeCloseTo(refWidth(DEVA, 'विवरण', 10), 6);
  });

  it('never breaks a line inside a conjunct', async () => {
    const model = await render(report([box('क्षत्रियक्षत्रियक्षत्रियक्षत्रिय', { w: 60, h: 80 })]), { fontStore });
    const segs = [...new Intl.Segmenter('hi', { granularity: 'grapheme' }).segment('क्षत्रियक्षत्रियक्षत्रियक्षत्रिय')].map(s => s.segment);
    const ls = lines(model).map(l => l.text);
    expect(ls.length).toBeGreaterThan(1);
    expect(ls.join('')).toBe(segs.join(''));
    for (const t of ls) expect(segs.join('|')).toContain([...new Intl.Segmenter('hi', { granularity: 'grapheme' }).segment(t)].map(s => s.segment).join('|'));
  });

  it('puts the shaped glyph IDs in the PDF, and the text reads back', async () => {
    const model = await render(report([box('क्षत्रिय राष्ट्रीय')]), { fontStore });
    const bytes = await exportPdf(model, fontStore, { subset });
    const content = pageContent(await PDFDocument.load(bytes));
    const want = ref(DEVA, 'क्षत्रिय').glyphs.map(g => g.id.toString(16).padStart(4, '0')).join('');
    expect(content.replace(/>\s*(-?[\d.]+\s*)?</g, '').toLowerCase()).toContain(want);
    expect(pdfText(bytes)).toContain('क्षत्रिय राष्ट्रीय');
  });

  it('subsets the fallback font to the glyphs it draws', async () => {
    const model = await render(report([box('क्षत्रिय')]), { fontStore });
    const doc = await PDFDocument.load(await exportPdf(model, fontStore, { subset }));
    const sizes = fontFiles(doc).map(b => b.length);
    expect(sizes.length).toBe(1); // Noto Sans Devanagari (the default font has nothing to draw)
    for (const n of sizes) expect(n).toBeLessThan(40_000);
  });
});

describe('Arabic and Hebrew', () => {
  it('joins Arabic letters (initial, medial, final forms), as HarfBuzz does', async () => {
    const model = await render(report([box('كشف حساب')]), { fontStore });
    const [l] = lines(model);
    const run = l.runs.find(r => r.text === 'حساب');
    expect(run.rtl).toBe(true);
    expect(ids(run)).toEqual(ref(ARAB, 'حساب', 'rtl').glyphs.map(g => g.id));
    // the joined forms are not the isolated (cmap) glyphs
    const iso = [...'حساب'].reverse().map(ch => ref(ARAB, ch, 'rtl').glyphs[0].id);
    expect(ids(run)).not.toEqual(iso);
  });

  it('orders a Hebrew + English line right to left, and aligns it right', async () => {
    const model = await render(report([box('שלום world 2026')]), { fontStore });
    const [l] = lines(model);
    expect(l.dir).toBe('rtl');
    const visual = [...l.runs].sort((a, b) => a.x - b.x).map(r => r.text).filter(t => t.trim());
    expect(visual).toEqual(['world', '2026', 'שלום']);
    expect(l.x + l.w).toBeCloseTo(36 + 400 - 2, 3); // page margin + box width - default padding
  });

  it('keeps an English paragraph left to right around a Hebrew phrase', async () => {
    const model = await render(report([box('Total שלום עולם due')]), { fontStore });
    const [l] = lines(model);
    expect(l.dir).toBe('ltr');
    const visual = [...l.runs].sort((a, b) => a.x - b.x).map(r => r.text).filter(t => t.trim());
    expect(visual).toEqual(['Total', 'עולם', 'שלום', 'due']);
    expect(l.x).toBeCloseTo(36 + 2, 3);
  });

  it('draws RTL runs in the SVG as visually ordered, positioned runs', async () => {
    const model = await render(report([box('שלום world')]), { fontStore });
    const svg = pageToSvg(model.pages[0], model.width, model.height);
    expect(svg).toMatch(/font-family="pw-NotoSansHebrew-Regular"[^>]*direction:rtl[^>]*>שלום<\/text>/);
    expect(svg).toMatch(/font-family="pw-Inter-Regular"[^>]*>world<\/text>/);
  });
});

describe('CJK', () => {
  const cjk = new FontStore(async (k) => (k === 'cjk' ? fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'fonts', 'NotoSansSC-Subset.otf')) : fontStore.loader(k)));
  it('breaks between ideographs, never before closing punctuation', async () => {
    await cjk.load(['cjk', SHAPER]);
    const m = new TextMeasurer(cjk);
    const text = '我们的产品很好。服务也很好，价格合理！';
    const out = m.wrap(text, 'cjk', 10, 52);
    expect(out.length).toBeGreaterThan(2);
    expect(out.map(l => l.text).join('')).toBe(text);
    for (const l of out) {
      expect(l.width).toBeLessThanOrEqual(52 + 1e-6);
      expect('。，！').not.toContain(l.text[0]);
    }
  });
});

describe('HTML export', () => {
  it('embeds the fallback font with its layout tables, so the browser shapes as the engine did', async () => {
    const model = await render(report([box('क्षत्रिय')]), { fontStore });
    const html = await exportHtml(model, fontStore, { subset });
    const m = /font-family:"pw-NotoSansDevanagari-Regular";src:url\(data:font\/ttf;base64,([^)]+)\)/.exec(html);
    const font = Buffer.from(m[1], 'base64');
    expect(font.includes('GSUB')).toBe(true);
    expect(font.length).toBeLessThan(60_000);
    expect(html).toContain('>क्षत्रिय</text>');
  });

  it('leaves Latin text as it was: no runs, the same SVG', async () => {
    const model = await render(report([box('Statement of account, ₹12,00,000 — 05 Jan 2024')]), { fontStore });
    const [l] = lines(model);
    expect(l.runs).toBeUndefined();
    expect(l.dir).toBeUndefined();
    expect(pageToSvg(model.pages[0], model.width, model.height)).toContain('font-family="pw-Inter-Regular" font-size="10" fill="rgba(31,35,40,1)" xml:space="preserve">Statement of account, ₹12,00,000 — 05 Jan 2024</text>');
  });
});

describe('fonts that are missing', () => {
  it('warns once when no font has a character', async () => {
    const model = await render(report([box('日本')]), { fontStore });
    expect(model.warnings.join(' ')).toMatch(/No font.*日/);
  });
});

/* ---- reading the PDF back ---- */
function pageContent(doc) {
  const c = doc.getPage(0).node.Contents();
  const streams = c instanceof PDFRawStream ? [c] : c.asArray().map(r => doc.context.lookup(r));
  return streams.map(s => inflateSync(Buffer.from(s.contents)).toString('latin1')).join('\n');
}
/** The embedded font programs (decompressed). */
function fontFiles(doc) {
  const out = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type'))?.toString() !== '/FontDescriptor') continue;
    const ref = obj.get(PDFName.of('FontFile2')) || obj.get(PDFName.of('FontFile3'));
    if (ref) out.push(inflateSync(Buffer.from(doc.context.lookup(ref).contents)));
  }
  return out;
}
function pdfText(bytes) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), 'a.pdf');
  fs.writeFileSync(f, bytes);
  return execFileSync('pdftotext', ['-enc', 'UTF-8', f, '-'], { encoding: 'utf8' });
}
