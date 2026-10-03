'use client';
import { fontStore, subsetter, origin } from './engineClient.js';
import { exportCsv } from '@/exporters/csv.js';
import { exportHtml } from '@/exporters/html.js';
import { fontKeysOf } from '@/exporters/svg.js';
import { exportXlsx } from '@/exporters/xlsx.js';

/* global __PW_EMBED__ */
/** ExcelJS: bundled for the app; loaded from the server as a script in the embeddable viewer. */
async function loadExcel() {
  if (typeof __PW_EMBED__ !== 'undefined' && __PW_EMBED__) {
    if (!window.ExcelJS) {
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = `${origin()}/embed/exceljs.min.js`; s.onload = res; s.onerror = () => rej(new Error('ExcelJS did not load')); document.head.appendChild(s); });
    }
    return window.ExcelJS;
  }
  const mod = await import('exceljs');
  return mod.default || mod;
}

/** Excel, HTML and CSV in the browser. ExcelJS loads only when needed. */
export async function exportBlob(fmt, model, def, opt = {}) {
  if (fmt === 'csv') return new Blob([exportCsv(model, { locale: def.locale, currency: def.currency })], { type: 'text/csv;charset=utf-8' });
  if (fmt === 'html' && opt.interactive !== false) {
    // interactive by default: the downloaded file runs the viewer itself
    try {
      const { exportInteractiveHtml } = await import('./interactiveHtml.js');
      const { html } = await exportInteractiveHtml(def, { params: opt.params, reportId: opt.reportId, lang: opt.lang, model });
      return new Blob([html], { type: 'text/html;charset=utf-8' });
    } catch (e) {
      if (e.code !== 'NO_BUNDLE') throw e;
      console.warn(`${e.message} Exporting static HTML instead.`);
    }
  }
  if (fmt === 'html') {
    const store = fontStore();
    await store.load(fontKeysOf(model));
    return new Blob([await exportHtml(model, store, { title: def.name, subset: subsetter })], { type: 'text/html;charset=utf-8' });
  }
  if (fmt === 'xlsx') {
    const ExcelJS = await loadExcel();
    const bytes = await exportXlsx(model, ExcelJS, { currency: def.currency, title: def.name });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  throw new Error(`Unknown format "${fmt}"`);
}
