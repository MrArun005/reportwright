// Phase 5: charts. Maths first (chart-kit), then each roadmap row through a real render.
import { describe, it, expect } from 'vitest';
import { PALETTES, paletteOf, inkOn, contrast, niceScale, logTicks, curvePath, fitTrend, movingAverage, LabelPlacer } from '../../src/engine/items/chart-kit.js';

describe('kit', () => {
  it('ships 12 named palettes of valid colours; unknown names fall back; custom arrays drop bad entries', () => {
    expect(Object.keys(PALETTES)).toHaveLength(12);
    for (const [name, p] of Object.entries(PALETTES)) {
      expect(p.length, name).toBeGreaterThanOrEqual(6);
      for (const c of p) expect(c, name).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(paletteOf('nope')).toBe(PALETTES.default);
    expect(paletteOf(undefined)).toBe(PALETTES.default);
    expect(paletteOf(['#000000', 'bad', 'red;x'])).toEqual(['#000000']);
    expect(paletteOf([])).toBe(PALETTES.default);
  });
  it('picks the label ink with the higher contrast', () => {
    expect(inkOn('#f59e0b')).not.toBe('#ffffff');
    expect(inkOn('#1e3a8a')).toBe('#ffffff');
    expect(inkOn('#84cc16')).not.toBe('#ffffff');
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(inkOn('nonsense')).toBe('#ffffff');
  });
  it('keeps the nice scale and makes log ticks', () => {
    expect(niceScale(0, 87)).toEqual({ lo: 0, hi: 100, step: 20 });
    expect(logTicks(3, 4200)).toEqual([1, 10, 100, 1000, 10000]);
    expect(logTicks(0.02, 0.5)).toEqual([0.01, 0.1, 1]);
    expect(logTicks(5, 5)).toEqual([1, 10]);
  });
  it('draws monotone smooth curves that never overshoot, and centred steps', () => {
    const pts = [{ x: 0, y: 50 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 100 }, { x: 40, y: 90 }];
    const d = curvePath(pts, 'smooth');
    expect(d).toMatch(/^M 0 50 C /);
    // every control point stays within the y range of its two neighbours (no overshoot)
    const nums = d.replace(/[MC]/g, ' ').trim().split(/[\s,]+/).map(Number);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(curvePath([{ x: 0, y: 5 }, { x: 10, y: 8 }], 'step')).toBe('M 0 5 H 5 V 8 H 10');
    expect(curvePath([{ x: 0, y: 5 }, { x: 10, y: 8 }], 'straight')).toBe('M 0 5 L 10 8');
    expect(curvePath([{ x: 3, y: 4 }], 'smooth')).toBe('M 3 4');
  });
  it('fits linear, exponential and polynomial trends', () => {
    const lin = fitTrend([[0, 1], [1, 3], [2, 5]], 'linear');
    expect(lin.at(0)).toBeCloseTo(1); expect(lin.at(10)).toBeCloseTo(21);
    const ex = fitTrend([0, 1, 2, 3].map(x => [x, 2 * Math.exp(0.5 * x)]), 'exp');
    expect(ex.at(0)).toBeCloseTo(2); expect(ex.at(4)).toBeCloseTo(2 * Math.exp(2));
    expect(fitTrend([[0, -1], [1, 2]], 'exp')).toBe(null); // needs two positive values
    const poly = fitTrend([-2, -1, 0, 1, 2, 3].map(x => [x, x * x - x]), 'poly', 2);
    expect(poly.at(5)).toBeCloseTo(20);
    expect(fitTrend([[0, 1], [1, 2]], 'poly', 2)).toBe(null); // needs order + 1 points
    const big = fitTrend(Array.from({ length: 40 }, (_, x) => [x, x ** 3]), 'poly', 99); // order clamps to 6
    expect(big.order).toBe(6);
    expect(big.at(10)).toBeCloseTo(1000, 0);
  });
  it('moving average with a running sum', () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(movingAverage([1, 2], 5)).toEqual([null, null]);
    expect(movingAverage([4, null, 6], 2)).toEqual([null, null, null]); // a gap resets the window
    const t = performance.now();
    movingAverage(Array.from({ length: 200000 }, (_, i) => i), 1000);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it('places labels without overlaps, in grid buckets', () => {
    const p = new LabelPlacer({ x: 0, y: 0, w: 1000, h: 1000 });
    expect(p.place({ x: 10, y: 10, w: 30, h: 8 })).toBe(true);
    expect(p.place({ x: 20, y: 12, w: 30, h: 8 })).toBe(false);
    expect(p.place({ x: 45, y: 10, w: 30, h: 8 })).toBe(true);
    expect(p.place({ x: 990, y: 10, w: 30, h: 8 })).toBe(false); // leaves the plot
    const t = performance.now();
    const q = new LabelPlacer({ x: 0, y: 0, w: 2000, h: 2000 });
    for (let i = 0; i < 20000; i++) q.place({ x: (i * 37) % 1970, y: (i * 11) % 1990, w: 30, h: 8 });
    expect(performance.now() - t).toBeLessThan(300);
  });
});

/* ---------------------------------------------------------------- rendering */
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const rows = [
  { m: 1, region: 'North', amt: 10, q: 3, lo: 5, hi: 12, o: 10, h: 14, l: 8, c: 12 },
  { m: 2, region: 'South', amt: 30, q: 1, lo: 20, hi: 35, o: 12, h: 13, l: 9, c: 10 },
  { m: 3, region: 'North', amt: 50, q: 7, lo: 40, hi: 55, o: 10, h: 16, l: 10, c: 15 },
];
const chart = (extra, data = rows) => report([{ type: 'chart', name: 'C', x: 0, y: 0, w: 400, h: 240, dataSet: 'Rows', category: '=Fields.m', series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }], ...extra }], { data: { rows: data } });
const draw = async (extra, data) => { const out = await render(chart(extra, data), { fontStore }); return { items: out.pages[0].items, warnings: out.warnings }; };
const textsOf = (items) => items.filter(i => i.t === 'text').map(i => i.lines[0].text);
const rects = (items, fill) => items.filter(i => i.t === 'rect' && !i.radius && (!fill || i.fill === fill)); // radius: legend keys
const textAt = (items, s) => items.find(i => i.t === 'text' && i.lines[0].text === s);

