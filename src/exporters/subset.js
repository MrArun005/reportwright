// @ts-check
/**
 * Font subsetting with HarfBuzz (WASM). Works in the browser and in Node.
 * pdf-lib's own subsetter drops glyphs from some fonts (Inter), so we subset
 * first and embed the result without further subsetting.
 */

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_DROP_TABLE_TAG = 3;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
const HB_SUBSET_FLAGS_RETAIN_GIDS = 2;
const HB_SUBSET_FLAGS_NOTDEF_OUTLINE = 0x40;
const tag = (s) => [...s].reduce((a, c) => (a << 8) + c.charCodeAt(0), 0) >>> 0;

/** CSS weight names by weight class: the name a variable face cut at that weight says it is. */
const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const WEIGHT_WORD = /\b(Thin|ExtraLight|UltraLight|Light|Regular|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy)\b/i;

/** bytes as one char each (tags, Mac name strings); a loop instead of spreading into a call (r5-fixes R5 #3) */
const chars = (b) => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };

/**
 * The tables of a single-face sfnt (TrueType or CFF) as a Map of tag to bytes. A collection (ttcf) gives an empty map.
 * @param {Uint8Array} bytes
 */
export function sfntTables(bytes) {
  const t = new Map();
  if (bytes.length < 12 || chars(bytes.subarray(0, 4)) === 'ttcf') return t;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const p = 12 + i * 16;
    const off = dv.getUint32(p + 8), len = dv.getUint32(p + 12);
    t.set(chars(bytes.subarray(p, p + 4)), bytes.subarray(off, off + len));
  }
  return t;
}

/** A sfnt from its tables: directory, 4-byte padding, table checksums and the head checkSumAdjustment. */
export function buildSfnt(version, tables) {
  const tags = [...tables.keys()].sort();
  const n = tags.length, pow = 2 ** Math.floor(Math.log2(n));
  const offs = new Map();
  let total = 12 + 16 * n;
  for (const tg of tags) { offs.set(tg, total); total += (tables.get(tg).length + 3) & ~3; }
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  out.set(version.subarray ? version.subarray(0, 4) : [0, 1, 0, 0], 0);
  dv.setUint16(4, n); dv.setUint16(6, pow * 16); dv.setUint16(8, Math.log2(pow)); dv.setUint16(10, n * 16 - pow * 16);
  tags.forEach((tg, i) => {
    const p = 12 + 16 * i, data = tables.get(tg), o = offs.get(tg);
    for (let k = 0; k < 4; k++) out[p + k] = tg.charCodeAt(k);
    out.set(data, o);
    dv.setUint32(p + 4, tableSum(out, o, (data.length + 3) & ~3));
    dv.setUint32(p + 8, o); dv.setUint32(p + 12, data.length);
  });
  if (offs.has('head')) { const h = offs.get('head') + 8; dv.setUint32(h, 0); dv.setUint32(h, (0xB1B0AFBA - tableSum(out, 0, out.length)) >>> 0); }
  return out;
}
const tableSum = (b, o, len) => { const dv = new DataView(b.buffer, b.byteOffset + o, len); let s = 0; for (let i = 0; i < len; i += 4) s = (s + dv.getUint32(i)) >>> 0; return s; };

/**
 * The name table with the given strings replaced (nameID to text). Each replaced string is written in its record's own
 * encoding: UTF-16BE for Windows and Unicode, one byte per character for Macintosh.
 * @param {Uint8Array} name
 * @param {Map<number, string>} strings
 */
