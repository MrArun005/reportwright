// The per-process PNG cache of exportPdf (src/exporters/pdf.js): bounded by entries and bytes, least recently used out,
// and a cached image gives the same bytes as a fresh decode.
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { render } from '../../src/engine/index.js';
import { exportPdf, pngCacheStats } from '../../src/exporters/pdf.js';
import { fontStore } from '../helpers.js';

/** an RGBA PNG of w×h, filled from seed (distinct seeds, distinct images) */
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = (x * 7 + y * 13 + seed * 31) & 255;
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const def = (src) => ({ $schema: 'pagewright/report@1', name: 'P', page: { size: 'A4' }, sections: { body: { items: [{ type: 'image', name: 'I', x: 0, y: 0, w: 100, h: 100, src, fit: 'fill' }] } } });
const pdf = async (src) => Buffer.from(await exportPdf(await render(def(src), { fontStore }), fontStore, { creationDate: new Date(0) }));

describe('PNG cache across exports', () => {
  it('stays under its entry and byte caps with many distinct images, and skips one too large', async () => {
    for (let i = 0; i < 40; i++) {
      await pdf(png(300, 300, i)); // ~0.7 MB held each
      const s = pngCacheStats();
      expect(s.entries).toBeLessThanOrEqual(s.maxEntries);
      expect(s.bytes).toBeLessThanOrEqual(s.maxBytes);
    }
    const before = pngCacheStats().bytes;
    await pdf(png(1100, 1000, 99)); // 4.4 MB of pixels: embedded, not held
    expect(pngCacheStats().bytes).toBeLessThanOrEqual(before + 0);
  }, 60000);

  it('a cached image gives the same PDF bytes as the first export', async () => {
    const src = png(64, 48, 1234);
    const a = await pdf(src), b = await pdf(src);
    expect(b.equals(a)).toBe(true);
  });
});
