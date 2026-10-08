// Column sets across a page (items/hpage.js): when the sets need k pages, they are spread evenly over those k pages
// (4 + 4 + 1 becomes 3 + 3 + 3), and a set never splits a column block (a pivot's measure: its value columns).
import { describe, it, expect } from 'vitest';
import { sliceColumns } from '../../src/engine/items/hpage.js';

/** Column sets of a table of `n` columns, `w` wide each, on a page `room` wide; returns the sets' widths in columns. */
function sets({ n, w, room, block = 1 }) {
  const widths = Array.from({ length: n }, () => w);
  const colX = widths.map((_, i) => i * w);
  let id = 0;
  const out = sliceColumns({
    units: [{ top: 0, height: 16, items: [] }], height: 16, headerCount: 0, headerHeight: 0, repeatHeader: false,
    colX, widths, x: 0, repeat: 0, room, order: 'down', pageH: 700, name: 'T', nextId: () => ++id, warn: () => {},
    shiftLocal: (items) => items, block,
  });
  const perSet = new Map();
  for (const u of out.units) perSet.set(u.hgrid.set, (perSet.get(u.hgrid.set) || 0) + 1);
  return { sets: perSet.size, width: out.width, wide: [...perSet.keys()].map(k => k) };
}

describe('column sets across the page: balanced over the pages they need', () => {
  it('nine one-column sets that fit four to a page go three to a page, not 4 + 4 + 1', () => {
    const r = sets({ n: 9, w: 60, room: 250 });
    expect(r.sets).toBe(3);
    expect(r.width).toBe(180);
  });

  it('nine two-column blocks (a pivot measure: value columns) go three to a page, and no block is split', () => {
    const r = sets({ n: 18, w: 60, room: 490, block: 2 });
    expect(r.sets).toBe(3);
    expect(r.width).toBe(360);
  });
});
