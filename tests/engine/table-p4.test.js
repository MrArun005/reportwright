import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const data = { rows: [{ id: 1, name: 'Asha', amt: 10 }, { id: 2, name: 'Ravi', amt: 20 }, { id: 3, name: 'Meera', amt: 30 }] };
const table = (extra) => ({ type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }], header: [], detail: [], footer: [], ...extra });
const textAt = (page, s) => page.items.filter(i => i.t === 'text' && i.lines.some(l => l.text === s));

describe('merged cells across rows (rowSpan)', () => {
  it('paints one text and a background in every row, with no border between them', async () => {
    const def = report([table({ header: [
      { height: 20, cells: [{ value: 'Name', rowSpan: 2, style: { backgroundColor: '#eeeeee', border: '1 solid #000000' } }, { value: 'Amounts', colSpan: 2 }, null] },
      { height: 20, cells: [null, { value: 'Paid' }, { value: 'Due' }] },
    ] })], { data });
    const out = await render(def, { fontStore });
    const pg = out.pages[0];
    expect(texts(pg).filter(t => t === 'Name')).toHaveLength(1);
    const x0 = 36; // left margin
    const bg = pg.items.filter(i => i.t === 'rect' && i.fill === '#eeeeee');
    expect(bg.map(r => [r.x, r.y, r.h])).toEqual([[x0, 36, 20], [x0, 56, 20]]);
    const across = pg.items.filter(i => i.t === 'line' && i.y1 === i.y2 && i.x1 === x0 && i.x2 === x0 + 100).map(l => l.y1);
    expect(across).toEqual([36, 76]); // top of the first row and bottom of the second, nothing at 56
    expect(texts(pg)).toEqual(['Name', 'Amounts', 'Paid', 'Due']);
    // the data export knows the span
    expect(out.regions[0].rows[0].cells[0]).toMatchObject({ value: 'Name', rowSpan: 2, colIndex: 0 });
  });

  it('spans rows of one record in a detail band with several rows', async () => {
    const def = report([table({ detail: [
      { height: 16, cells: [{ value: '=Fields.name', rowSpan: 2 }, { value: '="#" & Fields.id' }, { value: '=Fields.amt' }] },
      { height: 16, cells: [null, { value: 'note' }, { value: '=Fields.amt * 2' }] },
    ] })], { data });
    const t = texts((await render(def, { fontStore })).pages[0]);
    expect(t).toEqual(['Asha', '#1', '10', 'note', '20', 'Ravi', '#2', '20', 'note', '40', 'Meera', '#3', '30', 'note', '60']);
  });

  it('a span never reaches into the next band', async () => {
    const def = report([table({ header: [{ height: 16, cells: [{ value: 'H', rowSpan: 5 }, { value: 'x' }, null] }], detail: [{ height: 16, cells: [{ value: '=Fields.name' }, null, null] }] })], { data });
    const t = texts((await render(def, { fontStore })).pages[0]);
    expect(t).toEqual(['H', 'x', 'Asha', 'Ravi', 'Meera']);
  });

  it('the last row grows when the merged text needs more room', async () => {
    const long = 'A long label that wraps onto several lines in a narrow merged cell';
    const def = report([table({ columns: [{ width: 60 }, { width: 100 }], header: [
      { height: 14, cells: [{ value: long, rowSpan: 2 }, { value: 'a' }] }, { height: 14, cells: [null, { value: 'b' }] }] })], { data });
    const pg = (await render(def, { fontStore })).pages[0];
    const label = pg.items.find(i => i.t === 'text' && i.lines[0].text.startsWith('A long'));
    const b = textAt(pg, 'b')[0];
    const bottom = label.lines[label.lines.length - 1].y;
    expect(b.clip.y + b.clip.h).toBeGreaterThan(bottom); // row 2 grew to hold the label
  });

  it('draws the merged text again at the top of the page its rows continue on', async () => {
    const body = Array.from({ length: 80 }, (_, i) => ({ row: { height: 16, cells: i === 0 ? [{ raw: 'Region North', rowSpan: 80 }, { raw: `r${i}` }] : [null, { raw: `r${i}` }] }, kind: 'detail' }));
    const def = report([{ ...table({ columns: [{ width: 120 }, { width: 120 }] }), dataSet: null, __body: body }]);
    const out = await render(def, { fontStore });
    expect(out.pages.length).toBe(2);
    const p2 = out.pages[1];
    const again = textAt(p2, 'Region North');
    expect(again).toHaveLength(1);
    const first = p2.items.find(i => i.t === 'text' && /^r\d+$/.test(i.lines[0].text));
    expect(Math.abs(again[0].lines[0].y - first.lines[0].y)).toBeLessThan(0.01); // same line as the first row on page 2
    expect(texts(out.pages[0]).filter(t => t === 'Region North')).toHaveLength(1);
  });
});

describe('cells', () => {
  it('a toggle on any cell, and raw values that are never evaluated', async () => {
    const def = report([table({ dataSet: null, __body: [{ row: { height: 16, cells: [{ raw: '=1+1' }, { raw: '{Fields.x}', toggle: { key: 'k1', open: false } }, { raw: 5 }] }, kind: 'detail' }] })]);
    const pg = (await render(def, { fontStore })).pages[0];
    expect(texts(pg)).toEqual(['=1+1', '▶ {Fields.x}', '5']);
    const link = pg.items.find(i => i.t === 'link');
    expect(link).toMatchObject({ x: 136, w: 100, action: { type: 'toggle', key: 'k1', open: false } });
  });
});
