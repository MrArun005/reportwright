// Batch 4 layout: a page header and footer per body section, named content placeholders in a master,
// recursive row groups in a matrix, and items in table cells that continue on the next page.
import { describe, it, expect } from 'vitest';
import { render, BAND_ITEMS } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, texts, report } from '../helpers.js';

const tb = (name, value, y = 0, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 14, value, ...extra });
const band = (h, ...items) => ({ height: h, items });

describe('a page header and footer per body section', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ n: i }));
  const tbl = (name) => ({ type: 'table', name, x: 0, y: 0, w: 200, h: 14, dataSet: 'Rows', columns: [{ width: 200 }], detail: [{ height: 14, cells: [{ value: '=Fields.n' }] }] });
  const def = (sections) => {
    const d = report([], { data: { rows }, header: band(20, tb('H', 'Shared header')), footer: band(20, tb('F', 'Shared footer {Globals.PageNumber}')) });
    d.sections.body = sections;
    return d;
  };
  it('a section with its own header and footer uses them; the others keep the shared ones', async () => {
    const out = await render(def([
      { name: 'Cover', items: [tb('c', 'Cover')] },
      { name: 'Data', pageHeader: band(30, tb('H2', 'Data header')), pageFooter: band(16, tb('F2', 'Data footer {Globals.PageNumber}/{Globals.TotalPages}')), items: [tbl('T')] },
      { name: 'End', items: [tb('e', 'The end')] },
    ]), { fontStore });
    const t = out.pages.map(texts);
    expect(t[0]).toEqual(expect.arrayContaining(['Shared header', 'Cover', 'Shared footer 1']));
    const data = t.slice(1, -1);
    expect(data.length).toBeGreaterThan(1);
    for (const p of data) {
      expect(p).toContain('Data header');
      expect(p).not.toContain('Shared header');
      expect(p.some(s => /^Data footer \d+\/\d+$/.test(s))).toBe(true);
    }
    expect(t[t.length - 1]).toEqual(expect.arrayContaining(['Shared header', 'The end']));
    // the body starts under the section's own (taller) header, and its footer sits at its own height above the margin
    const first = out.pages[1].items.find(i => i.t === 'text' && i.lines[0].text === '0');
    expect(first.clip.y).toBeCloseTo(36 + 30, 1);
    const foot = out.pages[1].items.find(i => i.t === 'text' && i.lines[0].text.startsWith('Data footer'));
    expect(foot.clip.y).toBeCloseTo(841.89 - 36 - 16, 1);
  });
  it('hidden: true leaves the section without a header (the body gets the room)', async () => {
    const shared = await render(def([{ items: [tbl('T')] }]), { fontStore });
    const none = await render(def([{ pageHeader: { hidden: true }, pageFooter: { hidden: true }, items: [tbl('T')] }]), { fontStore });
    const nums = (o) => texts(o.pages[0]).filter(s => /^\d+$/.test(s)).length;
    expect(nums(none)).toBeGreaterThan(nums(shared)); // the room of both bands goes to the body
    for (const p of none.pages) { expect(texts(p)).not.toContain('Shared header'); expect(texts(p).some(s => s.startsWith('Shared footer'))).toBe(false); }
    const first = none.pages[0].items.find(i => i.t === 'text' && i.lines[0].text === '0');
    expect(first.clip.y).toBeCloseTo(36, 1);
  });
  it('printOnFirstPage / printOnLastPage of a section band count the section\'s pages', async () => {
    const out = await render(def([
      { items: [tb('c', 'Cover')] },
      { pageHeader: { ...band(20, tb('H2', 'Own header')), printOnFirstPage: false }, items: [tbl('T')] },
    ]), { fontStore });
    const own = out.pages.slice(1).map(p => texts(p).includes('Own header'));
    expect(own[0]).toBe(false);
    expect(own.slice(1).every(Boolean)).toBe(true);
  });
  it('validate: section bands are checked like the shared ones (PageNumber allowed, tables not)', () => {
    const d = def([{ pageHeader: band(20, tb('H2', 'Page {Globals.PageNumber}'), { ...tbl('X') }), items: [] }]);
    const v = validate(d);
    expect(v.warnings.join()).not.toMatch(/PageNumber/);
    expect(v.errors.join()).toMatch(/X: tables can only be in the body/);
    const bad = def([{ pageHeader: 'x', items: [] }]);
    expect(validate(bad).errors.join()).toMatch(/Body section 1: "pageHeader" must be an object/);
  });
  it('the content left must still fit: a section header that eats the page is an error', async () => {
    await expect(render(def([{ pageHeader: band(900), items: [] }]), { fontStore })).rejects.toThrow(/Body section 1: the page header and footer leave no room/);
  });
});

