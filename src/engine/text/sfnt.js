// @ts-check
/**
 * A TrueType/OpenType font read straight from its tables, for the part of fontkit's font API that laying out and
 * writing a Latin report reads: unitsPerEm, ascent, descent, capHeight, xHeight, italicAngle, bbox, postscriptName,
 * hasGlyphForCodePoint, glyphForCodePoint(cp) and getGlyph(id) with id and advanceWidth, directory.tables. Anything
 * else (layout, glyph paths, the OS/2 and post tables…) is fontkit's, parsed on first use, so callers see one font.
 * Why: loading and evaluating fontkit is about 30 ms of a cold start, and fontkit's advanceWidth decodes each glyph's
 * outline header; a report in Latin text needs neither. The values are fontkit's, read the same way (cmap subtable
 * order, format 4 and 12 lookups, hmtx past numberOfHMetrics). A font this does not cover (no format 4/12 Unicode
 * cmap, a variable, sbix or COLR font) is fontkit's from the start: liteFont returns null.
 */

const u16 = (/** @type {DataView} */ v, /** @type {number} */ o) => v.getUint16(o);
const i16 = (/** @type {DataView} */ v, /** @type {number} */ o) => v.getInt16(o);

/** fontkit's Unicode cmap subtables, in its order of preference */
const CMAP_ORDER = [[3, 10], [0, 6], [0, 4], [3, 1], [0, 3], [0, 2], [0, 1], [0, 0]];

/**
 * @param {Uint8Array} bytes the font file
 * @param {() => any} full the fontkit font of the same bytes (made on first call)
 * @returns {any} a fontkit-like font, or null when fontkit must read this font
 */
export function liteFont(bytes, full) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = u16(dv, 0) === 0x4f54 ? 'OTTO' : dv.getUint32(0);
    if (tag !== 0x00010000 && tag !== 0x74727565 && tag !== 'OTTO') return null; // a collection, WOFF…: fontkit
    /** @type {Record<string, { offset: number, length: number }>} */
    const tables = {};
    for (let i = 0, n = u16(dv, 4); i < n; i++) {
      const p = 12 + 16 * i;
      const t = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
      tables[t] = { offset: dv.getUint32(p + 8), length: dv.getUint32(p + 12) };
    }
    if (!tables.head || !tables.hhea || !tables.hmtx || !tables.maxp || !tables.cmap || !tables.post || !tables.name) return null;
    if (tables.fvar || tables.sbix || (tables.COLR && tables.CPAL)) return null; // variations, bitmap and colour glyphs: fontkit
    const head = tables.head.offset, hhea = tables.hhea.offset, hmtx = tables.hmtx.offset, post = tables.post.offset;
    const os2 = tables['OS/2'] ? tables['OS/2'].offset : -1, os2v = os2 >= 0 ? u16(dv, os2) : -1;
    const numGlyphs = u16(dv, tables.maxp.offset + 4), nhm = u16(dv, hhea + 34);
    if (!nhm) return null;
    const lookup = cmapLookup(dv, tables.cmap.offset);
    if (!lookup) return null;
    const ps = postscriptName(dv, tables.name.offset);
    if (ps === undefined) return null;
    const advance = (/** @type {number} */ id) => u16(dv, hmtx + 4 * (id < nhm ? id : nhm - 1));
    /** @type {Map<number, any>} */
    const glyphs = new Map();
    /** fontkit keeps the first glyph object made for an ID (and the code points it was asked with) */
    const getGlyph = (/** @type {number} */ id, /** @type {number[]} */ codePoints = []) => {
      let g = glyphs.get(id);
      if (!g) {
        const own = { id, advanceWidth: advance(id), codePoints };
        g = new Proxy(own, { get: (t, p) => (p in t || typeof p === 'symbol' ? /** @type {any} */ (t)[p] : bound(full().getGlyph(id, codePoints), p)) });
        glyphs.set(id, g);
      }
      return g;
    };
    const ascent = i16(dv, hhea + 4);
    const own = {
      standard: undefined,
      then: undefined, // not a thenable: awaiting a font never parses it
      lite: true,
      unitsPerEm: u16(dv, head + 18),
      ascent,
      descent: i16(dv, hhea + 6),
      capHeight: os2 < 0 ? ascent : os2v >= 2 ? i16(dv, os2 + 88) : undefined,
      xHeight: os2 < 0 ? 0 : os2v >= 2 ? i16(dv, os2 + 86) : undefined,
      italicAngle: dv.getInt32(post + 4) / 65536,
      bbox: Object.freeze({ minX: i16(dv, head + 36), minY: i16(dv, head + 38), maxX: i16(dv, head + 40), maxY: i16(dv, head + 42),
        get width() { return this.maxX - this.minX; }, get height() { return this.maxY - this.minY; } }),
      postscriptName: ps,
      numGlyphs,
      directory: { tables },
      /** fsType's no-subsetting bit and post's isFixedPitch, without parsing those tables in fontkit */
      noSubsetting: os2 >= 0 && (u16(dv, os2 + 8) & 0x100) !== 0,
      fixedPitch: dv.getUint32(post + 12) !== 0,
      hasGlyphForCodePoint: (/** @type {number} */ cp) => !!lookup(cp),
      glyphForCodePoint: (/** @type {number} */ cp) => getGlyph(lookup(cp), [cp]),
      getGlyph,
    };
    return new Proxy(own, { get: (t, p) => (p in t || typeof p === 'symbol' ? /** @type {any} */ (t)[p] : bound(full(), p)) });
  } catch { return null; }
}

