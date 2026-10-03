import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { pageToSvg } from '../../src/exporters/svg.js';
import { fontStore, texts, report } from '../helpers.js';

// two unit squares side by side (west and east), lon/lat degrees
const square = (name, x0) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [[[x0, 0], [x0 + 10, 0], [x0 + 10, 10], [x0, 10], [x0, 0]]] } });
const GEO = { type: 'FeatureCollection', features: [square('West', 0), square('East', 10)] };

const mapItem = (extra = {}) => ({
  type: 'map', name: 'M', x: 0, y: 0, w: 300, h: 200,
  geojson: JSON.stringify(GEO), shapeKey: '=Fields.name',
  valueDataSet: 'Rows', valueKey: '=Fields.region', value: '=Sum(Fields.amount)',
  colorLow: '#ffffff', colorHigh: '#000000', legend: 'bottom', valueFormat: 'N0',
  ...extra,
});
const data = { rows: [{ region: 'West', amount: 10 }, { region: 'West', amount: 30 }, { region: 'East', amount: 100 }] };

const paths = (page) => page.items.filter(i => i.t === 'path');

describe('map item', () => {
  it('draws one shape per feature, coloured by the joined aggregate', async () => {
    const out = await render(report([mapItem()], { data }), { fontStore });
    const shapes = paths(out.pages[0]).filter(p => p.shape);
    expect(shapes.map(p => p.shape)).toEqual(['West', 'East']);
    // West = 40 (low end of the scale), East = 100 (high end)
    expect(shapes[0].fill).toBe('#ffffff');
    expect(shapes[1].fill).toBe('#000000');
    const t = texts(out.pages[0]);
    expect(t).toContain('40');
    expect(t).toContain('100');
  });

  it('keeps the shapes inside the item and keeps their proportions', async () => {
    const out = await render(report([mapItem({ legend: 'none' })], { data }), { fontStore });
    const nums = paths(out.pages[0]).flatMap(p => p.d.match(/-?\d+(\.\d+)?/g).map(Number).map((v, i) => [v + (i % 2 === 0 ? p.x : p.y), i % 2]));
    const xs = nums.filter(([, k]) => k === 0).map(([v]) => v), ys = nums.filter(([, k]) => k === 1).map(([v]) => v);
    const top = 36; // page margin; the item sits at y 0 of the body
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(36 - 0.01);
    expect(Math.max(...xs)).toBeLessThanOrEqual(36 + 300 + 0.01);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(top - 0.01);
    expect(Math.max(...ys)).toBeLessThanOrEqual(top + 200 + 0.01);
    // the two squares together are 20° wide and ~10° tall: wider than tall
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.8 * (Math.max(...ys) - Math.min(...ys)));
  });

  it('draws point markers sized by value', async () => {
    const pts = { rows: [{ name: 'A', lat: 5, lon: 5, v: 1 }, { name: 'B', lat: 5, lon: 15, v: 4 }] };
    const item = mapItem({ valueDataSet: null, pointDataSet: 'Rows', lat: '=Fields.lat', lon: '=Fields.lon', pointSize: '=Fields.v', legend: 'none' });
    const out = await render(report([item], { data: pts }), { fontStore });
    const dots = out.pages[0].items.filter(i => i.t === 'ellipse');
    expect(dots).toHaveLength(2);
    expect(dots[1].rx).toBeCloseTo(dots[0].rx * 2, 5); // area ∝ value: 4× value → 2× radius
    expect(dots[1].cx).toBeGreaterThan(dots[0].cx);
  });

  it('reads shapes from a data set and warns about a bad geometry', async () => {
    const def = report([mapItem({ geojson: '', dataSet: 'Shapes', geometry: '=Fields.geometry', valueDataSet: null, legend: 'none' })], {
      def: {
        dataSources: [{ name: 'src', type: 'json', data: { features: [...GEO.features, { properties: { name: 'Bad' }, geometry: { type: 'Polygon', coordinates: 'nope' } }] } }],
        dataSets: [{ name: 'Shapes', source: 'src', path: '$.features', fields: [{ name: 'name', path: '$.properties.name' }, { name: 'geometry', path: '$.geometry', type: 'json' }] }],
      },
    });
    const out = await render(def, { fontStore });
    expect(paths(out.pages[0]).filter(p => p.shape)).toHaveLength(2);
    expect(out.warnings.join(' ')).toMatch(/M: .*Bad/);
  });

  it('exports to PDF and SVG', async () => {
    const out = await render(report([mapItem()], { data }), { fontStore });
    const pdf = await exportPdf(out, fontStore, {});
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(pageToSvg(out.pages[0], out.width, out.height)).toContain('<path');
  });
});
