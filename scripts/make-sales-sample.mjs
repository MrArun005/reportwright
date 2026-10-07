// Writes reports/sales-by-region.pw.json — groups, subtotals, cascading multi-value parameters, drill-down, document map.
import fs from 'node:fs';
const W = 523.28, ACC = '#1d4ed8', MUTED = '#6b7280';
const tb = (name, x, y, w, h, value, style = {}, extra = {}) => ({ type: 'textbox', name, x, y, w, h, value, canGrow: true, style, ...extra });
const num = (fmt = 'N0') => ({ textAlign: 'right', format: fmt });
const def = {
  $schema: 'pagewright/report@1', name: 'Sales by region', locale: 'en-IN', currency: 'INR',
  page: { size: 'A4', orientation: 'portrait', margins: [36, 36, 30, 36] },
  parameters: [
    { name: 'year', type: 'number', prompt: 'Year', required: true, default: 2026, options: [{ value: 2025, label: '2025' }, { value: 2026, label: '2026' }] },
    { name: 'regions', type: 'string', prompt: 'Regions', multi: true, optionsFrom: { dataSet: 'Regions', value: '=Fields.name' } },
  ],
  dataSources: [{ name: 'sales', type: 'rest', method: 'GET', url: '/api/sample/sales/{Parameters.year}' }],
  dataSets: [
    { name: 'Regions', source: 'sales', path: '$.regions', fields: [{ name: 'name', type: 'string' }, { name: 'cities', type: 'number' }] },
    { name: 'Sales', source: 'sales', path: '$.rows', fields: [
      { name: 'year', type: 'number' }, { name: 'month', type: 'number' }, { name: 'region', type: 'string' }, { name: 'city', type: 'string' },
      { name: 'product', type: 'string' }, { name: 'loans', type: 'number' }, { name: 'disbursed', type: 'number' }, { name: 'npa', type: 'number' },
      { name: 'crore', type: 'number', expr: '=Fields.disbursed / 10000000' }],
      filters: [{ expr: '=Fields.region', op: 'in', value: '=Parameters.regions' }],
    },
  ],
  styles: { base: { fontFamily: 'Inter', fontSize: 8.5, color: '#111827' } },
  sections: {
    pageHeader: { height: 34, items: [
      tb('Brand', 0, 0, 300, 16, 'ReportWright Finance · Sales', { fontSize: 11, fontWeight: 'bold', color: ACC }),
      tb('Year', W - 200, 2, 200, 12, 'Financial year {Parameters.year}', { fontSize: 8, color: MUTED, textAlign: 'right' }),
      { type: 'line', name: 'Rule', x: 0, y: 24, w: W, h: 0, style: { stroke: '#d1d5db', strokeWidth: 0.75 } },
    ] },
    body: { height: 200, items: [
      tb('Title', 0, 0, 400, 24, 'Disbursements by region', { fontSize: 16, fontWeight: 'bold' }),
      tb('Sub', 0, 25, 520, 14, "Regions: {IIF(Len(Join(Parameters.regions, ', ')) = 0, 'all', Join(Parameters.regions, ', '))} · amounts in ₹ crore · click ▶ to open a city", { fontSize: 8, color: MUTED }),
      {
        type: 'table', name: 'Breakdown', x: 0, y: 50, w: W, h: 90, dataSet: 'Sales', repeatHeader: true,
        columns: [170, 90, 80, 90, 93.28].map(width => ({ width })),
        style: { padding: [3, 5, 3, 5] },
        header: [{ height: 18, style: { fontWeight: 'bold', color: '#fff', backgroundColor: ACC, verticalAlign: 'middle' }, cells: [
          { value: 'Region / city / product', sortBy: '=Fields.region' }, { value: 'Loans', style: { textAlign: 'right' }, sortBy: '=Fields.loans' },
          { value: 'NPA %', style: { textAlign: 'right' } }, { value: '₹ crore', style: { textAlign: 'right' }, sortBy: '=Fields.disbursed' }, { value: 'Share', style: { textAlign: 'right' } }] }],
        groups: [
          { name: 'Region', expr: '=Fields.region', sort: 'asc', keepTogether: false, pageBreak: '',
            header: [{ height: 20, style: { fontWeight: 'bold', fontSize: 10, backgroundColor: '#eff6ff', borderTop: `1 solid ${ACC}` }, cells: [
              { value: '=Fields.region', bookmark: '=Fields.region' }, { value: '=Sum(Fields.loans)', style: num() }, { value: '=Avg(Fields.npa)', style: num('N2') },
              { value: '=Sum(Fields.crore)', style: num('N1') }, { value: '=Sum(Fields.disbursed) / Sum(Fields.disbursed, "Breakdown")', style: num('P1') }] }],
            footer: [] },
          { name: 'City', expr: '=Fields.city', sort: 'asc', collapsible: true, initiallyCollapsed: true,
            header: [{ height: 17, style: { fontWeight: '600', borderBottom: '0.5 solid #e5e7eb' }, cells: [
              { value: '=Fields.city', style: { padding: [3, 5, 3, 14] } }, { value: '=Sum(Fields.loans)', style: num() }, { value: '=Avg(Fields.npa)', style: { ...num('N2'), color: "=IIF(Avg(Fields.npa) > 2.2, '#b91c1c', '#111827')" } },
              { value: '=Sum(Fields.crore)', style: num('N1') }, { value: '=Sum(Fields.disbursed) / Sum(Fields.disbursed, "Region")', style: num('P1') }] }],
            footer: [] },
          { name: 'Product', expr: '=Fields.product', sort: 'asc',
            header: [{ height: 15, style: { color: '#374151', borderBottom: '0.5 solid #f3f4f6' }, cells: [
              { value: '=Fields.product', style: { padding: [3, 5, 3, 26] } }, { value: '=Sum(Fields.loans)', style: num() }, { value: '=Avg(Fields.npa)', style: num('N2') },
              { value: '=Sum(Fields.crore)', style: num('N2') }, { value: '=Sum(Fields.disbursed) / Sum(Fields.disbursed, "City")', style: num('P1') }] }],
            footer: [] },
        ],
        detail: [],
        footer: [{ height: 22, style: { fontWeight: 'bold', fontSize: 10, borderTop: `1.5 solid ${ACC}`, verticalAlign: 'middle' }, cells: [
          { value: 'All regions' }, { value: '=Sum(Fields.loans)', style: num() }, { value: '=Avg(Fields.npa)', style: num('N2') }, { value: '=Sum(Fields.crore)', style: num('N1') }, { value: '100.0%', style: { textAlign: 'right' } }] }],
      },
    ] },
    pageFooter: { height: 22, items: [
      tb('Gen', 0, 6, 300, 12, "Generated {Format(Globals.ExecutionTime, 'dd MMM yyyy, hh:mm tt')}", { fontSize: 7, color: MUTED }),
      tb('Pg', W - 200, 6, 200, 12, 'Page {Globals.PageNumber} of {Globals.TotalPages}', { fontSize: 7, color: MUTED, textAlign: 'right' }),
    ] },
  },
};
fs.writeFileSync(new URL('../reports/sales-by-region.pw.json', import.meta.url), JSON.stringify(def, null, 2));
console.log('wrote reports/sales-by-region.pw.json');
