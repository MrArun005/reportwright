// REVIEW-ENGINE A2 (a table wider than the page), A3 (side-by-side regions), B1 (empty-list report), A15 (body page numbers).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const wideTable = (extra = {}) => ({
  type: 'table', name: 'Wide', x: 0, y: 0, w: 900, h: 28, dataSet: 'Rows', ...extra,
  columns: Array.from({ length: 10 }, () => ({ width: 90 })),
  header: [{ height: 14, cells: Array.from({ length: 10 }, (_, i) => ({ value: `COL${i}` })) }],
  detail: [{ height: 14, cells: Array.from({ length: 10 }, (_, i) => ({ value: `=Fields.v & "-${i}"` })) }],
});
const data = { rows: [{ v: 'a' }, { v: 'b' }] };
const allTexts = (r) => r.pages.flatMap(texts);

describe('a table wider than the page', () => {
  it('continues on the next pages by default and warns; no column is lost', async () => {
    const r = await render(report([wideTable()], { data }), { fontStore });
    expect(r.pages.length).toBeGreaterThan(1);
    const t = allTexts(r);
    for (let i = 0; i < 10; i++) expect(t).toContain(`COL${i}`);
    expect(r.warnings.join('\n')).toMatch(/Wide: its columns are 900pt wide, wider than the page .* continue on the next pages/);
  });
  it('"shrink" narrows the columns to fit one page, with a warning', async () => {
    const r = await render(report([wideTable({ overflow: 'shrink' })], { data }), { fontStore });
    expect(r.pages.length).toBe(1);
    const t = allTexts(r).join(' ');
    for (let i = 0; i < 10; i++) expect(t).toContain(`COL${i}`);
    expect(r.warnings.join('\n')).toMatch(/narrowed to fit/);
  });
  it('"clip" keeps one page and says columns are cut', async () => {
    const r = await render(report([wideTable({ overflow: 'clip' })], { data }), { fontStore });
    expect(r.pages.length).toBe(1);
    expect(r.warnings.join('\n')).toMatch(/past the page edge are cut/);
  });
  it('an explicit "paginate" continues without a warning', async () => {
    const r = await render(report([wideTable({ overflow: 'paginate' })], { data }), { fontStore });
    expect(r.pages.length).toBeGreaterThan(1);
    expect(r.warnings.join('\n')).not.toMatch(/wider than the page/);
  });
});

describe('side-by-side tables', () => {
  const N = 200;
  const tbl = (name, x, h, ds) => ({
    type: 'table', name, x, y: 0, w: 180, h: h * 2, dataSet: ds, columns: [{ width: 180 }],
    header: [{ height: 14, cells: [{ value: `${name} head` }] }],
    detail: [{ height: h, cells: [{ value: `=Fields.v` }] }],
  });
  const def = (footerH) => report([tbl('A', 0, 17.3, 'Rows'), tbl('B', 200, 19.7, 'Rows')], {
    data: { rows: Array.from({ length: N }, (_, i) => ({ v: `r${i}` })) },
    footer: footerH ? { height: footerH, items: [{ type: 'textbox', name: 'F', x: 0, y: 0, w: 200, h: footerH, value: 'FOOTER' }] } : undefined,
  });
  for (const footerH of [30, 0]) {
    it(`never draw a row over the ${footerH ? 'page footer' : 'bottom margin'}, fill page 1, and show every row once (footer ${footerH})`, async () => {
      const r = await render(def(footerH), { fontStore });
      const pageH = 842, limit = pageH - 36 - footerH;
      for (const p of r.pages) for (const it of p.items) if (it.t === 'text' && /^r\d+$/.test(it.lines[0].text)) expect(it.clip.y + 17).toBeLessThanOrEqual(limit + 0.01);
      const rowsOf = (x) => r.pages.flatMap(p => p.items.filter(i => i.t === 'text' && /^r\d+$/.test(i.lines[0].text) && Math.abs(i.clip.x - x) < 50)).map(i => i.lines[0].text);
      expect(rowsOf(36)).toEqual(Array.from({ length: N }, (_, i) => `r${i}`));
      expect(rowsOf(236)).toEqual(Array.from({ length: N }, (_, i) => `r${i}`));
      expect(texts(r.pages[0]).filter(t => /^r\d+$/.test(t)).length).toBeGreaterThan(40);
      expect(r.warnings.join('\n')).not.toMatch(/taller than the page/);
    });
  }
});
