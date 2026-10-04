import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { importRdlx, translateExpression, toPt } from '../../src/importers/rdlx.js';
import { validate } from '../../src/engine/schema/validate.js';
import { checkValue } from '../../src/engine/expr/evaluate.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';

const FIX = path.join(import.meta.dirname, '..', 'fixtures', 'rdlx');
const load = (f) => importRdlx(fs.readFileSync(path.join(FIX, f), 'utf8'));
const allText = (out) => out.pages.flatMap(texts);
/** Every item in a definition, nested ones included. */
const walk = (items, out = []) => { for (const it of items || []) { out.push(it); walk(it.items, out); } return out; };
const items = (def) => walk([...def.sections.pageHeader.items, ...def.sections.body.items, ...def.sections.pageFooter.items]);
const byName = (def, name) => items(def).find(i => i.name === name);

describe('units', () => {
  it('turns ActiveReports lengths into points', () => {
    expect(toPt('1in')).toBe(72);
    expect(toPt('2.54cm')).toBe(72);
    expect(toPt('25.4mm')).toBe(72);
    expect(toPt('10pt')).toBe(10);
    expect(toPt('96px')).toBe(72);
    expect(toPt('1pc')).toBe(12);
    expect(toPt(' 0.5IN ')).toBe(36);
    expect(toPt(undefined)).toBe(0);
    expect(toPt('wide', 5)).toBe(5);
  });
});

describe('expressions', () => {
  const cases = [
    ['=Fields!Name.Value', '=Fields.Name'],
    ['=Fields!Name', '=Fields.Name'],
    ['=Fields.Item("product.productName").Value', '=Fields.product_productName'],
    ['=Parameters!Year.Value', '=Parameters.Year'],
    ['=Globals!ExecutionTime', '=Globals.ExecutionTime'],
    ['=Globals!PageNumberInSection', '=Globals.PageNumber'],
    ['="Page " & Globals!PageNumber & " of " & Globals!TotalPages', 'Page {Globals.PageNumber} of {Globals.TotalPages}'],
    ['=Count(Fields!x.Value) & " items"', '{Count(Fields.x)} items'],
    ['=IIF(Fields!Qty.Value > 10, "High", "Low")', '=IIF(Fields.Qty > 10, "High", "Low")'],
    ['=Sum(Fields!Amount.Value, "Sales")', '=Sum(Fields.Amount, "Sales")'],
    ['=Fields!x.Value Is Nothing', '=IsNull(Fields.x)'],
    ['=Fields!x.Value IsNot Nothing', '=not IsNull(Fields.x)'],
    ['=IIF(Fields!a.Value Is Null, "-", Fields!a.Value)', '=IIF(IsNull(Fields.a), "-", Fields.a)'],
    ['=Nothing', '=null'],
    ['=Format(Fields!d.Value, "dd MMM yyyy")', '=Format(Fields.d, "dd MMM yyyy")'],
    ['=Year(CDate(Fields!d.Value)) & ""', '{Year(CDate(Fields.d))}'],
    ['=CStr(Fields!n.Value)', '=CStr(Fields.n)'],
    ['=Fields!a.Value Mod 2 = 0', '=Fields.a % 2 = 0'],
    ['=2 ^ 3', '=Pow(2, 3)'],
    ['=7 \\ 2', '=Fix(ToInt64(7) / ToInt64(2))'], // VB rounds both sides to Long, then truncates
    ['=(Fields!a.Value + 1) * 2', '=(Fields.a + 1) * 2'],
    ['=Not Fields!b.Value And Fields!c.Value OrElse False', '=not Fields.b and Fields.c or false'],
    ['=Fields!Name.Value.ToUpper()', '=Upper(Fields.Name)'],
    ['=Fields!n.Value.ToString("N2")', '=Format(Fields.n, "N2")'],
    ['=Fields!s.Value.Substring(1, 3)', '=Mid(Fields.s, 1 + 1, 3)'],
    ['=FormatCurrency(Fields!x.Value, 0)', '=Format(Fields.x, "C0")'],
    ['=FormatNumber(Fields!x.Value, 2)', '=Format(Fields.x, "N2")'],
    ['=FormatPercent(Fields!x.Value)', '=Format(Fields.x, "P2")'],
    ['=Choose(Fields!i.Value, "a", "b")', '=Switch(Fields.i = 1, "a", Fields.i = 2, "b")'],
    ['=IsNothing(Fields!x.Value)', '=IsNull(Fields.x)'],
    ['=Convert.ToDecimal(Fields!x.Value)', '=CDbl(Fields.x)'],
    ['=Math.Round(Fields!x.Value, 2)', '=Round(Fields.x, 2)'],
    ['=DateAdd(DateInterval.Month, 1, Fields!d.Value)', '=DateAdd("m", 1, Fields.d)'],
    ['=Lookup(Fields!id.Value, Fields!id.Value, Fields!name.Value, "Names")', '=Lookup(Fields.id, Fields.id, Fields.name, "Names")'],
    ['="He said ""hi"""', 'He said "hi"'],
    ['=Fields!Name.Value Like "A*"', '=Left(Fields.Name, 1) = "A"'],
    ['=Now', '=Now()'],
    ['=MonthName(Month(Fields!d.Value), True)', '=MonthName(Month(Fields.d), true)'],
    ['=ToDecimal(Fields!x.Value) * 2', '=CDbl(Fields.x) * 2'],
    ['=$"Total: {Fields!n.Value:N2} ({Fields!c.Value} items)"', 'Total: {Format(Fields.n, "N2")} ({Fields.c} items)'],
    ['=$"{{literal}} " & Fields!x.Value', '{{literal}} {Fields.x}'],
    ['=StDev(Fields!x.Value, "Sales")', '=StDev(Fields.x, "Sales")'],
    ['=Previous(Fields!x.Value)', '=Previous(Fields.x)'],
    ['=WeekdayName(Weekday(Fields!d.Value))', '=WeekdayName(Weekday(Fields.d))'],
    ['=InStrRev(Fields!s.Value, "/")', '=LastIndexOf(Fields.s, "/") + 1'],
    ['=Hour(Fields!d.Value) & ":" & Space(1)', '{Hour(Fields.d)}:{Space(1)}'],
    ['=Math.Log(Fields!x.Value)', '=Log(Fields.x)'],
  ];
  for (const [src, want] of cases) {
    it(`${src} → ${want}`, () => {
      const r = translateExpression(src, { text: true });
      expect(r.value).toBe(want);
      expect(r.ok).toBe(true);
      expect(checkValue(r.value)).toBeNull();
    });
  }
  it('keeps literal text, escaping braces', () => {
    expect(translateExpression('Sales {2026}', { text: true }).value).toBe('Sales {{2026}}');
    expect(translateExpression('Plain', { text: true }).value).toBe('Plain');
    expect(translateExpression(42).value).toBe(42);
  });
  it('maps RunningValue with Nothing to the data region', () => {
    expect(translateExpression('=RunningValue(Fields!x.Value, Sum, Nothing)', { region: 'Table1' }).value).toBe('=RunningValue(Fields.x, "Sum", "Table1")');
    expect(translateExpression('=RowNumber(Nothing)', { region: 'Table1' }).value).toBe('=RowNumber("Table1")');
  });
  it('maps scope names and drops unknown ones with a note', () => {
    const scopes = new Map([['BandedList1_Group', null], ['Sales', 'Sales']]);
    expect(translateExpression('=Sum(Fields!x.Value, "BandedList1_Group")', { scopes }).value).toBe('=Sum(Fields.x)');
    const r = translateExpression('=Sum(Fields!x.Value, "Mystery")', { scopes });
    expect(r.value).toBe('=Sum(Fields.x)');
    expect(r.notes.join(' ')).toMatch(/Mystery/);
  });
  it('notes .Label, which gives the value', () => {
    const r = translateExpression('=Parameters!Region.Label', {});
    expect(r.value).toBe('=Parameters.Region');
    expect(r.notes.join(' ')).toMatch(/Label/);
  });
  it('turns colour names into hex in colour expressions', () => {
    expect(translateExpression('=IIF(Fields!x.Value < 0, "Red", "Transparent")', { lit: 'color' }).value).toBe('=IIF(Fields.x < 0, "#ff0000", "transparent")');
  });
  it('reads fields from the parent row when asked', () => {
    expect(translateExpression('=Fields!dept.Value', { fields: 'Parent' }).value).toBe('=Parent.dept');
  });
  for (const src of ['=ReportItems!TextBox1.Value', '=Code.Greeting()', '=Aggregate(Fields!x.Value)', '=User!UserID', '=InScope("Group1")', '=Fields!x.Value +', '=Globals!RenderFormat.IsInteractive']) {
    it(`keeps ${src} visible as text and says why`, () => {
      const r = translateExpression(src, { text: true });
      expect(r.ok).toBe(false);
      expect(r.notes.length).toBeGreaterThan(0);
      expect(checkValue(r.value)).toBeNull();
      expect(r.value).toBe('=' + JSON.stringify(src));
    });
  }
  it('returns no value for an untranslatable expression outside text', () => {
    const r = translateExpression('=Code.IsVip(Fields!x.Value)', {});
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
  });
});

