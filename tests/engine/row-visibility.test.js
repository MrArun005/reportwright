// Table rows: a hidden expression per row (header, group, detail, footer), and row styles beyond the background.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';

const rows = [{ name: 'a', v: 1 }, { name: 'b', v: 9 }, { name: 'c', v: 3 }];
const table = (extra = {}) => ({
  type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 200, h: 54, columns: [{ width: 100 }, { width: 100 }],
  header: [{ height: 14, cells: [{ value: 'Name' }, { value: 'V' }] }, { height: 14, hidden: '=Parameters.brief', cells: [{ value: 'detail header' }, { value: '' }] }],
  detail: [{ height: 14, cells: [{ value: '=Fields.name' }, { value: '=Fields.v' }] }, { height: 14, hidden: '=Fields.v < 5', cells: [{ value: '=Fields.name & " is big"' }, null] }],
  footer: [{ height: 14, hidden: true, cells: [{ value: 'secret footer' }, null] }, { height: 14, style: { fontWeight: 'bold', color: '#b91c1c', borderTop: '1 solid #000', verticalAlign: 'bottom' }, cells: [{ value: 'Total' }, { value: '=Sum(Fields.v)' }] }],
  ...extra,
});
const run = async (params) => render(report([table()], { data: { rows }, def: { parameters: [{ name: 'brief', type: 'boolean', default: false }] } }), { fontStore, parameters: params });

describe('table row visibility', () => {
  it('hides a row when its expression is true, per record for detail rows', async () => {
    const m = await run({ brief: false });
    const t = texts(m.pages[0]);
    expect(t).toContain('detail header');
    expect(t).toContain('b is big');
    expect(t).not.toContain('a is big');
    expect(t).not.toContain('secret footer');
    expect((await run({ brief: true })).pages[0].items.some(i => i.t === 'text' && i.lines.some(l => l.text === 'detail header'))).toBe(false);
  });
  it('a hidden row takes no space', async () => {
    const m = await run({ brief: true });
    const name = m.pages[0].items.find(i => i.t === 'text' && i.lines[0].text === 'a');
    const header = m.pages[0].items.find(i => i.t === 'text' && i.lines[0].text === 'Name');
    expect(name.lines[0].y - header.lines[0].y).toBeLessThan(20); // one header row above, not two
  });
  it('row styles reach the cells: font weight, colour, borders', async () => {
    const m = await run({ brief: false });
    const total = m.pages[0].items.find(i => i.t === 'text' && i.lines[0].text === 'Total');
    expect(total.color).toBe('#b91c1c');
    expect(total.font).toMatch(/bold/i);
  });
});
