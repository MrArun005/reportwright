// Pagination rules (group 3): no blank page where a page break meets a keep-together block.
import { describe, it, expect } from 'vitest';
import { paginate } from '../../src/engine/paginate/index.js';

const placedCount = (pages) => pages.reduce((n, p) => n + p.units.length, 0);

describe('paginator: page-break-before inside a keep-together block', () => {
  it('a break that lands inside a block does not leave a page with nothing on it', () => {
    // A fills page 1; block x starts just below A, and its last part has a page break before it
    const units = [
      { top: 0, height: 440, items: ['A'] },
      { top: 460, height: 54, items: ['B'], block: 'x' },
      { top: 514, height: 44, items: ['C'], block: 'x', breakBefore: true },
      { top: 558, height: 20, items: ['D'], block: 'x' },
    ];
    const pages = paginate(units, [], 452, () => {});
    expect(pages.every(p => p.units.length > 0)).toBe(true);
    expect(placedCount(pages)).toBe(units.length);
  });
});

describe('paginator: a group taller than a page keeps two rows on each side of a break', () => {
  it('no page holds a single row of such a group when it is split', () => {
    // a 200-point header, then ten 50-point rows of one group (the group is 500 tall, the page 260)
    const units = [{ top: 0, height: 200, items: ['H'] }];
    for (let i = 0; i < 10; i++) units.push({ top: 200 + i * 50, height: 50, items: [i], grp: 'G' });
    const pages = paginate(units, [], 260, () => {});
    const counts = pages.map(p => p.units.filter(u => u.grp === 'G').length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    for (const c of counts) expect(c === 0 || c >= 2).toBe(true);
  });
});

describe('paginator: keep with next', () => {
  it('a heading never ends a page; a chain of headings moves with the content under it', () => {
    const one = paginate([{ top: 0, height: 380, items: ['a'] }, { top: 380, height: 30, items: ['H'], keepWithNext: true }, { top: 410, height: 200, items: ['b'] }], [], 400, () => {});
    expect(one.map(p => p.units.at(-1).items[0])).toEqual(['a', 'b']);
    const chain = paginate([{ top: 0, height: 300, items: ['a'] }, { top: 300, height: 30, items: ['H1'], keepWithNext: true }, { top: 330, height: 30, items: ['H2'], keepWithNext: true }, { top: 360, height: 200, items: ['b'] }], [], 400, () => {});
    expect(chain.map(p => p.units.at(-1).items[0])).toEqual(['a', 'b']);
  });
});
