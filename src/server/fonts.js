// @ts-check
// Uploaded fonts: TTF, OTF, WOFF or WOFF2 in; a plain TrueType/OpenType file stored (the PDF embeds it and
// HarfBuzz subsets it, neither reads WOFF). Records live in the storage (kind "fonts"), as JSON with the
// file in base64, so every server that shares the storage has them. Ids are a hash of the content and the
// names, so a record never changes: its description can be cached forever.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fontkitModule from '@pdf-lib/fontkit';
import { store } from './storage/index.js';
import { BUNDLED_FAMILIES } from '../engine/text/fonts.js';

const fontkit = /** @type {any} */ (fontkitModule).default || fontkitModule;

export const MAX_FONT_BYTES = 20 * 1024 * 1024;
const MAX_SFNT_BYTES = 64 * 1024 * 1024; // a WOFF2 unpacks to about 3 times its size
const ID = /^[a-f0-9]{16}$/;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** @typedef {{ id: string, family: string, weight: number, style: 'normal'|'italic', format: 'truetype'|'opentype', bytes: number, glyphs: number, createdAt: string }} FontInfo */

/**
 * Check an upload and turn it into a TrueType/OpenType file. Throws an Error with .status for the user.
 * @param {Uint8Array} input @param {{ family?: string, weight?: string|number, style?: string }} [names] empty = read from the font
 * @returns {{ info: Omit<FontInfo, 'id'|'createdAt'>, sfnt: Uint8Array }}
 */
export function checkFont(input, names = {}) {
  if (!input?.length) throw bad('The file is empty.');
  if (input.length > MAX_FONT_BYTES) throw bad(`A font can be at most ${MAX_FONT_BYTES / 1024 / 1024} MB.`, 413);
  const sfnt = toSfnt(input);
  let font;
  try { font = fontkit.create(Buffer.from(sfnt)); } catch { throw bad('This font file is damaged: it could not be read.'); }
  if (font.type === 'TTC' || font.fonts) throw bad('Font collections (.ttc) are not supported. Upload one font of the collection as TTF or OTF.');
  if (!font.numGlyphs || !font.unitsPerEm || !font.characterSet?.length) throw bad('This font has no characters to draw.');
  const os2 = font['OS/2'];
  // OS/2 fsType (fontkit reads it as flags): "restricted licence" alone forbids embedding; "bitmap only" forbids
  // embedding the outlines, which is what a PDF needs.
  const t = os2?.fsType || {};
  if ((t.noEmbedding && !t.viewOnly && !t.editable) || t.bitmapOnly) throw bad("This font's licence does not allow embedding it in documents (OS/2 fsType), so it cannot be used in PDFs.");
  const family = String(names.family || font.getName?.('preferredFamily') || font.familyName || '').trim();
  if (!family || family.length > 64 || !/^[\p{L}\p{N} .,'&()+_-]+$/u.test(family)) throw bad('Give the font a family name: letters, digits and spaces, up to 64 characters.');
  if (BUNDLED_FAMILIES.some(f => f.toLowerCase() === family.toLowerCase())) throw bad(`"${family}" is a font Pagewright already has. Give your font another family name.`);
  const weight = names.weight ? Number(names.weight) : os2?.usWeightClass || 400;
  if (!Number.isInteger(weight) || weight < 1 || weight > 1000) throw bad('The weight is a number from 1 to 1000 (400 regular, 700 bold).');
  const style = names.style ? String(names.style) : os2?.fsSelection?.italic || font.italicAngle ? 'italic' : 'normal';
  if (style !== 'normal' && style !== 'italic') throw bad('The style is "normal" or "italic".');
  return { info: { family, weight, style, format: font.cff ? 'opentype' : 'truetype', bytes: sfnt.length, glyphs: font.numGlyphs }, sfnt };
}

/** Store an uploaded font. A face with the same family, weight and style replaces the old one. @returns {Promise<FontInfo>} */
export async function saveFont(input, names) {
  const { info, sfnt } = checkFont(input, names);
  const id = crypto.createHash('sha256').update(`${info.family}\u0000${info.weight}\u0000${info.style}\u0000`).update(sfnt).digest('hex').slice(0, 16);
  const rec = { id, ...info, createdAt: new Date().toISOString() };
  for (const f of await listFonts()) {
    if (f.id !== id && f.family === info.family && f.weight === info.weight && f.style === info.style) await deleteFont(f.id);
  }
  await store().put('fonts', id, JSON.stringify({ ...rec, data: Buffer.from(sfnt).toString('base64') }));
  infoCache.set(id, rec);
  return rec;
}

/** @type {Map<string, FontInfo>} records never change (the id is a content hash) */
const infoCache = (/** @type {any} */ (globalThis).__pwFontInfo ||= new Map());

/** Every uploaded font, without the files. @returns {Promise<FontInfo[]>} */
export async function listFonts() {
  const out = [];
  for (const id of await store().ids('fonts')) {
    let info = infoCache.get(id);
    if (!info) {
      const text = await store().get('fonts', id);
      if (!text) continue;
      try { const { data, ...rest } = JSON.parse(text); void data; info = /** @type {FontInfo} */ (rest); } catch { continue; }
      infoCache.set(id, info);
    }
    out.push(info);
  }
  return out.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style));
}