export function setNameStrings(name, strings) {
  const dv = new DataView(name.buffer, name.byteOffset, name.byteLength);
  const count = dv.getUint16(2), store = dv.getUint16(4);
  const recs = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + 12 * i;
    const platform = dv.getUint16(p), id = dv.getUint16(p + 6), len = dv.getUint16(p + 8), off = store + dv.getUint16(p + 10);
    const rec = { platform, enc: dv.getUint16(p + 2), lang: dv.getUint16(p + 4), id, raw: name.subarray(off, off + len) };
    if (strings.has(id)) {
      const s = strings.get(id);
      rec.raw = platform === 1 ? Uint8Array.from(s, c => c.charCodeAt(0) & 0xff) : utf16(s);
    }
    recs.push(rec);
  }
  const size = 6 + 12 * count + recs.reduce((a, r) => a + r.raw.length, 0);
  const out = new Uint8Array(size), o = new DataView(out.buffer);
  o.setUint16(0, 0); o.setUint16(2, count); o.setUint16(4, 6 + 12 * count);
  let at = 6 + 12 * count;
  recs.forEach((r, i) => {
    const p = 6 + 12 * i;
    o.setUint16(p, r.platform); o.setUint16(p + 2, r.enc); o.setUint16(p + 4, r.lang); o.setUint16(p + 6, r.id);
    o.setUint16(p + 8, r.raw.length); o.setUint16(p + 10, at - (6 + 12 * count));
    out.set(r.raw, at); at += r.raw.length;
  });
  return out;
}
const utf16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[2 * i] = s.charCodeAt(i) >> 8; b[2 * i + 1] = s.charCodeAt(i) & 0xff; } return b; };

/**
 * A variable font cut at one weight says that weight: the family, subfamily, full and PostScript names, the typographic
 * names and usWeightClass. The family keeps its name (a default "Noto Sans JP Thin" becomes "Noto Sans JP").
 * @param {Map<string, Uint8Array>} tables  changed in place
 * @param {number} weight
 */
function renameForWeight(tables, weight) {
  const word = WEIGHT_NAMES[weight] || 'Regular';
  const nm = tables.get('name');
  if (nm) {
    const dv = new DataView(nm.buffer, nm.byteOffset, nm.byteLength);
    const get = (id) => {
      const count = dv.getUint16(2), store = dv.getUint16(4);
      for (let i = 0; i < count; i++) {
        const p = 6 + 12 * i;
        if (dv.getUint16(p + 6) !== id) continue;
        const platform = dv.getUint16(p), len = dv.getUint16(p + 8), off = store + dv.getUint16(p + 10);
        const b = nm.subarray(off, off + len);
        if (platform === 1) return chars(b);
        let s = ''; for (let k = 0; k + 1 < b.length; k += 2) s += String.fromCharCode((b[k] << 8) | b[k + 1]);
        return s;
      }
      return null;
    };
    const family = (get(16) ?? get(1) ?? '').replace(new RegExp(`\\s*\\b(${Object.values(WEIGHT_NAMES).join('|')})$`, 'i'), '').trim() || get(1) || 'Font';
    const ps = get(6)?.replace(/-(\w+)$/, '') || family.replace(/\s+/g, '');
    const strings = new Map([
      [1, family], [2, word], [3, (get(3) ?? '').replace(WEIGHT_WORD, word)], [4, `${family} ${word}`],
      [6, `${ps}-${word}`], [16, family], [17, word],
    ]);
    tables.set('name', setNameStrings(nm, strings));
  }
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 6) {
    const copy = os2.slice();
    new DataView(copy.buffer).setUint16(4, weight);
    tables.set('OS/2', copy);
  }
}

