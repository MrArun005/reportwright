// @ts-check
/**
 * Font subsetting with HarfBuzz (WASM). Works in the browser and in Node.
 * pdf-lib's own subsetter drops glyphs from some fonts (Inter), so we subset
 * first and embed the result without further subsetting.
 */

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_DROP_TABLE_TAG = 3;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
const tag = (s) => [...s].reduce((a, c) => (a << 8) + c.charCodeAt(0), 0) >>> 0;

/** @param {() => Promise<ArrayBuffer|Uint8Array>} loadWasm */
export function createSubsetter(loadWasm) {
  /** @type {Promise<any>|null} */
  let hbP = null;
  const hb = () => (hbP ||= (async () => {
    const bytes = await loadWasm();
    const { instance } = await WebAssembly.instantiate(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {});
    const x = /** @type {any} */ (instance.exports);
    x._initialize?.();
    return x;
  })());

  /**
   * @param {Uint8Array} font  TrueType bytes
   * @param {Iterable<number>} codePoints
   * @returns {Promise<Uint8Array>}
   */
  return async function subset(font, codePoints) {
    const x = await hb();
    const heap = () => new Uint8Array(x.memory.buffer);
    const input = x.hb_subset_input_create_or_fail();
    if (!input) throw new Error('HarfBuzz: no subset input');
    const buf = x.malloc(font.byteLength);
    heap().set(font, buf);
    const blob = x.hb_blob_create(buf, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
    const face = x.hb_face_create(blob, 0);
    x.hb_blob_destroy(blob);
    try {
      // No OpenType layout: the engine measures plain advances, so the PDF must not
      // apply substitutions such as Inter's contextual colon (calt) either.
      x.hb_set_clear(x.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG));
      const drop = x.hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG);
      for (const t of ['GSUB', 'GPOS', 'GDEF', 'kern', 'morx', 'mort']) x.hb_set_add(drop, tag(t));
      const uni = x.hb_subset_input_unicode_set(input);
      for (const cp of codePoints) x.hb_set_add(uni, cp);
      const sub = x.hb_subset_or_fail(face, input);
      if (!sub) throw new Error('HarfBuzz: subsetting failed');
      const res = x.hb_face_reference_blob(sub);
      const off = x.hb_blob_get_data(res, 0);
      const len = x.hb_blob_get_length(res);
      const out = heap().slice(off, off + len);
      x.hb_blob_destroy(res);
      x.hb_face_destroy(sub);
      if (!len) throw new Error('HarfBuzz: empty subset');
      return out;
    } finally {
      x.hb_subset_input_destroy(input);
      x.hb_face_destroy(face);
      x.free(buf);
    }
  };
}
