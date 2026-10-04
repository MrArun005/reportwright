// BIRT importer (.rptdesign): tables, groups, aggregates, grids, labels, data, text, parameters, data sets, the safe
// reader, and a corpus of the BIRT sample reports.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { importBirt } from '../../src/importers/birt.js';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';

const CORPUS = path.join(import.meta.dirname, '..', 'fixtures', 'birt', 'corpus');
const P = (n, v) => `<property name="${n}">${v}</property>`;
const X = (n, v) => `<expression name="${n}">${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</expression>`;
const col = (n, t) => `<structure>${P('position', 1)}${P('name', n)}${P('dataType', t)}</structure>`;
const bound = (n, expr, extra = '') => `<structure>${P('name', n)}${X('expression', expr)}${extra}</structure>`;
const cell = (inner, extra = '') => `<cell>${extra}${inner}</cell>`;
const data = (c) => `<data>${P('resultSetColumn', c)}</data>`;
const label = (t) => `<label><text-property name="text">${t}</text-property></label>`;
const DESIGN = `<?xml version="1.0" encoding="UTF-8"?>
<report xmlns="http://www.eclipse.org/birt/2005/design" version="3.2.23" id="1">
  ${P('units', 'in')}
  <parameters><scalar-parameter name="MinAmount" id="2">${P('dataType', 'float')}<text-property name="promptText">Smallest amount</text-property>
    <simple-property-list name="defaultValue"><value type="constant">0</value></simple-property-list></scalar-parameter>
    <scalar-parameter name="Region" id="3">${P('dataType', 'string')}${P('isRequired', 'false')}
    <list-property name="selectionList"><structure>${P('value', 'North')}${P('label', 'The north')}</structure><structure>${P('value', 'South')}</structure></list-property></scalar-parameter></parameters>
  <data-sources><oda-data-source extensionID="org.eclipse.birt.report.data.oda.jdbc" name="Sales DB" id="4">${P('odaURL', 'jdbc:x')}</oda-data-source></data-sources>
  <data-sets><oda-data-set extensionID="org.eclipse.birt.report.data.oda.jdbc.JdbcSelectDataSet" name="Sales" id="5">
    <list-property name="resultSet">${col('REGION', 'string')}${col('CITY', 'string')}${col('AMOUNT', 'float')}</list-property>
    <list-property name="computedColumns"><structure>${P('name', 'DOUBLE')}${X('expression', 'row["AMOUNT"] * 2')}${P('dataType', 'float')}</structure></list-property>
    ${P('dataSource', 'Sales DB')}
    <list-property name="parameters"><structure>${P('name', 'param_1')}${P('paramName', 'MinAmount')}${P('position', 1)}${P('isInput', 'true')}</structure></list-property>
    <xml-property name="queryText"><![CDATA[select REGION, CITY, AMOUNT from SALES where AMOUNT > ? and CITY <> '?']]></xml-property>
  </oda-data-set></data-sets>
  <styles><style name="report" id="6">${P('fontFamily', 'sans-serif')}${P('fontSize', '9pt')}</style>
    <style name="table-header" id="7">${P('fontWeight', 'bold')}${P('backgroundColor', '#333333')}${P('color', '#FFFFFF')}</style></styles>
  <page-setup><simple-master-page name="Simple MasterPage" id="8">${P('type', 'a4')}${P('topMargin', '0.5in')}${P('leftMargin', '0.5in')}${P('bottomMargin', '0.5in')}${P('rightMargin', '0.5in')}
    <page-footer><text id="9">${P('contentType', 'html')}<text-property name="content"><![CDATA[Page <value-of>pageNumber</value-of>]]></text-property></text><auto-text id="10">${P('type', 'page-number-of-total-page')}</auto-text></page-footer>
  </simple-master-page></page-setup>
  <body>
    <grid id="11">${P('width', '100%')}<column id="12">${P('width', '3in')}</column><column id="13"/>
      <row id="14"><cell id="15"><label id="16">${P('fontSize', '16pt')}${P('fontWeight', 'bold')}<text-property name="text">Sales report</text-property></label></cell>
        <cell id="17"><text id="18">${P('contentType', 'html')}<text-property name="content"><![CDATA[<b>Region:</b> <value-of>params["Region"].value == null ? "all" : params["Region"].value</value-of>]]></text-property></text></cell></row>
    </grid>
    <table id="20">${P('width', '100%')}${P('dataSet', 'Sales')}
      <list-property name="boundDataColumns">
        ${bound('REGION', 'dataSetRow["REGION"]')}${bound('CITY', 'dataSetRow["CITY"]')}${bound('AMOUNT', 'dataSetRow["AMOUNT"]')}${bound('DOUBLE', 'dataSetRow["DOUBLE"]')}
        <structure>${P('name', 'RegionTotal')}${P('dataType', 'float')}${P('aggregateFunction', 'SUM')}<simple-property-list name="aggregateOn"><value>RegionGroup</value></simple-property-list><list-property name="arguments"><structure>${P('name', 'Expression')}${X('value', 'row["AMOUNT"]')}</structure></list-property></structure>
        ${bound('Grand', '"Total: " + Total.sum(row["AMOUNT"])')}
        ${bound('CityLabel', 'BirtStr.toUpper(row["CITY"]) + " (" + row["REGION"].length + ")"')}
      </list-property>
      <column id="21"/><column id="22"/><column id="23"/>
      <header><row id="24">${cell(label('City'))}${cell(label('Amount'))}${cell(label('Double'))}</row></header>
      <group id="25">${P('groupName', 'RegionGroup')}${X('keyExpr', 'row["REGION"]')}${P('sortDirection', 'asc')}
        <header><row id="26">${cell(data('REGION'), P('colSpan', 3))}</row></header>
        <footer><row id="27">${cell(label('Subtotal'))}${cell(`<data>${P('resultSetColumn', 'RegionTotal')}<structure name="numberFormat">${P('category', 'Custom')}${P('pattern', '#,##0.00')}</structure></data>`)}${cell('')}</row></footer>
      </group>
      <detail><row id="28">${cell(data('CityLabel'))}${cell(`<data>${P('resultSetColumn', 'AMOUNT')}<list-property name="highlightRules"><structure>${P('operator', 'gt')}${P('color', '#FF0000')}${X('testExpr', 'row["AMOUNT"]')}${X('value1', '15')}</structure></list-property></data>`)}${cell(data('DOUBLE'))}</row></detail>
      <footer><row id="29">${cell(data('Grand'), P('colSpan', 3))}</row></footer>
    </table>
  </body>
</report>`;
const rows = [{ REGION: 'North', CITY: 'Pune', AMOUNT: 10 }, { REGION: 'North', CITY: 'Nashik', AMOUNT: 20 }, { REGION: 'South', CITY: 'Salem', AMOUNT: 5 }];
const walk = (items, out = []) => { for (const it of items || []) { out.push(it); walk(it.items, out); } return out; };

