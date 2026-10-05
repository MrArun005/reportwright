// JasperReports importer (.jrxml, JR 3–6 and the 7.x format): Java expressions, bands, variables, charts, the safe
// reader, and a corpus of the JasperReports demo samples.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { importJrxml, stripJasperDoctype } from '../../src/importers/jrxml.js';
import { javaToVb, javaPattern, Untranslatable } from '../../src/importers/java.js';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';

const CORPUS = path.join(import.meta.dirname, '..', 'fixtures', 'jrxml', 'corpus');
const kinds = { a: 'str', b: 'str', n: 'num', d: 'date' };
const env = { notes: [], field: (n) => ({ s: `Fields!${n}.Value`, t: kinds[n] || 'any', p: 9 }), param: (n) => ({ s: `Parameters!${n}.Value`, t: 'any', p: 9 }), variable: (n) => ({ s: `V_${n}`, t: 'num', p: 9 }) };
const J = (s) => javaToVb(s, env).s;

describe('Java and Groovy expressions → VB', () => {
  it('fields, parameters, concatenation and arithmetic by type', () => {
    // String.valueOf on each side: a null field prints "null" in Java (ground truth: tests/diff)
    expect(J('$F{a} + ", " + $F{b}')).toBe('JavaStr(Fields!a.Value) & ", " & JavaStr(Fields!b.Value)');
    expect(J('$F{n} + 1')).toBe('Fields!n.Value + 1');
    expect(J('1 + 2 + "x"')).toBe('JavaStr(1 + 2, "int") & "x"');
    expect(J('"Total: " + ($F{n} * 2d)')).toBe('"Total: " & JavaStr((Fields!n.Value * 2))'); // a double: "Total: 4.0"
    expect(J('$F{n} % 10 == 0')).toBe('Fields!n.Value Mod 10 = 0');
    expect(J('"a\\nb"')).toBe('"a" & vbCrLf & "b"');
    expect(J('"say \\"hi\\""')).toBe('"say ""hi"""');
  });
  it('the ternary, null tests, logic and casts', () => {
    expect(J('$F{a} == null ? "-" : $F{a}')).toBe('IIF(IsNothing(Fields!a.Value), "-", Fields!a.Value)');
    expect(J('$F{a} != null && !$F{a}.isEmpty()')).toBe('Not IsNothing(Fields!a.Value) AndAlso Not Len(Fields!a.Value) = 0');
    expect(J('(String) $P{x}')).toBe('JavaStr(Parameters!x.Value)');
    expect(J('((Integer) $F{n}).intValue()')).toBe('Fix((Fix(Fields!n.Value)))'); // Java truncates (REVIEW-ENGINE A8)
    expect(J('new Double($F{n}.doubleValue() / 2)')).toBe('CDbl(CDbl(Fields!n.Value) / 2)');
    expect(J('Boolean.TRUE')).toBe('True');
    expect(J('$F{a} ?: "none"')).toBe('IIF(IsNothing(Fields!a.Value), "none", Fields!a.Value)');
  });
  it('String, Math and Date methods, msg(), JasperReports functions', () => {
    expect(J('$F{a}.substring(0, 1).toUpperCase()')).toBe('UCase(Fields!a.Value.Substring(0, 1 - 0))');
    expect(J('$F{a}.trim().length()')).toBe('Len(Trim(Fields!a.Value))');
    expect(J('$F{a}.equalsIgnoreCase("x")')).toBe('UCase(Fields!a.Value) = UCase("x")');
    expect(J('java.lang.Math.round($F{n})')).toBe('Math.Floor(Fields!n.Value + 0.5)'); // Java: halves toward +infinity
    expect(J('String.valueOf($F{n})')).toBe('JavaStr(Fields!n.Value)');
    expect(J('new java.util.Date()')).toBe('Now');
    expect(J('msg("{0} orders, {1,number,0.00} in total", $V{c}, $F{n})')).toBe('JavaStr(V_c) & " orders, " & Format(Fields!n.Value, "java:0.00") & " in total"'); // DecimalFormat as Java formats it (expr/javafmt.js)
    expect(J('UPPER(CONCATENATE($F{a}, "-", $F{b}))')).toBe('UCase(Fields!a.Value & "-" & Fields!b.Value)');
    expect(J('IF($F{n} > 5, "big", "small")')).toBe('IIF(Fields!n.Value > 5, "big", "small")');
    expect(J('DATEFORMAT($F{d}, "dd/MM/yyyy")')).toBe('Format(Fields!d.Value, "java:dd/MM/yyyy")');
  });
  it('says what it cannot translate', () => {
    for (const [src, re] of [['new java.text.SimpleDateFormat("yyyy").format($F{d})', /new java\.text\.SimpleDateFormat/], ['$F{a} instanceof String', /instanceof/],
      ['"${x}"', /Groovy/], ['$F{a}.foo()', /\.foo\(\)/], ['list[0]', /index|name/], ['(', /ends too early/]]) {
      expect(() => J(src), src).toThrow(Untranslatable);
      try { J(src); } catch (e) { expect(e.message, src).toMatch(re); }
    }
  });
  it('is linear and refuses deep nesting', () => {
    const deep = '('.repeat(5000) + '1' + ')'.repeat(5000);
    const t0 = Date.now();
    expect(() => J(deep)).toThrow(/too deeply/);
    expect(J(Array.from({ length: 2000 }, () => '$F{n}').join(' + ')).length).toBeGreaterThan(2000 * 10); // a long flat chain is fine
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('patterns: DecimalFormat and SimpleDateFormat → .NET', () => {
    expect(javaPattern('#,##0.00', 'num')).toBe('#,##0.00');
    expect(javaPattern('¤ #,##0.00', 'num')).toBe('C2');
    expect(javaPattern('EEE, MMM d, yyyy', 'date')).toBe('ddd, MMM d, yyyy');
    expect(javaPattern('dd/MM/yyyy HH:mm a')).toBe('dd/MM/yyyy HH:mm tt');
    expect(javaPattern("yyyy 'at' HH")).toBe('yyyy "at" HH');
  });
});

/* ---------------------------------------------------------------- a small design, in both formats */

const rows = [
  { region: 'North', city: 'Pune', amount: 10 }, { region: 'North', city: 'Nashik', amount: 20 },
  { region: 'South', city: 'Chennai', amount: 5 }, { region: 'South', city: 'Madurai', amount: 7 }, { region: 'South', city: 'Salem', amount: 8 },
];
const head6 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE jasperReport PUBLIC "//JasperReports//DTD Report Design//EN" "http://jasperreports.sourceforge.net/dtds/jasperreport.dtd">
<jasperReport name="Sales" pageWidth="595" pageHeight="842" columnWidth="555" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20">`;
const JR6 = `${head6}
  <style name="Base" isDefault="true" fontName="Arial" fontSize="9"/>
  <style name="Bold" style="Base" isBold="true"/>
  <parameter name="Title" class="java.lang.String"><defaultValueExpression><![CDATA["Sales by region"]]></defaultValueExpression></parameter>
  <queryString><![CDATA[SELECT region, city, amount FROM sales WHERE amount > $P{Min} ORDER BY region]]></queryString>
  <field name="region" class="java.lang.String"/><field name="city" class="java.lang.String"/><field name="amount" class="java.lang.Double"/>
  <variable name="RegionTotal" class="java.lang.Double" resetType="Group" resetGroup="Region" calculation="Sum"><variableExpression><![CDATA[$F{amount}]]></variableExpression></variable>
  <variable name="Running" class="java.lang.Double" calculation="Sum"><variableExpression><![CDATA[$F{amount}]]></variableExpression></variable>
  <variable name="Cities" class="java.lang.Integer" calculation="Count"><variableExpression><![CDATA[$F{city}]]></variableExpression></variable>
  <group name="Region"><groupExpression><![CDATA[$F{region}]]></groupExpression>
    <groupHeader><band height="16"><textField><reportElement style="Bold" x="0" y="0" width="200" height="14"/><textFieldExpression><![CDATA["Region " + $F{region}]]></textFieldExpression></textField></band></groupHeader>
    <groupFooter><band height="16"><textField pattern="#,##0.00"><reportElement x="0" y="0" width="200" height="14"/><textElement textAlignment="Right"/><textFieldExpression><![CDATA[$V{RegionTotal}]]></textFieldExpression></textField>
      <textField><reportElement x="200" y="0" width="100" height="14"/><textFieldExpression><![CDATA[$V{Region_COUNT} + " cities"]]></textFieldExpression></textField></band></groupFooter>
  </group>
  <title><band height="30"><textField><reportElement x="0" y="0" width="400" height="24"/><textElement><font size="16" isBold="true"/></textElement><textFieldExpression><![CDATA[$P{Title}.toUpperCase()]]></textFieldExpression></textField></band></title>
  <pageHeader><band height="16"><staticText><reportElement x="0" y="0" width="200" height="14"/><text><![CDATA[Header]]></text></staticText></band></pageHeader>
  <columnHeader><band height="16"><staticText><reportElement mode="Opaque" backcolor="#333333" forecolor="#FFFFFF" x="0" y="0" width="200" height="14"/><text><![CDATA[City]]></text></staticText></band></columnHeader>
  <detail><band height="14">
    <textField><reportElement x="0" y="0" width="200" height="14"><printWhenExpression><![CDATA[$F{amount} > 0]]></printWhenExpression></reportElement><textFieldExpression><![CDATA[$F{city}]]></textFieldExpression></textField>
    <textField pattern="0.00"><reportElement x="200" y="0" width="100" height="14"/><textFieldExpression><![CDATA[$V{Running}]]></textFieldExpression></textField>
  </band></detail>
  <pageFooter><band height="16"><textField><reportElement x="0" y="0" width="200" height="14"/><textFieldExpression><![CDATA["Page " + $V{PAGE_NUMBER}]]></textFieldExpression></textField>
    <textField evaluationTime="Report"><reportElement x="200" y="0" width="100" height="14"/><textFieldExpression><![CDATA[" of " + $V{PAGE_NUMBER}]]></textFieldExpression></textField></band></pageFooter>
  <summary><band height="40">
    <textField><reportElement x="0" y="0" width="300" height="14"/><textFieldExpression><![CDATA[msg("{0} cities, {1,number,0.00} in total", $V{Cities}, $V{Running})]]></textFieldExpression></textField>
    <pieChart><chart><reportElement x="300" y="0" width="200" height="40"/><chartTitle><titleExpression><![CDATA["Share"]]></titleExpression></chartTitle></chart>
      <pieDataset><keyExpression><![CDATA[$F{region}]]></keyExpression><valueExpression><![CDATA[$F{amount}]]></valueExpression></pieDataset><piePlot><plot/></piePlot></pieChart>
  </band></summary>
</jasperReport>`;
// the same design in the JasperReports 7 format
const JR7 = `<jasperReport name="Sales" pageWidth="595" pageHeight="842" columnWidth="555" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20">
  <style name="Base" default="true" fontName="Arial" fontSize="9.0"/>
  <style name="Bold" style="Base" bold="true"/>
  <parameter name="Title" class="java.lang.String"><defaultValueExpression><![CDATA["Sales by region"]]></defaultValueExpression></parameter>
  <query language="sql"><![CDATA[SELECT region, city, amount FROM sales WHERE amount > $P{Min} ORDER BY region]]></query>
  <field name="region" class="java.lang.String"/><field name="city" class="java.lang.String"/><field name="amount" class="java.lang.Double"/>
  <variable name="RegionTotal" resetType="Group" calculation="Sum" resetGroup="Region" class="java.lang.Double"><expression><![CDATA[$F{amount}]]></expression></variable>
  <variable name="Running" calculation="Sum" class="java.lang.Double"><expression><![CDATA[$F{amount}]]></expression></variable>
  <variable name="Cities" calculation="Count" class="java.lang.Integer"><expression><![CDATA[$F{city}]]></expression></variable>
  <group name="Region"><expression><![CDATA[$F{region}]]></expression>
    <groupHeader><band height="16"><element kind="textField" x="0" y="0" width="200" height="14" style="Bold"><expression><![CDATA["Region " + $F{region}]]></expression></element></band></groupHeader>
    <groupFooter><band height="16"><element kind="textField" x="0" y="0" width="200" height="14" pattern="#,##0.00" hTextAlign="Right"><expression><![CDATA[$V{RegionTotal}]]></expression></element>
      <element kind="textField" x="200" y="0" width="100" height="14"><expression><![CDATA[$V{Region_COUNT} + " cities"]]></expression></element></band></groupFooter>
  </group>
  <title height="30"><element kind="textField" x="0" y="0" width="400" height="24" fontSize="16.0" bold="true"><expression><![CDATA[$P{Title}.toUpperCase()]]></expression></element></title>
  <pageHeader height="16"><element kind="staticText" x="0" y="0" width="200" height="14"><text><![CDATA[Header]]></text></element></pageHeader>
  <columnHeader height="16"><element kind="staticText" mode="Opaque" x="0" y="0" width="200" height="14" forecolor="#FFFFFF" backcolor="#333333"><text><![CDATA[City]]></text></element></columnHeader>
  <detail><band height="14">
    <element kind="textField" x="0" y="0" width="200" height="14"><printWhenExpression><![CDATA[$F{amount} > 0]]></printWhenExpression><expression><![CDATA[$F{city}]]></expression></element>
    <element kind="textField" x="200" y="0" width="100" height="14" pattern="0.00"><expression><![CDATA[$V{Running}]]></expression></element>
  </band></detail>
  <pageFooter height="16"><element kind="textField" x="0" y="0" width="200" height="14"><expression><![CDATA["Page " + $V{PAGE_NUMBER}]]></expression></element>
    <element kind="textField" x="200" y="0" width="100" height="14" evaluationTime="Report"><expression><![CDATA[" of " + $V{PAGE_NUMBER}]]></expression></element></pageFooter>
  <summary height="40">
    <element kind="textField" x="0" y="0" width="300" height="14"><expression><![CDATA[msg("{0} cities, {1,number,0.00} in total", $V{Cities}, $V{Running})]]></expression></element>
    <element kind="chart" chartType="pie" x="300" y="0" width="200" height="40"><titleExpression><![CDATA["Share"]]></titleExpression>
      <dataset kind="pie"><series><keyExpression><![CDATA[$F{region}]]></keyExpression><valueExpression><![CDATA[$F{amount}]]></valueExpression></series></dataset></element>
  </summary>
</jasperReport>`;

const run = async (def) => render(def, { fontStore, sources: { JasperDataSource: rows }, parameters: { Min: 0 } });
const walk = (items, out = []) => { for (const it of items || []) { out.push(it); walk(it.items, out); } return out; };

describe('a design: bands, groups, variables, styles, chart', () => {
  for (const [fmt, src] of [['JR 3–6', JR6], ['JR 7', JR7]]) {
    it(`${fmt}: converts and prints as Jasper would`, async () => {
      const r = importJrxml(src, { name: 'Sales' });
      expect(r.error).toBeUndefined();
      expect(validate(r.definition).errors).toEqual([]);
      const d = r.definition;
      expect(d.dataSources[0]).toMatchObject({ type: 'sql', query: 'SELECT region, city, amount FROM sales WHERE amount > @Min ORDER BY region' });
      expect(d.parameters.find(p => p.name === 'Title').default).toBe('Sales by region');
      const all = walk(d.sections.body.items);
      expect(all.find(i => i.type === 'list' && i.groupBy)).toMatchObject({ groupBy: '=Fields.region' });
      const chart = all.find(i => i.type === 'chart');
      expect(chart).toMatchObject({ chartType: 'pie', title: 'Share', category: '=Fields.region', series: [{ value: '=Sum(Fields.amount)' }] });
      expect(d.sections.pageHeader.printOnFirstPage).toBe(false); // the title comes first on page 1
      const out = await run(d);
      const t = out.pages.flatMap(texts);
      expect(t[0]).toBe('SALES BY REGION');
      expect(t.slice(1, 3)).toEqual(['Header', 'City']);
      expect(t).toEqual(expect.arrayContaining(['Region North', 'Pune', '10.00', 'Nashik', '30.00', '30.00', '2 cities', 'Region South', '35.00', '20.00', '3 cities', '5 cities, 50.00 in total', 'Page 1', 'of 1']));
      // the report-wide running sum runs on across groups, as Jasper prints it (JasperValue; ground truth tests/diff)
      expect(r.warnings.join('\n')).not.toMatch(/restart at each group/);
      expect(r.warnings.join('\n')).toMatch(/PW_DB_JASPERDATASOURCE/);
    });
  }
  it('both formats give the same report', () => {
    const a = importJrxml(JR6, { name: 'Sales' }).definition, b = importJrxml(JR7, { name: 'Sales' }).definition;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('untrusted designs', () => {
  it('drops only the JasperReports DTD reference; an internal subset (entities) is refused', () => {
    expect(stripJasperDoctype(head6)).not.toMatch(/DOCTYPE/);
    const xxe = '<?xml version="1.0"?><!DOCTYPE jasperReport [<!ENTITY x SYSTEM "file:///etc/passwd">]><jasperReport name="x"><title><band height="10"><staticText><reportElement x="0" y="0" width="10" height="10"/><text>&x;</text></staticText></band></title></jasperReport>';
    const r = importJrxml(xxe);
    expect(r.error).toMatch(/DOCTYPE/);
    expect(JSON.stringify(r.definition)).not.toMatch(/passwd|root:/);
  });
  it('refuses other XML, and a cut-off file, with a message', () => {
    expect(importJrxml('<Report/>').error).toMatch(/not a JasperReports design/);
    expect(importJrxml(JR6.slice(0, 900)).error).toMatch(/not readable XML/);
  });
  it('variables that use each other many times do not explode', () => {
    const vars = Array.from({ length: 40 }, (_, i) => `<variable name="v${i}" class="java.lang.Double"><variableExpression><![CDATA[${i ? `$V{v${i - 1}} + $V{v${i - 1}}` : '$F{n}'}]]></variableExpression></variable>`).join('');
    const src = `<jasperReport name="x"><field name="n" class="java.lang.Double"/>${vars}<detail><band height="14"><textField><reportElement x="0" y="0" width="100" height="14"/><textFieldExpression><![CDATA[$V{v39}]]></textFieldExpression></textField></band></detail></jasperReport>`;
    const t0 = Date.now();
    const r = importJrxml(src);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.error).toBeUndefined();
    expect(r.warnings.join('\n')).toMatch(/more than 16 deep|too long/);
  });
});

describe('corpus: JasperReports demo samples', () => {
  const files = fs.readdirSync(CORPUS).filter(f => f.endsWith('.jrxml'));
  const readme = fs.readFileSync(path.join(CORPUS, 'README.md'), 'utf8');
  it('has 40 to 60 designs in both formats, each listed with its source', () => {
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(files.length).toBeLessThanOrEqual(60);
    expect(files.some(f => f.startsWith('jr7-'))).toBe(true);
    for (const f of files) expect(readme).toContain(f);
  });
  const totals = { items: 0, mapped: 0, approximated: 0, dropped: 0 };
  const kinds = new Map();
  const sample = (def) => {
    const v = (f, i) => (f.type === 'number' ? (i + 1) * 10 : f.type === 'date' ? `2024-0${i + 1}-15` : f.type === 'boolean' ? i % 2 === 0 : `${f.name} ${i % 3 + 1}`);
    return Object.fromEntries(def.dataSets.map(ds => [ds.source, Array.from({ length: 4 }, (_, i) => Object.fromEntries((ds.fields || []).filter(f => !f.expr).map(f => [f.name, v(f, i)])))]));
  };
  const params = (def) => Object.fromEntries(def.parameters.filter(p => p.default == null).map(p => [p.name, p.type === 'number' ? 1 : p.type === 'date' ? '2024-01-15' : p.type === 'boolean' ? true : 'x']));
  for (const f of files) {
    it(`imports, validates and renders ${f}`, async () => {
      const r = importJrxml(fs.readFileSync(path.join(CORPUS, f), 'utf8'), { name: f });
      expect(r.error).toBeUndefined();
      expect(validate(r.definition).errors).toEqual([]);
      const out = await render(r.definition, { fontStore, sources: sample(r.definition), parameters: params(r.definition) });
      expect(out.pages.length).toBeGreaterThanOrEqual(1);
      for (const k of Object.keys(totals)) totals[k] += r.stats[k];
      for (const w of r.warnings) {
        const k = w.replace(/^[^:]{1,60}: /, '').replace(/"[^"]*"/g, '"…"').replace(/\(\w+\)/g, '(…)').replace(/\b(PW_DB_)[\w.]*/g, '$1…').replace(/the expression .*/, 'the expression … is shown as text.').replace(/=[^;,]*/g, '=…').slice(0, 100);
        kinds.set(k, (kinds.get(k) || 0) + 1);
      }
    });
  }
  it('keeps at least 95% of the elements', () => {
    const rate = (totals.mapped + totals.approximated) / totals.items;
    const top = [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `  ${String(n).padStart(3)}  ${k}`).join('\n');
    console.log(`JRXML corpus: ${files.length} designs, ${totals.items} elements: ${totals.mapped} mapped, ${totals.approximated} approximated, ${totals.dropped} dropped (${(rate * 100).toFixed(1)}% kept)\nTop notes:\n${top}`);
    expect(totals.items).toBeGreaterThan(1000);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });
});
