// Charts and barcodes get descriptive alt text from their content; an author's alt text always wins
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const data = { rows: [{ m: 'Jan', amt: 1, c: 2 }, { m: 'Feb', amt: 3, c: 4 }] };
const chart = (extra = {}) => ({
  type: 'chart', x: 0, y: 0, w: 300, h: 160, chartType: 'column', dataSet: 'Rows', title: 'Revenue by month',
  category: '=Fields.m', series: [{ name: 'Revenue', value: '=Fields.amt' }, { name: 'Cost', value: '=Fields.c' }], ...extra,
});
const tagsOf = (out) => out.pages[0].items.map(i => i.tag).filter(Boolean);

describe('figure alt text', () => {
  it('a chart without alt text says its type, title, series and category count', async () => {
    const out = await render(report([chart()], { data }), { fontStore });
    expect(tagsOf(out).find(t => t.k === 'chart')?.alt).toBe('Column chart: Revenue by month; series Revenue, Cost; 2 categories');
  });

  it('a barcode without alt text says its symbology and encoded value', async () => {
    const out = await render(report([{ type: 'barcode', x: 0, y: 0, w: 160, h: 48, symbology: 'code128', value: 'AB-123' }]), { fontStore });
    expect(tagsOf(out).find(t => t.k === 'barcode')?.alt).toMatch(/^Code 128 barcode: AB-123$/);
  });

  it('an author alt text wins over the generated one', async () => {
    const out = await render(report([chart({ alt: 'Sales by month' }), { type: 'barcode', x: 0, y: 60, w: 160, h: 48, symbology: 'code128', value: 'X', alt: 'Product code' }], { data }), { fontStore });
    const t = tagsOf(out);
    expect(t.find(x => x.k === 'chart')?.alt).toBe('Sales by month');
    expect(t.find(x => x.k === 'barcode')?.alt).toBe('Product code');
  });
});
