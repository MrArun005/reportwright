// VB.NET / SSRS aggregate conformance: SSRS aggregate expressions, translated by the importer and rendered in a
// table with a group, as an imported report runs them. See vb-semantics.test.js for the row kinds.
//
// SSRS aggregate functions (Report Builder "Aggregate Functions Reference"):
//   Sum, Avg, Min, Max, Count, CountDistinct, StDev, Var ignore null values; "Avg returns the average of all non-null
//   numeric values"; Avg over no non-null value is Nothing; Count counts non-null values; CountRows counts rows.
//   First / Last return the first / last value in the scope, null or not. Previous returns the value of the previous
//   row (Nothing for the first). RunningValue(expr, function, scope) aggregates from the start of the scope to the
//   current row; scope Nothing means the outermost data region. The scope argument names a group, a data region or
//   a data set.
import { describe, it, expect } from 'vitest';
import { render } from '../../../src/engine/index.js';
import { translateExpression } from '../../../src/importers/rdlx.js';
import { fontStore, report, texts } from '../../helpers.js';

// region: the data region, as the importer passes it (a Nothing scope means the outermost data region)
const pw = (src) => { const t = translateExpression(src, { region: 'T' }); if (!t.ok) throw new Error(t.notes.join('; ')); return t.value.slice(1); };
/** A table grouped by g; `foot` is a VB expression shown in each group footer, `detail` one shown in each row. */
function table(rows, { foot, detail, sort = 'asc' }) {
  const cell = (tag, e) => [{ value: `="${tag}|" & (${pw(e)})` }];
  return report([{
    type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 300 }],
    groups: [{ name: 'G', expr: '=Fields.g', sort, header: [], footer: foot ? [{ height: 14, cells: cell('f', foot) }] : [] }],
    detail: detail ? [{ height: 14, cells: cell('d', detail) }] : [],
  }], { data: { rows }, def: { locale: 'en-US', currency: 'USD' } });
}
async function shown(rows, opt) {
  const out = await render(table(rows, opt), { fontStore });
  return out.pages.flatMap(texts).filter(t => /^[fd]\|/.test(t)).map(t => t.slice(2));
}

const ROWS = [
  { g: 'A', amt: 1, cat: 'x' }, { g: 'A', amt: null, cat: 'y' }, { g: 'A', amt: 2, cat: 'x' },
  { g: 'B', amt: null, cat: null }, { g: 'B', amt: null, cat: 'z' },
];
const TENTHS = Array.from({ length: 10 }, () => ({ g: 'A', amt: 0.1 }));

/** [VB expression in the group footer, values shown for groups A and B]. */
const FOOTERS = [
  ['=Sum(Fields!amt.Value)', ['3', '0'], 'unsure: SSRS Sum over only nulls; Pagewright gives 0 (we believe SSRS gives Nothing, a blank)'],
  ['=Avg(Fields!amt.Value)', ['1.5', '']],
  ['=Count(Fields!amt.Value)', ['2', '0']],
  ['=CountRows()', ['3', '2']],
  ['=CountDistinct(Fields!cat.Value)', ['2', '1']],
  ['=Min(Fields!amt.Value)', ['1', '']],
  ['=Max(Fields!amt.Value)', ['2', '']],
  ['=First(Fields!amt.Value)', ['1', '']],
  ['=Last(Fields!cat.Value)', ['x', 'z']],
  ['=Sum(Fields!amt.Value, "Rows")', ['3', '3']],
  ['=Count(Fields!amt.Value, "T")', ['2', '2']],
  ['=Format(Sum(Fields!amt.Value) / Sum(Fields!amt.Value, "Rows"), "P0")', ['100%', '0%']],
  ['=StDev(Fields!amt.Value)', ['0.7071067812', '']],
  ['=Var(Fields!amt.Value)', ['0.5', '']],
];

describe('aggregates in a group footer (nulls ignored, scopes)', () => {
  for (const [src, want, note] of FOOTERS) {
    it(`${src}${note ? '  [unsure]' : ''}`, async () => expect(await shown(ROWS, { foot: src })).toEqual(want));
  }
});

describe('aggregates of decimal values', () => {
  it('ten 0.1s sum to exactly 1', async () => {
    expect(await shown(TENTHS, { foot: '=Sum(Fields!amt.Value)' })).toEqual(['1']);
    expect(await shown(TENTHS, { foot: '=Sum(Fields!amt.Value) = 1' })).toEqual(['True']);
    expect(await shown(TENTHS, { foot: '=Format(Sum(Fields!amt.Value), "R")' })).toEqual(['1']);
  });
  it('Avg and RunningValue use the same decimal sum', async () => {
    expect(await shown(TENTHS, { foot: '=Avg(Fields!amt.Value) = 0.1' })).toEqual(['True']);
    expect((await shown(TENTHS, { detail: '=RunningValue(Fields!amt.Value, Sum, Nothing)' })))
      .toEqual(['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9', '1']);
  });
  it('money column totals', async () => {
    const rows = [19.99, 0.01, 4.1, 3.3, 10.2].map(amt => ({ g: 'A', amt }));
    expect(await shown(rows, { foot: '=Sum(Fields!amt.Value)' })).toEqual(['37.6']);
  });
});

/** [VB expression in each detail row, values shown row by row (groups A then B)]. */
const DETAILS = [
  ['=RunningValue(Fields!amt.Value, Sum, Nothing)', ['1', '1', '3', '3', '3']],
  ['=RunningValue(Fields!amt.Value, Sum, "G")', ['1', '1', '3', '0', '0']],
  ['=RunningValue(Fields!amt.Value, Count, Nothing)', ['1', '1', '2', '2', '2']],
  ['=RunningValue(Fields!cat.Value, CountDistinct, Nothing)', ['1', '2', '2', '2', '3']],
  ['=RunningValue(Fields!amt.Value, Max, "G")', ['1', '1', '2', '', '']],
  ['=Previous(Fields!cat.Value)', ['', 'x', 'y', 'x', '']],
  ['=RowNumber(Nothing)', ['1', '2', '3', '4', '5']],
  ['=RowNumber("G")', ['1', '2', '3', '1', '2']],
];

describe('RunningValue, Previous, RowNumber', () => {
  for (const [src, want] of DETAILS) it(src, async () => expect(await shown(ROWS, { detail: src })).toEqual(want));
});

describe('aggregate suite size', () => {
  it('counts', () => expect(FOOTERS.length + DETAILS.length + 3).toBeGreaterThan(20));
});
