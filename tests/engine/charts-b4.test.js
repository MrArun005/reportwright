// Batch 4 charts: treemap, histogram, box plot, waterfall and Gantt, drawn by the engine (viewer, PDF and HTML read the
// same page model), with their caps on untrusted data.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportHtml } from '../../src/exporters/html.js';
import { squarify, binValues, boxStats, dateTicks, MORE_CAPS } from '../../src/engine/items/chart-more.js';
import { CAPS } from '../../src/engine/items/chart-kit.js';
import { fontStore, report } from '../helpers.js';

const O = 36; // page margin
const chart = (extra, rows) => report([{ type: 'chart', name: 'C', x: 0, y: 0, w: 400, h: 240, dataSet: 'Rows', legend: 'none', ...extra }], { data: { rows } });
const draw = async (extra, rows, opts = {}) => { const out = await render(chart(extra, rows), { fontStore, ...opts }); return { items: out.pages[0].items, warnings: out.warnings, model: out }; };
const textsOf = (items) => items.filter(i => i.t === 'text').map(i => i.lines[0].text);
const inChart = (r) => r.x >= O - 0.5 && r.x + r.w <= O + 400.5 && r.y >= O - 0.5 && r.y + r.h <= O + 240.5;

describe('treemap', () => {
  it('squarify: areas proportional to the values, inside the box, no overlaps', () => {
    const vals = [60, 30, 20, 10, 5, 5].map((v, i) => ({ v, i }));
    const rs = squarify(vals, 0, 0, 300, 200);
    expect(rs).toHaveLength(6);
    const total = 130;
    for (const r of rs) expect(r.w * r.h).toBeCloseTo(vals[r.i].v / total * 60000, 3);
    for (const r of rs) { expect(r.x).toBeGreaterThanOrEqual(-1e-9); expect(r.y).toBeGreaterThanOrEqual(-1e-9); expect(r.x + r.w).toBeLessThanOrEqual(300 + 1e-6); expect(r.y + r.h).toBeLessThanOrEqual(200 + 1e-6); }
    for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
      const A = rs[a], B = rs[b];
      expect(A.x + 1e-6 < B.x + B.w && B.x + 1e-6 < A.x + A.w && A.y + 1e-6 < B.y + B.h && B.y + 1e-6 < A.y + A.h).toBe(false);
    }
    // squarified: no sliver worse than 1:6 for these values
    for (const r of rs) expect(Math.max(r.w / r.h, r.h / r.w)).toBeLessThan(6);
  });
  it('draws one box per category with its name, value and a tooltip; zero and negative values are left out with a warning', async () => {
    const rows = [{ c: 'North', v: 50 }, { c: 'South', v: 30 }, { c: 'East', v: 20 }, { c: 'West', v: 0 }];
    const { items, warnings } = await draw({ chartType: 'treemap', category: '=Fields.c', series: [{ name: 'Sales', value: '=Sum(Fields.v)' }] }, rows);
    const boxes = items.filter(i => i.t === 'rect' && i.stroke === '#ffffff');
    expect(boxes).toHaveLength(3);
    for (const b of boxes) expect(inChart(b)).toBe(true);
    expect(textsOf(items)).toEqual(expect.arrayContaining(['North', 'South', 'East', '50', '30']));
    expect(items.filter(i => i.t === 'link' && i.tip).map(i => i.tip)).toEqual(expect.arrayContaining(['North: 50 (50%)']));
    expect(warnings.join()).toMatch(/0 or less have no area/);
  });
});

describe('histogram', () => {
  it('bins: Sturges by default, a count, or a width; the highest value is in the last bin', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i); // 0..99
    expect(binValues(vals).counts).toHaveLength(8); // ceil(log2 100) + 1
    const c = binValues(vals, { binCount: 4 });
    expect(c.counts).toEqual([25, 25, 25, 25]);
    const w = binValues(vals, { binWidth: 10 });
    expect([w.lo, w.width, w.counts.length]).toEqual([0, 10, 10]);
    expect(w.counts.reduce((a, b) => a + b)).toBe(100);
    expect(binValues([5, 5, 5], { binCount: 3 }).counts.reduce((a, b) => a + b)).toBe(3);
  });
  it('draws touching columns whose heights follow the counts, with bin edges on the x axis', async () => {
    const rows = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4].map(v => ({ v }));
    const { items } = await draw({ chartType: 'histogram', series: [{ name: 'V', value: '=Fields.v' }], binWidth: 1 }, rows);
    const cols = items.filter(i => i.t === 'rect' && i.fill === '#2563eb').sort((a, b) => a.x - b.x);
    expect(cols.map(c => Math.round(c.h))).toEqual(cols.map(c => Math.round(cols[0].h * [1, 2, 3, 4][cols.indexOf(c)])));
    expect(items.filter(i => i.t === 'link').map(i => i.tip)).toEqual(['1 – 2: 1', '2 – 3: 2', '3 – 4: 3', '4 – 5: 4']);
  });
});

