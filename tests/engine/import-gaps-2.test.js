// Importer gaps, round 2: Jasper markup and rotation, BIRT charts, shapefiles, SQL spatial data, SSRS custom code.
// Fixtures hand-written from the formats' specs: tests/fixtures/{jrxml,birt,rdl}. Every parser here reads untrusted
// input: the hostile tests check the caps on what is read AND on what is emitted, and that each cap is noted.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { importJrxml } from '../../src/importers/jrxml.js';
import { importBirt } from '../../src/importers/birt.js';
import { jasperMarkup, rtfMarkup, MARKUP_LIMITS } from '../../src/importers/markup.js';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';
import os from 'node:os';
import { importRdl, customCode } from '../../src/importers/rdl.js';
import { importFolder } from '../../src/cli/importBatch.js';
import { readShapefile, readDbf } from '../../src/engine/geo.js';
import { shp, dbf, statesShp, statesDbf } from '../helpers-shapefile.js';

const FX = path.join(import.meta.dirname, '..', 'fixtures');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const all = (def) => { const out = []; const walk = (its) => { for (const i of its || []) { out.push(i); walk(i.items); } }; for (const s of Object.values(def.sections)) for (const x of Array.isArray(s) ? s : [s]) walk(x?.items); return out; };
const sourcesFor = (def, data) => Object.fromEntries(def.dataSets.map(ds => [ds.source, data]));
const words = (out) => out.pages.flatMap(texts).join(' ');

describe('JasperReports markup → rich text, rotation → rotate', () => {
  const r = importJrxml(read('jrxml/markup-rotation.jrxml'), { name: 'Markup' });
  const its = all(r.definition);
  it('maps html, styled and rtf markup to rich text', () => {
    expect(r.error).toBeUndefined();
    expect(validate(r.definition).errors).toEqual([]);
    const rich = its.filter(i => i.type === 'richtext').map(i => i.value);
    expect(rich[0]).toContain('<span style="font-weight:bold">bold</span>');
    expect(rich[0]).toContain('color:#ff0000');
    expect(rich[0]).toContain('<sup>2</sup>');
    expect(rich[1]).toBe('<span style="color:#0000ff;font-style:italic">Styled blue</span> plain');
    expect(rich[2]).toBe('Rtf <span style="font-weight:bold">strong</span> text');
    expect(rich[3]).toBe('<span style="font-style:italic">Literal</span> html');
    expect(r.warnings.join('\n')).toMatch(/marquee, which ReportWright leaves out/);
  });
  it('maps rotation Left / Right / UpsideDown to clockwise degrees', () => {
    const rot = Object.fromEntries(its.filter(i => i.rotate).map(i => [i.value, i.rotate]));
    expect(rot).toEqual({ Upwards: 270, Downwards: 90, Flipped: 180 });
    expect(r.warnings.join('\n')).not.toMatch(/rotated/);
  });
  it('html from the data is read as html; styled markup built by an expression is noted', () => {
    expect(its.find(i => i.type === 'richtext' && i.htmlFromData)).toBeTruthy();
    expect(r.warnings.join('\n')).toMatch(/styled markup built by an expression/);
  });
  it('renders the text', async () => {
    const out = await render(r.definition, { fontStore, sources: sourcesFor(r.definition, [{ name: 'Ann', note: 'a <b>note</b>' }]) });
    const t = words(out);
    for (const w of ['bold', 'red', 'moving', 'Styled blue', 'strong', 'Literal', 'Upwards', 'Flipped', 'note', 'Ann!']) expect(t).toContain(w);
  });
  it('hostile markup: input, nesting, tags and output are capped, linear, and noted', () => {
    const t0 = performance.now();
    expect(jasperMarkup('<b>'.repeat(100), 'html').cut).toMatch(/nested more than 32/);
    expect(jasperMarkup('<q/>'.repeat(24_000), 'html').cut).toMatch(/more than 20,000 tags/);
    expect(jasperMarkup('x'.repeat(MARKUP_LIMITS.maxInput + 5), 'styled').cut).toMatch(/characters/);
    const big = jasperMarkup('<u>x</u>'.repeat(9000), 'html');
    expect(big.html.length).toBeLessThanOrEqual(MARKUP_LIMITS.maxOutput);
    expect(big.cut).toMatch(/of output/);
    expect(jasperMarkup('<'.repeat(MARKUP_LIMITS.maxInput), 'html').html).toMatch(/^(&lt;)+$/);
    expect(jasperMarkup('<a b="'.repeat(16_000), 'html').cut).toBe('');
    expect(rtfMarkup('{'.repeat(1000)).cut).toMatch(/nested/);
    expect(rtfMarkup('{\\fonttbl ' + '}'.repeat(5000) + 'ok').html).toBe('ok');
    expect(rtfMarkup('\\b x\\b0 '.repeat(20_000)).cut).toMatch(/output/);
    expect(performance.now() - t0).toBeLessThan(3000);
    const r2 = importJrxml(read('jrxml/markup-rotation.jrxml').replace('Hello', '<b>'.repeat(50) + 'Hello'), { name: 'X' });
    expect(r2.warnings.join('\n')).toMatch(/nested more than 32 deep; the rest is left out/);
  });
});

