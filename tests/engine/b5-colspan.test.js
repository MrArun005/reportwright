// B5 item 7: colSpan in both forms (one entry per column, or RDL/HTML style with the spanned cells omitted), and a
// validate() warning for a cell under a span (it used to be drawn on top of the spanning cell).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, report, texts } from '../helpers.js';

const table = (header) => report([{ type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }], header: [{ height: 16, cells: header }], detail: [{ height: 16, cells: [{ value: 'a' }, { value: 'b' }, { value: 'c' }] }] }], { data: { rows: [{}] } });
const xs = async (d) => (await render(d, { fontStore })).pages[0].items.filter(i => i.t === 'text').map(i => [i.lines[0].text, Math.round(i.lines[0].x)]);

describe('table colSpan', () => {
  it('RDL/HTML style: fewer cells than columns, spanned cells omitted', async () => {
    const got = Object.fromEntries(await xs(table([{ value: 'Wide', colSpan: 2 }, { value: 'Last' }])));
    expect(got.Last - got.Wide).toBe(200); // Last starts in the third column
    expect(validate(table([{ value: 'Wide', colSpan: 2 }, { value: 'Last' }])).warnings).toEqual([]);
  });
  it('one entry per column with null under the span: the same layout', async () => {
    expect(await xs(table([{ value: 'Wide', colSpan: 2 }, null, { value: 'Last' }]))).toEqual(await xs(table([{ value: 'Wide', colSpan: 2 }, { value: 'Last' }])));
  });
  it('a cell under a span is not drawn, and validate() says so', async () => {
    const d = table([{ value: 'Wide', colSpan: 2 }, { value: 'Hidden' }, { value: 'Last' }]);
    const t = texts((await render(d, { fontStore })).pages[0]);
    expect(t).not.toContain('Hidden');
    expect(validate(d).warnings).toEqual([expect.stringMatching(/^T header row 1: cell 1 is covered by colSpan of cell 0/)]);
  });
});