describe('row 21: stacks, ranges, smooth and step lines', () => {
  it('100% stack: every category reaches the same top; ticks 0%..100%', async () => {
    const { items } = await draw({ stacked: 'percent', seriesGroup: '=Fields.region', series: [{ name: 'A', value: '=Sum(Fields.amt)' }, { name: 'Q', value: '=Sum(Fields.q)' }] });
    expect(textsOf(items)).toEqual(expect.arrayContaining(['0%', '100%']));
    const bars = rects(items).filter(r => r.h > 0 && r.w < 100);
    const tops = new Map();
    for (const r of bars) { const k = Math.round(r.x / 40); tops.set(k, Math.min(tops.get(k) ?? 1e9, r.y)); }
    const ys = [...tops.values()];
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
  });
  it('a range series draws floating columns from low to high', async () => {
    const { items } = await draw({ series: [{ name: 'Range', low: '=Sum(Fields.lo)', high: '=Sum(Fields.hi)' }] });
    const bars = rects(items, '#2563eb');
    expect(bars).toHaveLength(3);
    // 5..12 on a 0..60 axis: the bar does not touch the zero line
    const zero = items.find(i => i.t === 'line' && i.stroke === '#9ca3af');
    expect(bars[0].y + bars[0].h).toBeLessThan(zero.y1 - 5);
  });
  it('a range in a line chart is one filled band', async () => {
    const { items } = await draw({ chartType: 'line', series: [{ name: 'Range', low: '=Sum(Fields.lo)', high: '=Sum(Fields.hi)' }] });
    expect(items.filter(i => i.t === 'path' && i.fill === '#2563eb40')).toHaveLength(1);
  });
  it('smooth and step lines', async () => {
    const sm = await draw({ chartType: 'line', line: 'smooth' });
    expect(sm.items.find(i => i.t === 'path' && i.stroke === '#2563eb').d).toContain(' C ');
    const st = await draw({ chartType: 'line', series: [{ name: 'A', value: '=Sum(Fields.amt)', line: 'step' }] });
    expect(st.items.find(i => i.t === 'path' && i.stroke === '#2563eb').d).toMatch(/ H .* V /);
  });
});

