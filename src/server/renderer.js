// Server-side rendering to every format. The same engine as the browser, in Node.
import fs from 'node:fs/promises';
import path from 'node:path';
import { render, FontStore } from '@/engine/index.js';
import { FETCHED_TYPES } from '@/engine/data/index.js';
import { fontFile, setCustomFonts } from '@/engine/text/fonts.js';
import { exportPdf } from '@/exporters/pdf.js';
import { exportHtml } from '@/exporters/html.js';
import { exportCsv } from '@/exporters/csv.js';
import { exportXlsx } from '@/exporters/xlsx.js';
import { exportDocx } from '@/exporters/docx.js';
import { exportPptx } from '@/exporters/pptx.js';
import { createSubsetter } from '@/exporters/subset.js';
import { readRunnable, defaultPrincipal, vet, canDesign, writtenHost, normalizeSource } from './perms.js';
import { serverFetch, NO_BASE_URL } from './safeFetch.js';
import { pdfSigner } from './sign.js';
import { runSql } from './sql.js';
import { listFonts, readFont } from './fonts.js';
import { devMode } from './config.js';

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
  pptx: { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
  html: { type: 'text/html; charset=utf-8', ext: 'html' },
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  json: { type: 'application/json', ext: 'json' },
};

/** The server's render time limit: PW_RENDER_TIMEOUT_MS, default 60 s. Every server render (routes, batches,
 *  schedules, thumbnails) stops there with a 504, so one slow report cannot hold the server. */
