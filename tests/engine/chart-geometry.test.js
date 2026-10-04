// Locks the geometry of the charts that existed before Phase 5: every page-model item a chart draws, rounded and hashed.
// A change here must be a deliberate fix, noted in docs/superpowers/plans/2026-10-04-p5-charts.md.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const r2 = (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const digest = (items) => crypto.createHash('sha1').update(JSON.stringify(items, r2)).digest('hex').slice(0, 16);

const rows = { rows: [
  { m: 1, region: 'North', product: 'A', amt: 10, q: 3 }, { m: 1, region: 'South', product: 'B', amt: 30, q: 1 },
  { m: 2, region: 'North', product: 'B', amt: 20, q: 7 }, { m: 2, region: 'South', product: 'A', amt: -40, q: 2 },
  { m: 3, region: 'South', product: 'A', amt: 5, q: 9 }, { m: 4, region: 'East', product: 'C', amt: 55, q: 4 },
] };
const base = { type: 'chart', name: 'C', x: 10, y: 0, w: 320, h: 200, dataSet: 'Rows', category: '=Fields.m', series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }] };
const CASES = {
  column: { chartType: 'column', title: 'Sales', showValues: true },
  columnGroups: { chartType: 'column', seriesGroup: '=Fields.region' },
  columnStacked: { chartType: 'column', seriesGroup: '=Fields.region', stacked: true, xTitle: 'Month' },
  bar: { chartType: 'bar', showValues: true, category: '=Fields.region' },
  barStacked: { chartType: 'bar', seriesGroup: '=Fields.product', stacked: true },
  line: { chartType: 'line', showValues: true, series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }, { name: 'Qty', value: '=Sum(Fields.q)' }] },
  area: { chartType: 'area', seriesGroup: '=Fields.region' },
  areaStacked: { chartType: 'area', seriesGroup: '=Fields.region', stacked: true },
  pie: { chartType: 'pie', category: '=Fields.region', series: [{ name: 'Qty', value: '=Sum(Fields.q)' }] },
  donut: { chartType: 'donut', category: '=Fields.product', series: [{ name: 'Qty', value: '=Sum(Fields.q)' }], legend: 'none' },
  scatter: { chartType: 'scatter', xValue: '=Fields.q' },
  pointColor: { chartType: 'column', pointColor: '=IIf(Fields.m = 2, "#ff0000", Nothing)', categorySort: 'desc', valueFormat: 'C0' },
  empty: { chartType: 'column', filters: [{ expr: '=Fields.m', op: '=', value: '99' }] },
};

describe('existing chart geometry', () => {
  for (const [name, extra] of Object.entries(CASES)) {
    it(name, async () => {
      // en-IN / INR: the locale these were drawn with (it was the default then); C0 labels are rupees
      const out = await render(report([{ ...base, ...extra }], { data: rows, def: { locale: 'en-IN', currency: 'INR' } }), { fontStore });
      expect(out.warnings).toEqual([]);
      expect(digest(out.pages[0].items)).toMatchSnapshot();
    });
  }
  // the shipped reports with charts and pushed data
  for (const [file, test] of [['reports/sales-city.pw.json', 'sales-city'], ['reports/sales-explorer.pw.json', 'sales-explorer'], ['reports/sales-month.pw.json', 'sales-month']]) {
    it(file, async () => {
      const spec = read(`reports/__tests__/${test}.test.json`);
      const c = spec.cases[0];
      const def = read(file);
      const data = Object.fromEntries(Object.entries(c.data).map(([k, v]) => [k, read(`reports/__tests__/${v}`)]));
      def.dataSources = def.dataSources.map(s => (s.name in data ? { name: s.name, type: 'json', data: data[s.name] } : s));
      const out = await render(def, { fontStore, parameters: c.parameters, now: new Date(c.now) });
      expect(out.pages.map(p => digest(p.items))).toMatchSnapshot();
    });
  }
});