describe('invoice (older layout: Body, PageHeader, PageFooter)', () => {
  const { definition: def, warnings, stats } = load('invoice.rdlx-json');
  it('is a valid report', () => {
    expect(validate(def).errors).toEqual([]);
    expect(def.$schema).toBe('pagewright/report@1');
    expect(def.name).toBe('Invoice');
  });
  it('maps the page, locale and parameters', () => {
    expect(def.page).toEqual({ size: 'Letter', orientation: 'portrait', margins: [36, 36, 36, 36] });
    expect(def.locale).toBe('en-US');
    expect(def.currency).toBe('USD');
    expect(def.parameters[0]).toEqual({ name: 'InvoiceNo', type: 'number', prompt: 'Invoice number', default: 1001,
      options: [{ value: 1001, label: 'INV-1001' }, { value: 1002, label: 'INV-1002' }] });
    expect(def.parameters[1]).toMatchObject({ name: 'ShowNotes', type: 'boolean' });
    expect(def.parameters[1].required).toBeFalsy();
    expect(warnings.join('\n')).toMatch(/ShowNotes.*hidden/i);
  });
  it('maps inline JSON data, paths, typed and calculated fields, filters', () => {
    expect(def.dataSources).toHaveLength(1);
    expect(def.dataSources[0]).toMatchObject({ name: 'Inline', type: 'json' });
    expect(def.dataSources[0].data.invoices).toHaveLength(2);
    const inv = def.dataSets.find(d => d.name === 'Invoice');
    expect(inv).toMatchObject({ source: 'Inline', path: '$.invoices[*]' });
    expect(inv.fields.find(f => f.name === 'date')).toEqual({ name: 'date', type: 'date' });
    expect(inv.filters).toEqual([{ expr: '=Fields.no', op: '=', value: '=Parameters.InvoiceNo' }]);
    const lines = def.dataSets.find(d => d.name === 'Lines');
    expect(lines.fields.find(f => f.name === 'amount')).toEqual({ name: 'amount', expr: '=Fields.qty * Fields.price' });
  });
  it('maps text boxes with styles, fonts and colours', () => {
    const t = byName(def, 'Title');
    expect(t).toMatchObject({ type: 'textbox', x: 0, y: 0, w: 288, h: 36, value: 'Tax Invoice' });
    expect(t.style).toMatchObject({ fontFamily: 'Inter', fontSize: 20, fontWeight: 'bold', color: '#4682b4' });
    expect(warnings.filter(w => /Arial/.test(w))).toHaveLength(1);
    expect(byName(def, 'Printed').value).toBe('Printed {Format(Globals.ExecutionTime, "dd MMM yyyy")}');
    expect(byName(def, 'BillTo').style).toMatchObject({ fontWeight: '600', padding: [2, 2, 2, 2] });
    expect(byName(def, 'BillTo').canGrow).toBe(true);
    expect(byName(def, 'InvoiceDate').canGrow).toBe(false);
  });
  it('maps the image, line, rectangle, check box and barcode', () => {
    expect(byName(def, 'LogoImage')).toMatchObject({ type: 'image', x: 468, fit: 'contain' });
    expect(byName(def, 'LogoImage').src).toMatch(/^embedded:/); // stored once in images
    expect(def.images[byName(def, 'LogoImage').src.slice(9)]).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(byName(def, 'Rule')).toMatchObject({ type: 'line', x: 0, y: 28.8, w: 540, h: 0, style: { stroke: '#cccccc', strokeWidth: 0.5, strokeDash: 'dashed' } });
    const box = byName(def, 'StatusBox');
    expect(box).toMatchObject({ type: 'container', keepTogether: true, style: { backgroundColor: '#f5f5f5', border: '1 solid #dcdcdc' } });
    expect(box.items.map(i => i.name)).toEqual(['PaidBox', 'InvoiceCode']);
    expect(byName(def, 'PaidBox')).toMatchObject({ type: 'checkbox', value: '=First(Fields.paid, "Invoice")', text: 'Paid', x: 7.2, y: 7.2 });
    expect(byName(def, 'InvoiceCode')).toMatchObject({ type: 'barcode', symbology: 'code128', showText: true, value: 'INV-{First(Fields.no, "Invoice")}' });
  });
  it('maps the table: columns, header, detail, footer with a column span', () => {
    const t = byName(def, 'LineItems');
    expect(t.columns.map(c => c.width)).toEqual([324, 72, 72, 72]);
    expect(t.dataSet).toBe('Lines');
    expect(t.repeatHeader).toBe(true);
    expect(t.header[0].cells.map(c => c.value)).toEqual(['Item', 'Qty', 'Price', 'Amount']);
    expect(t.header[0].cells[0].style).toMatchObject({ fontWeight: 'bold', backgroundColor: '#eef2f7', borderBottom: '1 solid #9aa5b1' });
    expect(t.detail[0].cells.map(c => c.value)).toEqual(['=Fields.item', '=Fields.qty', '=Fields.price', '=Fields.amount']);
    expect(t.footer[0].cells[0]).toMatchObject({ value: 'Total', colSpan: 3 });
    expect(t.footer[0].cells.slice(1, 3)).toEqual([null, null]);
    expect(t.footer[0].cells[3].style.borderTop).toBe('2 double #000000');
  });
  it('puts page numbers in the footer and counts every item', () => {
    expect(def.sections.pageFooter.height).toBe(28.8);
    expect(byName(def, 'PageNo').value).toBe('Page {Globals.PageNumber} of {Globals.TotalPages}');
    expect(stats.items).toBe(21);
    expect(stats.dropped).toBe(0);
    expect(stats.mapped + stats.approximated).toBe(stats.items);
  });
  it('renders', async () => {
    const out = await render(def, { fontStore });
    const t = allText(out);
    expect(t).toEqual(expect.arrayContaining(['Tax Invoice', 'Asha Traders', 'Steel bracket', 'Hinge pack', 'Page 1 of 1', 'Total', '$632.00']));
    expect(t).not.toContain('Copper wire');
    expect(out.warnings).toEqual([]);
  });
});

