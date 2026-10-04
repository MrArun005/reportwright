// Batch 6: very tall items that overlap each other must not leave page 1 blank (seen by the layout agent).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { paginate } from '../../src/engine/paginate/index.js';
import { fontStore, report } from '../helpers.js';

const rect = (name, y, h, x = 0) => ({ type: 'shape', shape: 'rect', name, x, y, w: 200, h, style: { backgroundColor: '#eeeeee' } });
const drawn = (pg) => pg.items.filter(i => i.t !== 'text' || i.lines.some(l => l.text.trim())).length;

describe('paginator: tall overlapping items', () => {
  it('two overlapping items taller than the page start on page 1, not after a blank page', async () => {
    const out = await render(report([rect('A', 40, 1200), rect('B', 60, 1300, 100)]), { fontStore });
    expect(drawn(out.pages[0])).toBeGreaterThan(0);
    for (const pg of out.pages) expect(drawn(pg)).toBeGreaterThan(0);
    // and the cut-off part of an item makes no blank page after it
    const one = await render(report([rect('A', 0, 1200)]), { fontStore });
    expect(one.pages.length).toBe(1);
    const more = await render(report([rect('A', 0, 1200), { type: 'textbox', name: 'T', x: 0, y: 1210, w: 200, h: 14, value: 'after' }]), { fontStore });
    expect(more.pages.map(drawn).every(n => n > 0)).toBe(true);
  });
  it('the strip: units that cannot fit any page are cut where page 1 ends, not moved past a gap', () => {
    const warn = [];
    const units = [{ top: 40, height: 1200, items: [1] }, { top: 60, height: 1300, items: [2] }];
    const pages = paginate(units, [], 700, (w) => warn.push(w));
    expect(pages[0].units.length).toBe(2);
    expect(pages[0].bottom).toBe(700);
    expect(warn.length).toBeGreaterThan(0);
  });
  it('a single item taller than the page below a gap: same', () => {
    const pages = paginate([{ top: 50, height: 1000, items: [1] }], [], 700, () => {});
    expect(pages[0].units.length).toBe(1);
  });
  it('an item that fits a fresh page still moves there (page 1 keeps what is above it)', () => {
    const pages = paginate([{ top: 0, height: 100, items: [1] }, { top: 600, height: 200, items: [2] }], [], 700, () => {});
    expect(pages.map(p => p.units.length)).toEqual([1, 1]);
    expect(pages[1].top).toBe(600);
  });
});