describe('row 22: axis control', () => {
  it('min, max and format', async () => {
    const { items } = await draw({ axes: { y: { min: 0, max: 200, format: 'C0' } } });
    expect(textsOf(items)).toContain('₹200');
    expect(textsOf(items)).not.toContain('₹250');
  });
  it('a log axis has decades and warns on values <= 0', async () => {
    const { items, warnings } = await draw({ axes: { y: { log: true } }, series: [{ name: 'A', value: '=Sum(Fields.amt) * Fields.amt' }] });
    expect(textsOf(items)).toEqual(expect.arrayContaining(['100', '1,000', '10,000'])); // 100, 900, 2,500
    expect(textsOf(items)).not.toContain('5,000');
    expect(warnings).toEqual([]);
    const neg = await draw({ axes: { y: { log: true } }, series: [{ name: 'A', value: '=Sum(Fields.amt) - 20' }] });
    expect(neg.warnings.join()).toMatch(/logarithmic/);
  });
  it('reversed category axis, label angle, no gridlines, axis titles', async () => {
    const plain = await draw({});
    const rev = await draw({ axes: { x: { reversed: true, labelAngle: -45, title: 'Month' }, y: { gridlines: false, title: 'Amount' } } });
    expect(textAt(rev.items, '1').lines[0].x).toBeGreaterThan(textAt(rev.items, '3').lines[0].x);
    expect(textAt(rev.items, '1').rotate.a).toBe(-45);
    expect(textAt(rev.items, 'Amount').rotate.a).toBe(-90);
    expect(textsOf(rev.items)).toContain('Month');
    expect(rev.items.filter(i => i.t === 'line' && i.stroke === '#e5e7eb')).toHaveLength(0);
    expect(plain.items.filter(i => i.t === 'line' && i.stroke === '#e5e7eb').length).toBeGreaterThan(2);
  });
});

describe('row 23: combo charts', () => {
  it('columns on the primary axis, a line on a secondary axis with its own ticks', async () => {
    const { items } = await draw({ series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }, { name: 'Qty', value: '=Sum(Fields.q)', type: 'line', axis: 'secondary' }], axes: { y2: { format: 'N1', title: 'Qty' } } });
    expect(rects(items, '#2563eb')).toHaveLength(3);
    const line = items.find(i => i.t === 'path' && i.stroke === '#f59e0b');
    expect(line).toBeTruthy();
    // the secondary axis: 0.0 .. 8.0 on the right
    const t8 = textAt(items, '8.0');
    expect(t8.lines[0].x).toBeGreaterThan(350);
    // q = 7 is the top of the secondary axis (0..8): the third line point sits near the top, not near the bottom
    const ys = line.d.match(/[\d.]+ [\d.]+/g).map(p => Number(p.split(' ')[1]));
    expect(ys[2]).toBeLessThan(ys[1]);
  });
  it('a bar chart with a line series', async () => {
    const { items } = await draw({ chartType: 'bar', series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }, { name: 'Lo', value: '=Sum(Fields.lo)', type: 'line' }] });
    expect(rects(items, '#2563eb')).toHaveLength(3);
    expect(items.some(i => i.t === 'path' && i.stroke === '#f59e0b')).toBe(true);
  });
});

