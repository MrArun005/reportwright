// bulk(): named tasks over many files in worker threads; one bad file never stops the batch.
import { describe, it, expect } from 'vitest';
import { bulk, BULK_TASKS, toBytes, loadPdf } from '../../packages/pdf/src/index.js';

const doc = (label, pages = 2) => toBytes(async (pdf) => {
  const f = pdf.standardFont('Helvetica');
  for (let p = 0; p < pages; p++) { const pg = pdf.addPage(); pg.text(`${label} page ${p + 1}`, { x: 40, y: 40, font: f, size: 12 }); await pg.end(); }
});
const junk = new Uint8Array([1, 2, 3]);

describe('bulk', () => {
  it('runs each task in workers, results in input order, a bad file failing alone', async () => {
    const a = await doc('Alpha'), b = await doc('Beta', 3);
    const text = await bulk([a, junk, b], 'extractText', { workers: 2 });
    expect(text.map((r) => r.ok)).toEqual([true, false, true]);
    expect(text[0].value).toBe('Alpha page 1\fAlpha page 2');
    expect(text[1].error.code).toBe('E_MALFORMED');
    const split = await bulk([b], 'split', { workers: 2 });
    expect(split[0].value).toHaveLength(3);
    expect((await loadPdf(split[0].value[2])).extractText()).toBe('Beta page 3');
    const merged = await bulk([[a, b], [a, junk]], 'merge', { workers: 2 });
    expect((await loadPdf(merged[0].value)).pageCount).toBe(5);
    expect(merged[1].ok).toBe(false);
    const enc = await bulk([a, b], 'encrypt', { workers: 2, encrypt: { userPassword: 'u', ownerPassword: 'o' } });
    await expect(loadPdf(enc[0].value)).rejects.toThrow();
    expect((await loadPdf(enc[1].value, { password: 'u' })).pageCount).toBe(3);
  }, 30000);
  it('runs sequentially in-process with one worker (the browser path) with the same results', async () => {
    const a = await doc('Solo');
    const r = await bulk([junk, a], 'extractText', { workers: 1 });
    expect(r[0].ok).toBe(false); expect(r[1].value).toBe('Solo page 1\fSolo page 2');
  });
  it('takes named tasks only, never functions', async () => {
    expect(BULK_TASKS).toEqual(['extractText', 'merge', 'split', 'encrypt']);
    await expect(bulk([], 'toString')).rejects.toThrow(TypeError);
    await expect(bulk([], /** @type {any} */ (() => 1))).rejects.toThrow(TypeError);
    await expect(bulk([junk], 'encrypt', { workers: 1 }).then((r) => r[0].error.message)).resolves.toMatch(/encrypt/);
  });
  it('a worker past its heap cap fails only its item, and the next item gets a new worker', async () => {
    // a page whose text pieces need far more than 16 MB of heap
    const parts = ['BT /F1 6 Tf\n']; for (let i = 0; i < 400_000; i++) parts.push(`1 0 0 1 ${20 + (i % 60) * 9} 800 Tm (a) Tj\n`); parts.push('ET\n');
    const c = new TextEncoder().encode(parts.join(''));
    const head = '%PDF-1.7\n', objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    const chunks = [new TextEncoder().encode(head)]; let off = chunks[0].length; const xref = [];
    objs.forEach((o, k) => { xref.push(off); const b = o ? new TextEncoder().encode(`${k + 1} 0 obj\n${o}\nendobj\n`) : new Uint8Array([...new TextEncoder().encode(`${k + 1} 0 obj\n<< /Length ${c.length} >>\nstream\n`), ...c, ...new TextEncoder().encode('\nendstream\nendobj\n')]); chunks.push(b); off += b.length; });
    chunks.push(new TextEncoder().encode(`xref\n0 6\n0000000000 65535 f \n${xref.map((x) => String(x).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${off}\n%%EOF\n`));
    const big = new Uint8Array(chunks.reduce((n, x) => n + x.length, 0)); { let p = 0; for (const x of chunks) { big.set(x, p); p += x.length; } }
    const small = await doc('After');
    const r = await bulk([big, small, small], 'extractText', { workers: 2, memoryMb: 16 });
    expect(r[0].ok).toBe(false); expect(r[0].error.code).toBe('E_WORKER');
    expect(r[1].value).toBe('After page 1\fAfter page 2'); expect(r[2].ok).toBe(true);
  }, 60000);
});
