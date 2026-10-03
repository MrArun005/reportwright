// Uploaded fonts: what the server accepts (TTF, OTF, WOFF, WOFF2), what it refuses and why, and that an
// uploaded font is used by family in a server render and embedded (subset) in the PDF.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import fkm from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { checkFont, toSfnt, saveFont, listFonts, readFont, deleteFont, MAX_FONT_BYTES } from '../../src/server/fonts.js';
import { renderTo } from '../../src/server/renderer.js';
import { report } from '../helpers.js';

const fontkit = fkm.default || fkm;
const ROOT = path.join(import.meta.dirname, '..', '..');
const POPPINS = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'fonts', 'Poppins-Regular.ttf'));
const PLEX = fs.readFileSync(path.join(ROOT, 'public', 'fonts', 'ui', 'ibm-plex-sans-latin-400-normal.woff2'));
const u8 = (b) => new Uint8Array(b);
const fails = (fn) => { try { fn(); } catch (e) { return { status: e.status, message: e.message }; } return null; };

/** WOFF 1.0 from an sfnt: each table zlib-compressed. */
function woff(ttf) {
  const n = ttf.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const data = ttf.subarray(ttf.readUInt32BE(r + 8), ttf.readUInt32BE(r + 8) + ttf.readUInt32BE(r + 12));
    tables.push({ tag: ttf.readUInt32BE(r), sum: ttf.readUInt32BE(r + 4), data, z: zlib.deflateSync(data) });
  }
  let off = 44 + n * 20;
  const head = Buffer.alloc(off);
  head.write('wOFF', 0); head.writeUInt32BE(ttf.readUInt32BE(0), 4); head.writeUInt16BE(n, 12);
  const parts = [head];
  tables.forEach((t, i) => {
    const z = t.z.length < t.data.length ? t.z : t.data;
    const e = 44 + i * 20;
    head.writeUInt32BE(t.tag, e); head.writeUInt32BE(off, e + 4); head.writeUInt32BE(z.length, e + 8); head.writeUInt32BE(t.data.length, e + 12); head.writeUInt32BE(t.sum, e + 16);
    const pad = Buffer.alloc((4 - (z.length % 4)) % 4);
    parts.push(z, pad);
    off += z.length + pad.length;
  });
  const out = Buffer.concat(parts);
  out.writeUInt32BE(out.length, 8);
  return out;
}

const sameGlyphs = (a, b) => {
  const fa = fontkit.create(Buffer.from(a)), fb = fontkit.create(Buffer.from(b));
  expect(fb.numGlyphs).toBe(fa.numGlyphs);
  for (let id = 0; id < fa.numGlyphs; id++) {
    expect(fb.getGlyph(id).path.toSVG(), `glyph ${id}`).toBe(fa.getGlyph(id).path.toSVG());
    expect(fb.getGlyph(id).advanceWidth).toBe(fa.getGlyph(id).advanceWidth);
  }
};

