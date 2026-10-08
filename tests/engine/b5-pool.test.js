// B5 item 12: @reportwright/engine/pool renders on worker threads and returns the file's bytes.
// Runs against the built package (npm run build:packages): the workers import @reportwright/engine by name.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const built = fs.existsSync('packages/engine/dist/index.js') && fs.existsSync('packages/engine/package.json');
const def = (n) => ({ $schema: 'pagewright/report@1', name: `R${n}`, page: { size: 'A4', margins: [36, 36, 36, 36] }, sections: { body: { items: [{ type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: `Report ${n}` }] } } });

describe.skipIf(!built)('createPool', () => {
  it('renders PDFs in parallel and returns bytes; a bad report rejects only its own render', async () => {
    const { createPool } = await import('../../packages/engine/pool/index.js');
    const pool = createPool({ workers: 2, fontsDir: path.resolve('public/fonts') });
    try {
      const pdfs = await Promise.all([1, 2, 3, 4].map(n => pool.render(def(n), { options: { subset: false } })));
      for (const b of pdfs) { expect(b).toBeInstanceOf(Uint8Array); expect(new TextDecoder().decode(b.subarray(0, 5))).toBe('%PDF-'); }
      await expect(pool.render({ $schema: 'pagewright/report@1', sections: {} })).rejects.toThrow(/no body section/);
      const csv = await pool.render({ ...def(5), dataSources: [{ name: 's', type: 'json', data: [{ a: 1 }] }], dataSets: [{ name: 'D', source: 's' }], sections: { body: { items: [{ type: 'table', x: 0, y: 0, w: 100, h: 20, dataSet: 'D', columns: [{ width: 100 }], detail: [{ cells: [{ value: '=Fields.a' }] }] }] } } }, { format: 'csv' });
      expect(new TextDecoder().decode(csv)).toMatch(/1/);
    } finally { await pool.close(); }
    await expect(pool.render(def(9))).rejects.toThrow(/closed/);
  }, 120000);

  it('heapMB and timeoutMs: a render past either fails alone, and the pool goes on', async () => {
    const { createPool } = await import('../../packages/engine/pool/index.js');
    // big renders in ~6 s on a warm worker; a cold replacement worker boots in ~1 s. timeoutMs is 2 s, so the render after the
    // timeout (on a fresh worker) is not cut by boot time under load, while the big one stays far past the budget.
    const big = { ...def(7), dataSources: [{ name: 's', type: 'json', data: Array.from({ length: 150000 }, (_, i) => ({ a: i, b: `row ${i} ${'x'.repeat(40)}` })) }], dataSets: [{ name: 'D', source: 's' }],
      sections: { body: { items: [{ type: 'table', x: 0, y: 0, w: 300, h: 20, dataSet: 'D', columns: [{ width: 100 }, { width: 200 }], detail: [{ cells: [{ value: '=Fields.a' }, { value: '=Fields.b' }] }] }] } } };
    const pool = createPool({ workers: 1, fontsDir: path.resolve('public/fonts'), heapMB: 64 });
    try {
      await expect(pool.render(big, { options: { subset: false } })).rejects.toThrow(/memory/i);
      expect(new TextDecoder().decode((await pool.render(def(1), { options: { subset: false } })).subarray(0, 5))).toBe('%PDF-');
    } finally { await pool.close(); }
    const slow = createPool({ workers: 1, fontsDir: path.resolve('public/fonts'), timeoutMs: 2000 });
    try {
      await expect(slow.render(big, { options: { subset: false } })).rejects.toMatchObject({ status: 504 });
      expect(new TextDecoder().decode((await slow.render(def(2), { options: { subset: false } })).subarray(0, 5))).toBe('%PDF-');
    } finally { await slow.close(); }
    expect(() => createPool({ heapMB: 1 })).toThrow(/heapMB/);
  }, 120000);
});