describe('section bands stay inside the render budgets (adversarial)', () => {
  // 20 body sections × 100 pages each, every section with its own heavy header: 2,000 pages
  const heavy = (n, value, k) => ({ height: 40, items: Array.from({ length: n }, (_, i) => ({ type: 'textbox', name: `h${k}_${i}`, x: (i % 20) * 25, y: Math.floor(i / 20) * 2, w: 24, h: 2, value, canGrow: false })) });
  const def = (value, n = 200) => {
    const d = report([], { data: { rows: Array.from({ length: 100 }, (_, i) => ({ n: i })) } });
    d.sections.body = Array.from({ length: 20 }, (_, k) => ({
      name: `S${k}`, pageHeader: heavy(n, value, k),
      items: [{ type: 'list', name: `L${k}`, x: 0, y: 0, w: 200, h: 14, dataSet: 'Rows', pageBreakBetween: true, items: [{ type: 'textbox', name: `t${k}`, x: 0, y: 0, w: 100, h: 14, value: '=Fields.n' }] }],
    }));
    return d;
  };
  const bandItems = (out) => out.pages.reduce((a, p) => a + p.items.filter(i => i.art).length, 0);
  it('page-numbered headers on thousands of pages are capped, with a warning, quickly', async () => {
    const t0 = Date.now();
    const out = await render(def('{Globals.PageNumber}'), { fontStore });
    expect(out.pages.length).toBe(2000);
    expect(bandItems(out)).toBeLessThanOrEqual(BAND_ITEMS);
    expect(out.warnings.join()).toMatch(/page headers and footers would draw more than 250,000 items/);
    expect(Date.now() - t0).toBeLessThan(20000);
  }, 30000);
  it('a header without page numbers is laid out once per section and copied: same cap, faster', async () => {
    const t0 = Date.now();
    const out = await render(def('S'), { fontStore });
    expect(bandItems(out)).toBeLessThanOrEqual(BAND_ITEMS);
    expect(texts(out.pages[0])).toContain('S');
    // copies, not shared objects: moving one page's item does not move another's
    const a = out.pages[0].items.find(i => i.art && i.t === 'text'), b = out.pages[1].items.find(i => i.art && i.t === 'text');
    expect(a).not.toBe(b);
    expect(a.lines[0]).not.toBe(b.lines[0]);
    expect(Date.now() - t0).toBeLessThan(20000);
  }, 30000);
  it('the time limit stops heavy section headers', async () => {
    await expect(render(def('{Globals.PageNumber}', 400), { fontStore, timeoutMs: 300 })).rejects.toThrow(/time limit/);
  }, 30000);
});