/** The font file, or null. @param {string} id @returns {Promise<{ bytes: Uint8Array, format: string }|null>} */
export async function readFont(id) {
  if (!ID.test(String(id))) return null;
  const text = await store().get('fonts', id);
  if (!text) return null;
  const rec = JSON.parse(text);
  return { bytes: new Uint8Array(Buffer.from(rec.data, 'base64')), format: rec.format };
}

/** @param {string} id @returns {Promise<boolean>} */
export async function deleteFont(id) {
  if (!ID.test(String(id))) return false;
  infoCache.delete(id);
  return store().remove('fonts', id);
}

/* ---------------------------------------------------------------- WOFF and WOFF2 → sfnt */

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const tagOf = (n) => String.fromCharCode(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

/** @param {Uint8Array} b @returns {Uint8Array} */
export function toSfnt(b) {
  const sig = b.length >= 4 ? u32(b, 0) : 0;
  if (sig === 0x00010000 || sig === 0x74727565 /* true */ || sig === 0x4f54544f /* OTTO */) return b;
  if (sig === 0x74746366 /* ttcf */) throw bad('Font collections (.ttc) are not supported. Upload one font of the collection as TTF or OTF.');
  if (sig === 0x774f4646 /* wOFF */) return fromWoff(b);
  if (sig === 0x774f4632 /* wOF2 */) return fromWoff2(b);
  throw bad('This is not a font file. Upload a TTF, OTF, WOFF or WOFF2 file.', 415);
}

/** WOFF 1: each table zlib-compressed. */
function fromWoff(b) {
  const n = u16(b, 12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    const off = u32(b, e + 4), comp = u32(b, e + 8), orig = u32(b, e + 12);
    if (off + comp > b.length || orig > MAX_SFNT_BYTES) throw bad('This WOFF file is damaged.');
    const raw = b.subarray(off, off + comp);
    const data = comp < orig ? new Uint8Array(zlib.inflateSync(raw, { maxOutputLength: orig })) : raw;
    if (data.length !== orig) throw bad('This WOFF file is damaged.');
    tables.push({ tag: tagOf(u32(b, e)), data });
  }
  return sfnt(u32(b, 4), tables);
}

const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC',
  'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

/** A reader over bytes with the WOFF2 number formats. */
function reader(b, pos = 0) {
  const r = {
    pos,
    u8: () => { if (r.pos >= b.length) throw bad('This WOFF2 file is damaged.'); return b[r.pos++]; },
    u16: () => (r.u8() << 8) | r.u8(),
    i16: () => { const v = r.u16(); return v & 0x8000 ? v - 0x10000 : v; },
    u32: () => ((r.u16() << 16) | r.u16()) >>> 0,
    base128: () => { let v = 0; for (let i = 0; i < 5; i++) { const x = r.u8(); v = v * 128 + (x & 127); if (!(x & 128)) return v; } throw bad('This WOFF2 file is damaged.'); },
    u255: () => { const c = r.u8(); return c === 253 ? r.u16() : c === 255 ? r.u8() + 253 : c === 254 ? r.u8() + 506 : c; },
    bytes: (n) => { if (r.pos + n > b.length) throw bad('This WOFF2 file is damaged.'); const s = b.subarray(r.pos, r.pos + n); r.pos += n; return s; },
  };
  return r;
}

/** WOFF2: one Brotli stream, glyf/loca (and maybe hmtx) in a transformed form (W3C WOFF2 §5). */
function fromWoff2(b) {
  const h = reader(b, 4);
  const flavor = h.u32(); h.u32(); const n = h.u16(); h.u16();
  const total = h.u32(); const compressed = h.u32();
  h.pos = 48;
  if (total > MAX_SFNT_BYTES) throw bad('This WOFF2 file is too large once unpacked.', 413);
  if (flavor === 0x74746366) throw bad('Font collections (.ttc) are not supported. Upload one font of the collection as TTF or OTF.');
  const dir = [];
  for (let i = 0; i < n; i++) {
    const flags = h.u8();
    const tag = (flags & 63) === 63 ? tagOf(h.u32()) : KNOWN[flags & 63];
    const version = flags >> 6;
    const orig = h.base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    dir.push({ tag, orig, transformed, version, length: transformed ? h.base128() : orig });
  }
  let data;
  try { data = new Uint8Array(zlib.brotliDecompressSync(b.subarray(h.pos, h.pos + compressed), { maxOutputLength: MAX_SFNT_BYTES })); }
  catch { throw bad('This WOFF2 file is damaged: it could not be unpacked.'); }
  const raw = {};
  let off = 0;
  for (const t of dir) { raw[t.tag] = data.subarray(off, off + t.length); off += t.length; }
  if (off > data.length) throw bad('This WOFF2 file is damaged.');
  const out = {};
  for (const t of dir) out[t.tag] = raw[t.tag];
  const glyf = dir.find(t => t.tag === 'glyf');
  /** @type {{ xMin: number }[]|null} */
  let boxes = null;
  if (glyf?.transformed) {
    const g = rebuildGlyf(raw.glyf);
    out.glyf = g.glyf; out.loca = g.loca; boxes = g.boxes;
    out.head = new Uint8Array(out.head); out.head[50] = 0; out.head[51] = 1; // indexToLocFormat: long offsets
  }
  const hmtx = dir.find(t => t.tag === 'hmtx');
  if (hmtx?.transformed) out.hmtx = rebuildHmtx(raw.hmtx, u16(out.maxp, 4), u16(out.hhea, 34), boxes);
  return sfnt(flavor, Object.entries(out).map(([tag, d]) => ({ tag, data: d })));
}

/** The transformed glyf table back to glyf + loca (long offsets). Also the x minimum of each glyph, for hmtx. */
function rebuildGlyf(t) {
  const h = reader(t);
  h.u16(); const option = h.u16(); const numGlyphs = h.u16(); h.u16();
  const sizes = Array.from({ length: 7 }, () => h.u32());
  const streams = [];
  let p = h.pos;
  for (const s of sizes) { streams.push(reader(t.subarray(p, p + s))); p += s; }
  const [nContour, nPoints, flagS, glyphS, compS, bboxS, instS] = streams;
  const overlap = option & 1 ? t.subarray(p, p + ((numGlyphs + 7) >> 3)) : null;
  const bitmap = bboxS.bytes(((numGlyphs + 31) >> 5) * 4);
  const parts = [], loca = new Uint8Array((numGlyphs + 1) * 4), boxes = [];
  const lv = new DataView(loca.buffer);
  let size = 0;
  for (let i = 0; i < numGlyphs; i++) {
    lv.setUint32(i * 4, size);
    const nc = nContour.i16();
    const hasBox = bitmap[i >> 3] & (0x80 >> (i & 7));
    if (nc === 0) { boxes.push({ xMin: 0 }); continue; }
    let box = hasBox ? [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()] : null;
    const w = [];
    const i16 = (v) => w.push((v >> 8) & 255, v & 255);
    const put = (a) => { for (const x of a) w.push(x); };
    if (nc < 0) {
      // composite: copy the component records; the box is always stored
      const start = compS.pos;
      let more = true, instr = false;
      while (more) {
        const f = compS.u16(); compS.u16();
        compS.bytes((f & 1 ? 4 : 2) + (f & 8 ? 2 : f & 0x40 ? 4 : f & 0x80 ? 8 : 0));
        if (f & 0x100) instr = true;
        more = !!(f & 0x20);
      }
      if (!box) throw bad('This WOFF2 file is damaged (a composite glyph has no bounding box).');
      const end = compS.pos;
      compS.pos = start;
      i16(-1); box.forEach(i16); put(compS.bytes(end - start));
      if (instr) { const len = glyphS.u255(); i16(len); put(instS.bytes(len)); }
    } else {
      const ends = [];
      let total = 0;
      for (let c = 0; c < nc; c++) { total += nPoints.u255(); ends.push(total - 1); }
      const pts = [];
      let x = 0, y = 0;
      for (let k = 0; k < total; k++) {
        const raw = flagS.u8();
        const on = !(raw >> 7), f = raw & 127;
        const sign = (flag, v) => (flag & 1 ? v : -v);
        let dx, dy;
        if (f < 10) { dx = 0; dy = sign(f, ((f & 14) << 7) + glyphS.u8()); }
        else if (f < 20) { dx = sign(f, (((f - 10) & 14) << 7) + glyphS.u8()); dy = 0; }
        else if (f < 84) { const b0 = f - 20, b1 = glyphS.u8(); dx = sign(f, 1 + (b0 & 0x30) + (b1 >> 4)); dy = sign(f >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)); }
        else if (f < 120) { const b0 = f - 84; dx = sign(f, 1 + (Math.floor(b0 / 12) << 8) + glyphS.u8()); dy = sign(f >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphS.u8()); }
        else if (f < 124) { const b1 = glyphS.u8(), b2 = glyphS.u8(); dx = sign(f, (b1 << 4) + (b2 >> 4)); dy = sign(f >> 1, ((b2 & 0x0f) << 8) + glyphS.u8()); }
        else { dx = sign(f, glyphS.u16()); dy = sign(f >> 1, glyphS.u16()); }
        x += dx; y += dy;
        pts.push([x, y, on]);
      }
      const ilen = glyphS.u255();
      if (!box) {
        box = [Infinity, Infinity, -Infinity, -Infinity];
        for (const [px, py] of pts) { box[0] = Math.min(box[0], px); box[1] = Math.min(box[1], py); box[2] = Math.max(box[2], px); box[3] = Math.max(box[3], py); }
      }
      i16(nc); box.forEach(i16); ends.forEach(i16); i16(ilen); put(instS.bytes(ilen));
      // flags and coordinates, short form where it fits (no repeat compression)
      const fl = [], xs = [], ys = [];
      let px = 0, py = 0;
      pts.forEach(([qx, qy, on], k) => {
        let f = on ? 1 : 0;
        if (k === 0 && overlap && overlap[i >> 3] & (0x80 >> (i & 7))) f |= 0x40;
        const ddx = qx - px, ddy = qy - py;
        if (ddx === 0) f |= 0x10; else if (Math.abs(ddx) < 256) { f |= 0x02 | (ddx > 0 ? 0x10 : 0); xs.push(Math.abs(ddx)); } else xs.push((ddx >> 8) & 255, ddx & 255);
        if (ddy === 0) f |= 0x20; else if (Math.abs(ddy) < 256) { f |= 0x04 | (ddy > 0 ? 0x20 : 0); ys.push(Math.abs(ddy)); } else ys.push((ddy >> 8) & 255, ddy & 255);
        fl.push(f); px = qx; py = qy;
      });
      put(fl); put(xs); put(ys);
    }
    while (w.length % 4) w.push(0);
    boxes.push({ xMin: box[0] });
    parts.push(Uint8Array.from(w));
    size += w.length;
  }
  lv.setUint32(numGlyphs * 4, size);
  const glyf = new Uint8Array(size);
  let o = 0;
  for (const part of parts) { glyf.set(part, o); o += part.length; }
  return { glyf, loca, boxes };
}