describe('font upload checks', () => {
  it('takes a TrueType font as it is, with names from the font', () => {
    const { info, sfnt } = checkFont(u8(POPPINS));
    expect(info).toMatchObject({ family: 'Poppins', weight: 400, style: 'normal', format: 'truetype' });
    expect(sfnt.length).toBe(POPPINS.length);
  });

  it('unpacks WOFF to the same glyphs', () => {
    sameGlyphs(POPPINS, toSfnt(u8(woff(POPPINS))));
  });

  it('unpacks WOFF2 (transformed glyf and loca) to the same glyphs fontkit reads from the WOFF2', () => {
    const sfnt = toSfnt(u8(PLEX));
    expect(Buffer.from(sfnt.subarray(0, 4)).readUInt32BE(0)).toBe(0x00010000);
    sameGlyphs(PLEX, sfnt);
    expect(checkFont(u8(PLEX)).info).toMatchObject({ family: 'IBM Plex Sans', weight: 400 });
  });

  it('refuses what is not a font, a collection, a damaged file, a file too large', () => {
    expect(fails(() => checkFont(u8(Buffer.from('\x89PNG\r\n\x1a\n0000000000000000', 'latin1'))))).toMatchObject({ status: 415, message: /not a font file/ });
    expect(fails(() => checkFont(u8(Buffer.from('ttcf0000000000000000'))))).toMatchObject({ status: 400, message: /collections/ });
    expect(fails(() => checkFont(u8(Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(200, 7)]))))).toMatchObject({ status: 400, message: /damaged/ });
    expect(fails(() => checkFont(u8(Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(100)]))))).toMatchObject({ status: 400 });
    expect(fails(() => checkFont(new Uint8Array(MAX_FONT_BYTES + 1)))).toMatchObject({ status: 413 });
    expect(fails(() => checkFont(new Uint8Array(0)))).toMatchObject({ status: 400, message: /empty/ });
  });

  it('refuses a font whose licence forbids embedding, and the names of bundled fonts', () => {
    const f = Buffer.from(POPPINS);
    const n = f.readUInt16BE(4);
    for (let i = 0; i < n; i++) if (f.toString('latin1', 12 + i * 16, 16 + i * 16) === 'OS/2') f.writeUInt16BE(2, f.readUInt32BE(12 + i * 16 + 8) + 8);
    expect(fails(() => checkFont(u8(f)))).toMatchObject({ status: 400, message: /licence does not allow embedding/ });
    expect(fails(() => checkFont(u8(POPPINS), { family: 'inter' }))).toMatchObject({ status: 400, message: /already has/ });
    expect(fails(() => checkFont(u8(POPPINS), { family: 'x<script>' }))).toMatchObject({ status: 400, message: /family name/ });
    expect(fails(() => checkFont(u8(POPPINS), { weight: '1200' }))).toMatchObject({ status: 400, message: /weight/ });
    expect(fails(() => checkFont(u8(POPPINS), { style: 'oblique' }))).toMatchObject({ status: 400, message: /style/ });
  });
});

describe('uploaded fonts in a render', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-fonts-'));
  const home = process.cwd();
  afterAll(() => { process.chdir(home); fs.rmSync(tmp, { recursive: true, force: true }); });

  it('stores, lists, serves and deletes a font; a server PDF embeds it subset', async () => {
    process.chdir(tmp);
    const info = await saveFont(u8(POPPINS), { family: 'Brand Sans' });
    expect(info).toMatchObject({ family: 'Brand Sans', weight: 400, style: 'normal' });
    expect(await listFonts()).toEqual([info]);
    expect((await readFont(info.id)).bytes.length).toBe(POPPINS.length);
    expect(fs.existsSync(path.join(tmp, 'data', 'fonts', `${info.id}.json`))).toBe(true);

    const def = report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 400, h: 20, value: 'Brand statement', style: { fontFamily: 'Brand Sans', fontSize: 12 } }]);
    const r = await renderTo(def, { format: 'pdf' });
    expect(r.model.pages[0].items.find(i => i.t === 'text').font).toBe(`u-${info.id}`);
    const doc = await PDFDocument.load(r.bytes);
    const files = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/FontDescriptor') {
        files.push({ name: obj.get(PDFName.of('FontName')).toString(), bytes: zlib.inflateSync(Buffer.from(doc.context.lookup(obj.get(PDFName.of('FontFile2'))).contents)).length });
      }
    }
    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/Poppins/);
    expect(files[0].bytes).toBeLessThan(POPPINS.length / 4);

    // a second upload of the same face replaces the first
    const again = await saveFont(u8(woff(POPPINS)), { family: 'Brand Sans' });
    expect((await listFonts()).map(f => f.id)).toEqual([again.id]);
    expect(await deleteFont(again.id)).toBe(true);
    expect(await listFonts()).toEqual([]);
    expect(await readFont(again.id)).toBe(null);
    // the report still renders, in Inter
    const r2 = await renderTo(def, { format: 'json' });
    expect(r2.model.pages[0].items.find(i => i.t === 'text').font).toBe('Inter-Regular');
  });
});