describe('regional sales (newer layout: ReportSections)', () => {
  const { definition: def, warnings, stats } = load('regional-sales.rdlx-json');
  it('is a valid A4 report in millimetres', () => {
    expect(validate(def).errors).toEqual([]);
    expect(def.page.size).toBe('A4');
    expect(def.page.margins.map(Math.round)).toEqual([34, 43, 34, 43]);
    expect(def.locale).toBe('en-IN');
    expect(def.currency).toBe('INR');
  });
  it('maps a multi-value parameter with a default list and options from a data set', () => {
    expect(def.parameters[0]).toEqual({ name: 'Regions', type: 'string', prompt: 'Regions', multi: true, default: 'North,South,East,West',
      optionsFrom: { dataSet: 'RegionList', value: '=Fields.name', label: '=Fields.name' } });
    expect(def.dataSets.find(d => d.name === 'Sales').filters).toEqual([
      { expr: '=Fields.region', op: 'in', value: '=Parameters.Regions' },
      { expr: '=Fields.amount', op: '>=', value: '=Parameters.MinAmount' }]);
  });
  it('maps the page header background, header and footer', () => {
    const h = def.sections.pageHeader;
    expect(h.height).toBeCloseTo(62.36, 1);
    expect(h.items[0]).toMatchObject({ type: 'shape', x: 0, y: 0, style: { fill: '#f3f6fa' } });
    expect(byName(def, 'Subtitle').value).toBe('Regions: {Join(Parameters.Regions, ", ")}');
    expect(byName(def, 'FooterRule')).toMatchObject({ type: 'line', style: { stroke: '#c0c0c0', strokeWidth: 0.5 } });
    expect(def.sections.pageFooter.printOnFirstPage).toBe(true);
  });
  it('maps the stacked column chart with a category sort by another field', () => {
    const c = byName(def, 'MonthlyChart');
    expect(c).toMatchObject({ type: 'chart', chartType: 'column', dataSet: 'Sales', title: 'Sales by month and region', category: '=Fields.month',
      seriesGroup: '=Fields.region', stacked: true, legend: 'bottom', valueFormat: 'n0', sort: [{ by: '=Fields.monthNo', dir: 'asc' }] });
    expect(c.series).toEqual([{ name: 'amount', value: '=Sum(Fields.amount)' }]);
  });
  it('maps the grouped table: drill-down, document map, sort links, conditional colour', () => {
    const t = byName(def, 'SalesTable');
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0]).toMatchObject({ name: 'RegionGroup', expr: '=Fields.region', sort: 'asc', collapsible: true, initiallyCollapsed: false });
    expect(t.groups[0].header[0].cells[0]).toMatchObject({ value: '=Fields.region', bookmark: '=Fields.region' });
    expect(t.groups[0].header[0].cells[1].colSpan).toBe(2);
    expect(t.groups[0].footer[0].cells[0].value).toBe('Share of total: {Format(Sum(Fields.amount) / Sum(Fields.amount, "Sales"), "P1")}');
    expect(t.header[0].cells[1].sortBy).toBe('=Fields.monthNo');
    expect(t.sort).toEqual([{ by: '=Fields.monthNo', dir: 'asc' }]);
    expect(t.detail[0].cells[4].style.color).toBe('=IIF(Fields.amount >= 10000, "#2e8b57", "#000000")');
  });
  it('maps the pivot tablix to a matrix with totals', () => {
    const m = byName(def, 'QuarterPivot');
    expect(m).toMatchObject({ type: 'matrix', dataSet: 'Sales', corner: 'Region',
      rowGroups: [{ name: 'PivotRegion', expr: '=Fields.region', sort: 'asc', total: 'after' }],
      columnGroups: [{ name: 'QuarterGroup', expr: '=Fields.quarter', sort: 'asc', total: 'after' }],
      values: [{ value: '=Sum(Fields.amount)', format: 'n0' }] });
    expect(m.rowGroups[0].width).toBeCloseTo(113.39, 1);
  });
  it('converts every item', () => {
    expect(stats.dropped).toBe(0);
    expect(stats.mapped + stats.approximated).toBe(stats.items);
    expect(warnings.filter(w => /Segoe UI/.test(w))).toHaveLength(1);
  });
  it('renders with totals that match the data', async () => {
    const out = await render(def, { fontStore });
    const t = allText(out);
    expect(t).toEqual(expect.arrayContaining(['Regional sales, first half', 'Sales by month and region', 'East', 'North', 'Grand total', 'Q1', 'Q2', 'Total']));
    expect(out.warnings).toEqual([]);
    expect(out.bookmarks.map(b => b.label)).toEqual(['East', 'North', 'South', 'West']);
  });
});

