// @ts-check
/**
 * PNG checks before pdf-lib decodes a PNG: its decoder (UPNG) loops forever on some cut or corrupt files, and a
 * render worker stuck in it never answers. Every chunk is walked with its length in bounds and its CRC right, IHDR
 * first, IDAT present, IEND last; the IDAT data must inflate to exactly the bytes the header promises.
 */
import { Unzlib } from 'fflate';

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
/** @param {Uint8Array} b @param {number} from @param {number} to */
function crc32(b, from, to) {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Bytes of the filtered scanlines of a w×h image (with the filter byte per line). */
function rawBytes(w, h, bits, interlace) {
  const line = (pw) => (pw > 0 ? 1 + Math.ceil(pw * bits / 8) : 0);
  if (!interlace) return h * line(w);
  // Adam7: 7 passes, each a sub-image
  let n = 0;
  for (const [x0, y0, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw > 0 && ph > 0) n += ph * line(pw);
  }
  return n;
}

/**
 * Why a PNG cannot be embedded, or null when it can.
 * @param {Uint8Array} b @returns {string|null}
 */
export function pngProblem(b) {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 8 || SIG.some((x, i) => b[i] !== x)) return 'not a PNG';
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  let off = 8, ihdr = null, idat = [], end = false, first = true;
  while (off < b.length) {
    if (off + 12 > b.length) return 'the file is cut short';
    const len = u32(off);
    if (off + 12 + len > b.length) return 'the file is cut short';
    const t = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
    if (crc32(b, off + 4, off + 8 + len) !== u32(off + 8 + len)) return `the ${t} chunk is damaged (CRC)`;
    const d = off + 8;
    if (first && t !== 'IHDR') return 'IHDR is not first';
    first = false;
    if (t === 'IHDR') {
      if (ihdr || len !== 13) return 'a bad IHDR';
      ihdr = { w: u32(d), h: u32(d + 4), depth: b[d + 8], color: b[d + 9], interlace: b[d + 12] };
    } else if (t === 'IDAT') idat.push(b.subarray(d, d + len));
    else if (t === 'IEND') { end = true; break; }
    off = d + len + 4;
  }
  if (!ihdr) return 'no IHDR';
  if (!idat.length) return 'no image data (IDAT)';
  if (!end) return 'no IEND: the file is cut short';
  const ch = CHANNELS[ihdr.color];
  if (!ch || ![1, 2, 4, 8, 16].includes(ihdr.depth) || ihdr.w < 1 || ihdr.h < 1 || ihdr.interlace > 1) return 'an unsupported PNG header';
  const want = rawBytes(ihdr.w, ihdr.h, ch * ihdr.depth, ihdr.interlace);
  // inflate as a stream, counting: a bomb stops as soon as it passes what the header promises
  let got = 0, over = false, failed = false;
  const z = new Unzlib((chunk) => { got += chunk.length; if (got > want) over = true; });
  try {
    for (let i = 0; i < idat.length && !over; i++) z.push(idat[i], i === idat.length - 1);
  } catch { failed = true; }
  if (failed) return 'the image data does not inflate';
  if (over) return 'the image data is larger than its header says';
  if (got !== want) return 'the image data is cut short';
  return null;
}