describe('row 24: new chart types', () => {
  it('bubble: area grows with the size', async () => {
    const { items } = await draw({ chartType: 'bubble', xValue: '=Fields.m', series: [{ name: 'B', value: '=Fields.amt', size: '=Fields.m * Fields.m * Fields.m * Fields.m' }] }, [{ m: 1, amt: 1 }, { m: 2, amt: 2 }, { m: 4, amt: 3 }]);
    const r = items.filter(i => i.t === 'ellipse').map(e => e.rx).sort((a, b) => a - b);
    // sizes 1, 16, 256 → radii 1 : 4 : 16 (area ∝ size), the smallest clamped at 1.5
    expect(r[2] / r[1]).toBeCloseTo(4, 1);
  });
  it('radar: one closed polygon per series, first vertex at the top', async () => {
    const { items } = await draw({ chartType: 'radar', category: '=Fields.region & Fields.m' });
    const poly = items.find(i => i.t === 'path' && i.stroke === '#2563eb');
    expect(poly.d.endsWith('Z')).toBe(true);
    expect(poly.d.match(/[ML]/g)).toHaveLength(3);
    const [x0] = poly.d.slice(2).split(' ').map(Number);
    expect(x0).toBeCloseTo(200, 0);
  });
  it('polar: 90° is to the right of the centre', async () => {
    const { items } = await draw({ chartType: 'polar', xValue: '=Fields.m * 90', series: [{ name: 'P', value: '=Fields.amt' }] }, [{ m: 1, amt: 10 }]);
    const dot = items.find(i => i.t === 'ellipse' && i.fill === '#2563eb');
    expect(dot.cx).toBeGreaterThan(220);
    expect(dot.cy).toBeCloseTo(items.find(i => i.t === 'ellipse' && i.fill == null).cy, 0);
  });
  it('candlestick: up and down candles with wicks', async () => {
    const { items } = await draw({ chartType: 'candlestick', series: [{ name: 'Price', open: '=Sum(Fields.o)', high: '=Sum(Fields.h)', low: '=Sum(Fields.l)', close: '=Sum(Fields.c)' }] });
    expect(rects(items, '#16a34a')).toHaveLength(2);
    expect(rects(items, '#dc2626')).toHaveLength(1);
    expect(items.filter(i => i.t === 'line' && i.stroke === '#16a34a')).toHaveLength(2);
    // the axis does not start at 0 for prices
    expect(textsOf(items)).not.toContain('0');
  });
  it('OHLC: a high-low line plus open and close ticks', async () => {
    const { items } = await draw({ chartType: 'ohlc', series: [{ name: 'Price', open: '=Sum(Fields.o)', high: '=Sum(Fields.h)', low: '=Sum(Fields.l)', close: '=Sum(Fields.c)' }] });
    expect(items.filter(i => i.t === 'line' && (i.stroke === '#16a34a' || i.stroke === '#dc2626'))).toHaveLength(9);
  });
  it('gauge: 75 on 0..100 points up and to the right, with bands', async () => {
    const { items } = await draw({ chartType: 'gauge', series: [{ name: 'Score', value: '=75' }], axes: { y: { min: 0, max: 100 } }, overlays: [{ type: 'band', from: 0, to: 50, color: '#dc2626' }, { type: 'band', from: 50, to: 100, color: '#16a34a' }] });
    expect(textsOf(items)).toEqual(expect.arrayContaining(['0', '100', '75']));
    const needle = items.find(i => i.t === 'path' && i.fill === '#1f2937');
    const hub = items.find(i => i.t === 'ellipse' && i.fill === '#1f2937');
    const tip = needle.d.match(/L ([\d.]+) ([\d.]+)/).slice(1).map(Number).map((v, k) => v + (k ? needle.y : needle.x)); // paths are placed by x/y
    const ang = Math.atan2(hub.cy - tip[1], tip[0] - hub.cx) * 180 / Math.PI;
    expect(ang).toBeCloseTo(45, 0);
    expect(items.some(i => i.t === 'path' && i.fill === '#dc2626')).toBe(true);
  });
  it('funnel: stages in data order, widths from the values', async () => {
    const { items } = await draw({ chartType: 'funnel', category: '=Fields.s', series: [{ name: 'N', value: '=Sum(Fields.n)' }] }, [{ s: 'Leads', n: 100 }, { s: 'Calls', n: 50 }, { s: 'Won', n: 25 }]);
    const stages = items.filter(i => i.t === 'path' && i.stroke === '#ffffff');
    const width = (d) => { const xs = d.match(/[\d.]+ [\d.]+/g).map(p => Number(p.split(' ')[0])); return xs[1] - xs[0]; };
    expect(width(stages[0].d) / width(stages[1].d)).toBeCloseTo(2, 2);
    expect(textsOf(items)).toEqual(expect.arrayContaining(['Leads: 100', 'Calls: 50', 'Won: 25']));
  });
});