describe('several content placeholders in a master, filled by name', () => {
  const tb4 = (name, value, x, y) => ({ type: 'textbox', name, x, y, w: 160, h: 16, value });
  const loader = (lib) => async (id) => { if (!(id in lib)) throw new Error(`Report "${id}" not found`); return structuredClone(lib[id]); };
  const textItem = (m, s) => m.pages.flatMap(p => p.items).find(i => i.t === 'text' && i.lines.some(l => l.text === s));
  const master = () => report([
    tb4('MasterTop', 'MASTER TOP', 0, 0),
    { type: 'placeholder', name: 'Main', x: 0, y: 30, w: 300, h: 40 },
    { type: 'placeholder', name: 'Side', x: 320, y: 30, w: 180, h: 40 },
    { type: 'placeholder', name: 'Notes', x: 0, y: 90, w: 500, h: 20 },
    tb4('MasterBottom', 'MASTER BOTTOM', 0, 130),
  ]);
  const content = (extra) => ({ ...report([tb4('Body', 'BODY TEXT', 0, 0)]), master: 'm', ...extra });
  it('the body fills the first placeholder; sections.content fills the others by name', async () => {
    const def = content();
    def.sections.content = [
      { placeholder: 'Side', items: [tb4('S1', 'SIDE TEXT', 0, 0)] },
      { placeholder: 'Notes', items: [tb4('N1', 'NOTES TEXT', 10, 0)] },
    ];
    const m = await render(def, { fontStore, loadReport: loader({ m: master() }) });
    const body = textItem(m, 'BODY TEXT'), side = textItem(m, 'SIDE TEXT'), notes = textItem(m, 'NOTES TEXT');
    const top = textItem(m, 'MASTER TOP');
    expect(body.lines[0].x - top.lines[0].x).toBeCloseTo(0, 0);
    expect(side.lines[0].x - top.lines[0].x).toBeCloseTo(320, 0);
    expect(notes.lines[0].x - top.lines[0].x).toBeCloseTo(10, 0);
    expect(side.lines[0].y).toBeCloseTo(body.lines[0].y, 1);
    expect(notes.lines[0].y - body.lines[0].y).toBeCloseTo(60, 0);
    expect(m.warnings).toEqual([]);
  });
  it('a placeholder no content names stays empty; content for a placeholder the master lacks is a warning', async () => {
    const def = content();
    def.sections.content = [{ placeholder: 'Nowhere', items: [tb4('X', 'LOST', 0, 0)] }];
    const m = await render(def, { fontStore, loadReport: loader({ m: master() }) });
    expect(m.pages.flatMap(texts)).not.toContain('LOST');
    expect(m.warnings.join()).toMatch(/placeholder "Nowhere"/);
  });
  it('a long table in a named placeholder grows it and pushes the master items below it', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ n: i + 1 }));
    const tbl = { type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 160, h: 18, columns: [{ width: 160 }], detail: [{ height: 18, cells: [{ value: '=Fields.n' }] }] };
    const def = { ...content(), ...{} };
    def.dataSources = [{ name: 'src', type: 'json', data: { rows } }];
    def.sections.content = [{ placeholder: 'Side', items: [tbl] }];
    const m = await render(def, { fontStore, loadReport: loader({ m: master() }) });
    // Side grows by the table; Notes (below it, across) moves down, and MasterBottom below Notes with it
    const pageOf = (s) => m.pages.findIndex(p => texts(p).includes(s));
    const at = (s) => [pageOf(s), textItem(m, s).lines[0].y];
    const [pl, yl] = at('40'), [pb, yb] = at('MASTER BOTTOM');
    expect(pb > pl || (pb === pl && yb > yl)).toBe(true);
  });
});