/** @param {() => Promise<ArrayBuffer|Uint8Array>} loadWasm */
export function createSubsetter(loadWasm) {
  /** @type {Promise<any>|null} */
  let hbP = null;
  const hb = () => (hbP ||= (async () => {
    const bytes = await loadWasm();
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // Node: compiled synchronously, which V8 does lazily (each function when first called). The async compile also
    // optimizes the whole module in the background, and a cold process then waited ~140 ms for it before its first
    // PDF was written (measured: 1-page invoice export 175 ms → 35 ms). Browsers keep the async compile (a large
    // synchronous one is refused on the main thread).
    const src = /** @type {any} */ (u8);
    const instance = /** @type {any} */ (globalThis).process?.versions?.node
      ? new WebAssembly.Instance(new WebAssembly.Module(src), {})
      : (await WebAssembly.instantiate(src, {})).instance;
    const x = /** @type {any} */ (instance.exports);
    x._initialize?.();
    return x;
  })());

  /**
   * @param {Uint8Array} font  TrueType or OpenType (CFF) bytes
   * @param {Iterable<number>} codePoints
   * @param {{ glyphs?: Iterable<number>, layout?: boolean, weight?: number }} [opt]
   *   glyphs: shaped glyphs to keep as well (conjuncts, joined Arabic forms); their IDs stay the same, because
   *   the PDF draws them by ID. layout: keep GSUB/GPOS for a browser that shapes the text itself (HTML export).
   *   weight: the wght axis of a variable font (default 400, Regular); static fonts have no such axis and are unchanged.
   * @returns {Promise<Uint8Array>}
   */
  return async function subset(font, codePoints, opt = {}) {
    const x = await hb();
    const heap = () => new Uint8Array(x.memory.buffer);
    const variable = sfntTables(font).has('fvar'); // a variable font is renamed for the weight it is cut at
    const input = x.hb_subset_input_create_or_fail();
    if (!input) throw new Error('HarfBuzz: no subset input');
    const buf = x.malloc(font.byteLength);
    heap().set(font, buf);
    const blob = x.hb_blob_create(buf, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
    const face = x.hb_face_create(blob, 0);
    x.hb_blob_destroy(blob);
    try {
      if (!opt.layout) {
        // No OpenType layout: the engine measures plain advances (or shaped the text already), so the PDF
        // must not apply substitutions such as Inter's contextual colon (calt) either.
        x.hb_set_clear(x.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG));
        const drop = x.hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG);
        for (const t of ['GSUB', 'GPOS', 'GDEF', 'kern', 'morx', 'mort']) x.hb_set_add(drop, tag(t));
      }
      // keep the .notdef box: a character no font has draws as a box, not as nothing (a CJK report without CJK fonts)
      x.hb_subset_input_set_flags(input, x.hb_subset_input_get_flags(input) | HB_SUBSET_FLAGS_NOTDEF_OUTLINE);
      const uni = x.hb_subset_input_unicode_set(input);
      for (const cp of codePoints) x.hb_set_add(uni, cp);
      if (opt.glyphs) {
        x.hb_subset_input_set_flags(input, x.hb_subset_input_get_flags(input) | HB_SUBSET_FLAGS_RETAIN_GIDS);
        const gs = x.hb_subset_input_glyph_set(input);
        for (const g of opt.glyphs) x.hb_set_add(gs, g);
      }
      x.hb_subset_input_pin_all_axes_to_default(input, face); // a variable font becomes its default instance...
      // ...except weight: the default of a variable CJK face is Thin (wght 100), so it is cut at Regular (or opt.weight)
      x.hb_subset_input_pin_axis_location(input, face, tag('wght'), opt.weight ?? 400);
      const sub = x.hb_subset_or_fail(face, input);
      if (!sub) throw new Error('HarfBuzz: subsetting failed');
      const res = x.hb_face_reference_blob(sub);
      const off = x.hb_blob_get_data(res, 0);
      const len = x.hb_blob_get_length(res);
      let out = heap().slice(off, off + len);
      x.hb_blob_destroy(res);
      x.hb_face_destroy(sub);
      if (!len) throw new Error('HarfBuzz: empty subset');
      if (variable) { // the instance is pinned: its variation tables go, and the names say the weight it is
        const t = sfntTables(out);
        for (const tg of ['fvar', 'gvar', 'avar', 'cvar', 'HVAR', 'MVAR', 'STAT']) t.delete(tg);
        renameForWeight(t, opt.weight ?? 400);
        out = buildSfnt(out, t);
      }
      return out;
    } finally {
      x.hb_subset_input_destroy(input);
      x.hb_face_destroy(face);
      x.free(buf);
    }
  };
}
