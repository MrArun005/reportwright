// B9 data tickets: N26 text in a number field.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { exportPdfStream } from '../../src/exporters/pdfstream.js';
import { fontStore } from '../helpers.js';

const rows = [{ amount: '12.34' }, { amount: 'abc' }, { amount: null }, {}, { amount: '7' }, { amount: '' }];
const sqlDef = () => ({
  $schema: 'reportwright/report@1', name: 'L', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'sql', connection: 'db', query: 'select 1' }],
  dataSets: [{ name: 'D', source: 's', fields: [{ name: 'amount', type: 'number' }] }],
  sections: { body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 200, h: 40, columns: [{ width: 200 }],
    header: [{ height: 14, cells: [{ value: 'A' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.amount' }] }] }] } },
});
const jsonDef = () => ({ ...sqlDef(), dataSources: [{ name: 's', type: 'json', data: { rows } }], dataSets: [{ name: 'D', source: 's', path: '$.rows', fields: [{ name: 'amount', type: 'number' }] }] });
const want = 'Data set "D", field "amount": 1 value does not read as a number (for example "abc"), so it is blank. First: row 2. 3 are empty.';

describe('N26: text in a number field', () => {
  it('render() warns once per field: first bad row, and how many are empty', async () => {
    const m = await render(jsonDef(), { fontStore });
    expect(m.warnings.filter(w => /amount/.test(w) && /not read/.test(w))).toEqual([want]);
  });
  it('numeric strings (pg NUMERIC) and plain empties alone are silent', async () => {
    const d = jsonDef();
    d.dataSources[0].data = { rows: [{ amount: '12.34' }, { amount: null }, {}, { amount: 5 }] };
    const m = await render(d, { fontStore });
    expect(m.warnings.filter(w => /not read/.test(w))).toEqual([]);
  });
  it('the streamed export warns the same', async () => {
    const sqlRows = () => (async function* () { yield rows; })();
    const r = await exportPdfStream(sqlDef(), { fontStore, sqlRows, now: new Date('2026-01-02T00:00:00Z') }, { write: async () => {} });
    expect(r.warnings.filter(w => /not read/.test(w))).toEqual([want]);
  });
});

describe('N8: data set rows given as an object', () => {
  const mk = (data, path) => ({ ...jsonDef(), dataSources: [{ name: 's', type: 'json', data }], dataSets: [{ name: 'D', source: 's', path }],
    sections: { body: { items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 20, value: '=Sum(Fields.n)', dataSet: 'D' }] } } });
  it('an object holding the rows warns and names the key', async () => {
    const m = await render(mk({ orders: { rows: [{ n: 1 }, { n: 2 }] } }, '$.orders'), { fontStore });
    expect(m.warnings).toContain('Data set "D": $.orders is an object, not a list of rows, so it is one row; expected an array of rows (did you mean $.orders.rows?)');
  });
  it('a single-object data set ($.meta) does not warn', async () => {
    const m = await render(mk({ meta: { n: 3, tags: [{ a: 1 }] } }, '$.meta'), { fontStore });
    expect(m.warnings.filter(w => /not a list/.test(w))).toEqual([]);
    const m2 = await render(mk({ meta: { n: 3, title: 'x' } }, '$.meta'), { fontStore });
    expect(m2.warnings.filter(w => /not a list/.test(w))).toEqual([]);
  });
});
