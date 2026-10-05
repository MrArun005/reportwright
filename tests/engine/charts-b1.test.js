// Batch 1 charts: pie and donut outside labels with leader lines, overlays in the legend, three gauge shapes and indicators.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportHtml } from '../../src/exporters/html.js';
import { fontStore, report } from '../helpers.js';

const rows = [
  { m: 1, amt: 10 }, { m: 2, amt: 30 }, { m: 3, amt: 50 }, { m: 4, amt: 20 },
];
const chart = (extra, data = rows) => report([{ type: 'chart', name: 'C', x: 0, y: 0, w: 400, h: 240, dataSet: 'Rows', category: '=Fields.m', series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }], ...extra }], { data: { rows: data } });
const draw = async (extra, data) => { const out = await render(chart(extra, data), { exportData: true, fontStore }); return { items: out.pages[0].items, warnings: out.warnings, model: out }; };
const texts = (items) => items.filter(i => i.t === 'text');
const textsOf = (items) => texts(items).map(i => i.lines[0].text);
const O = 36; // the page margin: items are placed on the page
const box = (t) => ({ x: t.lines[0].x, y: t.lines[0].y - t.size * 0.8, w: t.lines[0].w, h: t.size });
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('pie and donut outside labels', () => {
  // twelve slices, several tiny: inside labels would hide them; outside they must all be placed without overlapping
  const many = Array.from({ length: 12 }, (_, i) => ({ m: `Region ${i + 1}`, amt: i < 6 ? 1 + i : 40 + i }));
  for (const chartType of ['pie', 'donut']) {
    it(`${chartType}: every label outside, joined by a leader line, none overlapping, all inside the chart`, async () => {
      const { items } = await draw({ chartType, labelPosition: 'outside', legend: 'none' }, many);
      const labels = texts(items).filter(t => /^Region \d+: \d+%$/.test(t.lines[0].text));
      expect(labels.length).toBe(12);
      const leaders = items.filter(i => i.t === 'path' && i.fill === null && i.stroke === '#9ca3af');
      expect(leaders).toHaveLength(12);
      for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) expect(hit(box(labels[a]), box(labels[b])), `${labels[a].lines[0].text} / ${labels[b].lines[0].text}`).toBe(false);
      for (const l of labels) { const r = box(l); expect(r.x).toBeGreaterThanOrEqual(O - 0.5); expect(r.x + r.w).toBeLessThanOrEqual(O + 400.5); expect(r.y).toBeGreaterThanOrEqual(O - 0.5); expect(r.y + r.h).toBeLessThanOrEqual(O + 240.5); }
      // a leader ends next to its label: within a few points of the label's left or right edge, at its middle
      for (const l of leaders) {
        const [x, y] = l.d.trim().split(/\s+/).slice(-2).map(Number).map((v, k) => v + (k ? l.y : l.x));
        expect(labels.some(t => Math.abs(t.lines[0].y - t.size * 0.35 - y) < 2 && (Math.abs(t.lines[0].x - x) < 5 || Math.abs(t.lines[0].x + t.lines[0].w - x) < 5))).toBe(true);
      }
    });
  }
  it('drops the smallest slices\' labels when a side cannot hold them all', async () => {
    const tiny = Array.from({ length: 60 }, (_, i) => ({ m: `C${i}`, amt: i + 1 }));
    const { items } = await draw({ chartType: 'pie', labelPosition: 'outside', legend: 'none', h: 120 }, tiny);
    const labels = texts(items).filter(t => /^C\d+: /.test(t.lines[0].text));
    expect(labels.length).toBeGreaterThan(4);
    expect(labels.length).toBeLessThan(60);
    expect(labels.map(t => t.lines[0].text)).toContain('C59: 3%');
  });
  it('keeps the template, and inside labels are unchanged', async () => {
    const { items } = await draw({ chartType: 'pie', labelPosition: 'outside', labelTemplate: '{category} ({value})', legend: 'none' });
    expect(textsOf(items)).toEqual(expect.arrayContaining(['1 (10)', '3 (50)']));
    const inside = await draw({ chartType: 'pie', legend: 'none' });
    expect(textsOf(inside.items)).toEqual(expect.arrayContaining(['9%', '45%']));
    expect(inside.items.some(i => i.t === 'path' && i.stroke === '#9ca3af')).toBe(false);
  });
});

