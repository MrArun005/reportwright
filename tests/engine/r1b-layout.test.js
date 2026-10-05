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

describe('page numbers', () => {
  it('a table of contents prints the page number the page shows when sections restart numbering', async () => {
    const rows = Array.from({ length: 6 }, (_, g) => Array.from({ length: 70 }, (_, n) => ({ g: `S${g}`, n }))).flat();
    const t = { type: 'table', name: 'T', x: 0, y: 30, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }],
      groups: [{ name: 'G', expr: '=Fields.g', newSection: true, pageBreak: 'between', header: [{ height: 16, cells: [{ value: '=Fields.g', bookmark: '=Fields.g' }] }] }],
      detail: [{ height: 14, cells: [{ value: '=Fields.n' }] }] };
    const footer = { height: 20, items: [{ type: 'textbox', name: 'F', x: 0, y: 0, w: 200, h: 14, value: '="PAGE " & Globals.PageNumber' }] };
    const r = await render(report([{ type: 'toc', name: 'Toc', x: 0, y: 0, w: 300, h: 20, title: 'Contents' }, t], { data: { rows }, footer }), { fontStore });
    const pageOf = (label) => r.pages.findIndex((p, i) => i > 0 && texts(p).includes(label)); // page 0 holds the TOC
    const toc = texts(r.pages[0]);
    for (const s of ['S2', 'S5']) {
      const shown = texts(r.pages[pageOf(s)]).find(x => /^PAGE \d+$/.test(x));
      expect(pageOf(s) + 1).not.toBe(Number(shown.slice(5))); // the section restarted the numbering
      expect(toc[toc.indexOf(s) + 1]).toBe(shown.slice(5));
    }
  });
  it('PageNumber in a body cell, a group header or an item inside a list warns', async () => {
    const list = { type: 'list', name: 'L', x: 0, y: 0, w: 200, h: 20, dataSet: 'Rows', items: [{ type: 'textbox', name: 'inner', x: 0, y: 0, w: 100, h: 14, value: '=Globals!PageNumber' }] };
    const t = { type: 'table', name: 'T', x: 0, y: 30, w: 200, h: 20, dataSet: 'Rows', columns: [{ width: 200 }],
      groups: [{ expr: '=Fields.g', header: [{ height: 14, cells: [{ value: 'p {Globals.TotalPages}' }] }] }], detail: [] };
    const r = await render(report([list, t], { data: { rows: [{ g: 1 }] } }), { fontStore });
    expect(r.warnings.filter(w => /PageNumber and TotalPages work only/.test(w)).length).toBe(2);
  });
});

describe('an empty report body', () => {
  it('a body that is only an empty list still prints one page with its header and footer', async () => {
    const list = { type: 'list', name: 'L', x: 0, y: 0, w: 200, h: 20, dataSet: 'Rows', items: [{ type: 'textbox', name: 't', x: 0, y: 0, w: 100, h: 14, value: '=Fields.v' }] };
    const header = { height: 20, items: [{ type: 'textbox', name: 'H', x: 0, y: 0, w: 200, h: 14, value: 'TITLE' }] };
    const footer = { height: 20, items: [{ type: 'textbox', name: 'F', x: 0, y: 0, w: 200, h: 14, value: '="Page " & Globals.PageNumber & " of " & Globals.TotalPages' }] };
    const r = await render(report([list], { data: { rows: [] }, header, footer }), { fontStore });
    expect(r.pages.length).toBe(1);
    expect(texts(r.pages[0])).toEqual(['TITLE', 'Page 1 of 1']);
  });
});