describe('row 25: overlays', () => {
  it('a linear trend through 10, 30, 50 runs from the first value to the last', async () => {
    const { items } = await draw({ chartType: 'line', overlays: [{ type: 'trend', color: '#000000' }] });
    const line = items.find(i => i.t === 'path' && i.stroke === '#2563eb');
    const trend = items.find(i => i.t === 'path' && i.stroke === '#000000');
    expect(trend.dash).toEqual([4, 3]);
    const pts = (d) => d.match(/-?[\d.]+ -?[\d.]+/g).map(p => p.split(' ').map(Number));
    expect(pts(trend.d)[0]).toEqual(pts(line.d)[0]);
    expect(pts(trend.d).at(-1)).toEqual(pts(line.d).at(-1));
  });
  it('a moving average starts at the period', async () => {
    const { items } = await draw({ chartType: 'line', overlays: [{ type: 'movingAverage', period: 2, color: '#000000' }] });
    const ma = items.find(i => i.t === 'path' && i.stroke === '#000000');
    expect(ma.d.match(/[ML]/g)).toHaveLength(2);
  });
  it('a reference line at the average with its label, and a band behind the bars', async () => {
    const { items } = await draw({ overlays: [{ type: 'line', value: '=Avg(Fields.amt)', label: 'Average' }, { type: 'band', from: 20, to: 40, color: '#10b981' }] });
    expect(textsOf(items)).toContain('Average 30');
    const band = items.findIndex(i => i.t === 'rect' && i.fill === '#10b98126');
    const firstBar = items.findIndex(i => i.t === 'rect' && i.fill === '#2563eb');
    expect(band).toBeGreaterThan(-1);
    expect(band).toBeLessThan(firstBar);
  });
  it('caps overlays and periods; poly order is clamped', async () => {
    const { items, warnings } = await draw({ chartType: 'line', overlays: [...Array.from({ length: 25 }, () => ({ type: 'line', value: 1 })), { type: 'movingAverage', period: 1e9 }, { type: 'trend', kind: 'poly', order: 1e6 }] });
    expect(warnings.join()).toMatch(/27 overlays; only the first 20/);
    expect(items.filter(i => i.t === 'line' && i.stroke === '#dc2626')).toHaveLength(20);
  });
});

describe('row 26: data labels', () => {
  it('templates with placeholders and expressions', async () => {
    const a = await draw({ labelTemplate: '{category}: {value} ({percent})' });
    expect(textsOf(a.items)).toEqual(expect.arrayContaining(['1: 10 (11%)', '2: 30 (33%)', '3: 50 (56%)']));
    const b = await draw({ labelTemplate: '=Fields.region' });
    expect(textsOf(b.items)).toEqual(expect.arrayContaining(['North', 'South']));
    const c = await draw({ chartType: 'pie', labelTemplate: '{category} {percent}' });
    expect(textsOf(c.items)).toContain('3 56%');
  });
  it('positions: outside above the bar, inside under its top, center in the middle; ink by contrast', async () => {
    const pos = async (labelPosition) => { const { items } = await draw({ showValues: true, labelPosition, palette: ['#fde047'] }); return { t: items.find(i => i.t === 'text' && i.lines[0].text === '50' && i.size < 7.5), bar: rects(items, '#fde047')[2] }; };
    const o = await pos('outside'), i = await pos('inside'), c = await pos('center');
    expect(o.t.lines[0].y).toBeLessThan(o.bar.y);
    expect(i.t.lines[0].y).toBeGreaterThan(i.bar.y);
    expect(i.t.lines[0].y).toBeLessThan(i.bar.y + i.bar.h / 2);
    expect(c.t.lines[0].y).toBeCloseTo(c.bar.y + c.bar.h / 2 + 7.5 * 0.9 * 0.35, 1);
    expect(i.t.color).toBe('#111827'); // dark ink on yellow
  });
  it('labels never overlap', async () => {
    const data = Array.from({ length: 30 }, (_, k) => ({ m: k, amt: 100 + (k % 2), q: 100 + (k % 3) }));
    const { items } = await draw({ chartType: 'line', showValues: true, series: [{ name: 'A', value: '=Sum(Fields.amt)' }, { name: 'B', value: '=Sum(Fields.q)' }] }, data);
    const boxes = items.filter(i => i.t === 'text' && i.size < 7).map(i => ({ x: i.lines[0].x, y: i.lines[0].y - i.size * 0.8, w: i.lines[0].w, h: i.size }));
    expect(boxes.length).toBeGreaterThan(5);
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const p = boxes[a], q = boxes[b];
      expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h).toBe(false);
    }
  });
  it('stacked columns show centred values', async () => {
    const { items } = await draw({ stacked: true, showValues: true, seriesGroup: '=Fields.region' });
    const t = textAt(items, '30');
    expect(t).toBeTruthy();
  });
});