import { buildPivot } from '../../src/engine/items/pivot.js';
describe('recursive row groups in a matrix', () => {
  // an org chart: CEO → VP A (→ M1 → E1, E2), VP B (→ M2); sales per person
  const people = [
    ['ceo', null, 'CEO', 10], ['va', 'ceo', 'VP A', 20], ['vb', 'ceo', 'VP B', 30],
    ['m1', 'va', 'M1', 5], ['m2', 'vb', 'M2', 7], ['e1', 'm1', 'E1', 1], ['e2', 'm1', 'E2', 2],
  ].map(([id, boss, name, sales]) => ({ id, boss, name, sales, region: id === 'vb' || id === 'm2' ? 'S' : 'N' }));
  const warnings = [];
  const lc = (state = {}) => ({ warn: (m) => warnings.push(m), state });
  const ctx = { params: {}, globals: {}, dataSets: {}, fields: null };
  const org = { rowGroups: [{ name: 'Person', expr: '=Fields.id', label: '=Fields.name', parent: '=Fields.boss', indent: 10, collapsible: true, expandLevels: 2, total: 'after' }], values: [{ value: '=Sum(Fields.sales)' }] };
  const grid = (p) => p.body.map(r => r.cells.map(c => (c.role === 'value' ? c.raw : c.text)));
  const pv = (extra, state, rows = people) => buildPivot({ type: 'matrix', name: 'Org', ...org, ...extra }, rows, ctx, lc(state));

  it('nodes depth first, each with the total of its subtree; expandLevels opens the first levels', () => {
    const p = pv();
    expect(grid(p)).toEqual([['CEO', 75], ['VP A', 28], ['M1', 8], ['VP B', 37], ['M2', 7], ['Total', 75]]);
    expect(p.body.map(r => r.cells[0].indent || 0)).toEqual([0, 10, 20, 10, 20, 0]);
    // M1 has reports and is collapsed (depth 2): it has a toggle; M2 has none (no reports)
    expect(p.body[2].cells[0].toggle).toEqual({ key: 'Org|r0|/ceo/va/m1', open: false });
    expect(p.body[4].cells[0].toggle).toBeUndefined();
  });
  it('a toggle opens a node; collapsing a node hides its subtree', () => {
    expect(grid(pv({}, { toggles: { 'Org|r0|/ceo/va/m1': true } })).map(r => r[0])).toEqual(['CEO', 'VP A', 'M1', 'E1', 'E2', 'VP B', 'M2', 'Total']);
    expect(grid(pv({}, { toggles: { 'Org|r0|/ceo': false } }))).toEqual([['CEO', 75], ['Total', 75]]);
  });
  it('with column groups, every cell is its node\'s subtree in that column', () => {
    const p = pv({ columnGroups: [{ expr: '=Fields.region', sort: 'asc' }] });
    expect(grid(p)[0]).toEqual(['CEO', 38, 37]);
    expect(grid(p)[3]).toEqual(['VP B', null, 37]);
  });
  it('draws: the label cell is indented by level', async () => {
    const def = report([{ type: 'matrix', name: 'Org', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', ...org, rowHeaderWidth: 160, columnWidth: 60 }], { data: { rows: people } });
    const out = await render(def, { fontStore });
    const x = (s) => out.pages[0].items.find(i => i.t === 'text' && i.lines[0].text.endsWith(s)).lines[0].x;
    expect(x('VP A') - x('CEO')).toBeCloseTo(10, 0);
    expect(x('M1') - x('CEO')).toBeCloseTo(20, 0);
  });
  it('adversarial: a 50,000-deep chain and a cycle stay bounded and linear', () => {
    warnings.length = 0;
    const chain = Array.from({ length: 50000 }, (_, i) => ({ id: `n${i}`, boss: i ? `n${i - 1}` : null, name: `N${i}`, sales: 1 }));
    const t0 = Date.now();
    const p = pv({ rowGroups: [{ ...org.rowGroups[0], collapsible: false, expandLevels: undefined }] }, {}, chain);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(p.body.length).toBeLessThanOrEqual(50001);
    expect(Math.max(...p.body.map(r => r.cells[0].indent || 0))).toBeLessThanOrEqual(63 * 10);
    expect(warnings.join()).toMatch(/more than 64 levels deep/);
    warnings.length = 0;
    const cyc = [{ id: 'a', boss: 'b', name: 'A', sales: 1 }, { id: 'b', boss: 'a', name: 'B', sales: 2 }];
    expect(grid(pv({}, {}, cyc)).map(r => r[0]).sort()).toEqual(['A', 'B', 'Total']);
    expect(warnings.join()).toMatch(/no root/);
  });
  it('recursion applies to the innermost row group only', () => {
    warnings.length = 0;
    pv({ rowGroups: [{ expr: '=Fields.region', parent: '=Fields.boss' }, { expr: '=Fields.id' }] });
    expect(warnings.join()).toMatch(/only the innermost row group can be recursive/);
  });
});

describe('an item in a table cell continues on the next page', () => {
  const lines = Array.from({ length: 120 }, (_, i) => ({ k: i + 1 }));
  const inner = (extra = {}) => ({ type: 'table', dataSet: 'Lines', columns: [{ width: 120 }], header: [{ height: 16, cells: [{ value: 'Inner H' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.k' }] }], ...extra });
  const def = (cellItem, extra = {}) => {
    const d = report([{ type: 'table', name: 'Outer', x: 0, y: 0, w: 260, h: 40, dataSet: 'Rows', repeatHeader: true,
      columns: [{ width: 120 }, { width: 140 }],
      header: [{ height: 18, cells: [{ value: 'Outer H' }, { value: 'Lines' }] }],
      detail: [{ height: 16, cells: [{ value: '=Fields.name' }, { value: '', item: cellItem }] }] }],
    { data: { rows: [{ name: 'Order A' }, { name: 'Order B' }], lines } });
    d.dataSets.push({ name: 'Lines', source: 'src', path: '$.lines' });
    return { ...d, ...extra };
  };
  const nums = (p) => texts(p).filter(s => /^\d+$/.test(s)).map(Number);
  it('a nested table splits at its rows, repeating its header on each page (and the outer header)', async () => {
    const out = await render(def(inner()), { fontStore });
    // two orders × 120 lines: several pages, every line once per order, in order
    expect(out.pages.length).toBeGreaterThan(4);
    const all = out.pages.flatMap(nums);
    expect(all).toEqual([...lines.map(l => l.k), ...lines.map(l => l.k)]);
    for (const p of out.pages) {
      const t = texts(p);
      expect(t[0]).toBe('Outer H');
      if (nums(p).length) expect(t).toContain('Inner H');
    }
    expect(out.warnings.join()).not.toMatch(/taller than the page/);
  });
  it('the row\'s other cells show on its first piece only', async () => {
    const out = await render(def(inner()), { fontStore });
    expect(out.pages.flatMap(texts).filter(s => s === 'Order A')).toHaveLength(1);
  });
  it('a nested list splits too; a nested table without a repeated header does not repeat it', async () => {
    const list = { type: 'list', dataSet: 'Lines', w: 120, h: 14, keepTogether: false, style: {}, items: [{ type: 'textbox', x: 0, y: 0, w: 100, h: 14, value: '=Fields.k' }] };
    const a = await render(def(list), { fontStore });
    expect(a.pages.length).toBeGreaterThan(4);
    expect(a.pages.flatMap(nums)).toEqual([...lines.map(l => l.k), ...lines.map(l => l.k)]);
    expect(a.warnings.join()).not.toMatch(/taller than the page/);
    const b = await render(def(inner({ repeatHeader: false })), { fontStore });
    expect(b.pages.flatMap(texts).filter(s => s === 'Inner H')).toHaveLength(2);
  });
  it('adversarial: 200,000 nested rows are capped by the cell-item budget, quickly', async () => {
    const big = Array.from({ length: 200000 }, (_, i) => ({ k: i }));
    const d = def(inner());
    d.dataSources = [{ name: 'src', type: 'json', data: { rows: [{ name: 'X' }], lines: big } }];
    const t0 = Date.now();
    const out = await render(d, { fontStore, timeoutMs: 60000 });
    expect(out.warnings.join()).toMatch(/rows of items inside cells/);
    expect(out.pages.flatMap(nums).length).toBe(0); // over the budget: the cell is left empty, not drawn in part
    expect(Date.now() - t0).toBeLessThan(20000);
  }, 60000);
  it('a row that fits stays whole; the fixed (header/footer) path is unchanged', async () => {
    const out = await render(def(inner({ filters: [{ expr: '=Fields.k', op: '<=', value: '3' }] })), { fontStore });
    expect(out.pages).toHaveLength(1);
    expect(nums(out.pages[0])).toEqual([1, 2, 3, 1, 2, 3]);
  });
});
