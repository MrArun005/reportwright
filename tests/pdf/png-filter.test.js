// filterRow is branch-free for speed: it must pick and write exactly what the plain PNG heuristic does (min sum of
// |signed bytes|, ties to None, Sub, Up, Paeth), byte for byte, on noisy and smooth rows at every bpp.
import { describe, it, expect } from 'vitest';
import { filterRow } from '../../packages/pdf/src/images/png.js';

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
function ref(x, up, bpp) {
  const n = x.length, w = (v) => (v < 128 ? v : 256 - v);
  const f = [x.slice(), x.map((v, i) => (v - (i >= bpp ? x[i - bpp] : 0)) & 255)];
  if (up) f.push(x.map((v, i) => (v - up[i]) & 255), null, x.map((v, i) => (v - paeth(i >= bpp ? x[i - bpp] : 0, up[i], i >= bpp ? up[i - bpp] : 0)) & 255));
  let best = -1, bs = Infinity;
  f.forEach((r, k) => { if (!r) return; const s = r.reduce((t, v) => t + w(v), 0); if (s < bs) { bs = s; best = k; } });
  const out = new Uint8Array(n + 1); out[0] = best; out.set(f[best], 1); return out;
}

describe('filterRow', () => {
  it('matches the plain heuristic on random, smooth and edge rows', () => {
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
    for (const bpp of [1, 2, 3, 4, 6, 8]) for (let trial = 0; trial < 300; trial++) {
      const n = 1 + (trial % 37) * bpp, kind = trial % 3;
      const row = () => Uint8Array.from({ length: n }, (_, i) => (kind === 0 ? rnd() : kind === 1 ? (i * 3 + (rnd() & 3)) & 255 : [0, 255, 128, 127][rnd() & 3]));
      const up = trial % 4 ? row() : null, x = row(), out = new Uint8Array(n + 3), t = new Uint8Array(n);
      filterRow(x, up, bpp, out, 2, t);
      expect(out.subarray(2, 3 + n)).toEqual(ref(x, up, bpp));
    }
  });
});
