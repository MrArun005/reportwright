// Native, editable Excel charts: chart parts bound to the exported data (src/exporters/xlsxchart.js).
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { render } from '../../src/engine/index.js';
import { exportXlsx } from '../../src/exporters/xlsx.js';
import { fontStore, report } from '../helpers.js';

const rows = [{ m: 'Jan', a: 10, b: 0.5, x: 1, y: 2 }, { m: 'Feb', a: 20, b: 0.7, x: 2, y: 5 }, { m: 'Mar', a: 15, b: 0.4, x: 3, y: 4 }];
const chart = (name, y, extra) => ({ type: 'chart', name, x: 0, y, w: 300, h: 160, dataSet: 'Rows', category: '=Fields.m', ...extra });
export const chartsReport = () => report([
  chart('Combo', 0, { chartType: 'column', title: 'Sales and margin', series: [{ name: 'Sales', value: '=Sum(Fields.a)' }, { name: 'Margin', value: '=Sum(Fields.b)', type: 'line', axis: 'secondary' }] }),
  chart('Share', 170, { chartType: 'pie', title: 'Share', series: [{ name: 'Sales', value: '=Sum(Fields.a)' }] }),
  chart('Points', 340, { chartType: 'scatter', title: 'Points', xValue: '=Fields.x', series: [{ name: 'Y', value: '=Fields.y' }] }),
  chart('Stack', 510, { chartType: 'bar', stacked: true, title: 'Stacked', series: [{ name: 'A', value: '=Sum(Fields.a)' }, { name: 'B', value: '=Sum(Fields.a) / 2' }] }),
], { data: { rows } });
export const chartsXlsx = async () => exportXlsx(await render(chartsReport(), { fontStore, exportData: true }), ExcelJS, { pictures: false });

describe('native Excel charts', () => {
  it('each chart is a chart part bound to its data sheet, with cached values', async () => {
    const bytes = await chartsXlsx();
    const z = unzipSync(bytes);
    const parts = Object.keys(z);
    const chartsXml = parts.filter(p => /^xl\/charts\/chartPW\d+\.xml$/.test(p)).sort().map(p => strFromU8(z[p]));
    expect(chartsXml.length).toBe(4);
    const [combo, pie, scatter, bar] = chartsXml;
    expect(combo).toMatch(/<c:barChart><c:barDir val="col"\/><c:grouping val="clustered"\/>/);
    expect(combo).toMatch(/<c:lineChart>/);
    expect(combo).toMatch(/<c:crosses val="max"\/>/); // the secondary value axis
    expect(combo).toContain("<c:f>'Sales and margin'!$B$2:$B$4</c:f>");
    expect(combo).toContain('<c:v>20</c:v>');
    expect(pie).toMatch(/<c:pieChart>/);
    expect(scatter).toMatch(/<c:scatterChart>.*<c:xVal>/);
    expect(bar).toMatch(/<c:barDir val="bar"\/><c:grouping val="stacked"\/>/);
    const types = strFromU8(z['[Content_Types].xml']);
    expect(types).toContain('/xl/charts/chartPW1.xml');
    // the workbook still opens, and the data is on the chart's sheet
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.getWorksheet('Sales and margin');
    expect(ws.getRow(1).values.slice(1)).toEqual(['', 'Sales', 'Margin']);
    expect(ws.getRow(3).values.slice(1)).toEqual(['Feb', 20, 0.7]);
    const sheetXml = Object.entries(z).find(([p, v]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p) && strFromU8(v).includes('rIdPW1'));
    expect(sheetXml).toBeTruthy();
  });
});
