// Designer Inspector and data binding, store level: the live field checks (fieldCheck.js, issues.js) the Inspector and
// the Issues list show, the issue-to-item mapping a click uses, and the store's guards on sizes typed in the Inspector.
import { describe, it, expect } from 'vitest';
import { fieldIssues, exprParts, fieldNames, nestedFields } from '../../src/designer/fieldCheck.js';
import { designIssues, checkIssues } from '../../src/designer/issues.js';
import {
  newDesignerStore,
  activateStore,
  updateItem,
  tableSetColumnWidth,
  findItem,
} from '../../src/designer/store.js';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore } from '../helpers.js';

const FIELDS = [
  { name: 'id', type: 'number' },
  { name: 'region', type: 'string' },
  { name: 'amount', type: 'number' },
];
const SETS = [
  { name: 'Sales', source: 'src', fields: FIELDS },
  { name: 'Stock', source: 'src', fields: [{ name: 'sku', type: 'string' }] },
];
const def = (items, more = {}) => ({
  $schema: 'reportwright/report@1',
  name: 'R',
  page: { size: 'A4' },
  dataSources: [{ name: 'src', type: 'json', data: [{ id: 1, region: 'N', amount: 3 }] }],
  dataSets: SETS,
  ...more,
  sections: { body: { height: 300, items } },
});
const bands = (d) => [{ key: 'body', items: d.sections.body.items, width: 523.28 }];
const fieldsFlagged = (d) =>
  designIssues(d, bands(d))
    .filter((i) => i.kind === 'field')
    .map((i) => `${i.name}:${i.field}`);

describe('fieldIssues: unknown Fields.x as the Inspector flags them', () => {
  it('flags an unknown field with a close suggestion, at its offset', () => {
    const [i] = fieldIssues('=Fields.amont + 1', SETS, 'Sales');
    expect(i).toMatchObject({ name: 'amont', suggest: 'amount' });
    expect('=Fields.amont + 1'.slice(i.from, i.to)).toBe('amont');
  });
  it('a text template is checked part by part; text outside {…} and names in quotes are not references', () => {
    expect(exprParts('Total {Fields.amount} of {Fields.regin}').map((p) => p.text)).toEqual([
      'Fields.amount',
      'Fields.regin',
    ]);
    expect(fieldIssues('Total {Fields.amount} of {Fields.regin}', SETS, 'Sales').map((i) => i.name)).toEqual(['regin']);
    expect(fieldIssues('="Fields.nothing"', SETS, 'Sales')).toEqual([]);
    expect(fieldIssues('Fields.nothing', SETS, 'Sales')).toEqual([]);
  });
  it('the item’s own data set is the scope; an aggregate naming another data set reads its fields too', () => {
    expect(fieldIssues('=Fields.sku', SETS, 'Stock')).toEqual([]);
    expect(fieldIssues('=Fields.sku', SETS, 'Sales').map((i) => i.name)).toEqual(['sku']);
    expect(fieldIssues('=Sum(Fields.sku, "Stock")', SETS, 'Sales')).toEqual([]);
  });
  it('case does not matter; .Value is the field itself', () => {
    expect(fieldIssues('=Fields.AMOUNT.Value', SETS, 'Sales')).toEqual([]);
  });
  it('a data set with no fields yet is not checked (nothing to check against)', () => {
    expect(fieldIssues('=Fields.anything', [{ name: 'X', source: 'src' }], 'X')).toEqual([]);
  });
  it('nested objects: dotted children are fields, an unknown child is flagged with a suggestion', () => {
    const nested = nestedFields([{ customer: { name: 'A', address: { city: 'B' } } }]);
    expect(nested[0].fields.map((f) => f.name)).toEqual(['name', 'address.city']);
    const sets = [{ name: 'O', fields: [{ name: 'id', type: 'number' }, ...nested] }];
    expect(fieldNames(sets[0])).toContain('customer.address.city');
    expect(fieldIssues('=Fields.customer.name', sets, 'O')).toEqual([]);
    expect(fieldIssues('=Fields.customer.nmae', sets, 'O')[0]).toMatchObject({
      name: 'customer.nmae',
      suggest: 'customer.name',
    });
  });
});

