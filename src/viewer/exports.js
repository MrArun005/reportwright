'use client';
import { loadFontStore, subsetter, origin } from './engineClient.js';
import { reportFetch } from './dataFetch.js';
import { fontKeysOf } from '@/exporters/svg.js';

import { EXPORT_DEFAULTS } from './logic.js';
export { EXPORT_DEFAULTS };
/** Formats that need the table data a view renders without (render option exportData). */
export { needsExportData } from '@/exporters/regions.js';

/** The report's fonts, loaded: Word, PowerPoint and Excel draw the text of charts as outlines from them. */
async function loadedFonts(model) {
  const store = await loadFontStore();
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
  if (fmt === 'csv') return new Blob([(await import('@/exporters/csv.js')).exportCsv(model, { locale: def.locale, currency: def.currency })], { type: 'text/csv;charset=utf-8' });
  if (fmt === 'html' && opt.interactive !== false && o.html === 'interactive') {
    // no silent fallback: INTERACTIVE_FAILED, the viewer asks before a static file
    try {
      const { exportInteractiveHtml } = await import('./interactiveHtml.js');
      const { html } = await exportInteractiveHtml(def, { params: opt.params, reportId: opt.reportId, lang: opt.lang, model, drillLinks: o.drillLinks });
      return new Blob([html], { type: 'text/html;charset=utf-8' });
    } catch (e) {
      throw Object.assign(new Error(e.message), { code: 'INTERACTIVE_FAILED', reason: e.code || null, cause: e });
    }
  }
  if (fmt === 'html') {
    const store = await loadedFonts(model);
    // drill-through links open the report in this server's viewer
    const { exportHtml } = await import('@/exporters/html.js'); // exporters load when used
    return new Blob([await exportHtml(model, { fonts: store, title: def.name, subset: subsetter, drillBase: origin(), drillLinks: o.drillLinks, static: o.html === 'static', locale: def.locale, currency: def.currency, lang: opt.lang, strings: opt.strings })], { type: 'text/html;charset=utf-8' });
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
    const { exportXlsx } = await import('@/exporters/xlsx.js');
    const bytes = await exportXlsx(model, { currency: def.currency, title: def.name, formulas: o.formulas, fontStore: await loadedFonts(model), fetchImage });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  throw new Error(`Unknown format "${fmt}"`);
}