describe('box plot', () => {
  it('quartiles, whiskers within 1.5 IQR, outliers beyond', () => {
    const st = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect([st.q1, st.med, st.q3]).toEqual([3.25, 5.5, 7.75]);
    expect([st.lo, st.hi]).toEqual([1, 9]);
    expect(st.outliers).toEqual([100]);
  });
  it('draws a box per category, medians, whiskers and outlier dots', async () => {
    const rows = [...[1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map(v => ({ g: 'A', v })), ...[10, 11, 12, 13, 14].map(v => ({ g: 'B', v }))];
    const { items } = await draw({ chartType: 'boxplot', category: '=Fields.g', series: [{ name: 'V', value: '=Fields.v' }] }, rows);
    expect(items.filter(i => i.t === 'rect' && i.stroke === '#2563eb')).toHaveLength(2);
    expect(items.filter(i => i.t === 'ellipse')).toHaveLength(1);
    expect(items.filter(i => i.t === 'link').map(i => i.tip)[0]).toBe('A: min 1, Q1 3, median 6, Q3 8, max 9, 1 outliers (n 10)');
  });
});

describe('waterfall', () => {
  it('bars float from the running total; colours for increase, decrease and total; a subtotal category', async () => {
    const rows = [{ c: 'Start', v: 100 }, { c: 'Sales', v: 40 }, { c: 'Costs', v: -30 }, { c: 'Q1', v: 0 }, { c: 'Tax', v: -10 }];
    const { items } = await draw({ chartType: 'waterfall', category: '=Fields.c', series: [{ name: 'V', value: '=Sum(Fields.v)' }], waterfallTotals: "=Fields.c = 'Q1'", showValues: true }, rows);
    const bars = items.filter(i => i.t === 'rect' && ['#16a34a', '#dc2626', '#2563eb'].includes(i.fill)).sort((a, b) => a.x - b.x);
    expect(bars.map(b => b.fill)).toEqual(['#16a34a', '#16a34a', '#dc2626', '#2563eb', '#dc2626', '#2563eb']);
    // Costs floats: its top is the Sales bar's top, its bottom lower by 30 of 140
    const [, sales, costs, q1, , total] = bars;
    expect(costs.y).toBeCloseTo(sales.y, 1);
    expect(q1.y + q1.h).toBeCloseTo(total.y + total.h, 1); // totals stand on 0
    expect(textsOf(items)).toEqual(expect.arrayContaining(['+100', '+40', '-30', '110', '-10', '100', 'Total']));
  });
});

describe('Gantt', () => {
  const tasks = [
    { t: 'Design', s: '2026-01-05', e: '2026-01-20', team: 'UX' },
    { t: 'Build', s: '2026-01-15', e: '2026-02-28', team: 'Eng' },
    { t: 'Test', s: '2026-02-20', e: '2026-03-10', team: 'QA' },
  ];
  const g = { chartType: 'gantt', category: '=Fields.t', ganttStart: '=Fields.s', ganttEnd: '=Fields.e' };
  it('one bar per row in its lane, lengths follow the dates, a today line and date ticks', async () => {
    const { items } = await draw(g, tasks, { now: new Date('2026-02-01T12:00:00Z') });
    const bars = items.filter(i => i.t === 'rect' && i.radius != null).sort((a, b) => a.y - b.y);
    expect(bars).toHaveLength(3);
    expect(bars[1].w / bars[0].w).toBeCloseTo(44 / 15, 1);
    expect(bars[1].x).toBeGreaterThan(bars[0].x);
    const today = items.find(i => i.t === 'line' && i.stroke === '#dc2626');
    expect(today.x1).toBeGreaterThan(bars[1].x);
    expect(textsOf(items)).toEqual(expect.arrayContaining(['Design', 'Build', 'Test', 'Today']));
    expect(items.filter(i => i.t === 'link').map(i => i.tip)[0]).toMatch(/^Design: 05 Jan – 20 Jan$/);
  });
  it('seriesGroup colours the bars by group, with a legend; no today line when it is off', async () => {
    const { items } = await draw({ ...g, seriesGroup: '=Fields.team', legend: 'bottom', ganttToday: false }, tasks);
    const bars = items.filter(i => i.t === 'rect' && i.radius != null);
    expect(new Set(bars.map(b => b.fill)).size).toBe(3);
    expect(textsOf(items)).toEqual(expect.arrayContaining(['UX', 'Eng', 'QA']));
    expect(textsOf(items)).not.toContain('Today');
  });
  it('date ticks pick days, weeks, months or years', () => {
    const d = (s) => Date.parse(s);
    expect(dateTicks(d('2026-01-01'), d('2026-01-05')).unit).toBe('d');
    expect(dateTicks(d('2026-01-01'), d('2026-06-30')).unit).toBe('m');
    expect(dateTicks(d('2000-01-01'), d('2026-01-01')).unit).toBe('y');
  });
});

describe('the new charts in the PDF and HTML', () => {
  it('every type exports', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ c: `C${i % 5}`, v: (i * 7) % 23 + 1, s: `2026-01-${String(1 + (i % 20)).padStart(2, '0')}`, e: `2026-02-${String(1 + (i % 20)).padStart(2, '0')}` }));
    for (const chartType of ['treemap', 'histogram', 'boxplot', 'waterfall', 'gantt']) {
      const out = await render(chart({ chartType, category: '=Fields.c', series: [{ name: 'V', value: chartType === 'histogram' || chartType === 'boxplot' ? '=Fields.v' : '=Sum(Fields.v)' }], ganttStart: '=Fields.s', ganttEnd: '=Fields.e' }, rows), { fontStore });
      expect(out.warnings, chartType).toEqual([]);
      const pdf = await exportPdf(out, fontStore);
      expect(pdf.byteLength, chartType).toBeGreaterThan(1000);
      const html = await exportHtml(out, fontStore);
      expect(String(html), chartType).toMatch(/<svg/);
    }
  });
});