describe('designIssues: missing fields in the Issues list', () => {
  it('flags text boxes, table cells, groups and matrices that read a field the data set lacks (a renamed field)', () => {
    const renamed = SETS.map((s) =>
      s.name === 'Sales' ? { ...s, fields: FIELDS.map((f) => (f.name === 'amount' ? { ...f, name: 'total' } : f)) } : s,
    );
    const items = [
      { id: 'a', type: 'textbox', name: 'A', x: 0, y: 0, w: 100, h: 20, value: '=Fields.amount', dataSet: 'Sales' },
      {
        id: 't',
        type: 'table',
        name: 'T',
        x: 0,
        y: 40,
        w: 200,
        h: 54,
        dataSet: 'Sales',
        columns: [{ width: 100 }, { width: 100 }],
        header: [],
        detail: [{ cells: [{ value: '=Fields.region' }, { value: '=Fields.amount' }] }],
        footer: [],
        groups: [{ name: 'G', expr: '=Fields.amount' }],
      },
      {
        id: 'm',
        type: 'matrix',
        name: 'M',
        x: 0,
        y: 120,
        w: 200,
        h: 54,
        dataSet: 'Sales',
        rowGroups: [{ expr: '=Fields.region' }],
        columnGroups: [],
        values: [{ value: '=Sum(Fields.amount)' }],
      },
      {
        id: 'h',
        type: 'textbox',
        name: 'H',
        x: 0,
        y: 200,
        w: 100,
        h: 20,
        value: 'x',
        hidden: '=Fields.amount < 0',
        dataSet: 'Sales',
      },
    ];
    expect(fieldsFlagged(def(items, { dataSets: renamed }))).toEqual(['A:amount', 'T:amount', 'M:amount', 'H:amount']);
    expect(fieldsFlagged(def(items))).toEqual([]);
  });
  it('a child of a list reads the list’s data set', () => {
    const list = {
      id: 'l',
      type: 'list',
      name: 'L',
      x: 0,
      y: 0,
      w: 200,
      h: 60,
      dataSet: 'Stock',
      items: [{ id: 'k', type: 'textbox', name: 'K', x: 0, y: 0, w: 100, h: 20, value: '=Fields.sku' }],
    };
    expect(fieldsFlagged(def([list]))).toEqual([]);
    expect(fieldsFlagged(def([{ ...list, dataSet: 'Sales' }]))).toEqual(['K:sku']);
  });
  it('checkIssues maps a save-check message to its item, so a click in the Issues list selects it', () => {
    const items = [
      { id: 'a1', type: 'textbox', name: 'Amount', x: 0, y: 0, w: 100, h: 20 },
      { id: 't1', type: 'table', name: 'T', x: 0, y: 40, w: 100, h: 20 },
    ];
    const out = checkIssues(
      [{ items }],
      [
        'Amount: Expected ) at 12',
        'T detail cell: Unknown function Foo',
        'Data set "X" uses the source "y", which does not exist',
      ],
    );
    expect(out.map((i) => i.id)).toEqual(['a1', 't1', null]);
  });
  it('a syntax error typed in the Inspector is a save-check error the Issues list shows', () => {
    const v = validate(
      def([{ id: 'a', type: 'textbox', name: 'A', x: 0, y: 0, w: 100, h: 20, value: '=Sum(Fields.amount' }]),
    );
    expect(v.errors.some((e) => e.startsWith('A:'))).toBe(true);
  });
});

describe('what a stale name renders as (the reason the rename gaps matter)', () => {
  const one = (value, more) => def([{ type: 'textbox', name: 'A', x: 0, y: 0, w: 100, h: 20, value }], more);
  const text = async (d) =>
    (await render(d, { fontStore })).pages[0].items.flatMap((i) => (i.lines || []).map((l) => l.text));
  it('an aggregate scoped to a data set that was renamed draws #Error', async () => {
    expect(
      await text(one('=Sum(Fields.amount, "Sales")', { dataSets: [{ ...SETS[0], name: 'Orders', path: '$' }] })),
    ).toEqual(['#Error']);
    expect(
      await text(one('=Sum(Fields.amount, "Orders")', { dataSets: [{ ...SETS[0], name: 'Orders', path: '$' }] })),
    ).toEqual(['3']);
  });
  it('a parameter that was renamed draws #Error', async () => {
    expect(
      await text(one('=Parameters.region', { parameters: [{ name: 'area', type: 'string', default: 'N' }] })),
    ).toEqual(['#Error']);
  });
});

describe('store guards for values typed in the Inspector', () => {
  const load = (items) => {
    const st = newDesignerStore();
    activateStore(st);
    st.getState().init('r', def(items));
    return st;
  };
  it('a size below 1, negative or not a number becomes 1; a place is kept as given', () => {
    const st = load([{ type: 'textbox', name: 'A', x: 0, y: 0, w: 100, h: 20 }]);
    const id = st.getState().def.sections.body.items[0].id;
    updateItem(id, (it) => {
      it.w = -50;
      it.h = Number('abc');
    });
    const a = findItem(st.getState().def, id).item;
    expect([a.w, a.h]).toEqual([1, 1]);
  });
  it('a table column is at least 12 pt wide', () => {
    const st = load([
      {
        type: 'table',
        name: 'T',
        x: 0,
        y: 0,
        w: 200,
        h: 36,
        columns: [{ width: 100 }, { width: 100 }],
        header: [],
        detail: [{ height: 18, cells: [{}, {}] }],
        footer: [],
      },
    ]);
    const id = st.getState().def.sections.body.items[0].id;
    tableSetColumnWidth(id, 0, 4);
    expect(findItem(st.getState().def, id).item.columns[0].width).toBe(12);
  });
});
