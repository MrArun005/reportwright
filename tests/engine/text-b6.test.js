// Batch 6 text: line breaks for scripts without spaces (Thai, Lao, Khmer, Myanmar), CJK kinsoku, the bundled
// script fallbacks, and text extraction from the PDF (pdftotext) for Arabic, Hebrew and Thai.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { TextMeasurer, saBreaks, clusters } from '../../src/engine/text/measure.js';
import { SHAPER, fallbackKey, unicodeRange } from '../../src/engine/text/fonts.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontFaceCss } from '../../src/exporters/svg.js';
import { fontStore, report } from '../helpers.js';

const SAMPLES = {
  Thai: 'ข้อความภาษาไทยที่ไม่มีช่องว่างระหว่างคำต้องตัดบรรทัดตรงขอบเขตของคำเสมอ',
  Lao: 'ພາສາລາວບໍ່ມີຍະຫວ່າງລະຫວ່າງຄໍາສັບຕ້ອງຕັດແຖວຢູ່ຂອບເຂດຂອງຄໍາ',
  Khmer: 'ភាសាខ្មែរមិនមានដកឃ្លារវាងពាក្យទេដូច្នេះត្រូវកាត់បន្ទាត់នៅព្រំដែនពាក្យ',
  Myanmar: 'မြန်မာဘာသာစကားတွင်စကားလုံးများကြားတွင်နေရာလွတ်မရှိပါ',
};
const FONT = { Thai: 'NotoSansThai-Regular', Lao: 'NotoSansLao-Regular', Khmer: 'NotoSansKhmer-Regular', Myanmar: 'NotoSansMyanmar-Regular' };
let m;
beforeAll(async () => {
  await fontStore.load();
  await fontStore.load([SHAPER, ...Object.values(FONT), 'NotoSansArabic-Regular', 'NotoSansHebrew-Regular', 'NotoSansTamil-Regular']);
  m = new TextMeasurer(fontStore);
});
const words = (s) => new Set([...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(s)].map(x => x.index));

describe('line breaks without spaces (UAX #14 class SA)', () => {
  for (const [script, text] of Object.entries(SAMPLES)) {
    it(`${script}: breaks only at word boundaries, and every line fits`, () => {
      const lines = m.wrap(text, 'Inter-Regular', 12, 90);
      expect(lines.length).toBeGreaterThan(2);
      expect(lines.map(l => l.text).join('')).toBe(text);
      const ok = words(text);
      let at = 0;
      for (const l of lines.slice(0, -1)) { at += l.text.length; expect(ok.has(at), `${script} broke inside a word at ${at}: "${l.text}"`).toBe(true); }
      for (const l of lines) if (l.width > 90) expect(saBreaks(l.text).size, `"${l.text}" is one word`).toBe(0);
    });
  }
  it('measures each script in its own bundled font (no missing glyphs)', () => {
    for (const text of Object.values(SAMPLES)) m.wrap(text, 'Inter-Regular', 12, 90);
    expect([...m.noGlyph]).toEqual([]);
    for (const [script, key] of Object.entries(FONT)) expect(fallbackKey(SAMPLES[script].codePointAt(0), 'Inter-Regular')).toBe(key);
    expect(fallbackKey(0x0b95, 'Inter-Bold')).toBe('NotoSansTamil-Bold');
    expect(fallbackKey(0x0c95, 'Inter-Regular')).toBe('NotoSansKannada-Regular');
  });
  it('without Intl.Segmenter: no word breaks, a too-long word breaks between grapheme clusters', () => {
    expect(saBreaks(SAMPLES.Thai, null).size).toBe(0);
    // clusters() without Intl keeps a base and its marks together
    expect(clusters('ที่ไม่', false)).toEqual(clusters('ที่ไม่')); // same as Intl: ['ที่', 'ไ', 'ม่']
    expect(clusters('नमस्ते', false).join('')).toBe('नमस्ते');
    expect(clusters('नमस्ते', false).every(c => !/^\p{M}/u.test(c))).toBe(true);
  });
  it('a Thai paragraph with spaces between phrases keeps them', () => {
    const t = 'สวัสดีครับ ยินดีต้อนรับสู่รายงานประจำเดือน';
    const lines = m.wrap(t, 'Inter-Regular', 12, 1000);
    expect(lines.map(l => l.text)).toEqual([t]);
  });
});

describe('CJK line breaks (kinsoku)', () => {
  it('breaks between ideographs, never before closing or after opening punctuation', () => {
    const t = '这是一个关于报表的测试。「引号里的文字」也要正确处理，好吗？日本語のテキスト、カタカナ（ア）も。';
    for (const w of [40, 55, 70, 85]) {
      const lines = m.wrap(t, 'Inter-Regular', 10, w);
      expect(lines.map(l => l.text).join('')).toBe(t);
      for (const l of lines.slice(1)) expect('。，、？！）」』'.includes(l.text[0]), `line starts with "${l.text[0]}" at ${w}`).toBe(false);
      for (const l of lines.slice(0, -1)) expect('「『（'.includes(l.text.at(-1)), `line ends with "${l.text.at(-1)}" at ${w}`).toBe(false);
    }
  });
});

