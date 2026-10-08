// Fonts passed to embedFont are untrusted: crafted names must not inject PDF syntax, and broken tables must fail fast
// with a clear error (no out-of-bounds reads, endless loops or allocations sized from the font's numbers).
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { toBytes } from '../../packages/pdf/src/index.js';
import { buildSfnt } from '../../packages/pdf/src/fonts/subset.js';
import { sfntTables, parseFont } from '../../packages/pdf/src/fonts/truetype.js';
import { pdfName, fontName } from '../../packages/pdf/src/core/serialize.js';
import { INTER, HAS, pdffonts, pdftotext, directory, latin, run, save } from './tools.js';

const EVIL = 'A /OpenAction << /S /JavaScript /JS (app.alert(1)) >>';

/** Inter with its name table replaced by one record (nameID 6, Windows, UTF-16BE) */
function withName(ps) {
  const s = Buffer.from(ps, 'utf16le').swap16();
  const nm = new Uint8Array(18 + s.length), dv = new DataView(nm.buffer);
  dv.setUint16(2, 1); dv.setUint16(4, 18);
  dv.setUint16(6, 3); dv.setUint16(8, 1); dv.setUint16(10, 0x409); dv.setUint16(12, 6); dv.setUint16(14, s.length); dv.setUint16(16, 0);
  nm.set(s, 18);
  const t = sfntTables(INTER);
  t.set('name', nm);
  return buildSfnt(t);
}
const copy = () => new Uint8Array(INTER);
/** set Inter's loca entry g (long format) @param {Uint8Array} b */
const setLoca = (b, g, v) => { const L = directory(b).get('loca'); new DataView(b.buffer).setUint32(L.off + g * 4, v); };
const getLoca = (b, g) => new DataView(b.buffer).getUint32(directory(b).get('loca').off + g * 4);
/** draw a line with the font and end the PDF */
const draw = (bytes, txt = 'Hello Ä', opt = {}) => toBytes(async (pdf) => {
  const f = await pdf.embedFont(bytes, opt);
  pdf.addPage().text(txt, { x: 10, y: 10, font: f });
}, { compress: false, creationDate: new Date(0) });
/** throws quickly with a message matching re */
async function failsFast(fn, re) {
  const t = performance.now();
  await expect(fn()).rejects.toThrow(re);
  expect(performance.now() - t).toBeLessThan(1000);
}

