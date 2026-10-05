// Excel export, batch 2: group and table totals as live SUBTOTAL formulas (checked against the shown value),
// number formats, frozen header, and charts and pictures as pictures on their own sheet.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { exportXlsx } from '../../src/exporters/xlsx.js';
import { fontKeysOf } from '../../src/exporters/svg.js';
import { model, fontStore } from './export-fixture.js';

const book = async (opt = {}) => {
  const m = await model();
  await fontStore.load(fontKeysOf(m));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportXlsx(m, ExcelJS, { currency: 'INR', fontStore, ...opt }));
  return wb;
};

describe('Excel export: live totals', () => {
  it('group subtotals and the grand total are SUBTOTAL formulas over the rows they cover, with the value cached', async () => {
    const ws = (await book()).getWorksheet('Sales');
    const byLabel = (label) => { let row = null; ws.eachRow(r => { if (r.getCell(1).value === label && !row) row = r; }); return row; };
    const sub = byLabel('Subtotal');
    expect(sub.getCell(2).value).toEqual({ formula: 'SUBTOTAL(9,B3:B4)', result: 200 });
    expect(sub.getCell(3).value).toEqual({ formula: 'SUBTOTAL(2,C3:C4)', result: 2 }); // a count
    const total = byLabel('Total');
    expect(total.getCell(2).value).toEqual({ formula: 'SUBTOTAL(9,B3:B4,B7:B8)', result: 460.5 });
    expect(total.getCell(3).value).toEqual({ formula: 'SUBTOTAL(1,C3:C4,C7:C8)', result: 2.75 }); // an average
    expect(total.getCell(2).numFmt).toBe('[>=10000000]##,##,##,##0.00;[>=100000]##,##,##0.00;##,##0.00'); // en-IN: lakh grouping (the file has \\, ; ExcelJS reads it back unescaped)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
  it('formulas: false keeps the values', async () => {
    const ws = (await book({ formulas: false })).getWorksheet('Sales');
    let v = null;
    ws.eachRow(r => { if (r.getCell(1).value === 'Total') v = r.getCell(2).value; });
    expect(v).toBe(460.5);
  });
  it('a total that is not a sum, count or average of its rows stays a value', async () => {
    const m = await model();
    const r = m.regions[0];
    const foot = r.rows.find(x => x.kind === 'footer');
    foot.cells.find(c => c.colIndex === 1).value = 999; // e.g. =Sum(Fields.amt) * 2
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportXlsx(m, ExcelJS, { pictures: false }));
    let v = null;
    wb.getWorksheet('Sales').eachRow(row => { if (row.getCell(1).value === 'Total') v = row.getCell(2).value; });
    expect(v).toBe(999);
  });
  it('pictures and barcodes are pictures on a Charts sheet, with their description; shapes are not; a chart is a native chart', async () => {
    const ws = (await book()).getWorksheet('Charts');
    expect(ws.getImages().length).toBe(2); // the column chart is a native Excel chart on its own sheet now
    const pics = (await book({ charts: false })).getWorksheet('Charts');
    expect(pics.getImages().length).toBe(3);
    expect(pics.getCell(1, 1).value).toBe('Column chart: Kochi has the highest amount');
  });
});