describe('staff directory (banded list, list, tablix, chart, subreport, notes)', () => {
  const { definition: def, warnings, stats } = load('staff-directory.rdlx-json');
  const W = warnings.join('\n');
  it('is valid and landscape Letter', () => {
    expect(validate(def).errors).toEqual([]);
    expect(def.page).toEqual({ size: 'Letter', orientation: 'landscape', margins: [36, 54, 36, 54] });
  });
  it('turns a SQL source into a server SQL source and says so', () => {
    expect(def.dataSources.find(s => s.name === 'Warehouse')).toEqual({ name: 'Warehouse', type: 'sql', connection: 'warehouse', query: 'select dept, budget from budgets where year = @Year' });
    expect(W).toMatch(/Warehouse.*SQL.*PW_DB_WAREHOUSE/);
    expect(def.parameters[0]).toMatchObject({ name: 'Year', type: 'number', default: '=Year(Today())' });
  });
  it('turns the banded list into lists: one per group level, filtered by the parent row', () => {
    const d = byName(def, 'Directory');
    expect(d.type).toBe('container');
    const groupList = d.items.find(i => i.type === 'list');
    expect(groupList).toMatchObject({ dataSet: 'People', groupBy: '=Fields.dept', pageBreakBetween: true });
    const detail = groupList.items.find(i => i.type === 'list');
    expect(detail).toMatchObject({ dataSet: 'People', filters: [{ expr: '=Fields.dept', op: '=', value: '=Parent.dept' }] });
    expect(detail.items.map(i => i.name)).toEqual(['PersonName', 'PersonTitle', 'PersonSalary']);
    expect(byName(def, 'DeptTotal').value).toBe('Payroll {Format(Sum(Fields.salary), "n0")}');
    expect(byName(def, 'DeptName').bookmark).toBe('=Fields.dept');
    expect(byName(def, 'PersonSalary').action).toEqual({ type: 'url', url: 'https://hr.example.com/people/{Fields.name}' });
    expect(W).toMatch(/Directory.*repeat/i);
  });
  it('maps a grouped list', () => {
    expect(byName(def, 'TitleList')).toMatchObject({ type: 'list', dataSet: 'People', groupBy: '=Fields.title' });
    expect(byName(def, 'TitleCount').value).toBe('{Fields.title}: {CountRows()}');
  });
  it('turns a row-grouped tablix into a table with groups', () => {
    const t = byName(def, 'Roster');
    expect(t.type).toBe('table');
    expect(t.columns.map(c => c.width)).toEqual([108, 180, 144]);
    expect(t.repeatHeader).toBe(true);
    expect(t.header[0].cells.map(c => c?.value)).toEqual(['Department', 'Name', 'Joined']);
    expect(t.groups).toEqual([expect.objectContaining({ name: 'RosterDept', expr: '=Fields.dept' })]);
    expect(t.detail[0].cells.map(c => c?.value)).toEqual(['=IIF(RowNumber("RosterDept") = 1, Fields.dept, "")', '=Fields.name', '=Fields.joined']);
    expect(t.footer[0].cells.map(c => c?.value)).toEqual(['Headcount', '=CountRows()', undefined]);
  });
  it('maps the classic bar chart with a drill-through on its points', () => {
    expect(byName(def, 'PayChart')).toMatchObject({ type: 'chart', chartType: 'bar', category: '=Fields.dept', series: [{ name: 'Payroll', value: '=Sum(Fields.salary)' }],
      pointAction: { type: 'report', report: 'deptdetail', params: { Dept: '=Fields.dept' } } });
  });
  it('maps the subreport, shape and visibility; notes what it cannot map', () => {
    expect(byName(def, 'Notes')).toMatchObject({ type: 'subreport', report: 'staffnotes', params: { Year: '=Parameters.Year' } });
    expect(W).toMatch(/Notes.*staffnotes/);
    expect(byName(def, 'Badge')).toMatchObject({ type: 'shape', shape: 'ellipse', style: { fill: '#f0e68c', stroke: '#bdb76b' } });
    expect(byName(def, 'Echo').value).toBe('="=ReportItems!DirTitle.Value"');
    expect(W).toMatch(/Echo.*ReportItems/);
    expect(byName(def, 'Custom').hidden).toBe('=Parameters.Year < 2000');
    expect(W).toMatch(/Custom.*Code\./);
    expect(byName(def, 'OfficeMap')).toBeUndefined();
    expect(W).toMatch(/OfficeMap.*"map"/);
    expect(stats.dropped).toBe(1);
    expect(stats.approximated).toBeGreaterThanOrEqual(3);
    expect(stats.items).toBe(stats.mapped + stats.approximated + stats.dropped);
  });
  it('renders the bands in order with group totals', async () => {
    const out = await render(def, { fontStore, sources: { Staff: JSON.parse(def.dataSources[0].data ? JSON.stringify(def.dataSources[0].data) : '[]'), Warehouse: [] } });
    const t = allText(out);
    const flat = t.join('|');
    expect(t).toContain('Staff directory (5 people)');
    expect(flat.indexOf('Credit')).toBeLessThan(flat.indexOf('Meera Rao'));
    expect(flat.indexOf('Meera Rao')).toBeLessThan(flat.indexOf('Payroll 159,000'));
    expect(flat).toContain('ANALYST');
    expect(t).toContain('Total payroll 335,500');
    expect(out.pages.length).toBeGreaterThanOrEqual(2); // page break between departments
  });
});

describe('real-world shapes', () => {
  it('reads embedded JSON whose line breaks are written as \\n, and an RDL 2005 Grouping', () => {
    const r = importRdlx({
      DataSources: [{ Name: 'E', ConnectionProperties: { DataProvider: 'JSONEMBED', ConnectString: 'jsondata=[\\n\\t{"name": "A\\nB", "dept": "X"}\\n]' } }],
      DataSets: [{ Name: 'D', Query: { DataSourceName: 'E', CommandText: 'jpath=$.*' }, Fields: [{ Name: 'name', DataField: 'name' }, { Name: 'dept', DataField: 'dept' }] }],
      Body: { ReportItems: [{ Type: 'Table', Name: 'T', DataSetName: 'D', TableColumns: [{ Width: '2in' }],
        TableGroups: [{ Grouping: { Name: 'ByDept', GroupExpressions: ['=Fields!dept.Value'] }, Header: { TableRows: [{ Height: '0.25in', TableCells: [{ Item: { Type: 'TextBox', Value: '=Fields!dept.Value' } }] }] } }],
        Details: { TableRows: [{ Height: '0.25in', TableCells: [{ Item: { Type: 'TextBox', Value: '=Fields!name.Value' } }] }] } }] },
    });
    expect(r.definition.dataSources[0].data).toEqual([{ name: 'A\nB', dept: 'X' }]);
    expect(r.definition.sections.body.items[0].groups[0]).toMatchObject({ name: 'ByDept', expr: '=Fields.dept' });
    expect(r.warnings).toEqual([]);
  });
  it('says when embedded data is empty', () => {
    const r = importRdlx({ DataSources: [{ Name: 'E', ConnectionProperties: { DataProvider: 'JSON', ConnectString: 'jsondata=' } }], DataSets: [{ Name: 'D', Query: { DataSourceName: 'E' } }], Body: {} });
    expect(r.warnings.join(' ')).toMatch(/E.*no embedded data/);
  });
});

