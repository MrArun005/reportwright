// Regressions for the independent security review of the reader (R1–R8). Each describe is one finding; each test
// failed before its fix. Inputs that can exhaust the heap or run for hours are run in a child process
// (reader-hostile-child.mjs) under a time limit and a 512 MB heap, since a fatal OOM cannot be caught in-process.
import { describe, it, expect } from 'vitest';
import { loadPdf } from '../../packages/pdf/src/index.js';
import { onePage } from './reader-tools.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CHILD = path.join(import.meta.dirname, 'reader-hostile-child.mjs');
/** run one case in a child: its JSON line, or { killed / crashed } @param {string} name @param {number} [secs] */
function child(name, secs = 20) {
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', CHILD, name], { encoding: 'utf8', timeout: secs * 1000, killSignal: 'SIGKILL' });
  const line = r.stdout.trim().split('\n').pop();
  if (r.status !== 0 || !line) return { code: r.signal ? `killed:${r.signal}` : `exit:${r.status}`, stderr: r.stderr.slice(-400) };
  return JSON.parse(line);
}

describe('R1: a ToUnicode bfrange cannot copy a long destination 65,536 times (heap exhaustion)', () => {
  it('a destination past 64 code units is skipped: the text comes from the encoding, no OOM', () => {
    const r = child('cmap-long-dst');
    expect(r.code).toBe('OK');
    expect(r.text).toBe('A');
  }, 30_000);
  it('the characters one CMap holds are capped: E_BUDGET, not OOM', () => {
    expect(child('cmap-chars').code).toBe('E_BUDGET');
  }, 30_000);
  it('the characters one extraction holds across fonts are capped: E_BUDGET, not OOM', () => {
    expect(child('cmap-many-fonts').code).toBe('E_BUDGET');
  }, 30_000);
});

describe('R2: a CIDFont /W is a budget step per code, capped in total (timeoutMs honoured)', () => {
  for (const name of ['w-ranges', 'w-arrays', 'page-tree-shared-kids']) {
    it(`${name}: stops in well under the 15 s limit with a typed error`, () => {
      const r = child(name, 15);
      expect(['E_BUDGET', 'E_TIMEOUT']).toContain(r.code);
      expect(r.ms).toBeLessThan(3000);
    }, 30_000);
  }
});

describe('R3: glyphs are budget steps, every stream counts against maxDecoded, form XObjects drawn are capped, extractText has a default time', () => {
  it('an unfiltered 64 KB form drawn 100,000 times stops at maxDecoded', () => {
    const r = child('forms-unfiltered', 15);
    expect(r.code).toBe('E_BUDGET');
    expect(r.message).toMatch(/maxDecoded/);
  }, 30_000);
  it('a form drawn 20,000 times: E_BUDGET (at most 10,000 per extraction)', () => {
    const r = child('forms-many', 15);
    expect(r.code).toBe('E_BUDGET');
    expect(r.message).toMatch(/form XObjects/);
  }, 30_000);
  it('one Tj of a 16 MB string honours timeoutMs 300', () => {
    const r = child('glyphs-one-string', 15);
    expect(r.code).toBe('E_TIMEOUT');
    expect(r.ms).toBeLessThan(1500);
  }, 30_000);
  it('extractText takes its own timeoutMs (30 s by default) and checks its options', async () => {
    const d = await loadPdf(onePage(`BT /F1 1 Tf (${'A'.repeat(1 << 20)}) Tj ET`));
    const t = Date.now();
    expect(() => d.page(0).extractText({ timeoutMs: 5 })).toThrow(expect.objectContaining({ code: 'E_TIMEOUT' }));
    expect(Date.now() - t).toBeLessThan(1500);
    expect(() => d.extractText({ timeoutMs: -1 })).toThrow(TypeError);
    expect(() => d.extractText({ nope: 1 })).toThrow(TypeError);
    expect(d.page(0).extractText({ timeoutMs: Infinity }).length).toBe(1 << 20);
  }, 30_000);
});