describe('a BIRT design', () => {
  it('converts tables, groups, aggregates, grids, text, parameters and data sets', async () => {
    const r = importBirt(DESIGN, { name: 'Sales' });
    expect(r.error).toBeUndefined();
    expect(validate(r.definition).errors).toEqual([]);
    const d = r.definition;
    expect(d.page).toMatchObject({ size: 'A4', margins: [36, 36, 36, 36] });
    expect(d.parameters).toEqual([
      expect.objectContaining({ name: 'MinAmount', type: 'number', prompt: 'Smallest amount', default: 0 }),
      expect.objectContaining({ name: 'Region', options: [{ value: 'North', label: 'The north' }, { value: 'South', label: 'South' }] }),
    ]);
    expect(d.dataSources[0]).toMatchObject({ type: 'sql', query: "select REGION, CITY, AMOUNT from SALES where AMOUNT > @MinAmount and CITY <> '?'" });
    expect(d.dataSets[0].fields).toEqual(expect.arrayContaining([{ name: 'DOUBLE', expr: '=Fields.AMOUNT * 2' }]));
    const t = walk(d.sections.body.items).find(i => i.type === 'table');
    expect(t.groups[0]).toMatchObject({ name: 'RegionGroup', expr: '=Fields.REGION', sort: 'asc' });
    expect(t.groups[0].footer[0].cells[1]).toMatchObject({ value: '=Sum(Fields.AMOUNT, "RegionGroup")', style: { format: '#,##0.00' } });
    expect(t.detail[0].cells[1].style.color).toMatch(/IIF\(\(?Fields\.AMOUNT\)? > \(?15\)?, "#ff0000"/i);
    const out = await render(d, { fontStore, sources: { 'Sales DB': rows }, parameters: { MinAmount: 0, Region: null } });
    const all = out.pages.flatMap(texts);
    expect(all).toEqual(expect.arrayContaining(['Sales report', 'Region: all', 'City', 'North', 'PUNE (5)', '10', '20', 'Subtotal', '30.00', 'South', '5.00', 'Total: 35', 'Page 1', '1 of 1']));
    expect(r.warnings.join('\n')).toMatch(/PW_DB_SALES_DB/);
  });
  it('refuses DTDs (XXE), other XML and cut-off files with a message', () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE report [<!ENTITY x SYSTEM "file:///etc/passwd">]><report xmlns="http://www.eclipse.org/birt/2005/design"><body><label><text-property name="text">&x;</text-property></label></body></report>';
    expect(importBirt(xxe).error).toMatch(/DOCTYPE/);
    expect(importBirt('<jasperReport/>').error).toMatch(/not a BIRT report design/);
    expect(importBirt(DESIGN.slice(0, 600)).error).toMatch(/not readable XML/);
  });
  it('bound columns that use each other do not explode', () => {
    const b = Array.from({ length: 30 }, (_, i) => bound(`c${i}`, i ? `row["c${i - 1}"] + row["c${i - 1}"]` : 'dataSetRow["A"]')).join('');
    const src = `<report xmlns="http://www.eclipse.org/birt/2005/design"><body><table>${P('dataSet', 'x')}<list-property name="boundDataColumns">${b}</list-property><column/><detail><row>${cell(data('c29'))}</row></detail></table></body></report>`;
    const t0 = Date.now();
    const r = importBirt(src);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.error).toBeUndefined();
    expect(r.warnings.join('\n')).toMatch(/more than 12 deep|too long/);
  });
});

