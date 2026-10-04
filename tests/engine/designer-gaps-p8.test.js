// Designer gaps found by rebuilding the Torture Test in the Designer (after Phase 8).
import { describe, it, expect } from 'vitest';
import { detectFields, coerce } from '../../src/engine/data/index.js';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

describe('list fields (#1)', () => {
  it('detection: an array of values is a list; an array of objects is not a field', () => {
    const f = detectFields([{ id: 1, history: [3, 5, 2], items: [{ a: 1 }], name: 'x' }]);
    expect(f).toEqual([{ name: 'id', type: 'number' }, { name: 'history', type: 'list' }, { name: 'name', type: 'string' }]);
  });
  it('a list field: arrays as they are, text split at commas', () => {
    expect(coerce([1, 2], 'list')).toEqual([1, 2]);
    expect(coerce('3, 5;2.5,x', 'list')).toEqual([3, 5, 2.5, 'x']);
    expect(coerce(7, 'list')).toEqual([7]);
  });
  it('a sparkline over a list field needs no Split()', async () => {
    const def = report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 200, h: 36, columns: [{ width: 200 }],
      detail: [{ height: 18, cells: [{ visual: { type: 'sparkline', values: '=Fields.trend' } }] }] }],
    { data: { rows: [{ trend: '1,4,2,8' }] }, def: { dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', fields: [{ name: 'trend', type: 'list' }] }] } });
    const m = await render(def, { fontStore });
    expect(m.warnings).toEqual([]);
    expect(m.pages[0].items.some(i => i.t === 'path' || i.t === 'polyline' || (i.t === 'line'))).toBe(true);
  });
});

import { formatFor, tableFor, isCode } from '../../src/designer/tableGen.js';
describe('table gallery: ids are whole words (#2)', () => {
  it('ids and codes, not money', () => {
    for (const n of ['id', 'ID', 'loan_id', 'customerId', 'zipCode', 'pin', 'year', 'invoiceNo', 'code', 'accountNumber']) expect(isCode(n), n).toBe(true);
    for (const n of ['paid', 'principalPaid', 'amountPaid', 'valid', 'void', 'totalAmount', 'grid', 'rapid', 'interestDue']) expect(isCode(n), n).toBe(false);
  });
  it('paid and principalPaid get totals and a money format', () => {
    const ds = { name: 'L', fields: [{ name: 'loanId', type: 'number' }, { name: 'paid', type: 'number' }, { name: 'principalPaid', type: 'number' }] };
    const t = tableFor(ds, { rows: [{ loanId: 7, paid: 10.5, principalPaid: 4.25 }] });
    expect(t.footer[0].cells.map(c => c.value)).toEqual(['Total', '=Sum(Fields.paid)', '=Sum(Fields.principalPaid)']);
    expect(formatFor({ name: 'paid', type: 'number' }, [{ paid: 1.5 }])).toBe('N2');
    expect(formatFor({ name: 'loanId', type: 'number' }, [])).toBe('0');
  });
});

import { useDesigner, moveItems, updateItem, growToFit, findItem } from '../../src/designer/store.js';
describe('band height stays consistent (#3)', () => {
  const load = (h, y) => useDesigner.getState().init('x', { $schema: 'pagewright/report@1', name: 'x', page: { size: 'A4' }, sections: { body: { height: h, items: [{ id: 'a', type: 'textbox', name: 'A', x: 0, y, w: 100, h: 20 }] } } });
  const body = () => useDesigner.getState().def.sections.body;
  it('opening a report keeps its band height (it only grows to the lowest item)', () => {
    load(200, 170); expect(body().height).toBe(200);
    load(100, 170); expect(body().height).toBe(190);
  });
  it('an item moved below the band grows it to the item, never more', () => {
    load(200, 0);
    moveItems(['a'], 0, 300);
    expect(body().height).toBe(320);
    updateItem('a', (it, d, s, f) => { it.y = 500; growToFit(d, f); });
    expect(body().height).toBe(520);
    expect(findItem(useDesigner.getState().def, 'a').item.y).toBe(500);
  });
});

import { exportPdf } from '../../src/exporters/pdf.js';
import { pageToSvg } from '../../src/exporters/svg.js';
describe('corner radius on text boxes and containers (#4)', () => {
  it('a rounded background and one rounded border; drawn by the SVG and PDF exporters', async () => {
    const def = report([
      { type: 'textbox', name: 'T', x: 0, y: 0, w: 120, h: 30, value: 'Hi', style: { backgroundColor: '#eeeeee', border: '1 solid #333333', radius: 6 } },
      { type: 'container', name: 'C', x: 0, y: 40, w: 120, h: 40, items: [], style: { border: '1 solid #333333', radius: 8 } },
    ]);
    const m = await render(def, { fontStore });
    const rects = m.pages[0].items.filter(i => i.t === 'rect');
    expect(rects.map(r => r.radius)).toEqual([6, 6, 8]);
    expect(m.pages[0].items.filter(i => i.t === 'line')).toEqual([]);
    expect(pageToSvg(m.pages[0], m.width, m.height).match(/rx="/g).length).toBe(3);
    expect((await exportPdf(m, fontStore)).length).toBeGreaterThan(500);
  });
  it('mixed side borders stay lines; the radius never exceeds half the box', async () => {
    const m = await render(report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 40, h: 10, value: '', canGrow: false, style: { backgroundColor: '#eee', borderBottom: '1 solid #000', radius: 50 } }]), { fontStore });
    expect(m.pages[0].items.find(i => i.t === 'rect').radius).toBe(5);
    expect(m.pages[0].items.filter(i => i.t === 'line').length).toBe(1);
  });
});

import fs from 'node:fs';
import { STRINGS } from '../../src/i18n/index.js';
describe('a cell has two different bookmark labels (#5)', () => {
  it('"Bookmark (this cell)" and "Jump to bookmark", in every language', () => {
    for (const [lang, s] of Object.entries(STRINGS)) expect(s.cellBookmark, lang).not.toBe(s.jumpToBookmark);
    expect(fs.readFileSync(new URL('../../src/designer/Inspector.jsx', import.meta.url), 'utf8')).not.toMatch(/label="Bookmark"/);
  });
});

import { addItem } from '../../src/designer/store.js';
describe('a table’s stored height is its rows’ (#6)', () => {
  it('on load and on insert', () => {
    const tbl = { id: 't', type: 'table', name: 'T', x: 0, y: 0, w: 10, h: 300, columns: [{ width: 50 }, { width: 70 }], header: [{ height: 20, cells: [{}, {}] }], detail: [{ height: 18, cells: [{}, {}] }], footer: [] };
    useDesigner.getState().init('x', { $schema: 'pagewright/report@1', name: 'x', page: { size: 'A4' }, sections: { body: { height: 400, items: [tbl] } } });
    expect(findItem(useDesigner.getState().def, 't').item).toMatchObject({ w: 120, h: 38 });
    const id = addItem('table', 'body', 0, 100, { columns: [{ width: 40 }], header: [], detail: [{ height: 25, cells: [{}] }], footer: [{ height: 18, cells: [{}] }], groups: [] });
    expect(findItem(useDesigner.getState().def, id).item).toMatchObject({ w: 40, h: 43 });
  });
});