export const renderTimeoutMs = () => { const n = Number(process.env.PW_RENDER_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 60000; };

/**
 * This server's own URL, for relative data URLs and its calls to itself: PW_BASE_URL. Never a request header: outside
 * production, the address Next listens on (Next builds req.url from its own host and port, not the Host header; plain
 * http, X-Forwarded-Proto aside). Production without PW_BASE_URL: NO_BASE_URL, which serverFetch refuses (fail closed).
 * @param {Request} [req]
 */
export function baseUrl(req) {
  if (process.env.PW_BASE_URL) return process.env.PW_BASE_URL.replace(/\/$/, '');
  if (!devMode()) return NO_BASE_URL;
  if (req) return `http://${new URL(req.url).host}`;
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

/** PW_FIXED_FETCH_HOSTS: 1 (the default in production), 0 (the default in development). */
const fixedHosts = () => (process.env.PW_FIXED_FETCH_HOSTS ? process.env.PW_FIXED_FETCH_HOSTS !== '0' : !devMode());
/**
 * With PW_FIXED_FETCH_HOSTS on: a data source the server fetches must write its host out; parameters and expressions
 * may fill the path and the query only (they are URL-encoded there), so a viewer cannot point the server at a host.
 * @param {any} def
 */
export function assertFixedHosts(def) {
  if (!fixedHosts()) return;
  for (const s of Array.isArray(def?.dataSources) ? def.dataSources : []) {
    if (!s || !FETCHED_TYPES.includes(s.type) || ((s.type === 'csv' || s.type === 'xml') && s.data)) continue;
    if (writtenHost(s.url) === null) throw Object.assign(new Error(`Data source "${s.name}": its host is made by an expression or a parameter. Write the host out (only the path and the query may vary), or set PW_FIXED_FETCH_HOSTS=0.`), { status: 403 });
  }
}

let zones = null;
/**
 * The viewer's time zone for a server render (Intl's resolvedOptions().timeZone, sent by the viewer), checked against
 * the zones this runtime knows; a bad one is a 400. A report's own timeZone setting still wins (engine render()).
 * @param {any} tz @returns {string|undefined}
 */
export function checkTimeZone(tz) {
  if (tz == null || tz === '') return undefined;
  zones ||= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', 'Etc/UTC']);
  if (typeof tz !== 'string' || !zones.has(tz)) throw Object.assign(new Error(`Unknown time zone "${String(tz).slice(0, 60)}". Send an IANA name such as Europe/Paris.`), { status: 400 });
  return tz;
}

/**
 * Resolve a template reference: "id", "id@version", or an inline definition object, as `principal` may.
 * An inline definition can name any SQL connection and any subreport, so it needs a designer (or a service key). A saved
 * one runs its server-side data only as a designer stored it (readRunnable).
 * @param {any} template @param {import('./perms.js').Principal} [principal]
 */
export async function loadTemplate(template, principal = defaultPrincipal()) {
  principal = vet(principal);
  if (template && typeof template === 'object') {
    if (!canDesign(principal)) throw Object.assign(new Error('Only a designer can render a definition sent in the request. Render a saved template by its id.'), { status: 403 });
    return template;
  }
  try { return await readRunnable(principal, String(template || '')); }
  catch (e) { throw e.status === 404 ? Object.assign(new Error(`Template "${template}" not found`), { status: 404 }) : e; }
}

/**
 * @param {any} def
 * @param {{ parameters?: object, data?: object, format?: string, baseUrl?: string, self?: string, state?: object, [k: string]: any }} opt
 *   data: { sourceName: json } replaces those data sources (push data instead of pull)
 *   self: this server's origin, which data sources may call even though it is local. Defaults to baseUrl;
 *   pass it when baseUrl came from an API caller. Every other private address is refused (SSRF).
 *   pdfa: a PDF/A-2b file (2a with ua). ua: an accessible PDF (PDF/UA-1). formulas: false keeps Excel totals as values.
 *   static: an HTML file without its Tables view. sign: sign the PDF with PW_SIGN_P12 (only for routes behind an API key).
 *   encrypt: passwords and permissions (pdfEncryptOptions); not with pdfa or sign.
 *   principal: who the render runs for (perms.js): subreports it may not view are "not found". Default: nobody
 *   with accounts on, so a caller that forgets cannot show more than it should.
 *   timeZone: the viewer's zone (checkTimeZone), so a server file shows dates as the browser does; the report's wins.
 *   firstPages: lay out only that many pages (thumbnails). modelOnly: the page model, no file (bytes null).
 */
export async function renderTo(def, opt = {}) {
  const format = opt.format || 'pdf';
  if (!FORMATS[format]) throw Object.assign(new Error(`Unknown format "${format}". Use pdf, xlsx, docx, pptx, html, csv or json.`), { status: 400 });
  let d = def;
  // pushed data replaces the report's own sources: a render of made-up rows under the report's name (and signature)
  if (opt.data && opt.principal && !canDesign(opt.principal)) throw Object.assign(new Error('Only a designer can send data for a render. Render the report with its own data.'), { status: 403 });
  if (opt.data && typeof opt.data === 'object') {
    d = { ...def, dataSources: (def.dataSources || []).map(s => (s.name in opt.data ? { name: s.name, type: 'json', data: opt.data[s.name] } : s)) };
  }
  if ((opt.pdfa || opt.sign || opt.encrypt || opt.ua) && format !== 'pdf') throw Object.assign(new Error('PDF/A, signing and passwords apply to the pdf format only'), { status: 400 });
  if (opt.encrypt && opt.pdfa) throw Object.assign(new Error('A PDF/A file cannot have a password. Turn off PDF/A or the password.'), { status: 400 });
  if (opt.encrypt && opt.sign) throw Object.assign(new Error('A signed PDF cannot have a password. Turn off signing or the password.'), { status: 400 });
  if (opt.sign && opt.principal && vet(opt.principal).kind === 'public') throw Object.assign(new Error('Signing needs an API key (PW_API_KEYS).'), { status: 401 });
  const signing = opt.sign ? await pdfSigner({ name: def.name || 'Pagewright' }) : null; // fail before rendering
  assertFixedHosts(d);
  // the engine runs exactly the objects the permission checks classified (perms.normalizeSource)
  if (Array.isArray(d?.dataSources)) d = { ...d, dataSources: d.dataSources.map(normalizeSource) };
  const base = opt.baseUrl || baseUrl();
  const fetch = serverFetch(opt.self || base);
  await syncFonts();
  const model = await render(d, {
    parameters: opt.parameters || {}, state: opt.state || {}, fontStore: fontStore(), timeZone: checkTimeZone(opt.timeZone),
    baseUrl: base, fetch, timeoutMs: renderTimeoutMs(),
    exportData: !opt.modelOnly && (format !== 'pdf' || !!opt.ua), // a plain PDF needs no table data
    ...(opt.firstPages ? { firstPages: opt.firstPages } : {}),
    sql: runSql, // SQL sources query the database directly, not through /api/data/sql
    loadReport: async (id) => {
      let sub;
      try { sub = await readRunnable(opt.principal || defaultPrincipal(), id); }
      catch (e) { throw e.status === 403 && /no designer saved/.test(e.message) ? e : new Error(`Report "${id}" not found`); } // the same words whether it is missing or not allowed
      assertFixedHosts(sub);
      return Array.isArray(sub?.dataSources) ? { ...sub, dataSources: sub.dataSources.map(normalizeSource) } : sub;
    },
  });
  let bytes = null;
  if (opt.modelOnly) return { bytes, model, contentType: FORMATS[format].type, ext: FORMATS[format].ext };
  // images by URL (a logo) go through the same guard; one that fails to load is left out, as in the viewer
  // with fixed hosts an image URL (often made by an expression) does not reach PW_INTERNAL_HOSTS either
  const imageFetch = fixedHosts() ? serverFetch(opt.self || base, { internal: false }) : fetch;
  const fetchImage = async (src) => { try { const r = await imageFetch(new URL(src, base)); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
  if (format === 'pdf') {
    bytes = await exportPdf(model, fontStore(), { title: def.name, subset, fetchImage, pdfa: opt.pdfa ? { icc: await iccProfile() } : undefined, tagged: opt.ua ? { lang: def.locale || 'en' } : undefined, prepare: signing?.prepare, save: signing?.save, encrypt: opt.encrypt });
    if (signing) bytes = await signing.sign(bytes);
  }
  else if (format === 'html') bytes = Buffer.from(await exportHtml(model, fontStore(), { title: def.name, subset, drillBase: opt.self || base, static: !!opt.static, locale: def.locale, currency: def.currency })); // drill-through opens this server's viewer (never a caller's baseUrl)
  else if (format === 'csv') bytes = Buffer.from(exportCsv(model, { locale: def.locale, currency: def.currency }));
  else if (format === 'docx') bytes = Buffer.from(await exportDocx(model, { title: def.name, lang: def.locale, fontStore: fontStore(), fetchImage }));
  else if (format === 'pptx') bytes = Buffer.from(await exportPptx(model, { title: def.name, lang: def.locale, fontStore: fontStore(), fetchImage }));
  else if (format === 'xlsx') { const ExcelJS = (await import('exceljs')).default; bytes = await exportXlsx(model, ExcelJS, { currency: def.currency, title: def.name, formulas: opt.formulas !== false, fontStore: fontStore(), fetchImage }); }
  else bytes = Buffer.from(JSON.stringify(model));
  return { bytes, model, contentType: FORMATS[format].type, ext: FORMATS[format].ext };
}
