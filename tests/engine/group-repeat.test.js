// A table group's header can repeat at the top of each page its group continues on, under the table header.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';

const rows = Array.from({ length: 120 }, (_, i) => ({ g: i < 100 ? 'Alpha' : 'Beta', n: i }));
const table = (repeat) => ({
  type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 200, h: 54, columns: [{ width: 100 }, { width: 100 }],
  header: [{ height: 14, cells: [{ value: 'Head' }, { value: 'N' }] }],
  groups: [{ name: 'G', expr: '=Fields.g', ...(repeat ? { repeatHeader: true } : {}), header: [{ height: 14, cells: [{ value: '="Group " & Fields.g' }, null] }] }],
  detail: [{ height: 14, cells: [{ value: '=Fields.g' }, { value: '=Fields.n' }] }],
});
const run = (repeat) => render(report([table(repeat)], { data: { rows } }), { fontStore });
const top = (page, text) => page.items.filter(i => i.t === 'text' && i.lines.some(l => l.text === text)).map(i => i.lines[0].y);

describe('repeat a group header after a page break', () => {
  it('off: only the table header repeats', async () => {
    const m = await run(false);
    expect(m.pages.length).toBeGreaterThan(1);
    expect(top(m.pages[1], 'Head')).toHaveLength(1);
    expect(top(m.pages[1], 'Group Alpha')).toHaveLength(0);
  });
  it('on: page 2 starts with the table header, then the group header, then the rows', async () => {
    const m = await run(true);
    const p2 = m.pages[1];
    const [h] = top(p2, 'Head'), [g] = top(p2, 'Group Alpha');
    expect(top(p2, 'Head')).toHaveLength(1);
    expect(g).toBeGreaterThan(h);
    const firstRow = Math.min(...p2.items.filter(i => i.t === 'text' && i.lines[0].text === 'Alpha').map(i => i.lines[0].y));
    expect(firstRow).toBeGreaterThan(g);
    // Beta starts on its own: its page shows "Group Beta" once (its real header), not Alpha's
    const pb = m.pages.find(p => top(p, 'Group Beta').length);
    expect(top(pb, 'Group Beta')).toHaveLength(1);
  });
  it('the rows on a repeated page are not hidden under the headers', async () => {
    const off = await run(false), on = await run(true);
    expect(on.pages.length).toBeGreaterThanOrEqual(off.pages.length);
    const all = on.pages.flatMap(p => texts(p)).filter(t => /^\d+$/.test(t)).map(Number);
    expect(new Set(all).size).toBe(120); // every row once
  });
});