/** The transformed hmtx table back: left side bearings are the glyphs' x minimum. */
function rebuildHmtx(t, numGlyphs, numH, boxes) {
  const r = reader(t);
  const flags = r.u8();
  const adv = Array.from({ length: numH }, () => r.u16());
  const lsb = Array.from({ length: numH }, (_, i) => (flags & 1 ? boxes?.[i]?.xMin ?? 0 : r.i16()));
  const rest = Array.from({ length: numGlyphs - numH }, (_, i) => (flags & 2 ? boxes?.[numH + i]?.xMin ?? 0 : r.i16()));
  const out = new DataView(new ArrayBuffer(numH * 4 + (numGlyphs - numH) * 2));
  adv.forEach((a, i) => { out.setUint16(i * 4, a); out.setInt16(i * 4 + 2, lsb[i]); });
  rest.forEach((l, i) => out.setInt16(numH * 4 + i * 2, l));
  return new Uint8Array(out.buffer);
}

/** An sfnt file from its tables (sorted by tag, 4-byte aligned, with checksums). */
function sfnt(flavor, tables) {
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = tables.length;
  let size = 12 + n * 16;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  const pow = 2 ** Math.floor(Math.log2(n));
  v.setUint32(0, flavor); v.setUint16(4, n); v.setUint16(6, pow * 16); v.setUint16(8, Math.log2(pow)); v.setUint16(10, n * 16 - pow * 16);
  let off = 12 + n * 16;
  const sum = (from, len) => { let s = 0; for (let i = 0; i < len; i += 4) s = (s + v.getUint32(from + i)) >>> 0; return s; };
  tables.forEach((t, i) => {
    out.set(t.data, off);
    if (t.tag === 'head') v.setUint32(off + 8, 0); // checkSumAdjustment, set below
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k);
    v.setUint32(rec + 4, sum(off, (t.data.length + 3) & ~3)); v.setUint32(rec + 8, off); v.setUint32(rec + 12, t.data.length);
    t.at = off;
    off += (t.data.length + 3) & ~3;
  });
  const head = tables.find(t => t.tag === 'head');
  if (head) v.setUint32(head.at + 8, (0xb1b0afba - sum(0, size)) >>> 0);
  return out;
}
