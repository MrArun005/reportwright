// Pagination rules (group 3): a table group taller than a page keeps at least two of its rows on each side of a break.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const table = (extra) => ({ type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }], header: [], detail: [], footer: [], ...extra });

describe('tables: a tall group is split with two rows on each side', () => {
  it('no page ends or starts a continuation with a single row of the group', async () => {
    // one group of 96 rows of 16 points: page 1 holds the group header and 47 rows, pages 2 on hold 48 each,
    // so a plain break would leave a single row on page 3
    const rows = Array.from({ length: 96 }, (_, i) => ({ g: 'G', name: `n${i}` }));
    const t = table({ groups: [{ expr: '=Fields.g', header: [{ height: 16, cells: [{ value: 'Group' }, null, null] }] }], detail: [{ height: 16, cells: [{ value: '=Fields.name' }, null, null] }] });
    const out = await render(report([t], { data: { rows } }), { exportData: true, fontStore });
    const perPage = out.pages.map(p => p.items.filter(i => i.t === 'text' && i.lines.some(l => /^n\d+$/.test(l.text.trim()))).length);
    expect(perPage.reduce((a, b) => a + b, 0)).toBe(96);
    for (const c of perPage) expect(c === 0 || c >= 2).toBe(true);
  });
});