describe('row 27: palettes', () => {
  it('a named palette colours the series', async () => {
    const { items } = await draw({ palette: 'office', seriesGroup: '=Fields.region' });
    expect(rects(items, PALETTES.office[0]).length).toBeGreaterThan(0);
    expect(rects(items, PALETTES.office[1]).length).toBeGreaterThan(0);
  });
});

describe('untrusted sizes', () => {
  it('caps categories and series groups, in linear time', async () => {
    const data = Array.from({ length: 20000 }, (_, i) => ({ m: i % 5000, g: `g${i % 2000}`, amt: i }));
    const t = performance.now();
    const a = await draw({ seriesGroup: '=Fields.g' }, data);
    expect(performance.now() - t).toBeLessThan(8000);
    expect(a.warnings.join('\n')).toMatch(/5000 categories; only the first 1000/);
    expect(a.warnings.join('\n')).toMatch(/2000 series groups; only the first 50/);
  });
  it('caps scatter points and long labels', async () => {
    const data = Array.from({ length: 12000 }, (_, i) => ({ m: i, amt: i % 97 }));
    const { items, warnings } = await draw({ chartType: 'scatter', xValue: '=Fields.m' }, data);
    expect(warnings.join()).toMatch(/only the first 10000 points/);
    expect(items.filter(i => i.t === 'ellipse')).toHaveLength(10000);
    const four = await draw({ chartType: 'scatter', xValue: '=Fields.m', series: [1, 2, 3, 4].map(k => ({ name: `S${k}`, value: `=Fields.amt * ${k}` })) }, data);
    expect(four.items.filter(i => i.t === 'ellipse')).toHaveLength(10000); // the cap is per chart, not per series
    const long = await draw({ category: '=Fields.region', title: 'x'.repeat(100000), labelTemplate: '{value}'.repeat(10000) });
    expect(long.items.every(i => i.t !== 'text' || i.lines[0].text.length <= 201)).toBe(true);
  });
});

import { pageToSvg } from '../../src/exporters/svg.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import zlib from 'node:zlib';

describe('row 27: animations (viewer only) and dashed paths', () => {
  it('tags bars with a grow animation from the baseline; the viewer SVG plays it, exports stay static', async () => {
    const plain = await draw({});
    const { items } = await draw({ animation: 'grow' });
    const bars = rects(items, '#2563eb');
    expect(bars.every(b => b.anim?.k === 'growY' && b.anim.o === 'bottom')).toBe(true);
    const page = { items };
    const svg = pageToSvg(page, 600, 400, { animate: true });
    expect(svg).toContain('class="pw-a pw-a-growY" style="transform-origin:center bottom;animation-delay:0ms"');
    expect(svg.match(/<style>/g)).toHaveLength(1);
    expect(svg).toContain('prefers-reduced-motion');
    // without animate (PDF, HTML, designer) the SVG is the same as a chart without animation
    expect(pageToSvg(page, 600, 400)).toBe(pageToSvg({ items: plain.items }, 600, 400));
  });
  it('negative bars grow from the top; bar charts grow sideways', async () => {
    const neg = await draw({ animation: 'grow' }, [{ m: 1, amt: -5 }]);
    expect(rects(neg.items, '#2563eb')[0].anim.o).toBe('top');
    const bar = await draw({ animation: 'grow', chartType: 'bar' });
    expect(rects(bar.items, '#2563eb')[0].anim).toMatchObject({ k: 'growX', o: 'left' });
    const fade = await draw({ animation: 'fade', chartType: 'line' });
    expect(fade.items.find(i => i.t === 'path').anim.k).toBe('fade');
  });
  it('a dashed path in SVG and PDF', async () => {
    expect(pageToSvg({ items: [{ t: 'path', x: 0, y: 0, d: 'M 0 0 L 10 10', stroke: '#000000', strokeWidth: 1, dash: [4, 3] }] }, 20, 20)).toContain('stroke-dasharray="4 3"');
    const model = await render(chart({ chartType: 'line', overlays: [{ type: 'trend' }] }), { fontStore });
    const bytes = Buffer.from(await exportPdf(model, fontStore)).toString('latin1');
    // page content streams are deflated: inflate each one and look for the dash operator
    const streams = [...bytes.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => { try { return zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return m[1]; } });
    expect(streams.some(s => /\[4 3\] 0 d/.test(s))).toBe(true);
  });
});