describe('BIRT charts → ReportWright charts', () => {
  const r = importBirt(read('birt/charts.rptdesign'), { name: 'Charts' });
  const charts = all(r.definition).filter(i => i.type === 'chart');
  it('maps type, series, category, series grouping, titles, legend and axes', () => {
    expect(r.error).toBeUndefined();
    expect(validate(r.definition).errors).toEqual([]);
    expect(charts[0]).toMatchObject({ name: 'SalesBar', chartType: 'column', stacked: true, dataSet: 'Sales', title: 'Sales by region', legend: 'bottom',
      category: '=Fields.REGION', seriesGroup: '=Fields.YEAR', series: [{ name: 'Amount', value: '=Sum(Fields.AMOUNT)' }], axes: { x: { title: 'Region' }, y: { title: 'Amount' } } });
    expect(charts[1]).toMatchObject({ name: 'SharePie', chartType: 'pie', category: '=Fields.REGION', series: [{ name: 'Count', value: '=Count(Fields.AMOUNT)' }] });
  });
  it('notes an unsupported chart type and drops nothing silently', () => {
    expect(charts.length).toBe(2);
    expect(r.warnings.join('\n')).toMatch(/Gantt Chart chart has no ReportWright equivalent/);
  });
  it('renders the charts', async () => {
    const data = [{ REGION: 'North', YEAR: 2023, AMOUNT: 10 }, { REGION: 'South', YEAR: 2024, AMOUNT: 5 }];
    const out = await render(r.definition, { fontStore, sources: sourcesFor(r.definition, data) });
    const t = words(out);
    for (const w of ['Sales by region', 'Share', 'North', 'South']) expect(t).toContain(w);
  });
  it('hostile: unreadable models, too many series and charts are capped and noted', () => {
    const src = read('birt/charts.rptdesign');
    const bad = importBirt(src.replace('<model:ChartWithoutAxes', '<model:ChartWithoutAxes <<'), { name: 'X' });
    expect(bad.warnings.join('\n')).toMatch(/chart model could not be read/);
    const one = /<Series xsi:type="type:BarSeries">.*?<\/Series>/s.exec(src)[0];
    const many = importBirt(src.replace(one, one.repeat(100)), { name: 'X' });
    expect(all(many.definition).find(i => i.name === 'SalesBar').series.length).toBe(32);
    expect(many.warnings.join('\n')).toMatch(/more than 32 series; 68 are left out/);
    const item = /<extended-item extensionName="Chart" name="SharePie".*?<\/extended-item>/s.exec(src)[0];
    const lots = importBirt(src.replace(item, item.repeat(510)), { name: 'X' });
    expect(all(lots.definition).filter(i => i.type === 'chart').length).toBe(500);
    expect(lots.warnings.join('\n')).toMatch(/more than 500 charts/);
  });
});