describe('hostile fonts', () => {
  it('a PostScript name that tries to inject a dictionary is sanitised (subset and whole)', async () => {
    for (const subset of [true, false]) {
      const out = await draw(withName(EVIL), 'Hello', { subset });
      const s = latin(out);
      expect(s).not.toMatch(/\/OpenAction|\/JavaScript|\/JS\b|\(app\.alert/); // the words survive inside one name, the syntax does not
      expect(s).toMatch(/\/BaseFont \/(?:[A-Z]{6}\+)?A--OpenAction-----S--JavaScript--JS--app.alert-1-----/);
      const doc = await PDFDocument.load(out); // parses: the structure is intact
      expect(doc.catalog.get(doc.context.obj('OpenAction'))).toBeUndefined();
      if (HAS.poppler) { expect(pdftotext(out)).toMatch('Hello'); expect(pdffonts(out)).toMatch('A--OpenAction'); }
      if (HAS.qpdf) expect(run('qpdf', ['--check', save(out)])).toMatch(/No syntax or stream encoding errors/);
    }
  });

  it('unsafe characters become "-", an empty name is "Font", long names are cut to 63', async () => {
    expect(latin(await draw(withName('()<>[]{}/% \u00e9'), 'Hi', { subset: false }))).toMatch(/\/BaseFont \/------------ /);
    expect(latin(await draw(withName(''), 'Hi', { subset: false }))).toMatch(/\/BaseFont \/Font /);
    expect(fontName('')).toBe('/Font'); expect(fontName(null, 'X')).toBe('/X'); expect(fontName('a b/c#d')).toBe('/a-b-c-d');
    const long = latin(await draw(withName('N'.repeat(500)), 'Hi', { subset: false }));
    expect(long).toMatch(new RegExp(`/BaseFont /${'N'.repeat(63)} `));
  });

  it('loca pointing past the end of glyf is refused', async () => {
    const b = copy(); setLoca(b, 40, directory(b).get('glyf').len + 1000);
    await failsFast(() => draw(b), /Broken font: loca/);
  });

  it('loca going backwards is refused', async () => {
    const b = copy(); setLoca(b, 41, getLoca(b, 40) - 4);
    await failsFast(() => draw(b), /Broken font: loca goes backwards/);
  });

  it('loca with a huge offset (a would-be giant allocation) is refused', async () => {
    const b = copy(); setLoca(b, 2925, 0xfffffff0); setLoca(b, 2926, 0xfffffff0);
    await failsFast(() => draw(b), /Broken font: loca/);
  });

  // a composite glyph of Inter (Ä): its first component's glyph index is at +12 in the glyph's data
  const composite = () => {
    const f = parseFont(INTER), g = f.glyphFor(0xc4), D = directory(INTER);
    const at = getLoca(INTER, g), pos = D.get('glyf').off + at;
    expect(new DataView(INTER.buffer, INTER.byteOffset).getInt16(pos)).toBeLessThan(0); // composite
    return { g, comp: pos + 12 };
  };

  it('a composite glyph that uses itself ends (no endless walk) and embeds', async () => {
    const { g, comp } = composite(), b = copy();
    new DataView(b.buffer).setUint16(comp, g);
    const t = performance.now();
    const out = await draw(b, 'Ä');
    expect(performance.now() - t).toBeLessThan(1000);
    if (HAS.poppler) expect(pdffonts(out)).toMatch(/Inter-Regular/);
  });

  it('a composite glyph using a glyph past the font is refused', async () => {
    const { comp } = composite(), b = copy();
    new DataView(b.buffer).setUint16(comp, 0xfff0);
    await failsFast(() => draw(b, 'Ä'), /Broken font: composite glyph \d+ uses glyph 65520/);
  });

  it('a table directory of 65535 tables is refused', async () => {
    const b = copy(); new DataView(b.buffer).setUint16(4, 0xffff);
    await failsFast(() => draw(b), /Broken font: a directory of 65535 tables/);
  });

  it('a table that lies past the end of the file is refused', async () => {
    const b = copy(); new DataView(b.buffer).setUint32(directory(b).get('hmtx').rec + 8, b.length - 10);
    await failsFast(() => draw(b), /Broken font: table "hmtx" lies outside the file/);
  });

  it('numberOfHMetrics larger than the glyphs, and a cmap past its table, are refused', async () => {
    const b = copy(); new DataView(b.buffer).setUint16(directory(b).get('hhea').off + 34, 0xffff);
    await failsFast(() => draw(b), /numberOfHMetrics/);
    const c = copy(), cm = directory(c).get('cmap');
    const dv = new DataView(c.buffer), n = dv.getUint16(cm.off + 2);
    for (let i = 0; i < n; i++) { const st = cm.off + dv.getUint32(cm.off + 8 + i * 8); if (dv.getUint16(st) === 4) dv.setUint16(st + 6, 0xfffe); if (dv.getUint16(st) === 12) dv.setUint32(st + 12, 0x0fffffff); }
    await failsFast(() => draw(c), /Broken font: its cmap/);
  });

  it('garbage, collections and WOFF are refused with a clear error', async () => {
    await failsFast(() => draw(new Uint8Array(100)), /Not a TrueType or OpenType font/);
    await failsFast(() => draw(new TextEncoder().encode('ttcf' + '\0'.repeat(40))), /collections/);
    await failsFast(() => draw(new TextEncoder().encode('wOFF' + '\0'.repeat(40))), /WOFF/);
    await failsFast(() => draw(new Uint8Array(4)), /too short/);
  });
});