/**
 * Why a subset cannot be embedded, or '' when it can: its table directory and every table lie inside the bytes, each
 * glyph's loca range is in order and inside glyf, and a CFF table's header and first INDEXes are in bounds. A cut or
 * damaged subset would otherwise reach the PDF (fontkit and sfnt.js read past a short buffer without complaint).
 * @param {Uint8Array} bytes the subset, before any padding
 */
export function subsetProblem(bytes) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), len = bytes.byteLength;
    const v = dv.getUint32(0);
    if (v !== 0x00010000 && v !== 0x74727565 && v !== 0x4f54544f) return 'not a TrueType or OpenType font';
    const n = u16(dv, 4);
    if (12 + 16 * n > len) return 'its table directory runs past the end';
    /** @type {Record<string, { offset: number, length: number }>} */
    const t = {};
    for (let i = 0; i < n; i++) {
      const p = 12 + 16 * i, tag = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
      t[tag] = { offset: dv.getUint32(p + 8), length: dv.getUint32(p + 12) };
      if (t[tag].offset + t[tag].length > len) return `its ${tag.trim()} table runs past the end`;
    }
    if (t.glyf || t.loca) {
      if (!t.glyf || !t.loca || !t.head || !t.maxp) return 'glyf, loca, head or maxp is missing';
      const numGlyphs = u16(dv, t.maxp.offset + 4), long = i16(dv, t.head.offset + 50) === 1, size = long ? 4 : 2;
      if (t.loca.length < (numGlyphs + 1) * size) return 'loca is short';
      let prev = 0;
      for (let k = 0; k <= numGlyphs; k++) {
        const at = long ? dv.getUint32(t.loca.offset + 4 * k) : 2 * u16(dv, t.loca.offset + 2 * k);
        if (at < prev || at > t.glyf.length) return `glyph ${k - 1} lies outside glyf`;
        prev = at;
      }
    }
    const cff = t['CFF '] || t.CFF2;
    if (cff) {
      const o = cff.offset, major = bytes[o], hdr = bytes[o + 2];
      if (cff.length < 4 || (t['CFF '] ? major !== 1 : major !== 2) || hdr < 4 || hdr > cff.length) return 'its CFF header is damaged';
      if (t['CFF ']) { // the Name and Top DICT INDEXes: count, offSize, offsets, data inside the table
        let p = o + hdr;
        for (let i = 0; i < 2; i++) {
          const count = u16(dv, p);
          if (!count) { p += 2; continue; }
          const os = bytes[p + 2], last = p + 3 + count * os;
          if (os < 1 || os > 4 || last + os > o + cff.length) return 'its CFF INDEX runs past the table';
          let end = 0;
          for (let b = 0; b < os; b++) end = end * 256 + bytes[last + b];
          p = last + os - 1 + end;
          if (p > o + cff.length) return 'its CFF INDEX runs past the table';
        }
      }
    }
    return '';
  } catch { return 'it could not be read'; }
}

