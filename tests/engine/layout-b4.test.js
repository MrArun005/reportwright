// Batch 4 layout: a page header and footer per body section, named content placeholders in a master,
// recursive row groups in a matrix, and items in table cells that continue on the next page.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
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
