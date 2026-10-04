// Server-side rendering to every format. The same engine as the browser, in Node.
import fs from 'node:fs/promises';
import path from 'node:path';
import { render, FontStore } from '@/engine/index.js';
import { fontFile, setCustomFonts } from '@/engine/text/fonts.js';
import { exportPdf } from '@/exporters/pdf.js';
import { exportHtml } from '@/exporters/html.js';
import { exportCsv } from '@/exporters/csv.js';
import { exportXlsx } from '@/exporters/xlsx.js';
import { exportDocx } from '@/exporters/docx.js';
import { createSubsetter } from '@/exporters/subset.js';
import { readReportFor, defaultPrincipal, vet } from './perms.js';
import { serverFetch } from './safeFetch.js';
import { pdfSigner } from './sign.js';
import { runSql } from './sql.js';
import { listFonts, readFont } from './fonts.js';

const ROOT = process.cwd();
let store;
/** Bundled fonts from public/fonts; uploaded ones ("u-<id>") from the storage. */
export const fontStore = () => (store ||= new FontStore(async (k) => {
  if (!k.startsWith('u-')) return fs.readFile(path.join(ROOT, 'public', 'fonts', fontFile(k)));
  const f = await readFont(k.slice(2));
  if (!f) throw new Error(`The uploaded font ${k} is gone`);
  return f.bytes;
}));

/** Tell the engine which fonts are uploaded (by family) before a render. A font that failed may load now. */
export async function syncFonts() {
  setCustomFonts(await listFonts());
  for (const k of fontStore().failed) if (k.startsWith('u-')) fontStore().failed.delete(k);
}
const subset = createSubsetter(() => fs.readFile(path.join(ROOT, 'public', 'harfbuzz-subset.wasm')));
let icc;
const iccProfile = async () => (icc ||= await fs.readFile(path.join(ROOT, 'public', 'icc', 'sRGB-v2-magic.icc')));

export const FORMATS = {
  pdf: { type: 'application/pdf', ext: 'pdf' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  html: { type: 'text/html; charset=utf-8', ext: 'html' },
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  json: { type: 'application/json', ext: 'json' },
};

/** The server's render time limit: PW_RENDER_TIMEOUT_MS, default 60 s. Every server render (routes, batches,
 *  schedules, thumbnails) stops there with a 504, so one slow report cannot hold the server. */
export const renderTimeoutMs = () => { const n = Number(process.env.PW_RENDER_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 60000; };

export function baseUrl(req) {
  if (process.env.PW_BASE_URL) return process.env.PW_BASE_URL.replace(/\/$/, '');
  if (req) return new URL(req.url).origin;
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

/**
 * Resolve a template reference: "id", "id@version", or an inline definition object, as `principal` may.
 * An inline definition can name any SQL connection and any subreport, so it needs a designer (or a service key).
 * @param {any} template @param {import('./perms.js').Principal} [principal]
 */
export async function loadTemplate(template, principal = defaultPrincipal()) {
  principal = vet(principal);
  if (template && typeof template === 'object') {
    if (principal.kind === 'user' ? principal.role === 'viewer' : !['open', 'service'].includes(principal.kind)) throw Object.assign(new Error('Only a designer can render a definition sent in the request. Render a saved template by its id.'), { status: 403 });
    return template;
  }
  try { return await readReportFor(principal, String(template || '')); }
  catch (e) { throw e.status === 404 ? Object.assign(new Error(`Template "${template}" not found`), { status: 404 }) : e; }
}

/**
 * @param {any} def
 * @param {{ parameters?: object, data?: object, format?: string, baseUrl?: string, self?: string, state?: object }} opt
 *   data: { sourceName: json } replaces those data sources (push data instead of pull)
 *   self: this server's origin, which data sources may call even though it is local. Defaults to baseUrl;
 *   pass it when baseUrl came from an API caller. Every other private address is refused (SSRF).
 *   pdfa: a PDF/A-2b file. sign: sign the PDF with PW_SIGN_P12 (only for routes behind an API key).
 *   encrypt: passwords and permissions (pdfEncryptOptions); not with pdfa or sign.
 *   principal: who the render runs for (perms.js): subreports it may not view are "not found". Default: nobody
 *   with accounts on, so a caller that forgets cannot show more than it should.
 */
export async function renderTo(def, opt = {}) {
  const format = opt.format || 'pdf';
  if (!FORMATS[format]) throw Object.assign(new Error(`Unknown format "${format}". Use pdf, xlsx, docx, html, csv or json.`), { status: 400 });
  let d = def;
  if (opt.data && typeof opt.data === 'object') {
    d = { ...def, dataSources: (def.dataSources || []).map(s => (s.name in opt.data ? { name: s.name, type: 'json', data: opt.data[s.name] } : s)) };
  }
  if ((opt.pdfa || opt.sign || opt.encrypt) && format !== 'pdf') throw Object.assign(new Error('PDF/A, signing and passwords apply to the pdf format only'), { status: 400 });
  if (opt.encrypt && opt.pdfa) throw Object.assign(new Error('A PDF/A file cannot have a password. Turn off PDF/A or the password.'), { status: 400 });
  if (opt.encrypt && opt.sign) throw Object.assign(new Error('A signed PDF cannot have a password. Turn off signing or the password.'), { status: 400 });
  const signing = opt.sign ? await pdfSigner({ name: def.name || 'Pagewright' }) : null; // fail before rendering
  const base = opt.baseUrl || baseUrl();
  const fetch = serverFetch(opt.self || base);
  await syncFonts();
  const model = await render(d, {
    parameters: opt.parameters || {}, state: opt.state || {}, fontStore: fontStore(), baseUrl: base, fetch, timeoutMs: renderTimeoutMs(),
    sql: runSql, // SQL sources query the database directly, not through /api/data/sql
    loadReport: async (id) => {
      try { return await readReportFor(opt.principal || defaultPrincipal(), id); }
      catch { throw new Error(`Report "${id}" not found`); } // the same words whether it is missing or not allowed
    },
  });
  let bytes;
  // images by URL (a logo) go through the same guard; one that fails to load is left out, as in the viewer
  const fetchImage = async (src) => { try { const r = await fetch(new URL(src, base)); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
  if (format === 'pdf') {
    bytes = await exportPdf(model, fontStore(), { title: def.name, subset, fetchImage, pdfa: opt.pdfa ? { icc: await iccProfile() } : undefined, prepare: signing?.prepare, save: signing?.save, encrypt: opt.encrypt });
    if (signing) bytes = await signing.sign(bytes);
  }
  else if (format === 'html') bytes = Buffer.from(await exportHtml(model, fontStore(), { title: def.name, subset }));
  else if (format === 'csv') bytes = Buffer.from(exportCsv(model, { locale: def.locale, currency: def.currency }));
  else if (format === 'docx') bytes = Buffer.from(await exportDocx(model, { title: def.name }));
  else if (format === 'xlsx') { const ExcelJS = (await import('exceljs')).default; bytes = await exportXlsx(model, ExcelJS, { currency: def.currency, title: def.name }); }
  else bytes = Buffer.from(JSON.stringify(model));
  return { bytes, model, contentType: FORMATS[format].type, ext: FORMATS[format].ext };
}