describe('overlays in the legend', () => {
  const ovs = [{ type: 'trend', label: 'Trend' }, { type: 'movingAverage', period: 2 }, { type: 'line', value: 25, label: 'Target', color: '#16a34a' }, { type: 'band', from: 20, to: 40, legend: false }];
  it('a single-series chart gets a legend: the series, then each overlay with a line or band key', async () => {
    const { items } = await draw({ chartType: 'line', overlays: ovs });
    const t = textsOf(items);
    expect(t).toEqual(expect.arrayContaining(['Amount', 'Trend', 'Moving average 2 (Amount)', 'Target']));
    expect(t).not.toContain('Band');
    // the reference line's key is a short dashed line in its colour
    expect(items.some(i => i.t === 'line' && i.stroke === '#16a34a' && i.dash && Math.abs(i.x2 - i.x1 - 11) < 0.01)).toBe(true);
  });
  it('a band in the legend has a translucent key; legend: none hides it all', async () => {
    const { items } = await draw({ chartType: 'column', overlays: [{ type: 'band', from: 20, to: 40, label: 'Normal', color: '#2563eb' }] });
    expect(textsOf(items)).toContain('Normal');
    expect(items.some(i => i.t === 'rect' && i.fill === '#2563eb40' && i.radius)).toBe(true);
    const none = await draw({ chartType: 'column', legend: 'none', overlays: [{ type: 'band', from: 20, to: 40, label: 'Normal' }] });
    expect(none.items.some(i => i.t === 'rect' && /40$/.test(i.fill || '') && i.radius)).toBe(false);
  });
  it('a scatter trend is listed; a pie never lists overlays', async () => {
    const xy = await draw({ chartType: 'scatter', xValue: '=Fields.m', series: [{ name: 'Amt', value: '=Fields.amt' }], overlays: [{ type: 'trend' }] });
    expect(textsOf(xy.items)).toContain('Trend (Amt)');
    const pie = await draw({ chartType: 'pie', overlays: [{ type: 'trend', label: 'Nope' }] });
    expect(textsOf(pie.items)).not.toContain('Nope');
  });
});

describe('gauge shapes and indicators', () => {
  const gauge = (extra) => draw({ chartType: 'gauge', series: [{ name: 'Score', value: '=75' }], axes: { y: { min: 0, max: 100 } }, overlays: [{ type: 'band', from: 0, to: 50, color: '#dc2626' }, { type: 'band', from: 50, to: 100, color: '#16a34a' }], ...extra });
  const needleAngle = (items) => {
    const needle = items.find(i => i.t === 'path' && i.fill === '#1f2937');
    const hub = items.find(i => i.t === 'ellipse' && i.fill === '#1f2937');
    const tip = needle.d.match(/L ([\d.-]+) ([\d.-]+)/).slice(1).map(Number).map((v, k) => v + (k ? needle.y : needle.x));
    return { ang: Math.atan2(tip[1] - hub.cy, tip[0] - hub.cx) * 180 / Math.PI, hub };
  };
  it('half (the default) is unchanged: 75 of 100 points up and to the right', async () => {
    const { items } = await gauge({});
    expect(needleAngle(items).ang).toBeCloseTo(-45, 0);
    expect(textsOf(items)).toEqual(expect.arrayContaining(['0', '100', '75']));
  });
  it('three-quarter: 270° from bottom left; 75 of 100 points down and to the right', async () => {
    const { items } = await gauge({ gaugeShape: 'threeQuarter' });
    // start 135°, sweep 270°: 75% is at 135 + 202.5 = 337.5° = -22.5°
    expect(needleAngle(items).ang).toBeCloseTo(-22.5, 0);
    expect(items.some(i => i.t === 'path' && i.fill === '#16a34a')).toBe(true);
  });
  it('full: min and max at the top; 25 points right and the max value is not drawn over the min', async () => {
    const { items } = await gauge({ gaugeShape: 'full', series: [{ name: 'Score', value: '=25' }] });
    expect(needleAngle(items).ang).toBeCloseTo(0, 0);
    const t = textsOf(items);
    expect(t).toContain('0');
    expect(t).not.toContain('100');
  });
  it('ticks: major marks with values, minor marks between; off with gaugeTicks: false', async () => {
    const { items } = await gauge({ gaugeShape: 'threeQuarter', h: 300 });
    expect(items.filter(i => i.t === 'line' && i.stroke === '#6b7280').length).toBeGreaterThanOrEqual(5);
    expect(items.filter(i => i.t === 'line' && i.stroke === '#9ca3af').length).toBeGreaterThanOrEqual(16);
    const off = await gauge({ gaugeShape: 'threeQuarter', h: 300, gaugeTicks: false });
    expect(off.items.filter(i => i.t === 'line' && i.stroke === '#6b7280')).toHaveLength(0);
    expect(textsOf(off.items)).toEqual(expect.arrayContaining(['0', '100']));
  });
  it('pointer: a marker at the value on the track\'s inner edge, no needle; bar: a value bar over the bands', async () => {
    const p = await gauge({ gaugeShape: 'full', gaugeIndicator: 'pointer', pointerColor: '#7c3aed' });
    const mark = p.items.find(i => i.t === 'path' && i.fill === '#7c3aed');
    expect(mark).toBeTruthy();
    expect(p.items.some(i => i.t === 'ellipse' && i.fill === '#7c3aed')).toBe(false);
    const b = await gauge({ gaugeIndicator: 'bar' });
    expect(b.items.some(i => i.t === 'path' && i.fill === '#2563eb')).toBe(true);
    expect(b.items.some(i => i.t === 'path' && i.fill === '#1f2937')).toBe(false);
  });
  it('unknown shape or indicator falls back to the half gauge with a needle', async () => {
    const { items } = await gauge({ gaugeShape: 'octagon', gaugeIndicator: 'laser' });
    expect(needleAngle(items).ang).toBeCloseTo(-45, 0);
  });
});

