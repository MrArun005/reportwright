// The SSRS importer (.rdl / .rdlc): the safe XML reader, the mapping, expressions, a corpus of real reports, the proof report.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseXml, XmlError } from '../../src/importers/xml.js';
import { importRdl } from '../../src/importers/rdl.js';
import { importRdlx, translateExpression, toPt, outputTooLarge } from '../../src/importers/rdlx.js';
import { validate } from '../../src/engine/schema/validate.js';
import { checkValue } from '../../src/engine/expr/evaluate.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';

const FIX = path.join(import.meta.dirname, '..', 'fixtures', 'rdl');
const CORPUS = path.join(FIX, 'corpus');
const walk = (items, out = []) => {
  for (const it of items || []) {
    out.push(it);
    walk(it.items, out);
    for (const r of [...(it.header || []), ...(it.detail || []), ...(it.footer || []), ...(it.groups || []).flatMap(g => [...g.header, ...g.footer])]) for (const c of r?.cells || []) if (c?.item) walk([c.item], out);
  }
  return out;
};
const all = (def) => walk([def.sections.pageHeader.items, ...[def.sections.body].flat().map(b => b.items), def.sections.pageFooter.items].flat());
const byName = (def, name) => all(def).find(i => i.name === name);
const ms = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };

/** Rows for every data set without inline data, from its field names and types. */
function sampleSources(def, n = 4) {
  const v = (f, i) => (f.type === 'number' ? (i + 1) * 10 : f.type === 'date' ? `2024-0${i + 1}-15` : f.type === 'boolean' ? i % 2 === 0 : `${f.name} ${i % 3 + 1}`);
  const out = {};
  for (const s of def.dataSources) if (s.data) out[s.name] = s.data;
  for (const ds of def.dataSets) out[ds.source] ??= Array.from({ length: n }, (_, i) => Object.fromEntries((ds.fields || []).filter(f => !f.expr).map(f => [f.name, v(f, i)])));
  return out;
}
const sampleParams = (def) => Object.fromEntries(def.parameters.filter(p => p.default == null).map(p => {
  const v = p.options?.[0]?.value ?? (p.type === 'number' ? 1 : p.type === 'date' ? '2024-01-15' : p.type === 'boolean' ? true : 'x');
  return [p.name, p.multi ? [v] : v];
}));

/** A report with one text box whose value is the given RDL expression (XML-escaped here). */
const NS = 'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rdl = (body, { ns = NS, extra = '' } = {}) => `<?xml version="1.0"?><Report xmlns="${ns}">${extra}<ReportSections><ReportSection><Body><ReportItems>${body}</ReportItems><Height>2in</Height></Body><Width>6in</Width><Page /></ReportSection></ReportSections></Report>`;
const box = (value, name = 'T') => `<Textbox Name="${name}"><Paragraphs><Paragraph><TextRuns><TextRun><Value>${esc(value)}</Value><Style /></TextRun></TextRuns></Paragraph></Paragraphs><Top>0in</Top><Left>0in</Left><Height>0.25in</Height><Width>2in</Width></Textbox>`;
const params = '<DataSets><DataSet Name="DataSet1"><Query><DataSourceName>S</DataSourceName></Query><Fields><Field Name="x"><DataField>x</DataField></Field></Fields></DataSet></DataSets><ReportParameters><ReportParameter Name="p"><DataType>String</DataType><Prompt>p</Prompt></ReportParameter><ReportParameter Name="Year"><DataType>Integer</DataType><Prompt>y</Prompt></ReportParameter></ReportParameters>';
const valueOf = (expr) => { const r = importRdl(rdl(box(expr), { extra: params })); return { value: byName(r.definition, 'T')?.value, warnings: r.warnings }; };

/* ---------------------------------------------------------------- the XML reader */