describe('adversarial data stays capped and fast', () => {
  const time = async (f) => { const t0 = Date.now(); const r = await f(); return { r, ms: Date.now() - t0 }; };
  it('histogram: a huge bin count or a tiny bin width is capped', async () => {
    expect(binValues([0, 1e6], { binCount: 1e9 }).counts).toHaveLength(MORE_CAPS.bins);
    const w = binValues([0, 1e6], { binWidth: 1e-12 });
    expect([w.counts.length, w.capped]).toEqual([MORE_CAPS.bins, true]);
    const rows = Array.from({ length: 50000 }, (_, i) => ({ v: i }));
    const { r, ms } = await time(() => draw({ chartType: 'histogram', series: [{ name: 'V', value: '=Fields.v' }], binWidth: 1e-9 }, rows));
    expect(r.warnings.join()).toMatch(/only the first 10000/);
    expect(r.warnings.join()).toMatch(/more than 500 bins/);
    expect(r.items.filter(i => i.t === 'rect').length).toBeLessThanOrEqual(MORE_CAPS.bins + 1);
    expect(ms).toBeLessThan(10000);
  }, 30000);
  it('box plot: rows and outlier dots are capped', async () => {
    const rows = Array.from({ length: 30000 }, (_, i) => ({ g: `G${i % 3}`, v: i % 100 === 0 ? 1e9 + i : i % 7 }));
    const { r, ms } = await time(() => draw({ chartType: 'boxplot', category: '=Fields.g', series: [{ name: 'V', value: '=Fields.v' }] }, rows));
    expect(r.warnings.join()).toMatch(/more than 10000 rows/);
    expect(r.items.filter(i => i.t === 'ellipse').length).toBeLessThanOrEqual(MORE_CAPS.outliers);
    expect(ms).toBeLessThan(10000);
  }, 30000);
  it('treemap and waterfall: categories are capped', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ c: `K${i}`, v: (i % 50) + 1 }));
    for (const chartType of ['treemap', 'waterfall']) {
      const { r, ms } = await time(() => draw({ chartType, category: '=Fields.c', series: [{ name: 'V', value: '=Sum(Fields.v)' }] }, rows));
      expect(r.warnings.join(), chartType).toMatch(new RegExp(`only the first ${CAPS.categories}`));
      expect(ms, chartType).toBeLessThan(10000);
    }
  }, 30000);
  it('Gantt: bars are capped; bad dates are skipped', async () => {
    const rows = Array.from({ length: 20000 }, (_, i) => ({ t: `T${i % 50}`, s: i % 3 ? '2026-01-01' : 'not a date', e: '2026-02-01' }));
    const { r, ms } = await time(() => draw({ chartType: 'gantt', category: '=Fields.t', ganttStart: '=Fields.s', ganttEnd: '=Fields.e' }, rows));
    expect(r.warnings.join()).toMatch(/more than 10000 bars/);
    expect(r.items.filter(i => i.t === 'rect' && i.radius != null).length).toBeLessThanOrEqual(CAPS.points);
    expect(ms).toBeLessThan(10000);
  }, 30000);
});