describe('SSRS shapefile maps: the .shp and .dbf next to the report → GeoJSON', () => {
  const SRC = read('rdl/shapefile/map-shapefile.rdl');
  const files = { shp: new Uint8Array(statesShp()), dbf: new Uint8Array(statesDbf()) };
  const mapOf = (r) => all(r.definition).find(i => i.type === 'map');
  it('reads polygons (with holes) and attributes when the caller resolves the shapefile', () => {
    const asked = [];
    const r = importRdl(SRC, { resolve: (kind, ref) => { asked.push([kind, ref]); return kind === 'shapefile' ? files : null; } });
    expect(asked).toEqual([['shapefile', 'C:\\maps\\states.shp']]);
    expect(validate(r.definition).errors).toEqual([]);
    const gj = JSON.parse(mapOf(r).geojson);
    expect(gj.features.map(f => f.properties.STATENAME)).toEqual(['Westland', 'Eastland']);
    expect(gj.features[1].geometry.coordinates.length).toBe(2); // the outer ring and its hole
    expect(r.warnings.join('\n')).not.toMatch(/shapefile/);
  });
  it('keeps the note when the shapefile is not provided', () => {
    expect(importRdl(SRC).warnings.join('\n')).toMatch(/reads the ESRI shapefile C:\\maps\\states.shp, which is not in the import/);
  });
  it('renders the shapes coloured by the joined data', async () => {
    const r = importRdl(SRC, { resolve: () => files });
    const out = await render(r.definition, { fontStore, sources: sourcesFor(r.definition, [{ State: 'Westland', Amount: 5 }, { State: 'Eastland', Amount: 9 }]) });
    expect(out.warnings.filter(w => /shape|GeoJSON|coordinates/.test(w))).toEqual([]);
    expect(out.pages[0].items.some(i => i.t === 'path' || i.t === 'poly' || i.d)).toBe(true);
    expect(words(out)).toContain('Sales by state');
  });
  it('pw import <folder> picks up the .shp and .dbf beside the report', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-shp-'));
    try {
      const IN = path.join(tmp, 'in'); fs.mkdirSync(IN);
      fs.writeFileSync(path.join(IN, 'map.rdl'), SRC);
      fs.writeFileSync(path.join(IN, 'states.shp'), statesShp()); fs.writeFileSync(path.join(IN, 'states.dbf'), statesDbf());
      const res = await importFolder(IN, path.join(tmp, 'out'), { log: () => {} });
      const rec = res.files.find(f => f.source === 'map.rdl');
      expect(rec.references).toContainEqual({ kind: 'shapefile', ref: 'C:\\maps\\states.shp', resolved: 'states.shp' });
      const def = JSON.parse(fs.readFileSync(path.join(tmp, 'out', rec.output), 'utf8'));
      expect(JSON.parse(all(def).find(i => i.type === 'map').geojson).features.length).toBe(2);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
  it('hostile shapefiles: lying counts, overlapping parts, huge record lengths, projected data, caps on emitted output', () => {
    const t0 = performance.now();
    const caps = { maxShapes: 20_000, maxPoints: 200_000 };
    const good = statesShp();
    // a point count far past the record: refused before anything is allocated
    const lying = Buffer.from(good); lying.writeInt32LE(0x7fffffff, 100 + 8 + 40);
    expect(readShapefile(new Uint8Array(lying), null, caps)).toMatchObject({ bad: 1, features: [expect.anything()] });
    // parts that go back (re-emitting points) are refused
    const back = shp([{ type: 5, parts: [[[0, 0], [0, 1], [1, 1], [0, 0]], [[0, 0], [0, 1], [1, 1], [0, 0]]] }]);
    back.writeInt32LE(0, 100 + 8 + 48);
    expect(readShapefile(new Uint8Array(back), null, caps).bad).toBe(1);
    // a record length past the file: stops there
    const long = Buffer.from(good); long.writeInt32BE(0x3fffffff, 104);
    expect(readShapefile(new Uint8Array(long), null, caps)).toMatchObject({ bad: 1, features: [] });
    // not a shapefile
    expect(readShapefile(new Uint8Array(200), null, caps).error).toMatch(/not a shapefile/);
    // projected metres
    expect(readShapefile(new Uint8Array(shp([{ type: 5, parts: [[[500000, 0], [500000, 10], [500010, 10], [500000, 0]]] }])), null, caps).notLonLat).toBe(true);
    // emitted caps: 30,000 small shapes → 20,000 kept, the rest noted
    const many = shp(Array.from({ length: 30_000 }, () => ({ type: 3, parts: [[[0, 0], [1, 1]]] })));
    const r = importRdl(SRC, { resolve: () => ({ shp: new Uint8Array(many) }) });
    expect(JSON.parse(mapOf(r).geojson).features.length).toBe(20_000);
    expect(r.warnings.join('\n')).toMatch(/more than 20,000 shapes/);
    expect(r.warnings.join('\n')).toMatch(/has no \.dbf next to it/);
    // the points cap counts what is emitted: one 250,000-point line is refused whole
    const big = shp([{ type: 3, parts: [Array.from({ length: 250_000 }, (_, i) => [i % 180, 0])] }]);
    expect(readShapefile(new Uint8Array(big), null, caps)).toMatchObject({ over: true, features: [] });
    // dBASE: fields longer than the record, too many fields, a record count past the file
    const d = Buffer.from(statesDbf()); d.writeUInt16LE(3, 10);
    expect(readDbf(new Uint8Array(d)).error).toMatch(/longer than its records/);
    expect(readDbf(new Uint8Array(dbf(Array.from({ length: 200 }, (_, i) => ({ name: `F${i}`, type: 'C', size: 1 })), []))).error).toMatch(/more than 128 fields/);
    const d2 = Buffer.from(statesDbf()); d2.writeUInt32LE(0xffffffff, 4);
    expect(readDbf(new Uint8Array(d2)).rows.length).toBe(2);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe('SSRS SQL spatial maps: the spatial field is decoded at render time', () => {
  const r = importRdl(read('rdl/map-spatial.rdl'));
  const map = all(r.definition).find(i => i.type === 'map');
  const wktW = 'POLYGON ((0 0, 0 10, 10 10, 10 0, 0 0))';
  // the same square as SQL Server's geography binary (version 1, one polygon figure, lat/long pairs)
  const geoBin = (pts) => {
    const b = Buffer.alloc(6 + 4 + pts.length * 16 + 4 + 5 + 4 + 9); let o = 0;
    b.writeInt32LE(4326, o); o += 4; b[o++] = 1; b[o++] = 4; b.writeUInt32LE(pts.length, o); o += 4;
    for (const [lon, lat] of pts) { b.writeDoubleLE(lat, o); b.writeDoubleLE(lon, o + 8); o += 16; }
    b.writeUInt32LE(1, o); o += 4; b[o] = 2; b.writeInt32LE(0, o + 1); o += 5;
    b.writeUInt32LE(1, o); o += 4; b.writeInt32LE(-1, o); b.writeInt32LE(0, o + 4); b[o + 8] = 3;
    return b;
  };
  const east = [[10, 0], [10, 10], [20, 10], [20, 0], [10, 0]];
  const sources = (shapes) => ({ [r.definition.dataSets.find(d => d.name === 'StateSales').source]: [{ State: 'Westland', Amount: 5 }, { State: 'Eastland', Amount: 9 }], ...Object.fromEntries(r.definition.dataSets.filter(d => d.name === 'StateShapes').map(d => [d.source, shapes])) });
  const shapesDrawn = (out) => out.pages[0].items.filter(i => i.t === 'path').length;
  it('imports the layer with its data set and no "supply GeoJSON" note', () => {
    expect(validate(r.definition).errors).toEqual([]);
    expect(map).toMatchObject({ dataSet: 'StateShapes', geometry: '=Fields.Geo' });
    expect(r.warnings.join('\n')).not.toMatch(/supply GeoJSON|return the shape as GeoJSON/);
  });
  it('draws WKT, the geography binary (bytes, a JSON Buffer, 0x hex, base64) and GeoJSON text', async () => {
    const bin = geoBin(east);
    for (const geo of [bin, { type: 'Buffer', data: [...bin] }, '0x' + bin.toString('hex'), bin.toString('base64'), JSON.stringify({ type: 'Polygon', coordinates: [east] })]) {
      const out = await render(r.definition, { fontStore, sources: sources([{ STATENAME: 'Westland', Geo: wktW }, { STATENAME: 'Eastland', Geo: geo }]) });
      expect(out.warnings.filter(w => /shape|coordinates/.test(w))).toEqual([]);
      expect(shapesDrawn(out)).toBeGreaterThanOrEqual(2);
      expect(words(out)).toContain('Sales by state');
    }
  });
  it('hostile spatial values: capped on emitted coordinates, nesting and size; unreadable ones are named', async () => {
    const t0 = performance.now();
    const huge = 'LINESTRING (' + Array.from({ length: 210_000 }, (_, i) => `${i % 180} 1`).join(', ') + ')';
    let out = await render(r.definition, { fontStore, sources: sources([{ STATENAME: 'Westland', Geo: wktW }, { STATENAME: 'Big', Geo: huge }]) });
    expect(out.warnings.join('\n')).toMatch(/more than 200,000 coordinates; the shape "Big"/);
    const bad = ['POLYGON ' + '('.repeat(5000) + '0 0' + ')'.repeat(5000), 'POLYGON ((0 0, 1 1 1 1 1, 2 2))', 'GEOMETRYCOLLECTION (POINT (1 2))', '0x00', 'POLYGON ((' + '1'.repeat(5e6) + '))'];
    out = await render(r.definition, { fontStore, sources: sources(bad.map((Geo, i) => ({ STATENAME: `B${i}`, Geo }))) });
    expect(out.warnings.filter(w => /has no Polygon/.test(w)).length).toBe(bad.length);
    // a binary that claims more points than it holds, and one over the cap
    const lying = geoBin(east); lying.writeUInt32LE(0x7fffffff, 6);
    const many = geoBin(Array.from({ length: 210_000 }, (_, i) => [i % 180, 1]));
    out = await render(r.definition, { fontStore, sources: sources([{ STATENAME: 'L', Geo: lying }, { STATENAME: 'M', Geo: many }]) });
    expect(out.warnings.join('\n')).toMatch(/shape "L" has no Polygon/);
    expect(out.warnings.join('\n')).toMatch(/more than 200,000 coordinates; the shape "M"/);
    expect(performance.now() - t0).toBeLessThan(8000);
  });
});

describe('SSRS custom code → report functions', () => {
  const r = importRdl(read('rdl/custom-code.rdl'));
  it('converts single-Return functions; calls become Code.F(…)', () => {
    expect(validate(r.definition).errors).toEqual([]);
    expect(r.definition.functions).toEqual([
      { name: 'Grade', params: ['score'], body: '=IIF(score >= 90, "A", IIF(score >= 75, "B", "C"))' },
    ]);
    expect(JSON.stringify(r.definition.sections)).toMatch(/Code\.Grade\(Fields\.Score\)/);
    expect(r.definition.customCode).toMatch(/Function Total/);
  });
  it('notes what it does not convert (a loop; a function calling an unqualified one)', () => {
    const W = r.warnings.join('\n');
    expect(W).toMatch(/1 of its 3 functions became report functions \(Grade\); 2 are not converted \(Label, Total\)/);
    expect(W).toMatch(/Code\.Total/);
  });
  it('renders the converted function', async () => {
    const out = await render(r.definition, { fontStore, sources: sourcesFor(r.definition, [{ Name: 'Ann', Score: 92 }, { Name: 'Bo', Score: 80 }, { Name: 'Cy', Score: 10 }]) });
    const t = words(out);
    for (const w of ['Ann A', 'Bo B', 'Cy C']) expect(t).toContain(w);
  });
  it('hostile code: size, function count, long lines, long expressions are bounded and noted', () => {
    const t0 = performance.now();
    expect(customCode('x'.repeat(100_001)).note).toMatch(/longer than 100,000 characters, so none of it is converted/);
    const many = Array.from({ length: 3000 }, (_, i) => `Function F${i}(a)\nReturn a + ${i}\nEnd Function`).join('\n').slice(0, 99_000);
    const c = customCode(many);
    expect(c.functions.length).toBe(200);
    expect(c.note).toMatch(/are not converted/);
    expect(customCode('Public '.repeat(14_000) + 'X').functions).toEqual([]);
    expect(customCode(`Function A(x)\nReturn ${'('.repeat(30_000)}x${')'.repeat(30_000)}\nEnd Function`).functions).toEqual([]);
    expect(customCode('Function A(x)\n' + 'Return x\n'.repeat(10_000) + 'End Function').functions).toEqual([]);
    expect(customCode(`Function A(Optional x = 1)\nReturn x\nEnd Function`).note).toMatch(/not converted \(A\)/);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('BIRT event scripts that only set a style → style expressions', () => {
  const r = importBirt(read('birt/scripts.rptdesign'), { name: 'Scripts' });
  const json = JSON.stringify(r.definition.sections);
  it('maps if/else colour and a literal weight; other scripts keep the note', () => {
    expect(r.error).toBeUndefined();
    expect(validate(r.definition).errors).toEqual([]);
    expect(json).toContain('IIF(Fields.AMOUNT > 100, \\"#ff0000\\", \\"#333333\\")');
    expect(json).toMatch(/"fontWeight":"bold"/);
    expect(r.warnings.join('\n')).toMatch(/The report has 1 event script /);
  });
  it('renders', async () => {
    const out = await render(r.definition, { fontStore, sources: sourcesFor(r.definition, [{ REGION: 'North', AMOUNT: 150 }, { REGION: 'South', AMOUNT: 5 }]) });
    const t = out.pages.flatMap(p => p.items).filter(i => i.t === 'text');
    const color = (s) => t.find(i => i.lines?.some(l => l.text.includes(s)))?.color;
    expect(color('150.00')).toMatch(/^#?(ff0000|red)$/i);
    expect(color('5.00')).toMatch(/333333/);
  });
  it('hostile scripts: long, many statements, backtracking bait — refused fast, noted', () => {
    const src = read('birt/scripts.rptdesign');
    const t0 = performance.now();
    for (const bad of ['if (a) this.getStyle().color = "r"' + ' '.repeat(1950) + 'x', 'this.getStyle().color = "red";\n'.repeat(200), 'if (' + ') this.getStyle().color = "red"'.repeat(60), 'this.getStyle().color = "re{d}";']) {
      const r2 = importBirt(src.replace(/<method name="onCreate">[\s\S]*?<\/method>/, `<method name="onCreate"><![CDATA[${bad}]]></method>`), { name: 'X' });
      expect(r2.warnings.join('\n')).toMatch(/The report has 2 event scripts/);
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
