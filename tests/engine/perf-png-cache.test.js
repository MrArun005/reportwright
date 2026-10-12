// #1 perf: pngProblem's verdict is cached by content (a SHA-256 of the bytes), never by name; changed bytes re-check.
import { describe, it, expect } from 'vitest';
import { pngProblem, pngVerdictCacheSize } from '../../src/exporters/png.js';
import { png } from './png-fixture.js';

describe('pngProblem verdict cache', () => {
  it('a repeat check hits the cache; different bytes get their own verdict', () => {
    const good = png(48, 48);
    const n = pngVerdictCacheSize();
    expect(pngProblem(good)).toBe(null);
    expect(pngProblem(good.slice())).toBe(null); // same content, new buffer: a hit
    expect(pngVerdictCacheSize()).toBe(n + 1);
    const bad = good.slice(); bad[40] ^= 0xff;
    expect(pngProblem(bad)).toMatch(/CRC/);
    expect(pngProblem(good)).toBe(null);
  });
  it('the cache stays bounded', () => {
    for (let i = 1; i < 300; i++) pngProblem(png(i % 60 + 1, Math.floor(i / 60) + 1));
    expect(pngVerdictCacheSize()).toBeLessThanOrEqual(256);
  });
});
