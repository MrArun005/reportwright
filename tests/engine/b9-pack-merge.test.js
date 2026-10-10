// A batch's merged PDF (jobs.packOutput) is built by @reportwright/pdf: page order kept, a corrupt input rejected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-b9-merge-'));
const cwd = process.cwd();
let jobs, blobs, loadPdf;

async function onePage(text) {
  const { toBytes } = await import('@reportwright/pdf');
  return toBytes(pdf => {
    const f = pdf.standardFont('Helvetica');
    const p = pdf.addPage();
    p.text(text, { x: 72, y: 72, font: f });
  });
}

beforeAll(async () => {
  fs.symlinkSync(path.join(cwd, 'public'), path.join(dir, 'public'));
  process.chdir(dir);
  process.env.PW_STORAGE = `sqlite:${path.join(dir, 'store.db')}`;
  jobs = await import('../../src/server/jobs.js');
  ({ blobs } = await import('../../src/server/blobs.js'));
  ({ loadPdf } = await import('@reportwright/pdf'));
});
afterAll(() => { process.chdir(cwd); delete process.env.PW_STORAGE; fs.rmSync(dir, { recursive: true, force: true }); });

describe('packOutput merged', () => {
  it('merges 3 engine PDFs in order', async () => {
    const keys = ['b9/a', 'b9/b', 'b9/c'];
    for (const [i, k] of keys.entries()) await blobs().put(k, await onePage(`ITEM${i}ALPHA`));
    await jobs.packOutput({ type: 'merged', key: 'b9/out', items: keys.map((key, i) => ({ key, name: `${i}.pdf` })) });
    const doc = await loadPdf(new Uint8Array(await blobs().get('b9/out')));
    expect(doc.pageCount).toBe(3);
    const text = doc.extractText();
    expect(text.indexOf('ITEM0ALPHA')).toBeLessThan(text.indexOf('ITEM1ALPHA'));
    expect(text.indexOf('ITEM1ALPHA')).toBeLessThan(text.indexOf('ITEM2ALPHA'));
  });

  it('a corrupt PDF in the batch is rejected (no output written)', async () => {
    await blobs().put('b9/bad', Buffer.from('not a pdf'));
    await blobs().put('b9/ok', await onePage('OK'));
    await expect(jobs.packOutput({ type: 'merged', key: 'b9/out2', items: [{ key: 'b9/ok', name: 'a.pdf' }, { key: 'b9/bad', name: 'b.pdf' }] })).rejects.toThrow(/Not a PDF|Failed to parse/);
    expect(await blobs().get('b9/out2')).toBeFalsy();
  });
});