describe('never throws', () => {
  for (const input of [null, undefined, 42, 'not json', '﻿{"Name":"Bom","Body":{"ReportItems":[{"Type":"textbox","Name":"T","Value":"Hi","Width":"1in","Height":"0.25in"}]}}',
    { Body: 5 }, { Body: { ReportItems: [null, 7, { Type: 'textbox' }, { Type: 'table', TableColumns: 'x' }, { Type: 'tablix' }, { Type: 'chart' }, { Type: 'bandedlist' }] } },
    { DataSources: [{}], DataSets: [{ Query: { CommandText: '=(' } }, {}], ReportParameters: [{}, null] }]) {
    it(`imports ${JSON.stringify(input)?.slice(0, 60)}`, () => {
      const r = importRdlx(input);
      expect(validate(r.definition).errors).toEqual([]);
      expect(Array.isArray(r.warnings)).toBe(true);
    });
  }
  it('reads a string with a BOM', () => {
    const r = importRdlx('﻿{"Name":"Bom","Body":{"ReportItems":[{"Type":"textbox","Name":"T","Value":"Hi","Width":"1in","Height":"0.25in"}]}}');
    expect(r.definition.name).toBe('Bom');
    expect(r.stats).toEqual({ items: 1, mapped: 1, approximated: 0, dropped: 0 });
  });
});

/* ---------------------------------------------------------------- real reports (not in the repo: no licence) */

// The MESCIUS samples and any other .rdlx-json files live outside the repo; the test runs only where they exist.
const CORPUS = process.env.PW_RDLX_CORPUS || '/private/tmp/claude-501/-Users-arunmallikarjun-HRMS/d37bac54-8dc7-42c4-aab2-cf27ec600a2a/scratchpad/rdlx';
const corpusDirs = [CORPUS, `${CORPUS}-wide`].filter(d => fs.existsSync(d));

/** Sample rows for every data set, shaped so the data set's path finds them in its source. */
export function sampleSources(def) {
  const out = {};
  const merge = (a, b) => {
    if (Array.isArray(a) && Array.isArray(b)) return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (i in a && i in b ? merge(a[i], b[i]) : i in a ? a[i] : b[i]));
    if (a && b && typeof a === 'object' && typeof b === 'object') { const o = { ...a }; for (const k of Object.keys(b)) o[k] = k in a ? merge(a[k], b[k]) : b[k]; return o; }
    return b && typeof b === 'object' ? b : a && typeof a === 'object' ? a : b ?? a; // nested rows win over a sample scalar
  };
  const tokens = (p) => [...String(p || '$').matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+|\*)\]|\['([^']+)'\]|\["([^"]+)"\]/g)].map(m => m[1] ?? m[3] ?? m[4] ?? (m[2] === '*' ? '*' : Number(m[2])));
  const sample = (f, i) => {
    const n = f.name.toLowerCase();
    if (f.type === 'date' || /date|time/.test(n)) return `2024-0${i + 1}-15`;
    if (f.type === 'boolean' || /^(is|has)[A-Z_]|discontinued/.test(f.name)) return i % 2 === 0;
    if (f.type === 'number' || /(id|key|no|qty|quantity|amount|price|total|count|sales|miles|units|year|month|level|stock|order|discount|freight|salary|value|budget)$/i.test(f.name)) return (i + 1) * 3;
    return `${f.name} ${i + 1}`;
  };
  for (const ds of def.dataSets) {
    const rows = [0, 1, 2].map((i) => {
      const r = {};
      for (const f of ds.fields || []) {
        if (f.expr) continue;
        const path = f.path ? tokens(f.path) : [f.name];
        let o = r;
        path.forEach((k, j) => { if (j === path.length - 1) o[k] = sample(f, i); else o = o[k] ??= {}; });
      }
      return r;
    });
    const t = tokens(ds.path);
    let doc = rows;
    for (let j = t.length - 1; j >= 0; j--) doc = t[j] === '*' ? (j === t.length - 1 ? doc : [doc, doc, doc]) : typeof t[j] === 'number' ? Object.assign([], { [t[j]]: doc }) : { [t[j]]: doc };
    out[ds.source] = merge(out[ds.source], doc);
  }
  for (const s of def.dataSources) out[s.name] ??= [];
  return out;
}

/** A value for every parameter that has no default. */
export function sampleParameters(def) {
  const out = {};
  for (const p of def.parameters) {
    if (p.default != null) continue;
    const v = p.options?.[0]?.value ?? (p.type === 'number' ? 3 : p.type === 'date' ? '2024-01-15' : p.type === 'boolean' ? true : 'x');
    out[p.name] = p.multi ? [v] : v;
  }
  return out;
}

describe.skipIf(!corpusDirs.length)('real ActiveReports reports', () => {
  const files = corpusDirs.flatMap(d => fs.readdirSync(d).filter(f => /\.rdlx-json$/i.test(f)).map(f => path.join(d, f)));
  for (const file of files) {
    it(`imports and renders ${path.basename(file)}`, async () => {
      const { definition: def, stats } = importRdlx(fs.readFileSync(file, 'utf8'), { name: path.basename(file).replace(/\.rdlx-json$/i, '') });
      expect(validate(def).errors).toEqual([]);
      const out = await render(def, { fontStore, sources: sampleSources(def), parameters: sampleParameters(def) });
      expect(out.pages.length).toBeGreaterThanOrEqual(1);
      const rate = stats.items ? (stats.mapped + stats.approximated) / stats.items : 1;
      expect(rate).toBeGreaterThanOrEqual(0.9);
    });
  }
});

