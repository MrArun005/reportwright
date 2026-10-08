// Widow/orphan control (every group): a group of four or more rows never leaves one row alone at a page foot or head;
// a group of two or three rows that fits a page moves whole; widowControl: false turns the rule off for a table.
import { describe, it, expect } from 'vitest';
import { paginate } from '../../src/engine/paginate/index.js';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const rowsOnPage = (pages, grp) => pages.map(p => p.units.filter(u => u.grp === grp).length);

describe('paginator: widow control for every group', () => {
  it('a 5-row group that fits a page never leaves one row at a page foot', () => {
    // page 100 holds 70 of filler, then five 20-point rows: a break after the first row would leave it alone
    const units = [{ top: 0, height: 70, items: ['F'] }];
    for (let i = 0; i < 5; i++) units.push({ top: 70 + i * 20, height: 20, items: [i], grp: 'G' });
    const pages = paginate(units, [], 100, () => {});
    const counts = rowsOnPage(pages, 'G');
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
    for (const c of counts) expect(c === 0 || c >= 2).toBe(true);
  });

  it('a 3-row group that does not fit the rest of the page moves whole to the next page', () => {
    const units = [{ top: 0, height: 70, items: ['F'] }];
    for (let i = 0; i < 3; i++) units.push({ top: 70 + i * 20, height: 20, items: [i], grp: 'G' });
    const pages = paginate(units, [], 100, () => {});
    expect(rowsOnPage(pages, 'G')).toEqual([0, 3]);
  });
});

describe('tables: widow control for every group, widowControl: false turns it off', () => {
  // nine groups of three rows, 24 points each: the page break falls inside a group
  const rows = [];
  for (let g = 0; g < 9; g++) for (let i = 0; i < 3; i++) rows.push({ g: 'G' + g, name: `G${g}r${i}` });
  const table = (extra) => ({
    type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
    header: [], footer: [], ...extra,
    groups: [{ expr: '=Fields.g', header: [{ height: 16, cells: [{ value: 'Group' }, null, null] }] }],
    detail: [{ height: 24, cells: [{ value: '=Fields.name' }, null, null] }],
  });
  const perPage = async (t) => {
    const out = await render(report([t], { data: { rows } }), { exportData: true, fontStore });
    return out.pages.map(p => p.items.filter(i => i.t === 'text' && i.lines.some(l => /^G\d+r\d$/.test(l.text.trim()))).length);
  };

  it('no page holds a single detail row of a group (on by default)', async () => {
    const counts = await perPage(table({}));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(27);
    for (const c of counts) expect(c === 0 || c >= 2).toBe(true);
  });

  it('widowControl: false lets a page end with a single row of a group', async () => {
    const counts = await perPage(table({ widowControl: false }));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(27);
    expect(counts).toContain(1);
  });
});

describe('paginator: widow control costs work linear in the units', () => {
  // The work counter counts comparisons (groups and units looked at). A quadratic search would look at ~n² of them.
  const strip = (groupSize, n) => {
    const units = [];
    for (let i = 0; i < n; i++) units.push({ top: i * 10, height: 10, items: [], grp: 'G' + Math.floor(i / groupSize) });
    return units;
  };
  const run = (groupSize, n) => {
    const stats = { work: 0 };
    const t0 = Date.now();
    const pages = paginate(strip(groupSize, n), [], 1000, () => {}, stats);
    return { work: stats.work, ms: Date.now() - t0, pages: pages.length, placed: pages.reduce((s, p) => s + p.units.length, 0) };
  };

  it('200k rows in 10k-row groups: each break is checked locally', () => {
    const r = run(10000, 200000);
    expect(r.placed).toBe(200000);
    expect(r.work).toBeLessThan(40 * 200000);
    expect(r.ms).toBeLessThan(60000);
  }, 120000);

  it('200k rows in 2-row groups and in single-row groups: linear as well', () => {
    for (const size of [2, 1]) {
      const r = run(size, 200000);
      expect(r.placed).toBe(200000);
      expect(r.work).toBeLessThan(40 * 200000);
      expect(r.ms).toBeLessThan(60000);
    }
  }, 240000);
});
