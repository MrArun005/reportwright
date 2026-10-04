import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, texts, report } from '../helpers.js';

const footer = { height: 20, items: [{ type: 'textbox', name: 'pn', x: 0, y: 4, w: 300, h: 12, value: 'Page {Globals.PageNumber} of {Globals.TotalPages} · {Globals.OverallPageNumber}/{Globals.OverallTotalPages}' }] };
const pageLines = (out) => out.pages.map(p => texts(p).find(t => t.startsWith('Page ')));

describe('page numbers per section (newSection)', () => {
  // invoices with 60, 10 and 100 lines: 2, 1 and 3 pages
  const lines = [...Array.from({ length: 60 }, (_, i) => ({ inv: 'A', n: i })), ...Array.from({ length: 10 }, (_, i) => ({ inv: 'B', n: i })), ...Array.from({ length: 100 }, (_, i) => ({ inv: 'C', n: i }))];
  const tbl = (g) => ({ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }],
    groups: [{ name: 'Inv', expr: '=Fields.inv', header: [{ height: 16, cells: [{ value: '="Invoice " & Fields.inv' }] }], ...g }],
    detail: [{ height: 14, cells: [{ value: '=Fields.n' }] }] });
  it('a table group restarts PageNumber and TotalPages; Overall* count the report', async () => {
    const out = await render(report([tbl({ newSection: true })], { data: { rows: lines }, footer }), { fontStore });
    expect(pageLines(out)).toEqual(['Page 1 of 2 · 1/6', 'Page 2 of 2 · 2/6', 'Page 1 of 1 · 3/6', 'Page 1 of 3 · 4/6', 'Page 2 of 3 · 5/6', 'Page 3 of 3 · 6/6']);
    expect(texts(out.pages[2])[0]).toBe('Invoice B');
  });
  it('a list with newSection: each record its own numbering', async () => {
    const invs = { rows: [{ id: 'X', n: 3 }, { id: 'Y', n: 70 }] };
    const sets = [{ name: 'Rows', source: 'src', path: '$.rows' }];
    const inner = { type: 'table', name: 'Lines', x: 0, y: 20, w: 200, h: 16, dataSet: 'Nums', columns: [{ width: 200 }], detail: [{ height: 14, cells: [{ value: '=Fields.k' }] }], filters: [{ expr: '=Fields.k', op: '<', value: '=Parent.n' }] };
    const list = { type: 'list', name: 'L', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', newSection: true, keepTogether: false, items: [{ type: 'textbox', name: 'h', x: 0, y: 0, w: 200, h: 14, value: '="Invoice " & Fields.id' }, inner] };
    const def = report([list], { data: { ...invs, nums: Array.from({ length: 70 }, (_, k) => ({ k })) }, footer, def: { dataSets: [...sets, { name: 'Nums', source: 'src', path: '$.nums' }] } });
    const out = await render(def, { fontStore });
    expect(pageLines(out)).toEqual(['Page 1 of 1 · 1/3', 'Page 1 of 2 · 2/3', 'Page 2 of 2 · 3/3']);
  });
});

describe('multi-section reports', () => {
  const cover = { type: 'textbox', name: 'c', x: 0, y: 0, w: 300, h: 20, value: 'Cover' };
  const wideRows = Array.from({ length: 40 }, (_, i) => ({ n: i }));
  const tbl = { type: 'table', name: 'T', x: 0, y: 0, w: 700, h: 40, dataSet: 'Rows', columns: [{ width: 700 }], detail: [{ height: 14, cells: [{ value: '=Fields.n' }] }] };
  const def = () => {
    const d = report([], { data: { rows: wideRows }, footer });
    d.sections.body = [{ name: 'Cover', items: [cover] }, { name: 'Data', page: { orientation: 'landscape' }, items: [tbl] }];
    return d;
  };
  it('each body section has its own page size; numbering continues', async () => {
    const out = await render(def(), { fontStore });
    expect(out.pages.length).toBe(3);
    expect([out.width, out.height]).toEqual([595.28, 841.89]);
    expect(out.pages[0].width).toBeUndefined();
    expect([out.pages[1].width, out.pages[1].height]).toEqual([841.89, 595.28]);
    expect(pageLines(out)).toEqual(['Page 1 of 3 · 1/3', 'Page 2 of 3 · 2/3', 'Page 3 of 3 · 3/3']);
    expect(texts(out.pages[0])[0]).toBe('Cover');
    expect(texts(out.pages[1])[0]).toBe('0');
    // the landscape page's footer sits at its own bottom
    const pn = out.pages[1].items.find(i => i.t === 'text' && i.lines[0].text.startsWith('Page'));
    expect(pn.clip.y).toBeCloseTo(595.28 - 36 - 20 + 4, 2);
  });
  it('validate: an array body is fine, an empty one is not', () => {
    expect(validate(def()).errors).toEqual([]);
    const d = def(); d.sections.body = [];
    expect(validate(d).errors).toContain('The report has no body section');
    d.sections.body = [{ items: [], page: 'A4' }];
    expect(validate(d).errors.join()).toMatch(/"page" must be an object/);
  });
});
