// P0: a truncated or corrupt PNG must never hang the PDF export (pdf-lib's UPNG loops on cut data).
import { describe, it, expect } from 'vitest';
import { exportPdf } from '../../src/exporters/pdf.js';
import { pngProblem } from '../../src/exporters/png.js';
import { fontStore } from '../helpers.js';
import { png } from './png-fixture.js';

const uri = (b) => `data:image/png;base64,${Buffer.from(b).toString('base64')}`;
const model = (src) => ({ pages: [{ width: 200, height: 200, items: [{ t: 'image', x: 0, y: 0, w: 50, h: 50, src, fit: 'contain' }] }] });
const full = png(64, 64);
const bad = {
  'cut file': full.subarray(0, full.length - 40),
  'cut IDAT (CRC fixed)': png(64, 64, { cutIdat: 30 }),
  'no IEND': full.subarray(0, full.length - 12),
  'bad CRC': (() => { const b = full.slice(); b[40] ^= 0xff; return b; })(),
  'signature only': full.subarray(0, 8),
};

describe('P0: PNGs are checked before pdf-lib decodes them', () => {
  it('a valid PNG passes and is embedded', async () => {
    expect(pngProblem(full)).toBe(null);
    const pdf = await exportPdf(model(uri(full)), fontStore);
    expect(Buffer.from(pdf).includes(Buffer.from('/Subtype /Image'))).toBe(true);
  });
  for (const [name, b] of Object.entries(bad)) {
    it(`${name}: refused with a reason, the export finishes without the image and warns`, async () => {
      expect(pngProblem(b)).toMatch(/./);
      const warnings = [];
      const t = Date.now();
      const pdf = await exportPdf(model(uri(b)), fontStore, { onWarning: (w) => warnings.push(w) });
      expect(Date.now() - t).toBeLessThan(5000);
      expect(Buffer.from(pdf).includes(Buffer.from('/Subtype /Image'))).toBe(false);
      expect(warnings.join(' ')).toMatch(/PNG/);
    }, 10000);
  }
  it('timeoutMs bounds every export (an image fetch that never answers)', async () => {
    const m = model('https://img.example/never.png');
    const never = () => new Promise(() => {});
    await expect(exportPdf(m, fontStore, { timeoutMs: 200, fetchImage: never })).rejects.toMatchObject({ status: 504 });
    const { withDeadline } = await import('../../src/exporters/deadline.js');
    await expect(withDeadline(never(), 50)).rejects.toMatchObject({ status: 504 });
    await expect(withDeadline(Promise.resolve(1), 50)).resolves.toBe(1);
    // the other exporters take it too (a quick export finishes as before)
    for (const mod of ['docx', 'pptx', 'xlsx']) {
      const fn = (await import(`../../src/exporters/${mod}.js`))[`export${mod[0].toUpperCase()}${mod.slice(1)}`];
      expect(await fn({ pages: [{ width: 100, height: 100, items: [] }] }, { timeoutMs: 5000 })).toBeTruthy();
    }
  });
});

describe('P0: the PNG check is bounded itself', () => {
  it('a 20000×20000 header is refused before anything is inflated', async () => {
    const { png: make } = await import('./png-fixture.js');
    const b = make(4, 4).slice();
    const v = new DataView(b.buffer); v.setUint32(16, 20000); v.setUint32(20, 20000);
    // fix the IHDR CRC so only the size is wrong
    const { pngProblem: p } = await import('../../src/exporters/png.js');
    const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    let c = 0xffffffff; for (let i = 12; i < 29; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8);
    v.setUint32(29, (c ^ 0xffffffff) >>> 0);
    const t = Date.now();
    expect(p(b)).toMatch(/MP/);
    expect(Date.now() - t).toBeLessThan(50);
  });
  it('IDAT that inflates past what the header promises is refused (a bomb stops early)', async () => {
    const { zlibSync } = await import('fflate');
    const { chunkPng } = await import('./png-fixture.js');
    const bomb = chunkPng(16, 16, [zlibSync(new Uint8Array(50 * 1048576))]);
    const t = Date.now();
    expect(pngProblem(bomb)).toMatch(/larger than its header/);
    expect(Date.now() - t).toBeLessThan(1000);
  });
  it('thousands of tiny chunks are refused', async () => {
    const { zlibSync } = await import('fflate');
    const { chunkPng } = await import('./png-fixture.js');
    const z = zlibSync(new Uint8Array(4 * (1 + 4 * 3)));
    const parts = [z, ...Array.from({ length: 5000 }, () => new Uint8Array(0))];
    expect(pngProblem(chunkPng(4, 4, parts))).toMatch(/chunks/);
  });
});