describe('map: region drill, colour legends, line layers', () => {
  const square = (name, x0) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [[[x0, 0], [x0 + 10, 0], [x0 + 10, 10], [x0, 10], [x0, 0]]] } });
  const road = { type: 'Feature', properties: { name: 'Road' }, geometry: { type: 'LineString', coordinates: [[0, 5], [10, 6], [20, 5]] } };
  const rail = { type: 'Feature', properties: { name: 'Rail' }, geometry: { type: 'MultiLineString', coordinates: [[[0, 1], [20, 1]], [[0, 9], [20, 9]]] } };
  const GEO = { type: 'FeatureCollection', features: [square('West', 0), square('East', 10), square('North', 20), road, rail] };
  const rows = [{ region: 'West', amount: 10 }, { region: 'East', amount: 55 }, { region: 'North', amount: 100 }];
  const mapItem = (extra = {}) => ({ type: 'map', name: 'M', x: 0, y: 0, w: 300, h: 200, geojson: JSON.stringify(GEO), shapeKey: '=Fields.name',
    valueDataSet: 'Rows', valueKey: '=Fields.region', value: '=Sum(Fields.amount)', colorLow: '#ffffff', colorHigh: '#000000', legend: 'bottom', valueFormat: 'N0', ...extra });
  const drawMap = async (extra) => { const out = await render(report([mapItem(extra)], { data: { rows } }), { fontStore }); return { items: out.pages[0].items, warnings: out.warnings }; };

  it('a click on a region sets parameters (or drills through), in the region\'s scope; hover shows its value', async () => {
    const { items } = await drawMap({ regionAction: { type: 'params', params: { region: '=Fields.region' } } });
    const links = items.filter(i => i.t === 'link' && i.d);
    expect(links.map(l => l.action.params.region)).toEqual(['West', 'East', 'North']);
    expect(links.map(l => l.tip)).toEqual(['West: 10', 'East: 55', 'North: 100']);
    // the hit area is the region's own outline, in page coordinates (like a pie slice)
    expect(links[0].d).toMatch(/^M [\d.]+ [\d.]+ L/);
    const drill = await drawMap({ regionAction: { type: 'report', report: 'region-detail', params: { r: '=Fields.region' } } });
    expect(drill.items.filter(i => i.t === 'link' && i.d)[1].action).toEqual({ type: 'drill', report: 'region-detail', params: { r: 'East' } });
  });
  it('line layers: LineString and MultiLineString drawn as strokes, not filled', async () => {
    const { items } = await drawMap({ lineColor: '#ff0000', lineWidth: 2 });
    const lines = items.filter(i => i.t === 'path' && i.fill === null && i.stroke === '#ff0000');
    expect(lines.map(l => l.shape)).toEqual(['Road', 'Rail']);
    expect(lines[1].d.match(/M/g)).toHaveLength(2);
    expect(lines[0].strokeWidth).toBe(2);
  });
  it('graduated legend: classes of equal width, each region filled with its class colour, ranges in the legend', async () => {
    const { items } = await drawMap({ colorScale: 'classes', classes: 3 });
    const fills = items.filter(i => i.t === 'path' && i.shape && i.fill).map(i => i.fill);
    expect(fills).toEqual(['#ffffff', '#808080', '#000000']);
    expect(textsOf(items)).toEqual(expect.arrayContaining(['10 – 40', '40 – 70', '70 – 100']));
  });
  it('heat legend: a continuous gradient between the lowest and highest value', async () => {
    const { items } = await drawMap({});
    const swatches = items.filter(i => i.t === 'rect' && i.h === 8);
    expect(swatches.length).toBeGreaterThanOrEqual(16);
    expect(textsOf(items)).toEqual(expect.arrayContaining(['10', '100']));
  });
  it('adversarial: shapes, coordinates and points are capped', async () => {
    const huge = { type: 'Feature', properties: { name: 'Huge' }, geometry: { type: 'Polygon', coordinates: [Array.from({ length: 300000 }, (_, i) => [Math.cos(i) * 10, Math.sin(i) * 10])] } };
    const many = Array.from({ length: 6000 }, (_, i) => square(`S${i}`, i % 100));
    const t0 = Date.now();
    const one = (features) => render(report([mapItem({ geojson: JSON.stringify({ type: 'FeatureCollection', features }), valueDataSet: null, legend: 'none' })], { data: { rows } }), { fontStore });
    const a = await one([square('Small', 0), huge]);
    expect(a.warnings.join()).toMatch(/more than 200,000 coordinates/);
    expect(a.pages[0].items.filter(i => i.t === 'path')).toHaveLength(1);
    const b = await one(many);
    expect(b.warnings.join()).toMatch(/more than 5,000 shapes/);
    expect(b.pages[0].items.filter(i => i.t === 'path').length).toBeLessThanOrEqual(5000);
    expect(Date.now() - t0).toBeLessThan(10000);
  }, 30000);
});
