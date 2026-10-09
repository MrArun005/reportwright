// Regressions for the independent security review of the reader (R1–R8). Each describe is one finding; each test
// failed before its fix. Inputs that can exhaust the heap or run for hours are run in a child process
// (reader-hostile-child.mjs) under a time limit and a 512 MB heap, since a fatal OOM cannot be caught in-process.
import { describe, it, expect } from 'vitest';
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
