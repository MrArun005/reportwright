// A tiny RGB PNG built in code (for the PNG validation tests), optionally with its IDAT data cut short.
import { zlibSync } from 'fflate';
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const o = new Uint8Array(12 + d.length); const v = new DataView(o.buffer); v.setUint32(0, d.length); o.set(new TextEncoder().encode(t), 4); o.set(d, 8); v.setUint32(8 + d.length, crc(o.subarray(4, 8 + d.length))); return o; };
export function png(w, h, { cutIdat = 0 } = {}) {
  const raw = new Uint8Array(h * (1 + w * 3)); for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) & 255; for (let y = 0; y < h; y++) raw[y * (1 + w * 3)] = 0;
  let z = zlibSync(raw); if (cutIdat) z = z.subarray(0, z.length - cutIdat);
  const ih = new Uint8Array(13); const v = new DataView(ih.buffer); v.setUint32(0, w); v.setUint32(4, h); ih[8] = 8; ih[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', z), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
