// Crosstabs (JasperReports, BIRT) become ReportWright matrices; SSRS maps become map items. Fixtures hand-written
// from the formats' schemas: tests/fixtures/{jrxml,birt,rdl}.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { importJrxml } from '../../src/importers/jrxml.js';
import { importBirt } from '../../src/importers/birt.js';
import { importRdl } from '../../src/importers/rdl.js';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';

const FX = path.join(import.meta.dirname, '..', 'fixtures');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const all = (def) => { const out = []; const walk = (its) => { for (const i of its || []) { out.push(i); walk(i.items); } }; for (const s of Object.values(def.sections)) for (const x of Array.isArray(s) ? s : [s]) walk(x?.items); return out; };
const rows = [{ region: 'North', year: 2023, amount: 10 }, { region: 'North', year: 2024, amount: 20 }, { region: 'South', year: 2024, amount: 5 }];
const sourcesFor = (def, data) => Object.fromEntries(def.dataSets.map(ds => [ds.source, data]));

describe('JasperReports crosstab → matrix', () => {
  const r = importJrxml(read('jrxml/crosstab-sales.jrxml'), { name: 'Crosstab' });
  const m = all(r.definition).find(i => i.type === 'matrix');
  it('maps groups, totals, the measure, formats and styles', () => {
    expect(r.error).toBeUndefined();
    expect(validate(r.definition).errors).toEqual([]);
    expect(m).toMatchObject({
      dataSet: 'Main', corner: 'Region',
      rowGroups: [{ name: 'Region', expr: '=Fields.region', sort: 'asc', total: 'after', totalLabel: 'Grand total', width: 80 }],
      columnGroups: [{ name: 'Year', expr: '=Fields.year', total: 'after', totalLabel: 'All years' }],
      values: [{ value: '=Sum(Fields.amount)', format: 'java:#,##0.00' }],
      columnWidth: 60, headerStyle: { color: '#ffffff', backgroundColor: '#336699' }, totalStyle: { fontWeight: 'bold', backgroundColor: '#e0e0e0' },
    });
  });
  it('notes what it leaves out, never silently', () => {
    expect(r.warnings.join('\n')).toMatch(/1 shapes or other elements in its cells are not shown/);
    expect(r.stats).toMatchObject({ dropped: 0, approximated: 1 });
  });
  it('renders', async () => {
    const out = await render(r.definition, { fontStore, sources: sourcesFor(r.definition, rows) });
    expect(out.pages.length).toBeGreaterThan(0);
    const t = out.pages.flatMap(texts);
    expect(t).toEqual(expect.arrayContaining(['North', 'South', '2023', '2024', 'Grand total', 'All years', '30.00', '35.00']));
  });
});

describe('BIRT crosstab → matrix', () => {
  const r = importBirt(read('birt/crosstab-sales.rptdesign'), { name: 'Crosstab' });
  const m = all(r.definition).find(i => i.type === 'matrix');
  it('maps the cube levels, date levels, measure, totals and formats', () => {
    expect(r.error).toBeUndefined();
    expect(validate(r.definition).errors).toEqual([]);
    expect(m).toMatchObject({
      dataSet: 'Sales',
      rowGroups: [{ expr: '=Fields.region', total: 'after', totalLabel: 'Grand Total' }],
      columnGroups: [{ expr: '=Year(Fields.sold)', total: 'after', totalLabel: 'All years' }],
      values: [{ value: '=Sum(Fields.amount)', format: 'icu:#,##0.00' }],
      headerStyle: { fontWeight: 'bold', backgroundColor: '#336699' },
    });
    expect(r.stats.dropped).toBe(0);
  });
  it('renders', async () => {
    const data = rows.map(x => ({ region: x.region, sold: `${x.year}-03-01`, amount: x.amount }));
    const out = await render(r.definition, { fontStore, sources: sourcesFor(r.definition, data) });
    expect(out.pages.length).toBeGreaterThan(0);
    const t = out.pages.flatMap(texts);
    expect(t).toEqual(expect.arrayContaining(['North', 'South', '2023', '2024', 'Grand Total', '35.00']));
  });
});

describe('SSRS map → map item', () => {
  const r = importRdl(read('rdl/map-sales.rdl'), { name: 'Map' });
  const m = all(r.definition).find(i => i.type === 'map');
  it('maps embedded shapes, the colour rule, legend, classes, lines and the drill-through', () => {
    expect(r.error).toBeUndefined();
    expect(validate(r.definition).errors).toEqual([]);
    expect(m).toMatchObject({ name: 'SalesMap', shapeKey: '=Fields.STATENAME', valueDataSet: 'StateSales', valueKey: '=Fields.State', value: '=Sum(Fields.Amount)',
      colorLow: '#e0f0e0', colorHigh: '#006400', valueFormat: 'N0', legend: 'bottom', colorScale: 'classes', classes: 5, lineColor: '#996633', lineWidth: 2,
      regionAction: { type: 'report', report: 'state-detail' } });
    const gj = JSON.parse(m.geojson);
    expect(gj.features.map(f => f.properties.STATENAME)).toEqual(['Westland', 'Eastland']);
    expect(gj.features[1].geometry).toEqual({ type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] });
  });
  it('asks for GeoJSON where the spatial source cannot be converted', () => {
    expect(r.warnings.join('\n')).toMatch(/SalesMap: the layer "Roads" reads the ESRI shapefile roads\.shp.*GeoJSON/);
    expect(r.stats).toMatchObject({ items: 2, dropped: 0, approximated: 1 });
  });
  it('renders', async () => {
    const out = await render(r.definition, { fontStore, sources: sourcesFor(r.definition, [{ State: 'Westland', Amount: 100 }, { State: 'Eastland', Amount: 2500 }]) });
    expect(out.pages.length).toBeGreaterThan(0);
    const t = out.pages.flatMap(texts).join(' ');
    expect(t).toMatch(/Sales by state/);
    expect(t).toMatch(/2,500|100/); // the legend
  });
});