describe('XML reader', () => {
  it('reads elements, attributes, text, CDATA, entities and namespaces', () => {
    const doc = parseXml('﻿<?xml version="1.0"?><!-- c --><r xmlns="urn:a" xmlns:b="urn:b" k=\'1 &amp; 2\'><b:x>&lt;&#65;&#x42;&quot;&apos;&gt;</b:x><y><![CDATA[<raw> & ]]></y><z/></r>');
    expect(doc).toMatchObject({ name: 'r', ns: 'urn:a', attrs: { k: '1 & 2' } });
    expect(doc.children.map(c => [c.name, c.ns, c.text])).toEqual([['x', 'urn:b', '<AB"\'>'], ['y', 'urn:a', '<raw> & '], ['z', 'urn:a', '']]);
  });
  it('keeps names like __proto__ and constructor as plain data', () => {
    const doc = parseXml('<r __proto__="x" constructor="y"><a/></r>');
    expect(doc.attrs.__proto__).toBe('x');
    expect(Object.getPrototypeOf(doc.attrs)).toBe(null);
    expect(() => parseXml('<constructor:a/>')).toThrow(/not declared/);
  });
  const refuse = {
    'a DOCTYPE': '<!DOCTYPE r><r/>',
    'an external entity (XXE)': '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>',
    'a billion laughs': `<!DOCTYPE r [<!ENTITY a "aaaaaaaaaa">${Array.from({ length: 9 }, (_, i) => `<!ENTITY b${i} "${'&' + (i ? `b${i - 1}` : 'a') + ';'}${('&' + (i ? `b${i - 1}` : 'a') + ';').repeat(9)}">`).join('')}]><r>&b8;</r>`,
    'a parameter entity': '<!ENTITY % p "x"><r/>',
    'an undefined entity': '<r>&nbsp;</r>',
    'a bare ampersand': '<r>a & b</r>',
    'a NUL character reference': '<r>&#0;</r>',
    'a surrogate reference': '<r>&#xD800;</r>',
    'mismatched tags': '<a><b></a></b>',
    'an unclosed element (a cut-off file)': '<a><b>text',
    'text outside the root': 'x<a/>',
    'two roots': '<a/><b/>',
    'a duplicate attribute': '<a x="1" x="2"/>',
    'a "<" in an attribute': '<a x="<"/>',
    'an unquoted attribute': '<a x=1/>',
    'an empty document': '   ',
  };
  for (const [what, src] of Object.entries(refuse)) {
    it(`refuses ${what}`, () => { expect(() => parseXml(src)).toThrow(XmlError); });
  }
  it('caps nesting depth, element count, attributes and size', () => {
    expect(() => parseXml('<a>'.repeat(200) + '</a>'.repeat(200))).toThrow(/nested more than 128/);
    expect(() => parseXml(`<r>${'<a/>'.repeat(101)}</r>`, { maxElements: 100 })).toThrow(/more than 100 elements/);
    expect(() => parseXml(`<r ${Array.from({ length: 70 }, (_, i) => `a${i}="1"`).join(' ')}/>`)).toThrow(/more than 64 attributes/);
    expect(() => parseXml(`<r>${'x'.repeat(2000)}</r>`, { maxChars: 1000 })).toThrow(/too large/);
  });
  it('runs in linear time on hostile input', () => {
    const big = 3_000_000;
    const cases = [
      `<r>${'<a/>'.repeat(200_000)}</r>`, // many elements
      `<r a="${'x'.repeat(big)}"/>`, // a huge attribute
      `<r>${'&amp;'.repeat(400_000)}</r>`, // many references
      `<r>${'x'.repeat(big)}`, // never closed
      `<r><!--${'-'.repeat(big)}`, // a comment that never ends
      `<r a="${'x'.repeat(big)}`, // an attribute that never ends
      `<r>${'<'.repeat(100_000)}`, // tags that never start
      `<r>${'&'.repeat(big)}</r>`, // ampersands
    ];
    for (const src of cases) {
      const t = ms(() => { try { parseXml(src, { maxElements: 300_000 }); } catch { /* refused: fine */ } });
      expect(t).toBeLessThan(5000); // linear: tens of ms; quadratic on these sizes would take hours (a loaded machine is slow, not that slow)
    }
  });
});

/* ---------------------------------------------------------------- the importer with hostile input */

describe('hostile .rdl files', () => {
  it('a DOCTYPE or XXE file is refused with a clear error and an empty, valid report', () => {
    const r = importRdl('<?xml version="1.0"?><!DOCTYPE Report [<!ENTITY x SYSTEM "file:///etc/passwd">]><Report xmlns="' + NS + '">&x;</Report>');
    expect(r.error).toMatch(/DOCTYPE/);
    expect(validate(r.definition).errors).toEqual([]);
    expect(r.definition.sections.body.items).toEqual([]);
  });
  it('a file that is not an SSRS report is refused', () => {
    expect(importRdl('<html><body/></html>').error).toMatch(/not an SSRS report/);
    expect(importRdl('<Report xmlns="urn:other"/>').error).toMatch(/not an SSRS report/);
    expect(importRdl('{"Body":{}}').error).toMatch(/not readable XML/);
    expect(importRdl(fs.readFileSync(path.join(FIX, 'truncated.rdl'), 'utf8')).error).toMatch(/not readable XML/);
  });
  it('never throws on junk', () => {
    for (const junk of [null, undefined, '', 42, '<Report/>', `<Report xmlns="${NS}"><ReportSections><ReportSection/></ReportSections></Report>`, rdl('<Tablix Name="T"/><Chart Name="C"/><GaugePanel Name="G"/><Textbox/>')]) {
      const r = importRdl(/** @type {any} */ (junk));
      expect(validate(r.definition).errors).toEqual([]);
    }
  });
  it('stays fast on inputs built to make regular expressions backtrack', () => {
    const n = 200_000; // quadratic work on these would take minutes
    const files = [
      rdl(box('=' + '1'.repeat(n) + 'x')), // a number that is not one
      rdl(box('=' + '('.repeat(9000) + '1' + ')'.repeat(9000))), // deep nesting
      rdl(box('="a" & ' + '_ \n'.repeat(5000) + '"b"')), // line continuations
      rdl(box('=' + 'Fields!a.Value + '.repeat(1000) + '1')), // a long but valid expression
      rdl(box('x', 'T').replace('<Width>2in</Width>', `<Width>${'1'.repeat(n)}z</Width>`)), // a length that is not one
      rdl(box('x', 'T').replace('<Top>', `<Visibility><Hidden>${' '.repeat(n)}x</Hidden></Visibility><Top>`)), // spaces before a boolean
      rdl(box('x'), { extra: `<DataSources><DataSource Name="S"><ConnectionProperties><DataProvider>JSON</DataProvider><ConnectString>a$${' '.repeat(n)}</ConnectString></ConnectionProperties></DataSource></DataSources>` }),
      rdl(box('x'), { extra: `<DataSources><DataSource Name="S"><ConnectionProperties><DataProvider>SQL</DataProvider></ConnectionProperties></DataSource></DataSources><DataSets><DataSet Name="D"><Query><DataSourceName>S</DataSourceName><CommandText>select @${'a'.repeat(n)}</CommandText><QueryParameters><QueryParameter Name="@(a+)+$"><Value>=Parameters!x.Value</Value></QueryParameter></QueryParameters></Query></DataSet></DataSets>` }),
      rdl(box('<' + '<'.repeat(n))), // markup-like text
      rdl(box('=Variables!' + 'a'.repeat(n) + '.Value & ReportItems!' + 'b'.repeat(n))), // long names
    ];
    for (const f of files) {
      let r;
      const t = ms(() => { r = importRdl(f); });
      expect(t).toBeLessThan(5000);
      expect(validate(r.definition).errors).toEqual([]);
    }
  });
  it('the ActiveReports translation it reuses is linear too (lexer, lengths, booleans, connection strings)', () => {
    const n = 200_000;
    for (const src of ['=' + '1'.repeat(n) + 'x', '=' + 'a'.repeat(n) + '(', '=' + '1.'.repeat(n / 2), '="' + 'x'.repeat(n), '=' + '#'.repeat(n), '=' + '['.repeat(n)]) {
      expect(ms(() => translateExpression(src, { text: true }))).toBeLessThan(5000);
    }
    expect(ms(() => toPt('1'.repeat(n) + 'z'))).toBeLessThan(5000);
    expect(ms(() => toPt('1' + ' '.repeat(n) + 'z'))).toBeLessThan(5000);
    expect(ms(() => importRdlx({ Body: { ReportItems: [{ Type: 'textbox', Name: 'T', Visibility: { Hidden: ' '.repeat(n) + 'x' } }] },
      DataSources: [{ Name: 'S', ConnectionProperties: { DataProvider: 'JSON', ConnectString: 'a$' + ' '.repeat(n) } }] }))).toBeLessThan(5000);
  });
  it('leaves out an expression that is too long, with a note', () => {
    const r = importRdl(rdl(box('="' + 'a'.repeat(30_000) + '"')));
    expect(byName(r.definition, 'T').value).toBe('');
    expect(r.warnings.join(' ')).toMatch(/too long to import/);
  });
  it('a query parameter name cannot inject a pattern into the SQL rewrite', () => {
    // the .rdl front end keeps only word characters; the ActiveReports importer escapes what is left
    const q = (Name) => importRdlx({ DataSources: [{ Name: 'S', ConnectionProperties: { DataProvider: 'SQL' } }],
      DataSets: [{ Name: 'D', Query: { DataSourceName: 'S', CommandText: 'select 1 where a = @a.b or b = @axb', QueryParameters: [{ Name, Value: '=Parameters!R.Value' }] } }] }).definition.dataSources[0].query;
    expect(q('@a.b')).toBe('select 1 where a = @R or b = @axb');
    let out;
    expect(ms(() => { out = q('@(a+)+$'); })).toBeLessThan(200);
    expect(out).toBe('select 1 where a = @a.b or b = @axb');
  });
  it('refuses a table whose rows × columns pass the per-table cap, before converting its cells', () => {
    const cols = '<TablixColumn><Width>1in</Width></TablixColumn>'.repeat(600);
    const rows = '<TablixRow><Height>1in</Height><TablixCells /></TablixRow>'.repeat(600);
    const src = rdl(`<Tablix Name="Wide"><TablixBody><TablixColumns>${cols}</TablixColumns><TablixRows>${rows}</TablixRows></TablixBody></Tablix>`);
    expect(src.length).toBeLessThan(100_000);
    let r;
    expect(ms(() => { r = importRdl(src); })).toBeLessThan(1000);
    expect(byName(r.definition, 'Wide')).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/Wide: it has 600 rows × 600 columns/);
    expect(r.stats.dropped).toBe(1);
  });
});

