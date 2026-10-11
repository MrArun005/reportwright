// Writes reports/sales-dashboard.pw.json — charts, matrix, sparklines, data bars, barcode and QR.
import fs from 'node:fs';
const W = 523.28, MUTED = '#6b7280';
const tb = (name, x, y, w, h, value, style = {}, extra = {}) => ({ type: 'textbox', name, x, y, w, h, value, canGrow: true, style, ...extra });
const half = (W - 12) / 2;
const def = {
  $schema: 'reportwright/report@1', name: 'Sales dashboard', locale: 'en-IN', currency: 'INR',
  page: { size: 'A4', orientation: 'portrait', margins: [32, 32, 28, 32] },
  parameters: [{ name: 'year', type: 'number', prompt: 'Year', required: true, default: 2026, options: [{ value: 2025, label: '2025' }, { value: 2026, label: '2026' }] }],
  dataSources: [{ name: 'sales', type: 'rest', method: 'GET', url: '/api/sample/sales/{Parameters.year}' }],
  dataSets: [{ name: 'Sales', source: 'sales', path: '$.rows', fields: [
    { name: 'month', type: 'number' }, { name: 'region', type: 'string' }, { name: 'city', type: 'string' }, { name: 'product', type: 'string' },
    { name: 'loans', type: 'number' }, { name: 'disbursed', type: 'number' }, { name: 'npa', type: 'number' },
    { name: 'crore', type: 'number', expr: '=Fields.disbursed / 10000000' },
    { name: 'monthName', type: 'string', expr: '=MonthName(Fields.month, True)' }] }],
  styles: { base: { fontFamily: 'Inter', fontSize: 8.5, color: '#111827' } },
  sections: {
    pageHeader: { height: 0, items: [] },
    body: { height: 760, items: [
      tb('Title', 0, 0, 360, 26, 'Sales dashboard {Parameters.year}', { fontSize: 18, fontWeight: 'bold' }),
      tb('Sub', 0, 27, 360, 14, 'Disbursements across 4 regions, 12 cities and 3 products. Amounts in ₹ crore.', { fontSize: 8, color: MUTED }),
      { type: 'barcode', name: 'QR', x: W - 52, y: 0, w: 52, h: 52, symbology: 'qrcode', value: 'https://example.com/reports/sales-dashboard?year={Parameters.year}' },
      { type: 'chart', name: 'ByMonth', x: 0, y: 60, w: W, h: 200, chartType: 'column', dataSet: 'Sales', title: 'Disbursed by month and region', category: '=Fields.monthName',
        series: [{ name: 'Disbursed', value: '=Sum(Fields.crore)' }], seriesGroup: '=Fields.region', stacked: true, valueFormat: 'N0' },
      { type: 'chart', name: 'ByProduct', x: 0, y: 272, w: half, h: 180, chartType: 'donut', dataSet: 'Sales', title: 'Share by product', category: '=Fields.product', series: [{ name: 'Disbursed', value: '=Sum(Fields.crore)' }], valueFormat: 'N0' },
      { type: 'chart', name: 'Npa', x: half + 12, y: 272, w: half, h: 180, chartType: 'line', dataSet: 'Sales', title: 'Average NPA % by month', category: '=Fields.monthName',
        series: [{ name: 'NPA %', value: '=Avg(Fields.npa)' }], valueFormat: 'N1' },
      tb('MatrixTitle', 0, 466, 300, 16, 'Region × product (₹ crore)', { fontSize: 10, fontWeight: 'bold' }),
      { type: 'matrix', name: 'Pivot', x: 0, y: 484, w: W, h: 54, dataSet: 'Sales', rowGroup: '=Fields.region', columnGroup: '=Fields.product', value: '=Sum(Fields.crore)', valueFormat: 'N1', corner: 'Region', rowHeaderWidth: 140, columnWidth: 95 },
      tb('CityTitle', 0, 560, 300, 16, 'Cities: monthly trend', { fontSize: 10, fontWeight: 'bold' }),
      { type: 'table', name: 'Cities', x: 0, y: 578, w: W, h: 36, dataSet: 'Sales', repeatHeader: true, columns: [130, 140, 160, 93.28].map(width => ({ width })),
        style: { padding: [3, 4, 3, 4] },
        header: [{ height: 18, style: { fontWeight: 'bold', backgroundColor: '#f1f5f9', borderBottom: '1 solid #94a3b8' }, cells: [{ value: 'City' }, { value: 'Trend (12 months)' }, { value: 'Disbursed' }, { value: 'NPA vs 2.5% cap', style: { textAlign: 'right' } }] }],
        groups: [{ name: 'City', expr: '=Fields.city', sort: 'asc', header: [{ height: 18, style: { borderBottom: '0.5 solid #e5e7eb' }, cells: [
          { value: '{Fields.city} · {Fields.region}' },
          { value: '', visual: { type: 'sparkline', category: '=Fields.month', value: '=Sum(Fields.crore)', color: '#2563eb' } },
          { value: '', visual: { type: 'databar', value: '=Sum(Fields.crore)', max: '=Max(Fields.crore, "Sales") * 36', format: 'N1', color: '#10b981' } },
          { value: '', visual: { type: 'bullet', value: '=Avg(Fields.npa)', target: 2.5, max: 4, color: "=IIF(Avg(Fields.npa) > 2.5, '#ef4444', '#64748b')" } },
        ] }], footer: [] }],
        detail: [] },
    ] },
    pageFooter: { height: 18, items: [
      tb('Pg', W - 200, 4, 200, 12, 'Page {Globals.PageNumber} of {Globals.TotalPages}', { fontSize: 7, color: MUTED, textAlign: 'right' }),
      tb('Gen', 0, 4, 300, 12, "Generated {Format(Globals.ExecutionTime, 'dd MMM yyyy')}", { fontSize: 7, color: MUTED }),
    ] },
  },
};
fs.writeFileSync(new URL('../reports/sales-dashboard.pw.json', import.meta.url), JSON.stringify(def, null, 2));
console.log('wrote reports/sales-dashboard.pw.json');
