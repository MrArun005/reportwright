import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { niceScale } from '../../src/engine/items/chart.js';
import { transformPath } from '../../src/engine/items/barcode.js';
import { fontStore, texts, report } from '../helpers.js';

const rows = { rows: [
  { m: 1, region: 'North', product: 'A', amt: 10 }, { m: 1, region: 'South', product: 'B', amt: 30 },
  { m: 2, region: 'North', product: 'B', amt: 20 }, { m: 2, region: 'South', product: 'A', amt: 40 },
  { m: 3, region: 'South', product: 'A', amt: 5 },
] };

describe('charts', () => {
  it('computes nice scales', () => {
    expect(niceScale(0, 87)).toEqual({ lo: 0, hi: 100, step: 20 });
    expect(niceScale(-3, 12).lo).toBeLessThanOrEqual(-3);
  });
  for (const chartType of ['column', 'bar', 'line', 'area', 'pie', 'donut', 'scatter']) {
    it(`draws a ${chartType} chart`, async () => {
      const def = report([{ type: 'chart', name: 'C', x: 0, y: 0, w: 300, h: 180, chartType, dataSet: 'Rows', title: 'Sales',
        category: '=Fields.m', series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }], seriesGroup: chartType === 'column' ? '=Fields.region' : undefined, xValue: '=Fields.m', showValues: true }], { data: rows });
      const out = await render(def, { fontStore });
      const items = out.pages[0].items;
      expect(texts(out.pages[0])).toContain('Sales');
      const marks = items.filter(i => i.t === 'rect' || i.t === 'path' || i.t === 'ellipse');
      expect(marks.length).toBeGreaterThanOrEqual(2);
      expect(out.warnings).toEqual([]);
      if (chartType === 'column') { expect(texts(out.pages[0])).toEqual(expect.arrayContaining(['North', 'South'])); }
      if (chartType === 'pie') expect(texts(out.pages[0])).toEqual(expect.arrayContaining(['1', '2', '3']));
    });
  }
});

describe('matrix', () => {
  it('pivots rows × columns with totals', async () => {
    const def = report([{ type: 'matrix', name: 'M', x: 0, y: 0, w: 300, h: 54, dataSet: 'Rows', rowGroup: '=Fields.region', columnGroup: '=Fields.product', value: '=Sum(Fields.amt)', valueFormat: 'N0', corner: 'Region' }], { data: rows });
    const out = await render(def, { fontStore });
    const t = texts(out.pages[0]);
    expect(t.slice(0, 4)).toEqual(['Region', 'A', 'B', 'Total']);
    expect(t.join('|')).toContain('North|10|20|30');
    expect(t.join('|')).toContain('South|45|30|75');
    expect(t.join('|')).toContain('Total|55|50|105');
  });
});

describe('visuals and barcodes', () => {
  it('draws sparklines and data bars in table cells', async () => {
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 300, h: 36, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
      groups: [{ name: 'R', expr: '=Fields.region', header: [{ height: 18, cells: [{ value: '=Fields.region' }, { value: '', visual: { type: 'sparkline', value: '=Fields.amt' } }, { value: '', visual: { type: 'databar', value: '=Sum(Fields.amt)', max: '=Max(Fields.amt, "Rows") * 3' } }] }], footer: [] }],
      detail: [] }], { data: rows });
    const out = await render(def, { fontStore });
    const items = out.pages[0].items;
    expect(items.filter(i => i.t === 'path').length).toBe(2);           // two sparklines
    expect(texts(out.pages[0])).toEqual(expect.arrayContaining(['North', 'South', '30', '75']));
  });
  it('draws a Code 128 and a QR code', async () => {
    const def = report([
      { type: 'barcode', name: 'B', x: 0, y: 0, w: 160, h: 48, symbology: 'code128', value: 'LN-2026-004417' },
      { type: 'barcode', name: 'Q', x: 200, y: 0, w: 60, h: 60, symbology: 'qrcode', value: 'https://example.com' },
      { type: 'barcode', name: 'E', x: 300, y: 0, w: 120, h: 40, symbology: 'ean13', value: 'not-a-number' },
    ]);
    const out = await render(def, { fontStore });
    const paths = out.pages[0].items.filter(i => i.t === 'path');
    expect(paths.length).toBeGreaterThanOrEqual(3);
    expect(texts(out.pages[0])).toContain('LN-2026-004417');
    expect(out.warnings.join(' ')).toMatch(/E: /);
  });
  it('scales SVG paths', () => {
    expect(transformPath('M1 2L3 4Z', 2, 10, 5, 0)).toBe('M 7 20 L 11 40 Z');
    expect(transformPath('M0 0h10v5', 2, 2, 1, 1)).toBe('M 1 1 h 20 v 10');
  });
});

describe('subreports', () => {
  const child = { $schema: 'pagewright/report@1', name: 'Child', page: { size: 'A4' },
    parameters: [{ name: 'region', type: 'string' }],
    dataSources: [{ name: 'src', type: 'json', data: rows }],
    dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', filters: [{ expr: '=Fields.region', op: '=', value: '=Parameters.region' }] }],
    sections: { body: { items: [{ type: 'textbox', name: 'S', x: 0, y: 0, w: 200, h: 14, value: '{Parameters.region} total {Sum(Fields.amt)}' }] } } };
  it('renders a child report once per list row with parameters', async () => {
    const def = report([{ type: 'list', name: 'L', x: 0, y: 0, w: 400, h: 20, dataSet: 'Rows', groupBy: '=Fields.region', items: [
      { type: 'subreport', name: 'Sub', x: 10, y: 0, w: 300, h: 16, report: 'child', params: { region: '=Fields.region' } }] }], { data: rows });
    const out = await render(def, { fontStore, loadReport: async (id) => (id === 'child' ? child : null) });
    expect(texts(out.pages[0])).toEqual(['North total 30', 'South total 75']);
    const t = out.pages[0].items.find(i => i.t === 'text');
    expect(t.lines[0].x).toBeCloseTo(36 + 10 + 2, 1);                    // margin + subreport x + text padding
  });
  it('stops a report that includes itself', async () => {
    const self = report([{ type: 'subreport', name: 'Me', x: 0, y: 0, w: 300, h: 16, report: 'self' }]);
    self.name = 'self';
    const out = await render(self, { fontStore, loadReport: async () => self });
    expect(texts(out.pages[0]).join(' ')).toMatch(/includes itself|nested more than 3/);
  });
});