describe('row 28: sparklines, icon sets, range bars', () => {
  const item = (type, extra, data = [{ v: 3 }, { v: -2 }, { v: 0 }, { v: 5 }]) => render(report([{ type, name: 'V', x: 0, y: 0, w: 100, h: 20, dataSet: 'Rows', ...extra }], { data: { rows: data } }), { fontStore }).then(o => ({ items: o.pages[0].items, warnings: o.warnings }));
  it('sparkline area: a line plus one filled path', async () => {
    const { items } = await item('sparkline', { value: '=Fields.v', style: 'area' });
    expect(items.filter(i => i.t === 'path' && i.fill === '#2563eb33')).toHaveLength(1);
    expect(items.filter(i => i.t === 'path' && i.stroke === '#2563eb')).toHaveLength(1);
  });
  it('win/loss: up bars for wins, down bars in red for losses, a stub for zero', async () => {
    const { items } = await item('sparkline', { value: '=Fields.v', style: 'winloss' });
    const r = items.filter(i => i.t === 'rect');
    expect(r).toHaveLength(4);
    const mid = 36 + 10; // page margin + the middle of the 20 pt item
    expect(r[0].y + r[0].h).toBeCloseTo(mid, 5); expect(r[0].fill).toBe('#2563eb');
    expect(r[1].y).toBeCloseTo(mid, 5); expect(r[1].fill).toBe('#dc2626');
    expect(r[3].h).toBe(r[0].h); // win/loss: every bar the same height
    expect(r[2].h).toBeLessThan(2);
  });
  it('a range band behind the sparkline', async () => {
    const { items } = await item('sparkline', { value: '=Fields.v', bandLow: '=0', bandHigh: '=3', bandColor: '#dcfce7' });
    const band = items.findIndex(i => i.t === 'rect' && i.fill === '#dcfce7');
    expect(band).toBe(0);
    // values -2..5 over 14 pt of height: 0..3 is 3/7 of it
    expect(items[0].h).toBeCloseTo(14 * 3 / 7, 5);
  });
  it('icon sets pick the icon by thresholds', async () => {
    const at = async (v, iconSet = 'trafficLights') => (await item('iconset', { value: `=${v}`, iconSet, lower: '=33', upper: '=67' }, [{}])).items;
    expect((await at(10)).find(i => i.t === 'ellipse').fill).toBe('#dc2626');
    expect((await at(50)).find(i => i.t === 'ellipse').fill).toBe('#f59e0b');
    expect((await at(90)).find(i => i.t === 'ellipse').fill).toBe('#16a34a');
    for (const set of ['arrows', 'symbols', 'flags', 'ratings']) {
      const lo = await at(10, set), hi = await at(90, set);
      expect(lo.length, set).toBeGreaterThan(0);
      expect(JSON.stringify(lo), set).not.toBe(JSON.stringify(hi));
    }
  });
  it('a range bar from low to high on min..max', async () => {
    const { items } = await item('rangebar', { low: '=20', high: '=60', min: '=0', max: '=100' }, [{}]);
    const [track, bar] = items.filter(i => i.t === 'rect');
    expect(bar.x - track.x).toBeCloseTo(track.w * 0.2, 5);
    expect(bar.w).toBeCloseTo(track.w * 0.4, 5);
  });
  it('icon sets and range bars work in table cells', async () => {
    const def = report([{ type: 'table', name: 'T', x: 0, y: 0, w: 140, h: 16, dataSet: 'Rows', columns: [{ width: 60 }, { width: 80 }],
      detail: [{ height: 16, cells: [{ value: '', visual: { type: 'iconset', value: '=Fields.v', iconSet: 'arrows' } }, { value: '', visual: { type: 'rangebar', low: '=0', high: '=Fields.v', max: '=10' } }] }] }], { data: { rows: [{ v: 5 }, { v: 80 }] } });
    const out = await render(def, { fontStore });
    expect(out.warnings).toEqual([]);
    expect(out.pages[0].items.filter(i => i.t === 'path').length).toBe(2);
  });
  it('100,000 sparkline values: capped, no stack overflow', async () => {
    const data = Array.from({ length: 100000 }, (_, i) => ({ v: i % 13 }));
    const { items, warnings } = await item('sparkline', { value: '=Fields.v' }, data);
    expect(items.some(i => i.t === 'path')).toBe(true);
    expect(warnings.join()).toMatch(/only the first 5000/);
  });
});
