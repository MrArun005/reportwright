// REVIEW-ENGINE A1 / A19: Nothing in operators follows VB / SSRS (the default); nullPropagation: true keeps SQL nulls.
import { describe, it, expect } from 'vitest';
import { evalValue } from '../../src/engine/expr/evaluate.js';
import { render } from '../../src/engine/index.js';
import { importRdl } from '../../src/importers/rdl.js';
import { fontStore, texts, report } from '../helpers.js';

const ctx = (o = {}) => ({ fields: { a: 1, b: null }, params: {}, globals: {}, dataSets: {}, ...o });
const ev = (s, o) => evalValue(s, ctx(o));
const sqlNull = { nullPropagation: true };

describe('Nothing in operators (VB, the default)', () => {
  it('is 0 in arithmetic, "" in concatenation', () => {
    expect(ev('=Fields.a + Fields.b')).toBe(1);
    expect(ev('=Fields.b * 5')).toBe(0);
    expect(ev('=Fields.b - 2')).toBe(-2);
    expect(ev('=Nothing + Nothing')).toBe(0);
    expect(ev('=-Fields.b')).toBe(0);
    expect(ev('="x" + Fields.b')).toBe('x');
    expect(ev('="x" & Fields.b')).toBe('x');
  });
  it('compares as the other side\'s default', () => {
    expect(ev('=Nothing = 0')).toBe(true);
    expect(ev('="" = Nothing')).toBe(true);
    expect(ev('=Fields.b < 1')).toBe(true);
    expect(ev('=Fields.b <> 0')).toBe(false);
    expect(ev('=Nothing = Nothing')).toBe(true);
    expect(ev('=IIF(Fields.b = 0, "zero", "other")')).toBe('zero');
  });
  it('Double division by zero is Infinity / NaN', () => {
    expect(ev('=5 / 0')).toBe(Infinity);
    expect(ev('=0 / 0')).toBeNaN();
  });
  it('nullPropagation: true keeps the SQL-like rule', () => {
    expect(ev('=Fields.a + Fields.b', sqlNull)).toBeNull();
    expect(ev('=Nothing = 0', sqlNull)).toBe(false);
    expect(ev('=Fields.b < 1', sqlNull)).toBe(false);
    expect(ev('=5 / 0', sqlNull)).toBeNull();
    expect(ev('=-Fields.b', sqlNull)).toBeNull();
  });
});

const rows = [{ a: 1, b: null }, { a: 2, b: 5 }, { a: 3, b: 7 }];
const table = (detail, footer) => ({
  type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }],
  detail: [{ height: 14, cells: [{ value: detail }] }], footer: [{ height: 14, cells: [{ value: footer }] }],
});

describe('a table over a row with a null field', () => {
  it('a + b shows 1 and Sum(a + b) is 18, as SSRS', async () => {
    const r = await render(report([table('=Fields.a + Fields.b', '=Sum(Fields.a + Fields.b)')], { data: { rows } }), { fontStore });
    expect(texts(r.pages[0])).toEqual(['1', '7', '10', '18']);
  });
  it('the report setting nullPropagation: true gives a blank and 17', async () => {
    const r = await render(report([table('=Fields.a + Fields.b', '=Sum(Fields.a + Fields.b)')], { data: { rows }, def: { nullPropagation: true } }), { fontStore });
    expect(texts(r.pages[0])).toEqual(['7', '10', '17']);
  });
  it('an imported RDL tablix totals 18', async () => {
    const rdl = `<?xml version="1.0"?><Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition">
<DataSources><DataSource Name="D"><ConnectionProperties><DataProvider>JSON</DataProvider><ConnectString/></ConnectionProperties></DataSource></DataSources>
<DataSets><DataSet Name="Rows"><Query><DataSourceName>D</DataSourceName><CommandText/></Query><Fields><Field Name="a"><DataField>a</DataField></Field><Field Name="b"><DataField>b</DataField></Field></Fields></DataSet></DataSets>
<ReportSections><ReportSection><Body><ReportItems><Tablix Name="T"><TablixBody><TablixColumns><TablixColumn><Width>2in</Width></TablixColumn></TablixColumns><TablixRows>
<TablixRow><Height>0.25in</Height><TablixCells><TablixCell><CellContents><Textbox Name="d"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!a.Value + Fields!b.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell></TablixCells></TablixRow>
<TablixRow><Height>0.25in</Height><TablixCells><TablixCell><CellContents><Textbox Name="t"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Sum(Fields!a.Value + Fields!b.Value)</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell></TablixCells></TablixRow>
</TablixRows></TablixBody><TablixColumnHierarchy><TablixMembers><TablixMember/></TablixMembers></TablixColumnHierarchy>
<TablixRowHierarchy><TablixMembers><TablixMember><Group Name="Details"/></TablixMember><TablixMember/></TablixMembers></TablixRowHierarchy><DataSetName>Rows</DataSetName><Height>0.5in</Height><Width>2in</Width></Tablix></ReportItems><Height>1in</Height></Body><Width>6in</Width>
<Page><PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth></Page></ReportSection></ReportSections></Report>`;
    const { definition: def, warnings } = importRdl(rdl);
    expect(def.nullPropagation).toBeUndefined();
    const r = await render(def, { fontStore, sources: { D: rows } });
    const t = texts(r.pages[0]);
    expect(t.slice(-4)).toEqual(['1', '7', '10', '18']);
  });
});
