// @ts-check
/**
 * Text shaping with HarfBuzz (public/fonts/harfbuzz.wasm, the build that ships with harfbuzzjs).
 * We call its C API directly instead of loading harfbuzzjs's Emscripten glue, so the same code runs in
 * Node, the browser and a Worker without bundler or Node-module tricks. HarfBuzz is also what Chrome and
 * Firefox shape with, so the browser draws the glyphs the engine measured.
 */

const LTR = 4, RTL = 5; // hb_direction_t
// features off for runs of simple scripts in a right-to-left context: same as the browser with
// font-kerning:none and font-variant-ligatures:none (the SVG root style)
const PLAIN = ['-kern', '-liga', '-clig', '-calt', '-dlig'];

/** @param {Uint8Array} wasm */
export async function createShaper(wasm) {
  /** @type {WebAssembly.Memory} */
  let memory;
  const { instance } = await WebAssembly.instantiate(wasm, {
    env: {
      _emscripten_runtime_keepalive_clear() {},
      _abort_js() { throw new Error('HarfBuzz stopped'); },
      _setitimer_js() { return 0; },
      emscripten_resize_heap(size) {
        const need = (size >>> 0) - memory.buffer.byteLength;
        try { memory.grow(Math.ceil(need / 65536)); return 1; } catch { return 0; }
      },
    },
    wasi_snapshot_preview1: { proc_exit(code) { throw new Error(`HarfBuzz exited (${code})`); } },
  });
  const x = /** @type {any} */ (instance.exports);
  memory = x.memory;
  x.__wasm_call_ctors();

  // features as hb_feature_t[] (16 bytes each), parsed once
  const featPtr = x.malloc(16 * PLAIN.length);
  PLAIN.forEach((f, i) => {
    const s = x.malloc(f.length + 1);
    new Uint8Array(memory.buffer).set([...f].map(c => c.charCodeAt(0)).concat(0), s);
    x.hb_feature_from_string(s, -1, featPtr + 16 * i);
    x.free(s);
  });

  return {
    /**
     * A HarfBuzz font for these bytes. It lives as long as the shaper: fonts are few and reused.
     * @param {Uint8Array} bytes @returns {{ ptr: number, upem: number }}
     */
    font(bytes) {
      const buf = x.malloc(bytes.byteLength);
      new Uint8Array(memory.buffer).set(bytes, buf);
      const blob = x.hb_blob_create(buf, bytes.byteLength, 1 /* read-only */, 0, 0);
      const face = x.hb_face_create(blob, 0);
      const ptr = x.hb_font_create(face); // scale = units per em: positions come back in font units
      const upem = x.hb_face_get_upem(face);
      x.hb_face_destroy(face);
      x.hb_blob_destroy(blob);
      return { ptr, upem };
    },
    /**
     * Shape one run (one font, one script, one direction).
     * @param {{ ptr: number }} font @param {string} text @param {boolean} rtl
     * @param {boolean} [plain] kerning and ligatures off (a simple-script run in a right-to-left context)
     * @returns {number[]} [glyph id, x advance, x offset, y offset, cluster (UTF-16 index)] per glyph, in visual order
     */
    shape(font, text, rtl, plain = false) {
      const n = text.length;
      const p = x.malloc(n * 2 + 2);
      const u16 = new Uint16Array(memory.buffer, p, n);
      for (let i = 0; i < n; i++) u16[i] = text.charCodeAt(i);
      const b = x.hb_buffer_create();
      x.hb_buffer_add_utf16(b, p, n, 0, n);
      x.hb_buffer_set_direction(b, rtl ? RTL : LTR);
      x.hb_buffer_guess_segment_properties(b); // script (and language) from the text
      x.hb_shape(font.ptr, b, plain ? featPtr : 0, plain ? PLAIN.length : 0);
      const len = x.hb_buffer_get_length(b);
      const info = new Uint32Array(memory.buffer, x.hb_buffer_get_glyph_infos(b, 0), len * 5);
      const pos = new Int32Array(memory.buffer, x.hb_buffer_get_glyph_positions(b, 0), len * 5);
      const out = new Array(len * 5);
      for (let i = 0; i < len; i++) {
        out[i * 5] = info[i * 5];          // glyph id
        out[i * 5 + 1] = pos[i * 5];       // x advance
        out[i * 5 + 2] = pos[i * 5 + 2];   // x offset
        out[i * 5 + 3] = pos[i * 5 + 3];   // y offset
        out[i * 5 + 4] = info[i * 5 + 2];  // cluster
      }
      x.hb_buffer_destroy(b);
      x.free(p);
      return out;
    },
  };
}
