// @ts-check
/** A blank A4 report: header with title, empty body, footer with page numbers. */
export function blankReport(name = 'Untitled report') {
  const W = 523.28;
  return {
    $schema: 'pagewright/report@1',
    name,
    page: { size: 'A4', orientation: 'portrait', margins: [36, 36, 36, 36] },
    parameters: [],
    dataSources: [],
    dataSets: [],
    styles: { base: { fontFamily: 'Inter', fontSize: 9, color: '#1f2937' } },
    sections: {
      pageHeader: { height: 36, items: [
        { id: 'h1', type: 'textbox', name: 'ReportTitle', x: 0, y: 0, w: 320, h: 22, value: name, canGrow: true, style: { fontSize: 14, fontWeight: 'bold' } },
      ] },
      body: { height: 420, items: [] },
      pageFooter: { height: 24, items: [
        { id: 'f1', type: 'textbox', name: 'PageNumber', x: W - 200, y: 6, w: 200, h: 12, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}', canGrow: false, style: { fontSize: 7.5, color: '#6b7280', textAlign: 'right' } },
      ] },
    },
  };
}

/**
 * A pageless dashboard: number tiles, two charts and a table on one page that grows to fit.
 * The inline sample rows are there so the dashboard shows something at once; replace the data source.
 */
export function blankDashboard(name = 'Dashboard') {
  const W = 912; // 960 wide, 24 margins
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const rows = months.flatMap((m, i) => ['North', 'South', 'East', 'West'].map((region, j) => ({ month: i + 1, monthName: m, region, sales: 40 + ((i * 7 + j * 13) % 30), orders: 10 + ((i * 3 + j * 5) % 9) })));
  const tile = (n, label, value, x) => [
    { type: 'textbox', name: `${n}Label`, x, y: 40, w: 216, h: 14, value: label, style: { fontSize: 8, color: '#6b7280' } },
    { type: 'textbox', name: n, x, y: 54, w: 216, h: 30, value, style: { fontSize: 20, fontWeight: 'bold' } },
  ];
  return {
    $schema: 'pagewright/report@1',
    name,
    page: { size: 'Pageless', width: 960, margins: [24, 24, 24, 24], minHeight: 540 },
    parameters: [],
    dataSources: [{ name: 'sample', type: 'json', data: { rows } }],
    dataSets: [{ name: 'Sales', source: 'sample', path: '$.rows' }],
    styles: { base: { fontFamily: 'Inter', fontSize: 9, color: '#1f2937' } },
    sections: {
      pageHeader: { height: 0, items: [] },
      body: { height: 600, items: [
        { type: 'textbox', name: 'Title', x: 0, y: 0, w: 600, h: 26, value: name, style: { fontSize: 18, fontWeight: 'bold' } },
        ...tile('Total', 'Total sales', '=Format(Sum(Fields.sales, "Sales"), "N0")', 0),
        ...tile('Orders', 'Orders', '=Format(Sum(Fields.orders, "Sales"), "N0")', 232),
        ...tile('Average', 'Average sale per order', '=Format(Sum(Fields.sales, "Sales") / Sum(Fields.orders, "Sales"), "N1")', 464),
        ...tile('Regions', 'Regions', '=CountDistinct(Fields.region, "Sales")', 696),
        { type: 'chart', name: 'ByMonth', x: 0, y: 100, w: 600, h: 240, chartType: 'column', dataSet: 'Sales', title: 'Sales by month', category: '=Fields.monthName', series: [{ name: 'Sales', value: '=Sum(Fields.sales)' }], seriesGroup: '=Fields.region', stacked: true, legend: 'bottom', valueFormat: 'N0' },
        { type: 'chart', name: 'ByRegion', x: 616, y: 100, w: W - 616, h: 240, chartType: 'donut', dataSet: 'Sales', title: 'Share by region', category: '=Fields.region', series: [{ name: 'Sales', value: '=Sum(Fields.sales)' }], legend: 'bottom', valueFormat: 'N0' },
        { type: 'matrix', name: 'Pivot', x: 0, y: 356, w: W, h: 60, dataSet: 'Sales', rowGroup: '=Fields.region', columnGroup: '=Fields.monthName', value: '=Sum(Fields.sales)', valueFormat: 'N0', corner: 'Region', columnSort: 'none' },
      ] },
      pageFooter: { height: 0, items: [] },
    },
  };
}
