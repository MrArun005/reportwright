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
