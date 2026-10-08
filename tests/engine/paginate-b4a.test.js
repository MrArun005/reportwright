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
