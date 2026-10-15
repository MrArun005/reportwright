// N1: a vertical gap in the body taller than the page printed a blank page and warned that an item was cut.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { paginate } from '../../src/engine/paginate/index.js';
import { fontStore, report, texts } from '../helpers.js';

const tb = (name, y, value) => ({ type: 'textbox', name, x: 0, y, w: 200, h: 20, value });

describe('paginator: a gap taller than the page', () => {
  it('the strip: no page of the gap alone, no warning', () => {
    const warn = [];
    const pages = paginate(
      [
        { top: 0, height: 20, items: [1] },
        { top: 1700, height: 20, items: [2] },
      ],
      [],
      700,
      (w) => warn.push(w),
    );
    expect(pages.map((p) => p.units.length)).toEqual([1, 1]);
    expect(pages[1].top).toBe(1700);
    expect(warn).toEqual([]);
  });
  it('a report: two pages, each with its text, and no "taller than the page" warning', async () => {
    for (const y of [900, 2500]) {
      const out = await render(report([tb('A', 0, 'TOP'), tb('B', y, 'BOT')]), { fontStore });
      expect(out.pages.map((p) => texts(p).filter((t) => t === 'TOP' || t === 'BOT'))).toEqual([['TOP'], ['BOT']]);
      expect(out.warnings.filter((w) => /taller than the page/.test(w))).toEqual([]);
    }
  });
  it('an item taller than the page is still cut and warned about', () => {
    const warn = [];
    const pages = paginate(
      [
        { top: 0, height: 20, items: [1] },
        { top: 900, height: 1500, items: [2] },
      ],
      [],
      700,
      (w) => warn.push(w),
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.units.length > 0)).toBe(true);
    expect(warn.length).toBe(1);
  });
});