describe('script fallbacks in the browser', () => {
  it('@font-face of a fallback face carries its unicode-range, other faces none', () => {
    expect(unicodeRange('NotoSansThai-Regular')).toMatch(/^U\+e00-e7f,/);
    expect(unicodeRange('Inter-Regular')).toBe(null);
    const css = fontFaceCss(['Inter-Regular', 'NotoSansThai-Bold']);
    expect(css).toMatch(/pw-NotoSansThai-Bold[^}]*unicode-range:U\+e00-e7f/);
    expect(css.split('\n')[0]).not.toMatch(/unicode-range/);
  });
});

const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
// pdftotext marks direction with U+202A..U+202E; the text itself is what we compare
const plain = (s) => s.replace(/[‪-‮‎‏]/g, '').split('\n').map(l => l.trim()).filter(Boolean);
async function extract(values, w = 500) {
  const def = report(values.map((v, i) => ({ type: 'textbox', x: 0, y: i * 40, w, h: 36, value: v, style: { fontSize: 14 } })));
  const file = path.join(os.tmpdir(), `pw-b6-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, await exportPdf(await render(def, { fontStore }), fontStore));
  try { return plain(execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-']).toString()); } finally { fs.rmSync(file, { force: true }); }
}

describe.skipIf(!hasPdftotext)('text extraction from the PDF (pdftotext)', () => {
  it('Arabic, Persian, Urdu and Hebrew come out in logical order, without stray spaces', async () => {
    const t = [
      'مرحبا بالعالم الجميل', 'شركة التقنية المحدودة — فاتورة رقم ٤٥٦', 'يتضمن هذا التقرير جميع الفواتير المستحقة',
      'تقرير المبيعات الشهري حسب المنطقة والمنتج', 'السلام عليكم لا إله إلا الله', 'گزارش فروش ماهانه پیش‌فاکتور',
      'یہ ایک اردو جملہ ہے', 'שלום עולם יפה', 'חשבונית מס׳ לחברת אלפא בע״מ',
    ];
    expect(await extract(t)).toEqual(t);
  });
  it('Thai, Tamil and Devanagari come out as typed', async () => {
    const t = ['รายงานยอดขายประจำเดือน', 'மாதாந்திர விற்பனை அறிக்கை', 'मासिक बिक्री रिपोर्ट'];
    expect(await extract(t)).toEqual(t);
  });
  it('a wrapped Thai paragraph breaks between words in the PDF too', async () => {
    const lines = await extract([SAMPLES.Thai], 120);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(SAMPLES.Thai);
    const ok = words(SAMPLES.Thai);
    let at = 0;
    for (const l of lines.slice(0, -1)) { at += l.length; expect(ok.has(at)).toBe(true); }
  });
});

describe('form fields with complex scripts', () => {
  const fieldPdf = async (values) => {
    const def = report(values.map((v, i) => ({ type: 'field', fieldName: `f${i}`, x: 0, y: i * 40, w: 250, h: 24, value: v, style: { fontSize: 12 } })));
    return exportPdf(await render(def, { fontStore }), fontStore);
  };
  it('the appearance of a pre-filled field draws the shaped glyphs, and its DA names the script font', async () => {
    const { PDFDocument, PDFName, decodePDFRawStream } = await import('pdf-lib');
    const bytes = await fieldPdf(['مرحبا', 'नमस्ते', 'Hello']); // Devanagari used to stop the export (fontkit's Indic shaper)
    const form = (await PDFDocument.load(bytes)).getForm();
    const ap = (name) => {
      const w = form.getTextField(name).acroField.getWidgets()[0];
      const n = w.dict.context.lookup(w.dict.lookup(PDFName.of('AP')).get(PDFName.of('N')));
      return new TextDecoder('latin1').decode(decodePDFRawStream(n).decode());
    };
    const da = (name) => form.getTextField(name).acroField.getDefaultAppearance();
    expect(ap('f0')).toMatch(/\/Tx BMC/);
    // joined Arabic: initial/medial/final glyphs, not the isolated letters pdf-lib would draw one by one
    const f = fontStore.get('NotoSansArabic-Regular');
    const isolated = [...'مرحبا'].map(ch => f.glyphForCodePoint(ch.codePointAt(0)).id.toString(16).padStart(4, '0'));
    const drawn = [...ap('f0').matchAll(/<([0-9a-f]{4})>/g)].map(x => x[1]);
    expect(drawn.length).toBeGreaterThan(3);
    expect(drawn.filter(id => !isolated.includes(id)).length).toBeGreaterThan(0);
    expect(da('f0')).not.toBe(da('f2')); // the Arabic field names its own font, the Latin one the report font
    expect(ap('f2')).not.toMatch(/\/Span/); // plain Latin keeps pdf-lib's appearance
  });
  it.skipIf(!hasPdftotext)('pdftotext reads the field values', async () => {
    const file = path.join(os.tmpdir(), `pw-b6f-${process.pid}.pdf`);
    fs.writeFileSync(file, await fieldPdf(['مرحبا بالعالم', 'नमस्ते दुनिया', 'ภาษาไทย']));
    try { expect(plain(execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-']).toString())).toEqual(['مرحبا بالعالم', 'नमस्ते दुनिया', 'ภาษาไทย']); } finally { fs.rmSync(file, { force: true }); }
  });
});
