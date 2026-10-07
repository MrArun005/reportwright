// B5 item 13: implicit behaviour, documented and switchable: ISO date detection, chart colours by category, C2's currency.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';

const rows = [{ d: '2024-01-31', n: 'North', v: 3 }, { d: '2024-02-01', n: 'South', v: 5 }];
const box = (value) => ({ type: 'textbox', x: 0, y: 0, w: 300, h: 16, value });
const textOf = async (def) => texts((await render(def, { fontStore })).pages[0]).join(' | ');

describe('ISO date detection', () => {
  it('detected fields turn ISO strings into dates; detectDates: false or a declared string field keeps the text', async () => {
    const expr = box('=First(Fields.d)');
    expect(await textOf(report([expr], { data: { rows } }))).not.toMatch(/2024-01-31/); // a date, shown the locale's way
    const off = report([expr], { data: { rows } });
    off.dataSets[0].detectDates = false;
    expect(await textOf(off)).toMatch(/2024-01-31/);
    const declared = report([expr], { data: { rows } });
    declared.dataSets[0].fields = [{ name: 'd', type: 'string' }];
    expect(await textOf(declared)).toMatch(/2024-01-31/);
  });
});

describe('chart colours by category (colorByCategory)', () => {
  const pie = (name, order) => ({ type: 'chart', name, chartType: 'pie', x: 0, y: 0, w: 200, h: 150, dataSet: 'Rows', category: '=Fields.n', series: [{ value: '=Sum(Fields.v)' }], categorySort: order, colorByCategory: true });
  it('the same category gets the same colour in two charts even when their order differs', async () => {
    const d = report([pie('A', 'asc'), { ...pie('B', 'desc'), y: 200 }], { data: { rows } });
    const m = await render(d, { fontStore });
    const paths = m.pages[0].items.filter(i => i.t === 'path' && i.fill);
    const [a, b] = [paths.slice(0, 2).map(p => p.fill), paths.slice(2, 4).map(p => p.fill)];
    expect(a).toHaveLength(2);
    expect(b).toEqual([a[1], a[0]]); // desc order: South first, still South's colour
  });
});

describe('C2 with no currency', () => {
  it('uses the locale\'s currency', async () => {
    expect(await textOf(report([box('=Format(1234.5, "C2")')], { def: { locale: 'en-IN' } }))).toMatch(/₹/);
    expect(await textOf(report([box('=Format(1234.5, "C2")')], { def: { locale: 'de-DE' } }))).toMatch(/€/);
  });
});