describe('proof report', () => {
  it('reports/imported-regional-sales.pw.json is what the importer makes of the fixture', () => {
    // regenerate after an importer change: importRdlx(fixture, { name: 'Imported regional sales' }).definition
    const stored = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'reports', 'imported-regional-sales.pw.json'), 'utf8'));
    expect(importRdlx(fs.readFileSync(path.join(FIX, 'regional-sales.rdlx-json'), 'utf8'), { name: 'Imported regional sales' }).definition).toEqual(stored);
  });
});

describe('text styling (phase 1)', () => {
  const one = (Item, extra = {}) => importRdlx({ Body: { ReportItems: [{ Type: 'textbox', Name: 'T', Value: 'Hi', Width: '2in', Height: '0.25in', ...Item }] }, ...extra });
  it('maps decoration, justify, background image and shrink-to-fit without warnings', () => {
    const r = one({ Style: { TextDecoration: 'Underline', TextAlign: 'Justify', BackgroundImage: { Source: 'External', Value: 'https://example.com/bg.png' } }, ShrinkToFit: 'true' });
    const t = r.definition.sections.body.items[0];
    expect(t.style).toMatchObject({ textDecoration: 'underline', textAlign: 'justify', backgroundImage: 'https://example.com/bg.png' });
    expect(t.shrinkToFit).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/underline|background image|justify/i);
  });
  it('turns ActiveReports angles (counter-clockwise) into Pagewright rotation (clockwise)', () => {
    expect(one({ Angle: '90' }).definition.sections.body.items[0].rotate).toBe(270);
    expect(one({ Angle: '-90' }).definition.sections.body.items[0].rotate).toBe(90);
    expect(one({ Angle: '45' }).definition.sections.body.items[0].rotate).toBe(315);
    expect(one({ Angle: '0' }).definition.sections.body.items[0].rotate).toBeUndefined();
  });
  it('maps LineThrough and MinCondenseRate', () => {
    const t = one({ Style: { TextDecoration: 'LineThrough' }, MinCondenseRate: '80' }).definition.sections.body.items[0];
    expect(t.style.textDecoration).toBe('line-through');
    expect(t.shrinkToFit).toBe(true);
  });
  it('uses an embedded background image from the file', () => {
    const r = one({ Style: { BackgroundImage: { Source: 'Embedded', Value: 'Logo' } } }, { EmbeddedImages: [{ Name: 'Logo', MIMEType: 'image/png', ImageData: 'iVBORw0KGgo=' }] });
    expect(r.definition.sections.body.items[0].style.backgroundImage).toBe('embedded:Logo');
    expect(r.definition.images).toEqual({ Logo: 'data:image/png;base64,iVBORw0KGgo=' });
  });
  it('still warns about database or expression background images', () => {
    const r = one({ Style: { BackgroundImage: { Source: 'Database', Value: '=Fields!Logo.Value' } } });
    expect(r.warnings.join(' ')).toMatch(/background image/);
  });
});

describe('rich text and vertical text (phase 2)', () => {
  const one = (Item) => importRdlx({ Body: { ReportItems: [{ Name: 'F', Width: '3in', Height: '0.5in', ...Item }] } });
  it('FormattedText keeps its HTML; mail-merge fields become escaped {…} parts', () => {
    const r = one({ Type: 'formattedtext', Html: '<b>Hi</b> <%Name%>, {not a field}', MailMergeFields: [{ Name: 'Name', Value: '=Fields!Customer.Value' }] });
    const it = r.definition.sections.body.items[0];
    expect(it).toMatchObject({ type: 'richtext', value: '<b>Hi</b> {Fields.Customer}, {{not a field}}' });
    expect(it.htmlFromData).toBeUndefined();
    expect(r.warnings.join(' ')).not.toMatch(/HTML\) is lost|formatting/);
  });
  it('HTML from an expression keeps working, as htmlFromData, with a warning that names it', () => {
    const r = one({ Type: 'formattedtext', Html: '=Fields!Notes.Value' });
    const it = r.definition.sections.body.items[0];
    expect(it).toMatchObject({ type: 'richtext', value: '=Fields.Notes', htmlFromData: true });
    expect(r.warnings.join(' ')).toMatch(/htmlFromData/);
  });
  it('renders: bold run and the merged field', async () => {
    const r = one({ Type: 'formattedtext', Html: '<p><b>Hi</b> <%Name%></p>', MailMergeFields: [{ Name: 'Name', Value: '="Ann"' }] });
    const m = await render(r.definition, { fontStore });
    expect(m.pages[0].items.filter(i => i.t === 'text').map(i => i.lines[0].text).join('')).toBe('Hi Ann');
  });
  it('WritingMode tb-rl maps to writingMode', () => {
    const r = one({ Type: 'textbox', Value: '縦', Style: { WritingMode: 'tb-rl' } });
    expect(r.definition.sections.body.items[0].style.writingMode).toBe('tb-rl');
    expect(r.warnings.join(' ')).not.toMatch(/vertical/i);
  });
});

/* ---------------------------------------------------------------- Phase 5: charts */

