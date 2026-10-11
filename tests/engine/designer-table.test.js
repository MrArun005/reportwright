// Designer table commands keep merged cells whole: a column added or removed next to or inside a merged cell leaves
// no phantom cell under it (the engine places cells by column index, a merged cell's columns hold null).
import { describe, it, expect, beforeEach } from 'vitest';
import { useDesigner, tableInsertColumn, tableDeleteColumn } from '../../src/designer/store.js';

const table = () => ({
  type: 'table', id: 't', name: 'T', x: 0, y: 0, w: 216, h: 54, dataSet: 'S',
  columns: [{ width: 72 }, { width: 72 }, { width: 72 }],
  // a group header written as one merged cell with no placeholders (as the table gallery does)
  groups: [{ name: 'G', expr: '=Fields.g', header: [{ height: 18, cells: [{ value: '=Fields.g', colSpan: 3 }] }] }],
  header: [{ height: 18, cells: [{ value: 'A' }, { value: 'B', rowSpan: 2, colSpan: 2 }, null] }, { height: 18, cells: [{ value: 'a' }, null, null] }],
  detail: [{ height: 18, cells: [{ value: '1' }, { value: '2' }, { value: '3' }] }],
});
const t = () => useDesigner.getState().def.sections.body.items[0];
const cells = (row) => row.cells.map(c => (c === null || c === undefined ? null : c.value + (c.colSpan > 1 ? `/${c.colSpan}` : '')));

beforeEach(() => {
  useDesigner.getState().init('x', { $schema: 'reportwright/report@1', name: 'x', page: { size: 'A4' }, sections: { body: { height: 200, items: [table()] } } });
});

describe('add column', () => {
  it('at the end: a merged group header keeps its place; the new column gets an empty cell, not one under the merge', () => {
    tableInsertColumn('t', 3);
    expect(cells(t().groups[0].header[0])).toEqual(['=Fields.g/3', null, null, '']);
    expect(cells(t().detail[0])).toEqual(['1', '2', '3', '']);
  });
  it('inside a merged cell: the merge grows, and so do the rows it covers below', () => {
    tableInsertColumn('t', 2);
    expect(cells(t().header[0])).toEqual(['A', 'B/3', null, null]);
    expect(cells(t().header[1])).toEqual(['a', null, null, null]);
    expect(cells(t().groups[0].header[0])).toEqual(['=Fields.g/4', null, null, null]);
    expect(cells(t().detail[0])).toEqual(['1', '2', '', '3']);
  });
  it('at a merged cell\'s left edge: a new cell, the merge moves right', () => {
    tableInsertColumn('t', 1);
    expect(cells(t().header[0])).toEqual(['A', '', 'B/2', null]);
    expect(cells(t().header[1])).toEqual(['a', '', null, null]);
  });
});

describe('delete column', () => {
  it('the first column of a merged cell: the merge shrinks and keeps its value', () => {
    tableDeleteColumn('t', 1);
    expect(cells(t().header[0])).toEqual(['A', 'B']);
    expect(t().header[0].cells[1].rowSpan).toBe(2);
    expect(cells(t().header[1])).toEqual(['a', null]);
    expect(cells(t().groups[0].header[0])).toEqual(['=Fields.g/2', null]);
  });
  it('the first column, under a group header merged from it', () => {
    tableDeleteColumn('t', 0);
    expect(cells(t().groups[0].header[0])).toEqual(['=Fields.g/2', null]);
    expect(cells(t().detail[0])).toEqual(['2', '3']);
  });
});
