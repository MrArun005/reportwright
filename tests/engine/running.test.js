// RunningValue reuses per-row values as the prefix grows (stress test: groups of 2,000 rows were quadratic).
// These pin the results to what a full re-evaluation gives.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';

const rows = [{ g: 'A', amt: 1 }, { g: 'A', amt: 2 }, { g: 'B', amt: 10 }, { g: 'A', amt: 3 }, { g: 'B', amt: 20 }];
const table = (cell, groups = true) => report([{
  type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }],
  ...(groups ? { groups: [{ name: 'G', expr: '=Fields.g', sort: 'asc', header: [{ height: 14, cells: [{ value: '=Fields.g' }, { value: '' }] }], footer: [] }] } : {}),
  detail: [{ height: 14, cells: [{ value: '=Fields.amt' }, { value: `="r" & ${cell.slice(1)}` }] }],
}], { data: { rows } });
// the running cells, tagged with "r"
const column = async (def) => texts((await render(def, { fontStore })).pages[0]).filter(t => t.startsWith('r')).map(t => t.slice(1));

describe('RunningValue', () => {
  it('runs within the named scope and restarts for each group', async () => {
    expect(await column(table('=RunningValue(Fields.amt, "Sum", "G")'))).toEqual(['1', '3', '6', '10', '30']);
  });
  it('runs over the whole table across groups', async () => {
    expect(await column(table('=RunningValue(Fields.amt, "Sum", "T")'))).toEqual(['1', '3', '6', '16', '36']);
  });
  it('without a scope, runs over the rows of the current region', async () => {
    expect(await column(table('=RunningValue(Fields.amt * 2, "Max")', false))).toEqual(['2', '4', '20', '20', '40']);
  });
  it('an aggregate inside the expression is not cached (it depends on the prefix)', async () => {
    // each prefix row's Sum over the prefix is the prefix total, so the running Max is the running total
    expect(await column(table('=RunningValue(Sum(Fields.amt), "Max", "G")'))).toEqual(['1', '3', '6', '10', '30']);
  });
});