describe('corpus: BIRT sample reports', () => {
  const files = fs.readdirSync(CORPUS).filter(f => f.endsWith('.rptdesign'));
  const readme = fs.readFileSync(path.join(CORPUS, 'README.md'), 'utf8');
  it('has 20 to 40 designs, each listed with its source', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files.length).toBeLessThanOrEqual(40);
    for (const f of files) expect(readme).toContain(f);
  });
  const totals = { items: 0, mapped: 0, approximated: 0, dropped: 0 };
  const kinds = new Map();
  const sample = (def) => {
    const v = (f, i) => (f.type === 'number' ? (i + 1) * 10 : f.type === 'date' ? `2024-0${i + 1}-15` : f.type === 'boolean' ? i % 2 === 0 : `${f.name} ${i % 3 + 1}`);
    return Object.fromEntries(def.dataSets.map(ds => [ds.source, Array.from({ length: 4 }, (_, i) => Object.fromEntries((ds.fields || []).filter(f => !f.expr).map(f => [f.name, v(f, i)])))]));
  };
  const params = (def) => Object.fromEntries(def.parameters.filter(p => p.default == null).map(p => [p.name, p.options?.[0]?.value ?? (p.type === 'number' ? 1 : p.type === 'date' ? '2024-01-15' : p.type === 'boolean' ? true : 'x')]));
  for (const f of files) {
    it(`imports, validates and renders ${f}`, async () => {
      const r = importBirt(fs.readFileSync(path.join(CORPUS, f), 'utf8'), { name: f });
      expect(r.error).toBeUndefined();
      expect(validate(r.definition).errors).toEqual([]);
      const out = await render(r.definition, { fontStore, sources: sample(r.definition), parameters: params(r.definition) });
      expect(out.pages.length).toBeGreaterThanOrEqual(1);
      for (const k of Object.keys(totals)) totals[k] += r.stats[k];
      for (const w of r.warnings) {
        const k = w.replace(/^[^:]{1,60}: /, '').replace(/"[^"]*"/g, '"…"').replace(/\b(PW_DB_)[\w.]*/g, '$1…').replace(/the expression .*/, 'the expression … is shown as text.').replace(/=[^;,]*/g, '=…').slice(0, 100);
        kinds.set(k, (kinds.get(k) || 0) + 1);
      }
    });
  }
  it('keeps at least 95% of the items', () => {
    const rate = (totals.mapped + totals.approximated) / totals.items;
    const top = [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `  ${String(n).padStart(3)}  ${k}`).join('\n');
    console.log(`BIRT corpus: ${files.length} designs, ${totals.items} items: ${totals.mapped} mapped, ${totals.approximated} approximated, ${totals.dropped} dropped (${(rate * 100).toFixed(1)}% kept)\nTop notes:\n${top}`);
    expect(totals.items).toBeGreaterThan(400);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });
});
