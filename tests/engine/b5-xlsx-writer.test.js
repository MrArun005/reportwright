// B5 item 2: the Excel export has its own writer (no ExcelJS at run time, so no uuid / deprecated-package alerts).
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs'; // dev only: reads the file back
import fs from 'node:fs';
import { render } from '../../src/engine/index.js';
import { exportXlsx } from '../../src/exporters/xlsx.js';
import { fontStore, report } from '../helpers.js';

describe('xlsx writer', () => {
  it('exportXlsx(model) needs no ExcelJS and writes a workbook Excel readers open', async () => {
    const d = report([{
      type: 'table', name: 'Sales & <Co>', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 150 }, { width: 150 }],
      header: [{ height: 14, cells: [{ value: 'Name' }, { value: 'Amount' }] }],
      detail: [{ height: 14, cells: [{ value: '=Fields.n' }, { value: '=Fields.v', style: { format: 'N2' } }] }],
      footer: [{ height: 14, cells: [{ value: 'Total' }, { value: '=Sum(Fields.v)', style: { format: 'N2' } }] }],
    }], { data: { rows: [{ n: 'a\u0001"b"', v: 1.5 }, { n: 'c', v: 2 }] } });
    const bytes = await exportXlsx(await render(d, { fontStore, exportData: true }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('Sales & <Co>');
    expect(ws.getCell('A1').value).toBe('Name');
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.getCell('A2').value).toBe('a"b"'); // control character dropped
    expect(ws.getCell('B2').value).toBe(1.5);
    expect(ws.getCell('B4').value).toEqual({ formula: 'SUBTOTAL(9,B2:B3)', result: 3.5 });
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
  it('the engine sources and package never import exceljs', () => {
    for (const f of ['src/exporters/xlsx.js', 'src/exporters/xlsxwriter.js', 'packages/engine/entry.js']) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/from 'exceljs'|import\('exceljs'\)/);
    expect(fs.readFileSync('scripts/build-packages.mjs', 'utf8')).not.toMatch(/'exceljs'/);
  });
});
