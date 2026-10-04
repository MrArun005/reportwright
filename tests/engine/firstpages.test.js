// A fast first page (ROADMAP week 12): render only the first pages, then the full report.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, texts, report } from '../helpers.js';

const rows = (n) => ({ rows: Array.from({ length: n }, (_, i) => ({ n: i + 1, amt: i % 7 })) });
const table = { type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 54, dataSet: 'Rows', repeatHeader: true, columns: [{ width: 150 }, { width: 150 }],
  header: [{ height: 18, cells: [{ value: 'No' }, { value: 'Amount' }] }], detail: [{ height: 16, cells: [{ value: '=Fields.n' }, { value: '=Fields.amt' }] }],
  footer: [{ height: 18, cells: [{ value: 'Total' }, { value: '=Sum(Fields.amt)' }] }] };
const footer = { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 0, w: 200, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] };

describe('first pages', () => {
  it('lays out only enough rows for the first pages and says it is partial', async () => {
    const def = report([table], { data: rows(20000), footer });
    const t0 = performance.now();
    const part = await render(def, { fontStore, firstPages: 2 });
    const partMs = performance.now() - t0;
    expect(part.partial).toBe(true);
    expect(part.pages).toHaveLength(2);
    expect(texts(part.pages[0])).toContain('Page 1 of …');
    expect(part.pages.flatMap(texts)).not.toContain('Total'); // no total from a part of the rows
    const t1 = performance.now();
    const full = await render(def, { fontStore });
    const fullMs = performance.now() - t1;
    expect(full.partial).toBeFalsy();
    expect(full.pages.length).toBeGreaterThan(300);
    expect(texts(full.pages[0])).toEqual(texts(part.pages[0]).map(s => (s === 'Page 1 of …' ? `Page 1 of ${full.pages.length}` : s)));
    expect(partMs).toBeLessThan(fullMs / 2); // loose: the suite runs files in parallel
  });

  it('a report that fits is never partial', async () => {
    const out = await render(report([table], { data: rows(10), footer }), { fontStore, firstPages: 2 });
    expect(out.partial).toBeFalsy();
    expect(texts(out.pages[0])).toContain('Total');
  });
});

describe('first pages with a table of contents', () => {
  const groups = (n) => ({ rows: Array.from({ length: n }, (_, i) => ({ n: i + 1, g: `G${Math.floor(i / 400) + 1}`, amt: i % 7 })) });
  const grouped = { ...table, groups: [{ name: 'G', expr: '=Fields.g', header: [{ height: 18, cells: [{ value: '=Fields.g', bookmark: '=Fields.g' }, { value: '=Sum(Fields.amt)' }] }] }] };
  const def = report([{ type: 'toc', name: 'Toc', x: 0, y: 0, w: 300, h: 40, title: 'Contents' }, { ...grouped, y: 50 }], { data: groups(8000), footer });

  it('shows the first pages with the entries and their page numbers pending, then the full render fills them in', async () => {
    const part = await render(def, { fontStore, firstPages: 2 });
    expect(part.partial).toBe(true);
    expect(part.pages).toHaveLength(2);
    const t = texts(part.pages[0]);
    expect(t[0]).toBe('Contents');
    expect(t[t.indexOf('G1') + 1]).toBe('…');
    expect(t[t.indexOf('G20') + 1]).toBe('…');

    const full = await render(def, { fontStore });
    const ft = texts(full.pages[0]);
    for (const b of full.bookmarks) expect(ft[ft.indexOf(b.label) + 1]).toBe(String(b.page));
    expect(full.bookmarks).toHaveLength(20);
  });
});
