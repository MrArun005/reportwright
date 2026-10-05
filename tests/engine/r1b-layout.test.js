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
