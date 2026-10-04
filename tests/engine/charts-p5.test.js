// Phase 5: charts. Maths first (chart-kit), then each roadmap row through a real render.
import { describe, it, expect } from 'vitest';
import { PALETTES, paletteOf, inkOn, contrast, niceScale, logTicks, curvePath, fitTrend, movingAverage, LabelPlacer } from '../../src/engine/items/chart-kit.js';

describe('kit', () => {
  it('ships 12 named palettes of valid colours; unknown names fall back; custom arrays drop bad entries', () => {
    expect(Object.keys(PALETTES)).toHaveLength(12);
    for (const [name, p] of Object.entries(PALETTES)) {
      expect(p.length, name).toBeGreaterThanOrEqual(6);
      for (const c of p) expect(c, name).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(paletteOf('nope')).toBe(PALETTES.default);
    expect(paletteOf(undefined)).toBe(PALETTES.default);
    expect(paletteOf(['#000000', 'bad', 'red;x'])).toEqual(['#000000']);
    expect(paletteOf([])).toBe(PALETTES.default);
  });
  it('picks the label ink with the higher contrast', () => {
    expect(inkOn('#f59e0b')).not.toBe('#ffffff');
    expect(inkOn('#1e3a8a')).toBe('#ffffff');
    expect(inkOn('#84cc16')).not.toBe('#ffffff');
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(inkOn('nonsense')).toBe('#ffffff');
  });
  it('keeps the nice scale and makes log ticks', () => {
    expect(niceScale(0, 87)).toEqual({ lo: 0, hi: 100, step: 20 });
    expect(logTicks(3, 4200)).toEqual([1, 10, 100, 1000, 10000]);
    expect(logTicks(0.02, 0.5)).toEqual([0.01, 0.1, 1]);
    expect(logTicks(5, 5)).toEqual([1, 10]);
  });
  it('draws monotone smooth curves that never overshoot, and centred steps', () => {
    const pts = [{ x: 0, y: 50 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 100 }, { x: 40, y: 90 }];
    const d = curvePath(pts, 'smooth');
    expect(d).toMatch(/^M 0 50 C /);
    // every control point stays within the y range of its two neighbours (no overshoot)
    const nums = d.replace(/[MC]/g, ' ').trim().split(/[\s,]+/).map(Number);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(curvePath([{ x: 0, y: 5 }, { x: 10, y: 8 }], 'step')).toBe('M 0 5 H 5 V 8 H 10');
    expect(curvePath([{ x: 0, y: 5 }, { x: 10, y: 8 }], 'straight')).toBe('M 0 5 L 10 8');
    expect(curvePath([{ x: 3, y: 4 }], 'smooth')).toBe('M 3 4');
  });
  it('fits linear, exponential and polynomial trends', () => {
    const lin = fitTrend([[0, 1], [1, 3], [2, 5]], 'linear');
    expect(lin.at(0)).toBeCloseTo(1); expect(lin.at(10)).toBeCloseTo(21);
    const ex = fitTrend([0, 1, 2, 3].map(x => [x, 2 * Math.exp(0.5 * x)]), 'exp');
    expect(ex.at(0)).toBeCloseTo(2); expect(ex.at(4)).toBeCloseTo(2 * Math.exp(2));
    expect(fitTrend([[0, -1], [1, 2]], 'exp')).toBe(null); // needs two positive values
    const poly = fitTrend([-2, -1, 0, 1, 2, 3].map(x => [x, x * x - x]), 'poly', 2);
    expect(poly.at(5)).toBeCloseTo(20);
    expect(fitTrend([[0, 1], [1, 2]], 'poly', 2)).toBe(null); // needs order + 1 points
    const big = fitTrend(Array.from({ length: 40 }, (_, x) => [x, x ** 3]), 'poly', 99); // order clamps to 6
    expect(big.order).toBe(6);
    expect(big.at(10)).toBeCloseTo(1000, 0);
  });
  it('moving average with a running sum', () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(movingAverage([1, 2], 5)).toEqual([null, null]);
    expect(movingAverage([4, null, 6], 2)).toEqual([null, null, null]); // a gap resets the window
    const t = performance.now();
    movingAverage(Array.from({ length: 200000 }, (_, i) => i), 1000);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it('places labels without overlaps, in grid buckets', () => {
    const p = new LabelPlacer({ x: 0, y: 0, w: 1000, h: 1000 });
    expect(p.place({ x: 10, y: 10, w: 30, h: 8 })).toBe(true);
    expect(p.place({ x: 20, y: 12, w: 30, h: 8 })).toBe(false);
    expect(p.place({ x: 45, y: 10, w: 30, h: 8 })).toBe(true);
    expect(p.place({ x: 990, y: 10, w: 30, h: 8 })).toBe(false); // leaves the plot
    const t = performance.now();
    const q = new LabelPlacer({ x: 0, y: 0, w: 2000, h: 2000 });
    for (let i = 0; i < 20000; i++) q.place({ x: (i * 37) % 1970, y: (i * 11) % 1990, w: 30, h: 8 });
    expect(performance.now() - t).toBeLessThan(300);
  });
});