/* ---------------------------------------------------------------- output budget: small files that would become huge reports */

describe('expansion amplification', () => {
  /** Run an import, with its time and heap growth. */
  const measure = (fn) => {
    const heap = process.memoryUsage().heapUsed;
    let r;
    const t = ms(() => { r = fn(); });
    return { r, t, heap: process.memoryUsage().heapUsed - heap };
  };
  const tx = (name, value, style = '') => `<Textbox Name="${name}"><Paragraphs><Paragraph><TextRuns><TextRun><Value>${esc(value)}</Value><Style>${style}</Style></TextRun></TextRuns></Paragraph></Paragraphs></Textbox>`;

  it('variables that each use the one before many times (exponential): the expression is left out, fast', () => {
    const vars = ['<Variable Name="V0"><Value>="ab"</Value></Variable>',
      ...Array.from({ length: 8 }, (_, k) => `<Variable Name="V${k + 1}"><Value>=${Array(30).fill(`Variables!V${k}.Value`).join(' &amp; ')}</Value></Variable>`)].join('');
    const src = rdl(tx('T', '=Variables!V8.Value'), { extra: `<Variables>${vars}</Variables>` });
    expect(src.length).toBeLessThan(100_000);
    const { r, t, heap } = measure(() => importRdl(src));
    expect(t).toBeLessThan(1000);
    expect(heap).toBeLessThan(200 * 1024 * 1024);
    expect(byName(r.definition, 'T').value).toBe('');
    expect(r.warnings.join(' ')).toMatch(/longer than 20000 characters once its variables and item references are filled in/);
  });
  it('a variable used in every style of many items: refused once the expressions pass the output budget', () => {
    const big = `<Variable Name="Big"><Value>=${Array(700).fill('Fields!abcdefghij.Value').join(' &amp; ')}</Value></Variable>`;
    const style = ['Color', 'BackgroundColor', 'FontFamily', 'FontSize', 'FontWeight', 'FontStyle', 'Format', 'TextAlign', 'VerticalAlign',
      'PaddingLeft', 'PaddingRight', 'PaddingTop', 'PaddingBottom', 'TextDecoration', 'WritingMode', 'LineHeight', 'Direction', 'Language'].map(k => `<${k}>=Variables!Big.Value</${k}>`).join('');
    const src = rdl(Array.from({ length: 60 }, (_, i) => tx(`T${i}`, '=1', style)).join(''), { extra: `<Variables>${big}</Variables>` });
    expect(src.length).toBeLessThan(100_000);
    const { r, t, heap } = measure(() => importRdl(src));
    expect(t).toBeLessThan(1000);
    expect(heap).toBeLessThan(300 * 1024 * 1024);
    expect(r.error).toMatch(/too large to import: its expressions grow past 16 million characters/);
    expect(validate(r.definition).errors).toEqual([]);
  });
  it('one embedded image used by many items is stored once', () => {
    const data = 'iVBORw0KGgo'.repeat(5000); // 55 KB
    const imgs = Array.from({ length: 400 }, (_, i) => `<Image Name="I${i}"><Source>Embedded</Source><Value>Logo</Value></Image>`).join('');
    const src = rdl(imgs, { extra: `<EmbeddedImages><EmbeddedImage Name="Logo"><MIMEType>image/png</MIMEType><ImageData>${data}</ImageData></EmbeddedImage></EmbeddedImages>` });
    expect(src.length).toBeLessThan(100_000);
    const { r, t } = measure(() => importRdl(src));
    expect(t).toBeLessThan(1000);
    expect(byName(r.definition, 'I399').src).toBe('embedded:Logo');
    expect(JSON.stringify(r.definition).length).toBeLessThan(200_000); // 400 copies would be 22 MB
  });
  it('many tables under the per-table cap: refused once all their cells pass the budget (ActiveReports JSON too)', () => {
    const tbl = (i) => ({ Type: 'tablix', Name: `T${i}`, Body: { Columns: Array(450).fill(1), Rows: Array(450).fill(0) }, RowHierarchy: { Members: Array(450).fill(0).map(() => ({})) }, ColumnHierarchy: { Members: [] } });
    const src = JSON.stringify({ Body: { ReportItems: Array.from({ length: 20 }, (_, i) => tbl(i)) } });
    expect(src.length).toBeLessThan(100_000);
    const { r, t, heap } = measure(() => importRdlx(src));
    expect(t).toBeLessThan(1000);
    expect(heap).toBeLessThan(300 * 1024 * 1024);
    expect(r.error).toMatch(/too large to import: its tables have more than 1,000,000 cells/);
  });
  it('a deeply nested tablix: data regions deeper than 8 are left out with a note', () => {
    let inner = tx('Leaf', 'x');
    for (let d = 15; d >= 1; d--) { // 15 tables, about 110 XML levels (the reader allows 128)
      inner = `<Tablix Name="N${d}"><TablixBody><TablixColumns><TablixColumn><Width>1in</Width></TablixColumn><TablixColumn><Width>1in</Width></TablixColumn></TablixColumns><TablixRows><TablixRow><Height>0.25in</Height><TablixCells>`
        + `<TablixCell><CellContents>${inner}</CellContents></TablixCell><TablixCell><CellContents>${tx(`S${d}`, '=1')}</CellContents></TablixCell></TablixCells></TablixRow></TablixRows></TablixBody>`
        + '<TablixColumnHierarchy><TablixMembers><TablixMember /><TablixMember /></TablixMembers></TablixColumnHierarchy><TablixRowHierarchy><TablixMembers><TablixMember><Group Name="Details' + d + '" /></TablixMember></TablixMembers></TablixRowHierarchy></Tablix>';
    }
    const { r, t } = measure(() => importRdl(rdl(inner)));
    expect(t).toBeLessThan(1000);
    expect(validate(r.definition).errors).toEqual([]);
    expect(byName(r.definition, 'N8')).toBeDefined();
    expect(byName(r.definition, 'N9')).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/N9: it is nested more than 8 tables or charts deep/);
  });
  it('a many-cells matrix stays within the budget', () => {
    const n = 300;
    const cols = '<TablixColumn><Width>0.5in</Width></TablixColumn>'.repeat(n);
    const cells = Array.from({ length: n }, () => '<TablixCell />').join('');
    const src = rdl(`<Tablix Name="M"><TablixBody><TablixColumns>${cols}</TablixColumns><TablixRows><TablixRow><Height>0.25in</Height><TablixCells>${cells}</TablixCells></TablixRow></TablixRows></TablixBody>`
      + `<TablixColumnHierarchy><TablixMembers>${'<TablixMember><Group Name="C"><GroupExpressions><GroupExpression>=Fields!c.Value</GroupExpression></GroupExpressions></Group></TablixMember>'.repeat(n)}</TablixMembers></TablixColumnHierarchy>`
      + '<TablixRowHierarchy><TablixMembers><TablixMember><Group Name="R"><GroupExpressions><GroupExpression>=Fields!r.Value</GroupExpression></GroupExpressions></Group></TablixMember></TablixMembers></TablixRowHierarchy></Tablix>');
    expect(src.length).toBeLessThan(100_000);
    const { r, t } = measure(() => importRdl(src));
    expect(t).toBeLessThan(1000);
    expect(validate(r.definition).errors).toEqual([]);
    expect(JSON.stringify(r.definition).length).toBeLessThan(500_000);
  });
  it('translations that repeat their operands (Choose, nested Math.Max) are capped', () => {
    const choose = '=Choose(' + 'Fields!abcdefghij.Value + '.repeat(500) + '1, ' + Array(2000).fill('1').join(', ') + ')';
    let max = 'Fields!x.Value';
    for (let k = 0; k < 40; k++) max = `Math.Max(${max}, 1)`;
    for (const src of [choose, '=' + max]) {
      let r;
      expect(ms(() => { r = translateExpression(src, { text: true }); })).toBeLessThan(1000);
      expect(r.ok).toBe(false);
      expect(r.notes.join(' ')).toMatch(/longer than 100000 characters/);
    }
  });
  it('the definition size is counted without serialising it, and stops early', () => {
    const shared = { value: 'x'.repeat(100) };
    expect(ms(() => expect(outputTooLarge({ items: Array(1e6).fill(shared) })).toBe(true))).toBeLessThan(1000);
    expect(outputTooLarge({ items: Array(10).fill(shared) })).toBe(false);
  });
  it('keeps custom code as text and never runs it', () => {
    const code = 'Public Function Boom() As String\n  System.IO.File.Delete("x")\n  Return "x"\nEnd Function';
    const r = importRdl(rdl(box('=Code.Boom()'), { extra: `<Code>${esc(code)}</Code>` }));
    expect(r.definition.customCode).toBe(code);
    expect(r.definition.functions).toBeUndefined();
    expect(byName(r.definition, 'T').value).toBe('="=Code.Boom()"');
    expect(r.warnings.join(' ')).toMatch(/custom code \(Visual Basic, 4 lines\)/);
  });
});

