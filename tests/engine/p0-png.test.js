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
