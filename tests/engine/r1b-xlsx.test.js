// REVIEW-ENGINE A18 (Excel gets full-precision values) and EXTERNAL-REVIEW-2 (Excel dates a day early east of UTC).
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { render } from '../../src/engine/index.js';
import { exportXlsx } from '../../src/exporters/xlsx.js';
import { fontStore, report } from '../helpers.js';

const def = (extra = {}) => report([{
  type: 'table', name: 'Sales', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 150 }, { width: 150 }],
  detail: [{ height: 14, cells: [{ value: '=Fields.v', style: { format: 'N2' } }, { value: '=Fields.d', style: { format: 'dd MMM yyyy' } }] }],
  footer: [{ height: 14, cells: [{ value: '=Sum(Fields.v)', style: { format: 'N2' } }, null] }],
}], { data: { rows: [{ v: 0.333, d: '2024-01-31' }, { v: 0.333, d: '2024-02-29' }, { v: 1.0025, d: '2024-12-31' }] }, def: extra });
const sheet = async (d, opts = {}) => {
  const m = await render(d, { fontStore, exportData: true, ...opts });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportXlsx(m, ExcelJS, { pictures: false }));
  return wb.getWorksheet('Sales');
};

describe('Excel export', () => {
  it('writes the full value and lets the number format round it', async () => {
    const ws = await sheet(def());
    expect([1, 2, 3].map(r => ws.getRow(r).getCell(1).value)).toEqual([0.333, 0.333, 1.0025]);
    expect(ws.getRow(1).getCell(1).numFmt).toBe('#,##0.00');
    expect(ws.getRow(4).getCell(1).value).toEqual({ formula: 'SUBTOTAL(9,A1:A3)', result: 1.6685 });
  });
  for (const timeZone of ['Asia/Kolkata', 'Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles', 'UTC']) {
    it(`dates keep their calendar day in ${timeZone}`, async () => {
      const ws = await sheet(def({ timeZone }));
      // ExcelJS reads a serial back as the UTC date of that serial: the day Excel shows
      expect([1, 2, 3].map(r => ws.getRow(r).getCell(2).value.toISOString().slice(0, 10))).toEqual(['2024-01-31', '2024-02-29', '2024-12-31']);
    });
  }
  it('with no zone set, the host\'s (the server or browser that exported)', async () => {
    const ws = await sheet(def());
    expect(ws.getRow(1).getCell(2).value.toISOString()).toBe('2024-01-31T00:00:00.000Z');
  });
});
