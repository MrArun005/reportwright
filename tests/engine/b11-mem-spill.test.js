// N44 (a): the spill sort's memory does not grow with the row count. Past mergeMB's worth of runs, groups of runs are
// merged on disk first, so the final merge never holds a batch from every run of a large sort.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spillSorter, spillShared } from '../../src/exporters/spill.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b11-mem-spill-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const used = () => Array.from(spillShared().cells).reduce((a, b) => a + b, 0);

describe('N44: spill sort memory is bounded', () => {
  it('many runs are merged in groups first, in the same order, and the files and budget are given back', async () => {
    // ~100-byte records, 20 a batch: mergeMB 0.01 holds ~5 batches, so 300 runs take group merges
    const s = spillSorter({ run: 20, frame: 20, mergeMB: 0.01, dir })((a, b) => a.k - b.k || a.s - b.s);
    const N = 6000;
    for (let i = 0; i < N; i++) await s.push({ k: (i * 7919) % 101, s: i, r: `row ${i}` });
    expect(s.runs).toBe(300);
    const got = [];
    for await (const x of s.drain()) got.push(x);
    expect(s.passes).toBeGreaterThan(0);
    expect(s.runs).toBeLessThanOrEqual(64); // the last merge reads a few runs, not 300
    expect(got.length).toBe(N);
    for (let i = 1; i < N; i++) expect(got[i - 1].k < got[i].k || (got[i - 1].k === got[i].k && got[i - 1].s < got[i].s)).toBe(true);
    // merged-away runs are deleted as they go: only the runs left are on disk
    const d = fs.readdirSync(dir).find(f => f.startsWith(`pw-spill-${process.pid}-`));
    expect(fs.readdirSync(path.join(dir, d)).length).toBe(s.runs);
    await s.close();
    expect(fs.readdirSync(dir).filter(f => f.startsWith('pw-spill-'))).toEqual([]);
    expect(used()).toBe(0);
  });
  it('defaults: a run ends at 10,000 records (or runMB), and a small sort needs no group merge', async () => {
    const s = spillSorter({ dir })((a, b) => a - b);
    for (let i = 25000; i > 0; i--) await s.push(i);
    expect(s.runs).toBe(2);
    let n = 0, prev = 0;
    for await (const x of s.drain()) { expect(x).toBeGreaterThan(prev); prev = x; n++; }
    expect(n).toBe(25000);
    expect(s.passes).toBe(0);
    await s.close();
  });
  it('runMB ends a run by its size', async () => {
    const s = spillSorter({ runMB: 0.1, dir })((a, b) => a.k - b.k);
    for (let i = 0; i < 50; i++) await s.push({ k: i, r: 'x'.repeat(5000) }); // ~10 KB each
    expect(s.runs).toBeGreaterThanOrEqual(4);
    await s.close();
  });
});