describe('Phase 5 charts', () => {
  const rows = [{ m: 'Jan', amt: 10, q: 2, lo: 5, hi: 12, o: 10, h: 14, l: 8, c: 12, x: 1, size: 4 }, { m: 'Feb', amt: 30, q: 3, lo: 20, hi: 35, o: 12, h: 13, l: 9, c: 10, x: 2, size: 9 }];
  const F = (n) => ({ Field: { Value: [`=Fields!${n}.Value`] } });
  const imp = (chart) => {
    const r = importRdlx({
      DataSources: [{ Name: 'S', ConnectionProperties: { DataProvider: 'JSON', ConnectString: `jsondata=${JSON.stringify({ rows })}` } }],
      DataSets: [{ Name: 'D', Fields: Object.keys(rows[0]).map(k => ({ Name: k, DataField: k })), Query: { DataSourceName: 'S', CommandText: 'jpath=$.rows.*' } }],
      Body: { ReportItems: [{ Type: 'dvchart', Name: 'Ch', DataSetName: 'D', Width: '6in', Height: '3in', ...chart }] },
    });
    return { c: byName(r.definition, 'Ch'), warnings: r.warnings, def: r.definition };
  };
  const plot = (type, enc, extra = {}) => ({ PlotName: 'P1', PlotChartType: type, Encodings: { Category: F('m'), ...enc }, ...extra });

  it('100% stacked, spline and step lines', () => {
    const a = imp({ Plots: [plot('Column', { Values: [{ ...F('amt'), Aggregate: 'Sum' }] }, { PlotChartSubtype: 'PercentStacked' })] });
    expect(a.c.stacked).toBe('percent');
    expect(a.warnings.join()).not.toMatch(/100%/);
    expect(imp({ Plots: [plot('Line', { Values: [F('amt')] }, { Config: { LineAspect: 'Spline' } })] }).c.line).toBe('smooth');
    const st = imp({ Plots: [plot('Line', { Values: [F('amt')] }, { Config: { LineAspect: 'StepLeft' } })] });
    expect(st.c.line).toBe('step');
    expect(st.warnings.join()).toMatch(/step/i);
  });
  it('range plots: two values become low and high', () => {
    const { c } = imp({ Plots: [plot('Area', { Values: [{ Field: { Value: ['=Fields!lo.Value', '=Fields!hi.Value'] }, Aggregate: 'Sum' }] })] });
    expect(c.series[0]).toMatchObject({ low: '=Sum(Fields.lo)', high: '=Sum(Fields.hi)' });
    expect(c.series[0].value).toBeUndefined();
  });
  it('axes: min, max, log, reversed, label angle, grid lines, titles', () => {
    const { c } = imp({ Plots: [plot('Column', { Values: [F('amt')] })], PlotArea: { Axes: [
      { AxisType: 'X', LabelAngle: -45, Reversed: true, MajorGrid: true, Title: 'Month' },
      { AxisType: 'Y', Min: 0, Max: 100, Scale: 'Logarithmic', Title: 'Amount', MajorGrid: false, Format: 'n0' }] } });
    expect(c.axes).toEqual({ x: { labelAngle: -45, reversed: true, gridlines: true, title: 'Month' }, y: { min: 0, max: 100, log: true, title: 'Amount', gridlines: false } });
    expect(c.valueFormat).toBe('n0');
  });
  it('a second plot on a second Y axis becomes a combo series', () => {
    const { c, warnings } = imp({
      Plots: [plot('Column', { Values: [F('amt')] }), { ...plot('Line', { Values: [F('q')] }), PlotName: 'P2' }],
      PlotArea: { Axes: [{ AxisType: 'X' }, { AxisType: 'Y', Plots: ['P1'] }, { AxisType: 'Y', Plots: ['P2'], Format: 'n1' }] },
    });
    expect(c.chartType).toBe('column');
    expect(c.series).toHaveLength(2);
    expect(c.series[1]).toMatchObject({ type: 'line', axis: 'secondary' });
    expect(c.axes.y2).toEqual({ format: 'n1' });
    expect(warnings.join()).not.toMatch(/only its first plot/);
  });
  it('bubble, radar, polar, candlestick, OHLC, funnel and gauge', () => {
    const bubble = imp({ Plots: [{ PlotName: 'P', PlotChartType: 'Bubble', Encodings: { Values: [{ Field: { Value: ['=Fields!amt.Value', '=Fields!size.Value'] } }], Category: F('x') } }] }).c;
    expect(bubble).toMatchObject({ chartType: 'bubble', xValue: '=Fields.x' });
    expect(bubble.series[0].size).toMatch(/Fields\.size/);
    expect(imp({ Plots: [plot('Line', { Values: [F('amt')] }, { Config: { AxisMode: 'Polygonal' } })] }).c.chartType).toBe('radar');
    expect(imp({ Plots: [plot('Area', { Values: [F('amt')] }, { Config: { AxisMode: 'Radial' } })] }).c.chartType).toBe('radar');
    expect(imp({ Plots: [{ PlotName: 'P', PlotChartType: 'Scatter', Encodings: { Values: [F('amt')], Category: F('x') }, Config: { AxisMode: 'Radial' } }] }).c.chartType).toBe('polar');
    const candle = imp({ Plots: [plot('Candlestick', { Values: [{ Field: { Value: ['=Fields!h.Value', '=Fields!l.Value', '=Fields!o.Value', '=Fields!c.Value'] } }] })] }).c;
    expect(candle.chartType).toBe('candlestick');
    expect(candle.series[0]).toMatchObject({ high: '=Sum(Fields.h)', low: '=Sum(Fields.l)', open: '=Sum(Fields.o)', close: '=Sum(Fields.c)' });
    expect(imp({ Plots: [plot('HighLowOpenClose', { Values: [{ Field: { Value: ['=Fields!h.Value', '=Fields!l.Value', '=Fields!o.Value', '=Fields!c.Value'] } }] })] }).c.chartType).toBe('ohlc');
    const hlc = imp({ Plots: [plot('HighLowClose', { Values: [{ Field: { Value: ['=Fields!h.Value', '=Fields!l.Value', '=Fields!c.Value'] } }] })] }).c;
    expect(hlc).toMatchObject({ chartType: 'ohlc' });
    expect(hlc.series[0].open).toBeUndefined();
    expect(imp({ Plots: [plot('Funnel', { Values: [F('amt')] })] }).c.chartType).toBe('funnel');
    const pyr = imp({ Plots: [plot('Pyramid', { Values: [F('amt')] })] });
    expect(pyr.c.chartType).toBe('funnel');
    expect(pyr.warnings.join()).toMatch(/pyramid/i);
    expect(imp({ Plots: [plot('Gauge', { Values: [F('amt')] })] }).c.chartType).toBe('gauge');
  });
  it('palettes, overlays and label positions', () => {
    const { c, warnings } = imp({ Palette: 'Office', Plots: [plot('Line', { Values: [F('amt')] }, { Config: {
      Text: { Template: '{value}', TextPosition: 'Inside' },
      Overlays: [{ Type: 'LinearTrendline' }, { Type: 'MovingAverageTrendline', Period: 3 }, { Type: 'PolynomialTrendline', Order: 3 }, { Type: 'ExponentialTrendline' }, { Type: 'ReferenceLine', Value: 20, LegendLabel: 'Goal' }, { Type: 'ReferenceBand', Start: 5, End: 15 }, { Type: 'PowerTrendline' }] } })] });
    expect(c.palette).toBe('office');
    expect(c.labelPosition).toBe('inside');
    expect(c.showValues).toBe(true);
    expect(c.overlays).toEqual([{ type: 'trend' }, { type: 'movingAverage', period: 3 }, { type: 'trend', kind: 'poly', order: 3 }, { type: 'trend', kind: 'exp' }, { type: 'line', value: 20, label: 'Goal' }, { type: 'band', from: 5, to: 15 }, { type: 'trend' }]);
    expect(warnings.join()).toMatch(/power trend line is drawn as a linear one/i);
    expect(imp({ Palette: 'Cerulean', Plots: [plot('Column', { Values: [F('amt')] })] }).c.palette).toBe('ocean');
  });
  it('the imported charts render with no warnings', async () => {
    for (const chart of [
      { Plots: [plot('Candlestick', { Values: [{ Field: { Value: ['=Fields!h.Value', '=Fields!l.Value', '=Fields!o.Value', '=Fields!c.Value'] } }] })] },
      { Plots: [plot('Column', { Values: [F('amt')] }), { ...plot('Line', { Values: [F('q')] }), PlotName: 'P2' }], PlotArea: { Axes: [{ AxisType: 'X' }, { AxisType: 'Y', Plots: ['P1'] }, { AxisType: 'Y', Plots: ['P2'] }] } },
    ]) {
      const { def } = imp(chart);
      expect(validate(def).errors).toEqual([]);
      const out = await render(def, { fontStore });
      expect(out.warnings).toEqual([]);
    }
  });
});