/* ---------------------------------------------------------------- expressions */

describe('expressions', () => {
  const cases = [
    ['=Fields!Amount.Value', '=Fields.Amount'],
    ['=Parameters!p.Value', '=Parameters.p'],
    ['=Globals!PageNumber & " / " & Globals!TotalPages', '{Globals.PageNumber} / {Globals.TotalPages}'],
    ['=Globals!ExecutionTime', '=Globals.ExecutionTime'],
    ['=Sum(Fields!x.Value, "DataSet1")', '=Sum(Fields.x, "DataSet1")'],
    ['=Count(Fields!x.Value) & " rows"', '{Count(Fields.x)} rows'],
    ['=IIf(Fields!x.Value > 0, "up", "down")', '=IIF(Fields.x > 0, "up", "down")'],
    ['=Switch(Fields!x.Value = 1, "a", True, "b")', '=Switch(Fields.x = 1, "a", true, "b")'],
    ['=Choose(2, "a", "b")', '=Switch(2 = 1, "a", 2 = 2, "b")'],
    ['=Format(Fields!d.Value, "yyyy-MM-dd")', '=Format(Fields.d, "yyyy-MM-dd")'],
    ['=FormatNumber(Fields!x.Value, 1)', '=Format(Fields.x, "N1")'],
    ['=FormatCurrency(Fields!x.Value)', '=Format(Fields.x, "C2")'],
    ['=FormatDateTime(Fields!d.Value, DateFormat.ShortDate)', '=Format(Fields.d, "d")'],
    ['=FormatDateTime(Fields!d.Value, Microsoft.VisualBasic.DateFormat.LongDate)', '=Format(Fields.d, "D")'],
    ['=UCase(Left(Trim(Fields!s.Value), 3)) & Len(Fields!s.Value)', '{Upper(Left(Trim(Fields.s), 3))}{Len(Fields.s)}'],
    ['=Replace(Mid(Fields!s.Value, 2, 3), "a", "b")', '=Replace(Mid(Fields.s, 2, 3), "a", "b")'],
    ['=DateAdd("d", 7, Today())', '=DateAdd("d", 7, Today())'],
    ['=DateDiff(DateInterval.Day, Fields!a.Value, Now())', '=DateDiff("d", Fields.a, Now())'],
    ['=Year(Fields!d.Value) * 100 + Month(Fields!d.Value)', '=Year(Fields.d) * 100 + Month(Fields.d)'],
    ['=Math.Round(Abs(Fields!x.Value), 2)', '=Round(Abs(Fields.x), 2)'],
    ['=System.Math.Floor(Fields!x.Value)', '=Floor(Fields.x)'],
    ['=Fields!x.Value Mod 2 = 0 And Not Fields!y.Value Or False', '=Fields.x % 2 = 0 and not Fields.y or false'],
    ['=CStr(Fields!x.Value) & CDbl("1.5")', '{CStr(Fields.x)}{CDbl("1.5")}'],
    ['=WeekdayName(DatePart(DateInterval.Weekday, Fields!d.Value), True, FirstDayOfWeek.Monday)', '=WeekdayName(DatePart("w", Fields.d), true, 2)'],
    ['=RowNumber(Nothing)', '=RowNumber()'],
    ['=Join(Parameters!p.Value, ", ")', '=Join(Parameters.p, ", ")'],
  ];
  for (const [src, want] of cases) {
    it(`${src} → ${want}`, () => {
      const { value, warnings } = valueOf(src);
      expect(value).toBe(want);
      expect(checkValue(value)).toBeNull();
      expect(warnings.join(' ')).not.toMatch(/no ReportWright equivalent|could not be read/);
    });
  }
  it('Parameters!p.Label gives the value, with a note', () => {
    const { value, warnings } = valueOf('=Parameters!p.Label');
    expect(value).toBe('=Parameters.p');
    expect(warnings.join(' ')).toMatch(/Label gives the value/);
  });
  for (const src of ['=Code.Fmt(Fields!x.Value)', '=InScope("Group1")', '=Globals!RenderFormat.IsInteractive', '=User!UserID', '=Fields!x.Value +']) {
    it(`keeps ${src} as text and names it`, () => {
      const { value, warnings } = valueOf(src);
      expect(value).toBe('=' + JSON.stringify(src));
      expect(warnings.length).toBeGreaterThan(0);
    });
  }
  it('resolves Variables!, ReportItems! (same scope) and Me.Value; keeps ReportItems! of another region as text', () => {
    const r = importRdl(rdl(box('=Variables!V.Value & "!"', 'A') + box('=ReportItems!A.Value', 'B') +
      '<Textbox Name="C"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!x.Value</Value><Style><Color>=IIF(Me.Value &lt; 0, "Red", "Green")</Color></Style></TextRun></TextRuns></Paragraph></Paragraphs><Top>1in</Top><Left>0in</Left><Height>0.25in</Height><Width>1in</Width></Textbox>' +
      '<Tablix Name="Tb"><TablixBody><TablixColumns><TablixColumn><Width>1in</Width></TablixColumn></TablixColumns><TablixRows><TablixRow><Height>0.25in</Height><TablixCells><TablixCell><CellContents>' + box('=Fields!x.Value', 'InTable') + '</CellContents></TablixCell></TablixCells></TablixRow></TablixRows></TablixBody>' +
      '<TablixColumnHierarchy><TablixMembers><TablixMember /></TablixMembers></TablixColumnHierarchy><TablixRowHierarchy><TablixMembers><TablixMember><Group Name="Details" /></TablixMember></TablixMembers></TablixRowHierarchy><Top>2in</Top><Left>0in</Left><Height>0.25in</Height><Width>1in</Width></Tablix>' +
      box('=ReportItems!InTable.Value', 'Outside'), { extra: '<Variables><Variable Name="V"><Value>="Hi " &amp; Globals!ReportName</Value></Variable></Variables>' }));
    const d = r.definition;
    expect(byName(d, 'A').value).toBe('Hi {Globals.ReportName}!');
    expect(byName(d, 'B').value).toBe('Hi {Globals.ReportName}!');
    expect(byName(d, 'C').style.color).toBe('=IIF(Fields.x < 0, "#ff0000", "#008000")');
    expect(byName(d, 'Outside').value).toBe('="=ReportItems!InTable.Value"');
    expect(r.warnings.join(' ')).toMatch(/ReportItems!InTable \(the value of another item\)/);
  });
});