/** @param {any} o @param {string|symbol} p */
const bound = (o, p) => { const v = o[p]; return typeof v === 'function' ? v.bind(o) : v; };

/**
 * The code point → glyph ID lookup of fontkit's preferred Unicode subtable, when it is format 4 or 12; else null.
 * @param {DataView} dv @param {number} cmap
 * @returns {((cp: number) => number) | null}
 */
function cmapLookup(dv, cmap) {
  const n = u16(dv, cmap + 2);
  let at = -1;
  for (const [pid, eid] of CMAP_ORDER) {
    for (let i = 0; i < n && at < 0; i++) {
      const r = cmap + 4 + 8 * i;
      if (u16(dv, r) === pid && u16(dv, r + 2) === eid) at = cmap + dv.getUint32(r + 4);
    }
    if (at >= 0) break;
  }
  if (at < 0) return null;
  const format = u16(dv, at);
  if (format === 4) {
    const segCount = u16(dv, at + 6) / 2, ends = at + 14, starts = ends + 2 * segCount + 2, deltas = starts + 2 * segCount, ranges = deltas + 2 * segCount;
    const glyphArray = ranges + 2 * segCount, end = at + u16(dv, at + 2);
    return (cp) => {
      let min = 0, max = segCount - 1;
      while (min <= max) {
        const mid = (min + max) >> 1;
        if (cp < u16(dv, starts + 2 * mid)) max = mid - 1;
        else if (cp > u16(dv, ends + 2 * mid)) min = mid + 1;
        else {
          const rangeOffset = u16(dv, ranges + 2 * mid), delta = i16(dv, deltas + 2 * mid);
          let gid;
          if (rangeOffset === 0) gid = cp + delta;
          else {
            const index = rangeOffset / 2 + (cp - u16(dv, starts + 2 * mid)) - (segCount - mid);
            const p = glyphArray + 2 * index;
            gid = index >= 0 && p + 2 <= end ? u16(dv, p) : 0;
            if (gid !== 0) gid += delta;
          }
          return gid & 0xffff;
        }
      }
      return 0;
    };
  }
  if (format === 12) {
    const nGroups = dv.getUint32(at + 12), groups = at + 16;
    return (cp) => {
      let min = 0, max = nGroups - 1;
      while (min <= max) {
        const mid = (min + max) >> 1, g = groups + 12 * mid;
        if (cp < dv.getUint32(g)) max = mid - 1;
        else if (cp > dv.getUint32(g + 4)) min = mid + 1;
        else return dv.getUint32(g + 8) + (cp - dv.getUint32(g));
      }
      return 0;
    };
  }
  return null;
}

/**
 * fontkit's postscriptName: the last English (Macintosh 0 or Windows 0x409) record of name ID 6, or null when there is
 * none; undefined when a record needs a decoding this does not do (Macintosh text outside ASCII).
 * @param {DataView} dv @param {number} name
 * @returns {string|null|undefined}
 */
function postscriptName(dv, name) {
  const count = u16(dv, name + 2), store = name + u16(dv, name + 4);
  /** @type {string|null|undefined} */
  let out = null;
  for (let i = 0; i < count; i++) {
    const r = name + 6 + 12 * i;
    const pid = u16(dv, r), lang = u16(dv, r + 4), id = u16(dv, r + 6), len = u16(dv, r + 8), off = store + u16(dv, r + 10);
    if (id !== 6) continue;
    if (pid === 1 && lang === 0) {
      let s = '';
      for (let k = 0; k < len; k++) { const c = dv.getUint8(off + k); if (c >= 0x80) return undefined; s += String.fromCharCode(c); }
      out = s;
    } else if (pid === 3 && lang === 0x409) {
      let s = '';
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(u16(dv, off + k));
      out = s;
    }
  }
  return out;
}