describe('the new chart options draw the same in PDF and HTML', () => {
  it('outside labels, legend overlays and a full gauge reach both exporters', async () => {
    const def = report([
      { type: 'chart', name: 'P', x: 0, y: 0, w: 260, h: 200, dataSet: 'Rows', category: '=Fields.m', chartType: 'donut', labelPosition: 'outside', series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }] },
      { type: 'chart', name: 'L', x: 270, y: 0, w: 260, h: 200, dataSet: 'Rows', category: '=Fields.m', chartType: 'column', overlays: [{ type: 'trend', label: 'Trend line' }], series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }] },
      { type: 'chart', name: 'G', x: 0, y: 210, w: 200, h: 200, dataSet: 'Rows', chartType: 'gauge', gaugeShape: 'full', gaugeIndicator: 'pointer', series: [{ name: 'Total', value: '=Sum(Fields.amt)' }] },
    ], { data: { rows } });
    const model = await render(def, { exportData: true, fontStore });
    const h = await exportHtml(model, fontStore, { title: 'T' }); const html = typeof h === 'string' ? h : new TextDecoder().decode(h);
    expect(html).toContain('1: 9%');
    expect(html).toContain('Trend line');
    const pdf = await exportPdf(model, fontStore, { title: 'T' });
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe('importers map gauge shapes and pointers', async () => {
  const { importRdl } = await import('../../src/importers/rdl.js');
  const { importRdlx } = await import('../../src/importers/rdlx.js');
  const find = (def, name) => { let hit; const walk = (list) => { for (const i of list || []) { if (i.name === name) hit = i; walk(i.items); } }; for (const s of Object.values(def.sections || {})) walk(s.items); for (const b of def.bodies || []) walk(b.items); return hit; };
  const NS = 'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
  const gaugeRdl = (scaleExtra, pointerExtra) => `<?xml version="1.0"?><Report xmlns="${NS}"><DataSets><DataSet Name="D"><Query><DataSourceName>S</DataSourceName></Query><Fields><Field Name="v"><DataField>v</DataField></Field></Fields></DataSet></DataSets><ReportSections><ReportSection><Body><ReportItems>
    <GaugePanel Name="G"><RadialGauges><RadialGauge Name="R1"><GaugeScales><RadialScale Name="S1">${scaleExtra}
      <GaugePointers><RadialPointer Name="P1">${pointerExtra}<GaugeInputValue><Value>=Sum(Fields!v.Value)</Value></GaugeInputValue></RadialPointer></GaugePointers>
      <MaximumValue><Value>100</Value></MaximumValue><MinimumValue><Value>0</Value></MinimumValue></RadialScale></GaugeScales></RadialGauge></RadialGauges>
      <DataSetName>D</DataSetName><Top>0in</Top><Left>0in</Left><Height>2in</Height><Width>2in</Width></GaugePanel>
    </ReportItems><Height>2in</Height></Body><Width>6in</Width><Page /></ReportSection></ReportSections></Report>`;
  it('SSRS: the sweep angle picks the shape, a Marker or Bar pointer the indicator', () => {
    expect(find(importRdl(gaugeRdl('<SweepAngle>320</SweepAngle>', '<Type>Marker</Type>')).definition, 'G')).toMatchObject({ chartType: 'gauge', gaugeShape: 'full', gaugeIndicator: 'pointer' });
    expect(find(importRdl(gaugeRdl('<SweepAngle>270</SweepAngle>', '<Type>Bar</Type>')).definition, 'G')).toMatchObject({ gaugeShape: 'threeQuarter', gaugeIndicator: 'bar' });
    const half = find(importRdl(gaugeRdl('', '')).definition, 'G');
    expect(half.gaugeShape).toBeUndefined();
    expect(half.gaugeIndicator).toBeUndefined();
  });
  it('ActiveReports: Config.Sweep and Config.PointerType', () => {
    const r = importRdlx({ DataSources: [{ Name: 'S', ConnectionProperties: { DataProvider: 'JSON', ConnectString: 'jsondata={"rows":[{"v":1}]}' } }],
      DataSets: [{ Name: 'D', Fields: [{ Name: 'v', DataField: 'v' }], Query: { DataSourceName: 'S', CommandText: 'jpath=$.rows.*' } }],
      Body: { ReportItems: [{ Type: 'dvchart', Name: 'G', DataSetName: 'D', Width: '3in', Height: '3in', Plots: [{ PlotName: 'P', PlotChartType: 'Gauge', Config: { Sweep: 270, PointerType: 'Marker' }, Encodings: { Values: [{ Field: { Value: ['=Fields!v.Value'] } }] } }] }] } });
    expect(find(r.definition, 'G')).toMatchObject({ chartType: 'gauge', gaugeShape: 'threeQuarter', gaugeIndicator: 'pointer' });
    expect(r.warnings.join()).not.toMatch(/half circle/);
  });
});