/* ---------------------------------------------------------------- the mapping: one report that uses most of RDL */

describe('kitchen sink (RDL 2016)', () => {
  const { definition: def, warnings, stats } = importRdl(fs.readFileSync(path.join(FIX, 'kitchen-sink.rdl'), 'utf8'), { name: 'Kitchen sink' });
  const W = warnings.join('\n');
  it('is a valid report, with every item counted', () => {
    expect(validate(def).errors).toEqual([]);
    expect(def).toMatchObject({ $schema: 'reportwright/report@1', name: 'Kitchen sink', locale: 'en-GB', currency: 'GBP' });
    expect(stats.items).toBe(stats.mapped + stats.approximated + stats.dropped);
    expect(stats.dropped).toBe(0); // the map is kept (its shapes need GeoJSON)
  });
  it('maps the page, header and footer', () => {
    expect(def.page).toEqual({ size: 'Letter', orientation: 'portrait', margins: [36, 36, 36, 36] });
    const { pageHeader: h, pageFooter: f } = def.sections;
    expect(h.height).toBe(43.2);
    expect(h.items[0]).toMatchObject({ type: 'shape', style: { fill: '#eef3f8' } }); // the header's background
    expect(byName(def, 'HeaderTitle')).toMatchObject({ value: 'Sales {Parameters.Year}', style: { fontSize: 16, fontWeight: 'bold' } });
    expect(byName(def, 'HeaderLogo').src).toBe('embedded:Logo');
    expect(def.images.Logo).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(byName(def, 'PageNo')).toMatchObject({ value: 'Page {Globals.PageNumber} of {Globals.TotalPages}', style: { textAlign: 'right' } });
    expect(f.height).toBe(28.8);
  });
  it('maps parameters: types, defaults, valid values, multi-value, cascading, hidden, nullable', () => {
    const p = Object.fromEntries(def.parameters.map(x => [x.name, x]));
    expect(p.Region).toMatchObject({ type: 'string', default: 'West', optionsFrom: { dataSet: 'Regions', value: '=Fields.Name' } });
    expect(p.Country).toMatchObject({ type: 'string', multi: true, optionsFrom: { dataSet: 'Countries', value: '=Fields.Country', label: '=Fields.Country' } });
    expect(p.Country.required).toBeUndefined(); // AllowBlank
    expect(p.Year).toMatchObject({ type: 'number', default: 2024, options: [{ value: 2023, label: 'Last year' }, { value: 2024, label: 'This year' }] });
    expect(p.ShowDetails).toMatchObject({ type: 'boolean', default: true, hidden: true });
    expect(p.Since).toMatchObject({ type: 'date' });
    expect(p.Since.required).toBeUndefined(); // Nullable
  });
  it('maps data: SQL with @parameters, a shared data source, data typed into the report, typed and calculated fields, filters', () => {
    const src = Object.fromEntries(def.dataSources.map(s => [s.name, s]));
    expect(src.Sales).toMatchObject({ type: 'sql', connection: 'sales', query: 'SELECT Region, Country, Product, Amount, OrderDate FROM Orders WHERE Region = @Region AND YEAR(OrderDate) = @Year' });
    expect(src.Warehouse).toMatchObject({ type: 'sql', connection: 'warehouse' });
    expect(src.Typed_Regions).toMatchObject({ type: 'json', data: [{ Name: 'West', Rank: 1 }, { Name: 'East', Rank: 2 }] });
    expect(W).toMatch(/shared data source "\/Shared\/Warehouse".*treated as SQL Server/);
    expect(W).toMatch(/PW_DB_SALES=/);
    const orders = def.dataSets.find(d => d.name === 'Orders');
    expect(orders.fields).toEqual(expect.arrayContaining([{ name: 'Amount', type: 'number' }, { name: 'OrderDate', type: 'date' }, { name: 'Margin', expr: '=Fields.Amount * 0.2' }]));
    expect(orders.filters).toEqual([{ expr: '=Fields.Amount', op: '>', value: '0' }]);
  });
  it('maps text runs: one style → a text box; mixed styles → rich text with lists, escaped text and fields', () => {
    const h = byName(def, 'Heading');
    expect(h.type).toBe('richtext');
    expect(h.value).toBe('<p style="text-align:center"><span style="font-size:14pt">Sales for </span><span style="font-size:14pt;font-weight:bold;color:#1f4e79">{Parameters.Region}</span></p>'
      + '<ul><li><span style="font-style:italic">Figures in thousands &lt;not audited&gt;</span></li></ul>');
    expect(h.bookmark).toBe('Heading');
    const g = byName(def, 'Grand');
    expect(g).toMatchObject({ type: 'textbox', value: '=Sum(Fields.Amount, "Orders")', style: { format: 'C0', backgroundColor: '#f5f5f5', border: '1 solid #c0c0c0' } });
    expect(g.style.color).toBe('=IIF(Sum(Fields.Amount, "Orders") < 0, "#ff0000", "#000000")'); // Me.Value
    expect(byName(def, 'Echo').value).toBe('=Sum(Fields.Amount, "Orders")'); // ReportItems!Grand
    expect(byName(def, 'Custom').value).toBe('="=Code.Pct(1, 2)"');
    expect(W).toMatch(/Custom: custom code \(Code.Pct\)/);
  });
  it('maps lines, rectangles and actions (hyperlink, bookmark link, drill-through)', () => {
    expect(byName(def, 'Rule')).toMatchObject({ type: 'line', style: { stroke: '#808080', strokeDash: 'dashed' } });
    expect(byName(def, 'Links')).toMatchObject({ type: 'container', keepTogether: true });
    expect(byName(def, 'Site').action).toEqual({ type: 'url', url: 'https://example.com/{Parameters.Region}' });
    expect(byName(def, 'BackToTop').action).toEqual({ type: 'bookmark', target: 'top' });
  });
  it('maps a table tablix: header repeat, group with page breaks and document map, drill-down, sorting, filters, spans, user sort', () => {
    const t = byName(def, 'OrdersTable');
    expect(t).toMatchObject({ type: 'table', dataSet: 'Orders', repeatHeader: true, noRowsText: 'No orders', columns: [{ width: 144 }, { width: 216 }, { width: 108 }] });
    expect(t.header[0].cells[0]).toMatchObject({ value: 'Region', sortBy: '=Fields.Region' });
    expect(t.groups).toEqual([expect.objectContaining({ name: 'RegionGroup', expr: '=Fields.Region', sort: 'asc', pageBreak: 'between', keepTogether: true, collapsible: true, initiallyCollapsed: true })]);
    expect(t.groups[0].header[0].cells.map(c => c?.value)).toEqual(['=Fields.Region', '{CountRows()} orders', '=Sum(Fields.Amount)']);
    expect(t.groups[0].header[0].cells[0].bookmark).toBe('=Fields.Region');
    expect(t.detail[0].cells[1].action).toEqual({ type: 'report', report: 'order-detail', params: { Product: '=Fields.Product' } });
    expect(t.sort).toEqual([{ by: '=Fields.Amount', dir: 'desc' }]);
    expect(t.footer[0].cells[0]).toMatchObject({ value: 'Total', colSpan: 2 });
    expect(t.footer[0].cells[2].value).toBe('=Sum(Fields.Amount, "OrdersTable")');
    expect(t.filters).toEqual([{ expr: '=Fields.Country', op: 'in', value: '=Parameters.Country' }]);
  });
  it('maps a matrix tablix and a list tablix', () => {
    expect(byName(def, 'Pivot')).toMatchObject({ type: 'matrix', dataSet: 'Orders', corner: 'Region',
      rowGroups: [{ name: 'PivotRegion', expr: '=Fields.Region', width: 86.4 }], columnGroups: [{ name: 'YearGroup', expr: '=Year(Fields.OrderDate)', sort: 'asc', total: 'after', totalLabel: 'All years' }],
      values: [{ value: '=Sum(Fields.Amount)', format: 'N0' }] });
    const l = byName(def, 'CountryList');
    expect(l).toMatchObject({ type: 'list', dataSet: 'Orders', groupBy: '=Fields.Country', sort: [{ by: '=Fields.Country', dir: 'asc' }] });
    expect(l.items.map(i => [i.name, i.value])).toEqual([['CountryName', '=Fields.Country'], ['CountryTotal', '=Sum(Fields.Amount)']]);
  });
  it('maps charts: combo with a secondary axis, labels, palettes, point drill-through, a doughnut', () => {
    const c = byName(def, 'SalesChart');
    expect(c).toMatchObject({ type: 'chart', chartType: 'column', dataSet: 'Orders', category: '=Fields.Product', categorySort: 'desc', title: 'Sales {Parameters.Year}', legend: 'bottom',
      stacked: true, showValues: true, palette: 'earth', valueFormat: 'N0',
      series: [{ name: 'Amount', value: '=Sum(Fields.Amount)' }, { name: 'Margin', value: '=Sum(Fields.Margin)', type: 'line', axis: 'secondary', line: 'smooth' }],
      pointAction: { type: 'report', report: 'order-detail', params: { Product: '=Fields.Product' } } });
    expect(c.axes).toMatchObject({ x: { title: 'Product', labelAngle: -45 }, y: { min: 0, gridlines: false, title: 'Amount' }, y2: { title: 'Margin', format: 'P0' } });
    expect(byName(def, 'ShareChart')).toMatchObject({ chartType: 'donut', category: '=Fields.Region', palette: ['#1f77b4', '#ff7f0e'], showValues: true,
      labelTemplate: '=Format(Sum(Fields.Amount) / Sum(Fields.Amount, "Orders"), "P0")' });
  });
  it('approximates gauges and state indicators; maps images and subreports; keeps the map with a note to supply its shapes', () => {
    expect(byName(def, 'Speed')).toMatchObject({ type: 'chart', chartType: 'gauge', series: [{ value: '=Sum(Fields.Amount)' }], axes: { y: { min: 0, max: 1000 } } });
    expect(W).toMatch(/Speed: its ranges, ticks, extra pointers and frame are left out/);
    expect(byName(def, 'Status')).toMatchObject({ type: 'iconset', value: '=Sum(Fields.Amount)', iconSet: 'arrows', lower: '=100', upper: '=500' });
    expect(byName(def, 'Photo')).toMatchObject({ type: 'image', src: 'https://example.com/photo.png', fit: 'contain' });
    expect(byName(def, 'Stored').src).toBe('data:image/jpeg;base64,{First(Fields.Product, "Orders")}');
    expect(byName(def, 'Detail')).toMatchObject({ type: 'subreport', report: 'order-detail', params: { Region: '=Parameters.Region' } });
    expect(byName(def, 'SalesMap')).toMatchObject({ type: 'map', geojson: '' });
    expect(W).toMatch(/SalesMap: its shapes could not be read from the file: paste GeoJSON/);
  });
  it('keeps the custom code text', () => {
    expect(def.customCode).toMatch(/^Public Function Pct/);
  });
  it('renders', async () => {
    const out = await render(def, { fontStore, sources: sampleSources(def), parameters: { Country: ['Country 1', 'Country 2', 'Country 3'] } });
    const t = out.pages.flatMap(texts).join(' ');
    expect(t).toMatch(/Sales 2024/);
    expect(t).toMatch(/Page 1 of \d/);
    expect(t).toMatch(/Region 1/);
    expect(out.bookmarks?.length).toBeGreaterThan(0);
  });
});

