import { describe, it, expect } from 'vitest';
import { loadPdf } from '@reportwright/pdf';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { blankDashboard } from '../../src/engine/schema/template.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontStore, texts, report } from '../helpers.js';

const rows = (n) => ({ rows: Array.from({ length: n }, (_, i) => ({ n: i + 1, g: i % 3 })) });
const table = (extra = {}) => ({
  type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', repeatHeader: true,
  columns: [{ width: 100 }, { width: 200 }],
  header: [{ height: 20, cells: [{ value: 'No' }, { value: 'Group' }] }],
  detail: [{ height: 20, cells: [{ value: '=Fields.n' }, { value: '=Fields.g' }] }],
  ...extra,
});
const footer = { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 0, w: 200, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] };
const pageless = (body, data, page = {}) => report(body, { data, footer, def: { page: { size: 'Pageless', width: 800, margins: [24, 24, 24, 24], ...page } } });

describe('pageless layout', () => {
  it('puts everything on one page as tall as the content', async () => {
    const out = await render(pageless([table()], rows(100)), { fontStore });
    expect(out.pages).toHaveLength(1);
    expect(out.width).toBe(800);
    // 24 margin + 20 header row + 100 × 20 rows + 20 footer + 24 margin
    expect(out.height).toBeCloseTo(24 + 20 + 2000 + 20 + 24, 0);
    const t = texts(out.pages[0]);
    expect(t.filter(s => s === 'No')).toHaveLength(1);
    expect(t).toContain('Page 1 of 1');
  });

  it('has a minimum height', async () => {
    const out = await render(pageless([table()], rows(1), { minHeight: 300 }), { fontStore });
    expect(out.height).toBe(300);
  });

  it('ignores page breaks', async () => {
    const out = await render(pageless([table({ groups: [{ name: 'G', expr: '=Fields.g', pageBreak: 'between' }] })], rows(9)), { fontStore });
    expect(out.pages).toHaveLength(1);
  });

  it('splits with a warning past the 200-inch PDF page limit', async () => {
    const out = await render(pageless([table()], rows(1000)), { fontStore });
    expect(out.pages.length).toBeGreaterThan(1);
    expect(out.height).toBe(14400);
    expect(out.warnings.join(' ')).toMatch(/200 inches/);
  });

  it('exports a PDF page of the same size', async () => {
    const out = await render(pageless([table()], rows(30)), { fontStore });
    const doc = await loadPdf(await exportPdf(out, fontStore, {}));
    const { width, height } = doc.page(0);
    expect([width, height]).toEqual([out.width, out.height]);
  });

  it('the dashboard template is a valid pageless report with charts', async () => {
    const def = blankDashboard('Sales');
    expect(validate(def).errors).toEqual([]);
    expect(def.page.size).toBe('Pageless');
    const out = await render(def, { fontStore });
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].items.some(i => i.t === 'path' || i.t === 'rect')).toBe(true);
  });
});
