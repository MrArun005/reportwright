// Server-side rendering to every format. The same engine as the browser, in Node.
import fs from 'node:fs/promises';
import path from 'node:path';
import { render, FontStore } from '@/engine/index.js';
import { exportPdf } from '@/exporters/pdf.js';
import { exportHtml } from '@/exporters/html.js';
import { exportCsv } from '@/exporters/csv.js';
import { exportXlsx } from '@/exporters/xlsx.js';
import { createSubsetter } from '@/exporters/subset.js';
import { readReport } from './reports.js';
import { serverFetch } from './safeFetch.js';

const ROOT = process.cwd();
let store;
export const fontStore = () => (store ||= new FontStore((k) => fs.readFile(path.join(ROOT, 'public', 'fonts', `${k}.ttf`))));
const subset = createSubsetter(() => fs.readFile(path.join(ROOT, 'public', 'harfbuzz-subset.wasm')));

export const FORMATS = {
  pdf: { type: 'application/pdf', ext: 'pdf' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  html: { type: 'text/html; charset=utf-8', ext: 'html' },
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  json: { type: 'application/json', ext: 'json' },
};

export function baseUrl(req) {
  if (process.env.PW_BASE_URL) return process.env.PW_BASE_URL.replace(/\/$/, '');
  if (req) return new URL(req.url).origin;
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

/** Resolve a template reference: "id", "id@version", or an inline definition object. */
export async function loadTemplate(template) {
  if (template && typeof template === 'object') return template;
  const def = await readReport(String(template || ''));
  if (!def) throw Object.assign(new Error(`Template "${template}" not found`), { status: 404 });
  return def;
}

/**
 * @param {any} def
 * @param {{ parameters?: object, data?: object, format?: string, baseUrl?: string, self?: string, state?: object }} opt
 *   data: { sourceName: json } replaces those data sources (push data instead of pull)
 *   self: this server's origin, which data sources may call even though it is local. Defaults to baseUrl;
 *   pass it when baseUrl came from an API caller. Every other private address is refused (SSRF).
 */
export async function renderTo(def, opt = {}) {
  const format = opt.format || 'pdf';
  if (!FORMATS[format]) throw Object.assign(new Error(`Unknown format "${format}". Use pdf, xlsx, html, csv or json.`), { status: 400 });
  let d = def;
  if (opt.data && typeof opt.data === 'object') {
    d = { ...def, dataSources: (def.dataSources || []).map(s => (s.name in opt.data ? { name: s.name, type: 'json', data: opt.data[s.name] } : s)) };
  }
  const base = opt.baseUrl || baseUrl();
  const fetch = serverFetch(opt.self || base);
  const model = await render(d, {
    parameters: opt.parameters || {}, state: opt.state || {}, fontStore: fontStore(), baseUrl: base, fetch,
    loadReport: async (id) => { const r = await readReport(id); if (!r) throw new Error(`Report "${id}" not found`); return r; },
  });
  let bytes;
  // images by URL (a logo) go through the same guard; one that fails to load is left out, as in the viewer
  const fetchImage = async (src) => { try { const r = await fetch(new URL(src, base)); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
  if (format === 'pdf') bytes = await exportPdf(model, fontStore(), { title: def.name, subset, fetchImage });
  else if (format === 'html') bytes = Buffer.from(await exportHtml(model, fontStore(), { title: def.name, subset }));
  else if (format === 'csv') bytes = Buffer.from(exportCsv(model, { locale: def.locale, currency: def.currency }));
  else if (format === 'xlsx') { const ExcelJS = (await import('exceljs')).default; bytes = await exportXlsx(model, ExcelJS, { currency: def.currency, title: def.name }); }
  else bytes = Buffer.from(JSON.stringify(model));
  return { bytes, model, contentType: FORMATS[format].type, ext: FORMATS[format].ext };
}