describe('RDL versions and layouts', () => {
  it('reads an RDL 2008 report (Body and Page under Report, page settings at the top) and a .rdlc', () => {
    const src = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2008/01/reportdefinition"><Body><ReportItems>${box('Hello')}</ReportItems><Height>1in</Height></Body><Width>6in</Width>
      <Page><PageHeader><Height>0.5in</Height><ReportItems>${box('Head', 'H')}</ReportItems></PageHeader><PageHeight>29.7cm</PageHeight><PageWidth>21cm</PageWidth><LeftMargin>2cm</LeftMargin><RightMargin>2cm</RightMargin></Page></Report>`;
    const r = importRdl(src, { name: 'local.rdlc' });
    expect(r.error).toBeUndefined();
    expect(r.definition.page).toMatchObject({ size: 'A4', orientation: 'portrait' });
    expect(byName(r.definition, 'T').value).toBe('Hello');
    expect(r.definition.sections.pageHeader.items[0].value).toBe('Head');
  });
  it('reads RDL 2010 and says what an RDL 2005 report loses', () => {
    expect(importRdl(rdl(box('x'), { ns: 'http://schemas.microsoft.com/sqlserver/reporting/2010/01/reportdefinition' })).error).toBeUndefined();
    const old = importRdl(rdl(box('x') + '<Table Name="Old"/>', { ns: 'http://schemas.microsoft.com/sqlserver/reporting/2005/01/reportdefinition' }));
    expect(old.warnings.join(' ')).toMatch(/RDL 2005 report.*upgrade/);
    expect(old.stats.dropped).toBe(1);
  });
  it('widens a page that is narrower than the body', () => {
    const r = importRdl(rdl(box('x')).replace('<Width>6in</Width><Page />', '<Width>10in</Width><Page><PageWidth>8.5in</PageWidth><PageHeight>11in</PageHeight></Page>'));
    expect(r.definition.page).toMatchObject({ width: 720 });
    expect(r.warnings.join(' ')).toMatch(/wider than its page/);
  });
});

/* ---------------------------------------------------------------- real reports */

describe('corpus of real SSRS reports', () => {
  const files = fs.readdirSync(CORPUS).filter(f => /\.rdlc?$/i.test(f));
  const readme = fs.readFileSync(path.join(CORPUS, 'README.md'), 'utf8');
  it('has 20 to 40 reports, each listed with its source', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files.length).toBeLessThanOrEqual(40);
    for (const f of files) expect(readme).toContain(f);
  });
  const totals = { items: 0, mapped: 0, approximated: 0, dropped: 0 };
  const kinds = new Map();
  for (const f of files) {
    it(`imports, validates and renders ${f}`, async () => {
      const r = importRdl(fs.readFileSync(path.join(CORPUS, f), 'utf8'), { name: f });
      expect(r.error).toBeUndefined();
      expect(validate(r.definition).errors).toEqual([]);
      const out = await render(r.definition, { fontStore, sources: sampleSources(r.definition), parameters: sampleParams(r.definition) });
      expect(out.pages.length).toBeGreaterThanOrEqual(1);
      for (const k of Object.keys(totals)) totals[k] += r.stats[k];
      for (const w of r.warnings) {
        const k = w.replace(/^[^:]{1,60}: /, '').replace(/"[^"]*"/g, '"…"').replace(/\b(Code|PW_DB_)[\w.]*/g, '$1…').replace(/=[^;,]*/g, '=…').slice(0, 90);
        kinds.set(k, (kinds.get(k) || 0) + 1);
      }
    });
  }
  it('keeps at least 95% of the report items', () => {
    const rate = (totals.mapped + totals.approximated) / totals.items;
    const top = [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `  ${String(n).padStart(3)}  ${k}`).join('\n');
    console.log(`SSRS corpus: ${files.length} reports, ${totals.items} items: ${totals.mapped} mapped, ${totals.approximated} approximated, ${totals.dropped} dropped (${(rate * 100).toFixed(1)}% kept)\nTop notes:\n${top}`);
    expect(totals.items).toBeGreaterThan(500);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });
});

describe('proof report', () => {
  it('reports/imported-ssrs-transcript.pw.json is what the importer makes of the Microsoft sample', () => {
    // regenerate after an importer change: importRdl(<corpus>/rs-Transcript.rdl, { name: 'Imported SSRS transcript' }).definition
    const stored = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'reports', 'imported-ssrs-transcript.pw.json'), 'utf8'));
    expect(importRdl(fs.readFileSync(path.join(CORPUS, 'rs-Transcript.rdl'), 'utf8'), { name: 'Imported SSRS transcript' }).definition).toEqual(stored);
  });
});