describe('phase 4: nested tablix, recursive groups, row spans, sections', () => {
  const tb = (name, Value, extra = {}) => ({ Item: { Type: 'textbox', Name: name, Value, ...extra } });
  const ds = { DataSources: [{ Name: 'S', ConnectionProperties: { DataProvider: 'JSON', ConnectString: 'jsondata=[]' } }],
    DataSets: [{ Name: 'Sales', Query: { DataSourceName: 'S', CommandText: '$.[*]' }, Fields: ['region', 'city', 'year', 'amount', 'id', 'boss'].map(n => ({ Name: n, DataField: n })) }] };
  const nested = {
    Type: 'tablix', Name: 'Pivot', DataSetName: 'Sales', Width: '6in', Height: '1in',
    Corner: [[tb('C1', 'Sales')]],
    RowHierarchy: { LevelSizes: ['1in', '1in'], Members: [
      { Header: tb('HRegion', '=Fields!region.Value'), Group: { Name: 'Region', GroupExpressions: ['=Fields!region.Value'] }, SortExpressions: [{ Value: '=Fields!region.Value' }],
        Children: [
          { Header: tb('HCity', '=Fields!city.Value'), Group: { Name: 'City', GroupExpressions: ['=Fields!city.Value'] }, Visibility: { Hidden: true, ToggleItem: 'HRegion' } },
          { Header: tb('HCityTotal', 'Subtotal') },
        ] },
      { Header: tb('HTotal', 'Total') },
    ] },
    ColumnHierarchy: { LevelSizes: ['0.25in'], Members: [
      { Header: tb('HYear', '=Fields!year.Value'), Group: { Name: 'Year', GroupExpressions: ['=Fields!year.Value'] } },
      { Header: tb('HYearTotal', 'Total') },
    ] },
    Body: { Columns: ['0.8in', '0.8in'], Rows: [
      { Height: '0.25in', Cells: [tb('V', '=Sum(Fields!amount.Value)', { Style: { Format: 'n0' } }), tb('V2', '=Sum(Fields!amount.Value)')] },
      { Height: '0.25in', Cells: [tb('V3', '=Sum(Fields!amount.Value)'), tb('V4', '=Sum(Fields!amount.Value)')] },
      { Height: '0.25in', Cells: [tb('V5', '=Sum(Fields!amount.Value)'), tb('V6', '=Sum(Fields!amount.Value)')] },
    ] },
  };
  const rep = (items, extra = {}) => importRdlx({ Name: 'R', ...ds, Page: { PageWidth: '8.5in', PageHeight: '11in' }, Body: { ReportItems: items, Height: '3in' }, ...extra });
  it('a tablix with nested row groups becomes the array form with totals and drill-down', () => {
    const r = rep([nested]);
    const m = byName(r.definition, 'Pivot');
    expect(m.rowGroups).toEqual([
      { expr: '=Fields.region', name: 'Region', sort: 'asc', total: 'after', width: 72, collapsible: true, initiallyCollapsed: true },
      { expr: '=Fields.city', name: 'City', total: 'after', totalLabel: 'Subtotal', width: 72 },
    ]);
    expect(m.columnGroups).toEqual([{ expr: '=Fields.year', name: 'Year', total: 'after' }]);
    expect(m.values).toEqual([{ value: '=Sum(Fields.amount)', format: 'n0' }]);
    expect(m.corner).toBe('Sales');
    expect(validate(r.definition).errors).toEqual([]);
    expect(r.stats.dropped).toBe(0);
  });
  it('a recursive group, Level() and Recursive aggregates; row spans; reset page numbers', () => {
    const t = {
      Type: 'tablix', Name: 'Org', DataSetName: 'Sales', Width: '4in', Height: '0.5in',
      RowHierarchy: { Members: [{ Group: { Name: 'Emp', GroupExpressions: ['=Fields!id.Value'], Parent: '=Fields!boss.Value', PageBreak: { BreakLocation: 'Between', ResetPageNumber: true } } }] },
      ColumnHierarchy: { Members: [{}, {}] },
      Body: { Columns: ['2in', '2in'], Rows: [{ Height: '0.25in', Cells: [tb('N', '=Level()'), tb('S', '=Sum(Fields!amount.Value, "Emp", Recursive)')] }] },
    };
    const r = rep([t]);
    const g = byName(r.definition, 'Org').groups[0];
    expect(g).toMatchObject({ name: 'Emp', expr: '=Fields.id', parent: '=Fields.boss', newSection: true });
    expect(g.pageBreak).toBeUndefined();
    expect(JSON.stringify(byName(r.definition, 'Org'))).toContain('Sum(Fields.amount, \\"Emp\\", \\"Recursive\\")');
    expect(JSON.stringify(byName(r.definition, 'Org'))).toContain('=Level()');
    const sp = translateExpression('=Level("Emp")', { scopes: new Map([['Emp', 'Emp']]) });
    expect(sp.value).toBe('=Level("Emp")');
  });
  it('several report sections become body sections, each with its own page', () => {
    const r = importRdlx({ Name: 'R', ...ds, ReportSections: [
      { Name: 'Cover', Page: { PageWidth: '8.5in', PageHeight: '11in' }, Body: { Height: '1in', ReportItems: [{ Type: 'textbox', Name: 'T1', Value: 'Cover', Width: '2in', Height: '0.3in' }] } },
      { Name: 'Wide', Page: { PageWidth: '11in', PageHeight: '8.5in' }, Body: { Height: '1in', ReportItems: [{ Type: 'textbox', Name: 'T2', Value: 'Wide', Width: '2in', Height: '0.3in' }] } },
    ] });
    const b = r.definition.sections.body;
    expect(Array.isArray(b)).toBe(true);
    expect(b.map(s => s.name)).toEqual(['Cover', 'Wide']);
    expect(b[1].page).toMatchObject({ size: 'Letter', orientation: 'landscape' });
    expect(validate(r.definition).errors).toEqual([]);
  });
});
