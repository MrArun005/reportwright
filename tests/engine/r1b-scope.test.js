// REVIEW-ENGINE A4 (Sum in a detail row), A5 (RunningValue / RowNumber in a group header), A9 (recursive matrix Sum).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

describe('aggregate scopes as RDL', () => {
  it('Sum() in a detail row is the row\'s own value, inside a group and in a table with none', async () => {
    const grouped = {
      type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }],
      groups: [{ name: 'G', expr: '=Fields.g', header: [{ height: 14, cells: [{ value: '="G " & Sum(Fields.a)' }] }] }],
      detail: [{ height: 14, cells: [{ value: '="d " & Sum(Fields.a) & " " & Sum(Fields.a, "G") & " " & CountRows()' }] }],
    };
    const r = await render(report([grouped], { data: { rows: [{ g: 'A', a: 1 }, { g: 'A', a: 2 }] } }), { fontStore });
    expect(texts(r.pages[0])).toEqual(['G 3', 'd 1 3 1', 'd 2 3 1']);
    const flat = { ...grouped, groups: [], detail: [{ height: 14, cells: [{ value: '=Sum(Fields.a) & "/" & Sum(Fields.a, "T")' }] }] };
    const r2 = await render(report([flat], { data: { rows: [{ a: 1 }, { a: 2 }] } }), { fontStore });
    expect(texts(r2.pages[0])).toEqual(['1/3', '2/3']);
  });
  it('RunningValue and RowNumber in a group header include the group\'s own rows', async () => {
    const t = {
      type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 300 }],
      groups: [{ name: 'G', expr: '=Fields.g',
        header: [{ height: 14, cells: [{ value: '="h " & RunningValue(Fields.v, "Sum", "T") & " " & RowNumber("T") & " " & RunningValue(Fields.v, "Count", "G")' }] }],
        footer: [{ height: 14, cells: [{ value: '="f " & RunningValue(Fields.v, "Sum", "T") & " " & RowNumber("T")' }] }] }],
      detail: [],
    };
    const rows = [{ g: 'A', v: 1 }, { g: 'A', v: 2 }, { g: 'B', v: 4 }, { g: 'B', v: 8 }, { g: 'C', v: 16 }];
    const r = await render(report([t], { data: { rows } }), { fontStore });
    expect(texts(r.pages[0])).toEqual(['h 3 2 2', 'f 3 2', 'h 15 4 2', 'f 15 4', 'h 31 5 1', 'f 31 5']);
  });
  it('a recursive matrix row group: Sum is the node\'s own rows, Sum(…, "Recursive") its subtree', async () => {
    const m = {
      type: 'matrix', name: 'M', x: 0, y: 0, w: 400, h: 60, dataSet: 'Rows', columnWidth: 80,
      rowGroups: [{ name: 'G', expr: '=Fields.id', parent: '=Fields.parent', total: 'none' }],
      columnGroups: [],
      values: [{ value: '=Sum(Fields.v)', label: 'own' }, { value: '=Sum(Fields.v, "G", "Recursive")', label: 'tree' }],
    };
    const rows = [{ id: 'A', parent: null, v: 1 }, { id: 'B', parent: 'A', v: 10 }, { id: 'C', parent: 'B', v: 100 }, { id: 'D', parent: 'A', v: 1000 }];
    const r = await render(report([m], { data: { rows } }), { fontStore });
    const t = texts(r.pages[0]);
    const row = (k) => t.slice(t.indexOf(k), t.indexOf(k) + 3);
    expect(row('A')).toEqual(['A', '1', '1111']);
    expect(row('B')).toEqual(['B', '10', '110']);
    expect(row('C')).toEqual(['C', '100', '100']);
    expect(row('D')).toEqual(['D', '1000', '1000']);
  });
});
