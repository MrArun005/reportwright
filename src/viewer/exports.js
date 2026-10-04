'use client';
import { fontStore, subsetter, origin } from './engineClient.js';
import { reportFetch } from './dataFetch.js';
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

/** Export options the viewer offers (its Export options menu) and their defaults. */
export const EXPORT_DEFAULTS = { pdfua: false, pdfa: false, formulas: true, html: 'interactive' };
/** Formats that need the table data a view renders without (render option exportData). */
export const needsExportData = (fmt, o = {}) => ['xlsx', 'csv', 'docx', 'pptx', 'html', 'json'].includes(fmt) || (fmt === 'pdf' && !!o.pdfua);

/** The report's fonts, loaded: Word, PowerPoint and Excel draw the text of charts as outlines from them. */
async function loadedFonts(model) {
  const store = fontStore();
  await store.load(fontKeysOf(model));
  return store;
}
// a report's image: a GET under the same rules as its data (no cookies to our other routes or to other sites)
const fetchImage = async (src) => { try { const r = await reportFetch(origin())(src); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };

/**
 * Excel, Word, PowerPoint, HTML, CSV and JSON in the browser. ExcelJS loads only when needed.
 * opt.options: the Export options (EXPORT_DEFAULTS); opt.strings: the Tables view of an HTML file in the UI language.
 */
export async function exportBlob(fmt, model, def, opt = {}) {
  const o = { ...EXPORT_DEFAULTS, ...(opt.options || {}) };
  const lang = def.locale || opt.lang || 'en';
  // the laid-out pages, as the server's json format gives them
  if (fmt === 'json') return new Blob([JSON.stringify(model)], { type: 'application/json' });
  if (fmt === 'csv') return new Blob([exportCsv(model, { locale: def.locale, currency: def.currency })], { type: 'text/csv;charset=utf-8' });
  if (fmt === 'html' && opt.interactive !== false && o.html === 'interactive') {
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
    const store = await loadedFonts(model);
    // drill-through links open the report in this server's viewer
    return new Blob([await exportHtml(model, store, { title: def.name, subset: subsetter, drillBase: origin(), static: o.html === 'static', locale: def.locale, currency: def.currency, lang: opt.lang, strings: opt.strings })], { type: 'text/html;charset=utf-8' });
  }
  if (fmt === 'docx') {
    const { exportDocx } = await import('@/exporters/docx.js');
    return new Blob([await exportDocx(model, { title: def.name, lang, fontStore: await loadedFonts(model), fetchImage })], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  if (fmt === 'pptx') {
    const { exportPptx } = await import('@/exporters/pptx.js');
    return new Blob([await exportPptx(model, { title: def.name, lang, fontStore: await loadedFonts(model), fetchImage })], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  }
  if (fmt === 'xlsx') {
    const ExcelJS = await loadExcel();
    const bytes = await exportXlsx(model, ExcelJS, { currency: def.currency, title: def.name, formulas: o.formulas, fontStore: await loadedFonts(model), fetchImage });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  throw new Error(`Unknown format "${fmt}"`);
}
