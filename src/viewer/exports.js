'use client';
import { fontStore, subsetter } from './engineClient.js';
import { exportCsv } from '@/exporters/csv.js';
import { exportHtml } from '@/exporters/html.js';
import { exportXlsx } from '@/exporters/xlsx.js';

/** Excel, HTML and CSV in the browser. ExcelJS loads only when needed. */
export async function exportBlob(fmt, model, def) {
  if (fmt === 'csv') return new Blob([exportCsv(model, { locale: def.locale, currency: def.currency })], { type: 'text/csv;charset=utf-8' });
  if (fmt === 'html') {
    const store = fontStore();
    await store.load();
    return new Blob([await exportHtml(model, store, { title: def.name, subset: subsetter })], { type: 'text/html;charset=utf-8' });
  }
  if (fmt === 'xlsx') {
    const mod = await import('exceljs');
    const ExcelJS = mod.default || mod;
    const bytes = await exportXlsx(model, ExcelJS, { currency: def.currency, title: def.name });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  throw new Error(`Unknown format "${fmt}"`);
}
