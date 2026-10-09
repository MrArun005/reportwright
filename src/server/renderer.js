// @ts-check
// Server-side rendering to every format. The same engine as the browser, in Node.
import fs from 'node:fs/promises';
import path from 'node:path';
import { localAclGen } from './storage/index.js';
import { render, FontStore } from '@/engine/index.js';
import { FETCHED_TYPES } from '@/engine/data/index.js';
import { fontFile, setCustomFonts } from '@/engine/text/fonts.js';
import { exportPdf } from '@/exporters/pdf.js';
import { exportHtml } from '@/exporters/html.js';
import { exportCsv, writeCsvStream } from '@/exporters/csv.js';
import { planStream } from '@/engine/stream.js';
import { planPaged } from '@/engine/paged.js';
import { writePagedPdf } from '@/exporters/pdfstream.js';
import { textWriter, byteWriter } from './stream-out.js';
import { writeXlsxStream } from '@/exporters/xlsxstream.js';
import { spillSorter } from '../exporters/spill.js';
import { fetchMaxBytes, deadlineMs as fetchDeadlineMs } from './safeFetch.js';
import { exportXlsx } from '@/exporters/xlsx.js';
import { exportDocx } from '@/exporters/docx.js';
import { exportPptx } from '@/exporters/pptx.js';
import { createSubsetter } from '@/exporters/subset.js';
import { readRunnable, defaultPrincipal, vet, canDesign, writtenHost, normalizeSource, principalId } from './perms.js';
import { serverFetch, NO_BASE_URL } from './safeFetch.js';
import { pdfSigner } from './sign.js';
import { runSql, runSqlRows, streamLimits } from './sql.js';
import { listFonts, readFont, fontsGen } from './fonts.js';
import { devMode, num as cnum, formulasOn } from './config.js';

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
// ponytail: the list is read at most every FONT_SYNC_MS (a batch of 180 items reads it once, not 180 times); an
// upload shows in renders within that time
const FONT_SYNC_MS = 2000;
let fontsSyncedAt = 0, fontsSyncedGen = -1;
let fontsSyncing = null; // one read at a time: concurrent batch items share it
export async function syncFonts() {
  if (Date.now() - fontsSyncedAt < FONT_SYNC_MS && fontsSyncedGen === fontsGen.n) return;
  if (fontsSyncing) return fontsSyncing;
  const gen = fontsGen.n;
  fontsSyncing = listFonts().then(list => { setCustomFonts(list); fontsSyncedAt = Date.now(); fontsSyncedGen = gen; }).finally(() => { fontsSyncing = null; });
  await fontsSyncing;
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
export const renderTimeoutMs = () => cnum('PW_RENDER_TIMEOUT_MS', 60000, { min: 1 });

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
 *   csv: "layout" gives the printed layout as CSV (default: the data). static: an HTML file without its Tables view. sign: sign the PDF with PW_SIGN_P12 (only for routes behind an API key).
 *   encrypt: passwords and permissions (pdfEncryptOptions); not with pdfa or sign.
 *   principal: who the render runs for (perms.js): subreports it may not view are "not found". Default: nobody
 *   with accounts on, so a caller that forgets cannot show more than it should.
 *   timeZone: the viewer's zone (checkTimeZone), so a server file shows dates as the browser does; the report's wins.
 *   firstPages: lay out only that many pages (thumbnails). modelOnly: the page model, no file (bytes null).
 */
/**
 * Responses fetched for the items of one batch (opt.batch): a statement run of 180 items fetches its data once, not
 * 180 times. The key is the batch, the principal (never shared across principals: each item's checks stand), and the
 * whole request (URL, method, headers, body). Only OK answers are kept, for BATCH_FETCH_TTL_MS, within
 * BATCH_FETCH_MAX_BYTES (oldest out first). Each render thread has its own.
 * ponytail: per-thread, so a pool of N threads fetches up to N times; a shared cache only if that matters.
 */
const batchFetches = new Map(); // key → { at, status, headers, bytes }
const BATCH_FETCH_TTL_MS = 10 * 60000, BATCH_FETCH_MAX_BYTES = 256 * 1048576;
let batchFetchBytes = 0;
/** @param {(input: any, init?: any) => Promise<Response>} fetch @param {string} scope */
function batchFetch(fetch, scope) {
  return async (input, init = {}) => {
    const key = JSON.stringify([scope, String(input), init.method || 'GET', init.headers || null, typeof init.body === 'string' ? init.body : init.body == null ? null : NaN]);
    const now = Date.now();
    for (const [k, v] of batchFetches) { if (now - v.at < BATCH_FETCH_TTL_MS && batchFetchBytes <= BATCH_FETCH_MAX_BYTES) break; batchFetches.delete(k); batchFetchBytes -= v.bytes.length; }
    if (typeof init.body !== 'string' && init.body != null) return fetch(input, init); // a stream body: not cached
    let hit = batchFetches.get(key);
    if (!hit) {
      const res = await fetch(input, init);
      if (!res.ok) return res;
      hit = { at: now, status: res.status, headers: [...res.headers], bytes: new Uint8Array(await res.arrayBuffer()) };
      batchFetches.set(key, hit);
      batchFetchBytes += hit.bytes.length;
    }
    const res = new Response(hit.bytes.slice(), { status: hit.status, headers: hit.headers });
    // parsed once per batch, not once per item (the engine builds its own rows and never changes the source)
    const h = hit;
    res.json = async () => (h.parsed ??= JSON.parse(new TextDecoder().decode(h.bytes)));
    return res;
  };
}

/**
 * A streaming render (docs/research/STREAMING-1M.md): rows from the source a batch at a time, sorted through spill
 * files when they need sorting, written to opt.out as they come. Null when the report cannot stream (the caller renders
 * the model instead). An error before any output is thrown as usual; after it, the caller's stream breaks off.
 */
async function streamTo(d, format, def, renderOpts, opt) {
  const t0 = Date.now();
  /** @type {any} */
  let plan;
  // the caps are the server's, never the request's (the same for every streaming format)
  const caps = { sqlRows: (src, p, o) => runSqlRows(src, p, { ms: Math.max(0, renderOpts.deadline - Date.now()), signal: o?.signal }), sorter: spillSorter({ maxMB: cnum('PW_SPILL_MAX_MB', 2048, { min: 1 }), totalMB: cnum('PW_SPILL_TOTAL_MB', 8192, { min: 1 }), staleMs: 2 * renderTimeoutMs() + 60000 }),
    maxRows: Number(streamLimits.rows), maxJsonWholeBytes: fetchMaxBytes() };
  try {
    // pdf: the page layout runs window by window over the same rows (engine/paged.js), with render()'s options
    plan = format === 'pdf' ? await planPaged(d, { ...renderOpts, ...caps, tagged: !!opt.ua })
      : await planStream(d, { format, parameters: renderOpts.parameters, timeZone: renderOpts.timeZone, state: renderOpts.state, loadReport: renderOpts.loadReport,
        fetch: renderOpts.fetch, baseUrl: renderOpts.baseUrl, deadline: renderOpts.deadline, timeoutMs: renderOpts.timeoutMs, ...caps });
  } catch { return null; } // a definition or parameter error: the model path reports it as it always has
  if (plan.why) return null;
  const meta = { contentType: FORMATS[format].type, ext: FORMATS[format].ext };
  const w = format === 'csv' ? textWriter(opt.out, meta) : byteWriter(opt.out, meta);
  try {
    if (format === 'pdf') {
      const r = await writePagedPdf(plan, { fontStore: renderOpts.fontStore, subset, title: def.name, drillBase: opt.self || renderOpts.baseUrl,
        pdfa: opt.pdfa ? { icc: await iccProfile() } : undefined, tagged: opt.ua ? { lang: def.locale || 'en' } : undefined }, { write: (u8) => /** @type {any} */ (w).put(u8) });
      await w.end();
      return { bytes: null, streamed: true, model: { pages: [], regions: null, warnings: r.warnings, streamed: true, stats: { ms: Date.now() - t0, pages: r.pages, rows: {} } }, ...meta };
    }
    if (format === 'xlsx') await writeXlsxStream(plan, /** @type {any} */ (w.put), { currency: def.currency, title: def.name, formulas: formulasOn(opt.formulas) });
    else await writeCsvStream(plan, /** @type {any} */ (w.put), { locale: def.locale, currency: def.currency });
    await w.end();
  } catch (e) {
    if (!opt.out.started && /** @type {any} */ (e).fallBack) return null; // nothing written yet: the model path can still do it
    throw e;
  }
  const model = { pages: [], regions: null, warnings: plan.warnings, streamed: true, stats: { ms: Date.now() - t0, pages: 0, rows: { [plan.name]: plan.stats.rows } } };
  return { bytes: null, streamed: true, model, ...meta };
}

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
  const signing = opt.sign ? await pdfSigner({ name: def.name || 'ReportWright' }) : null; // fail before rendering
  assertFixedHosts(d);
  // the engine runs exactly the objects the permission checks classified (perms.normalizeSource)
  if (Array.isArray(d?.dataSources)) d = { ...d, dataSources: d.dataSources.map(normalizeSource) };
  const base = opt.baseUrl || baseUrl();
  // a render for someone not signed in (public embed) passes that on, so its own data calls keep the anonymous caps
  const anon = !['user', 'service'].includes(opt.principal ? vet(opt.principal).kind : '');
  const fetch = opt.batch ? batchFetch(serverFetch(opt.self || base, { anon }), `${opt.batch}|${principalId(opt.principal)}|${anon}|${opt.self || base}|${localAclGen()}`) : serverFetch(opt.self || base, { anon });
  await syncFonts();
  // the data CSV needs the tables' data only: no text layout, no pages (a report without a table falls back to its page text)
  const dataOnly = format === 'csv' && opt.csv !== 'layout' && !opt.modelOnly && !opt.firstPages;
  let sources;
  const run = (only) => render(d, /** @type {any} */ ({ ...renderOpts, ...(only ? { dataOnly: true, onSources: (s) => { sources = s; } } : sources ? { sources } : {}) }));
  const renderOpts = {
    parameters: opt.parameters || {}, state: opt.state || {}, fontStore: fontStore(), timeZone: checkTimeZone(opt.timeZone),
    baseUrl: base, fetch, timeoutMs: renderTimeoutMs(), deadline: Date.now() + renderTimeoutMs(), // one deadline for both CSV passes (dataOnly, then the full fallback)
    maxFetchBytes: fetchMaxBytes(), fetchTimeoutMs: fetchDeadlineMs(), // the engine's own fetch limits: the server's settings (PW_FETCH_MAX_MB, PW_FETCH_DEADLINE_MS)
    exportData: !opt.modelOnly && (format !== 'pdf' || !!opt.ua), // a plain PDF needs no table data
    ...(opt.firstPages ? { firstPages: opt.firstPages } : {}),
    sql: runSql, // SQL sources query the database directly, not through /api/data/sql
    loadReport: async (id) => {
      let sub;
      try { sub = await readRunnable(opt.principal || defaultPrincipal(), id); }
      catch (e) { throw e.status === 403 && /no designer saved/.test(e.message) ? e : new Error(`Report "${id}" not found`); } // the same words whether it is missing or not allowed
      assertFixedHosts(sub);
      opt.onLoadReport?.(id, sub); // thumbs.js: what else this render drew, for its principal-independence check
      return Array.isArray(sub?.dataSources) ? { ...sub, dataSources: sub.dataSources.map(normalizeSource) } : sub;
    },
  };
  // opt.out (a portSink): the data CSV streams when the report allows it (engine/stream.js), else the model path below
  // a PDF streams too (engine/paged.js; PDF/A and accessible ones included); signed and encrypted ones take the model path
  const pdfStreams = format === 'pdf' && !opt.sign && !opt.encrypt;
  if (opt.out && (dataOnly || ((format === 'xlsx' || pdfStreams) && !opt.modelOnly && !opt.firstPages)) && !opt.batch && process.env.PW_STREAM !== '0') {
    const r = await streamTo(d, format, def, renderOpts, opt);
    if (r) return r;
  }
  let model = await run(dataOnly);
  if (dataOnly && !model.regions.length) model = await run(false);
  let bytes = null;
  if (opt.modelOnly) return { bytes, model, contentType: FORMATS[format].type, ext: FORMATS[format].ext };
  // images by URL (a logo) go through the same guard; one that fails to load is left out, as in the viewer
  // with fixed hosts an image URL (often made by an expression) does not reach PW_INTERNAL_HOSTS either
  // images through the SSRF guard, never to PW_INTERNAL_HOSTS: an image URL comes from expressions and parameters,
  // which no designer stamp vouches for (internal hosts are for designer-saved data sources only)
  const imageFetch = serverFetch(opt.self || base, { internal: false });
  const fetchImage = async (src) => { try { const r = await imageFetch(new URL(src, base)); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
  if (format === 'pdf') {
    bytes = await exportPdf(model, fontStore(), { title: def.name, subset, fetchImage, drillBase: opt.self || base, // drill-through opens this server's viewer
      pdfa: opt.pdfa ? { icc: await iccProfile() } : undefined, tagged: opt.ua ? { lang: def.locale || 'en' } : undefined, prepare: signing?.prepare, save: signing?.save, encrypt: opt.encrypt });
    if (signing) bytes = await signing.sign(bytes);
  }
  else if (format === 'html') bytes = Buffer.from(await exportHtml(model, { fonts: fontStore(), title: def.name, subset, drillBase: opt.self || base, static: !!opt.static, locale: def.locale, currency: def.currency })); // drill-through opens this server's viewer (never a caller's baseUrl)
  else if (format === 'csv') bytes = Buffer.from(exportCsv(model, /** @type {any} */ ({ locale: def.locale, currency: def.currency, layout: opt.csv === 'layout' })));
  else if (format === 'docx') bytes = Buffer.from(await exportDocx(model, { title: def.name, lang: def.locale, fontStore: fontStore(), fetchImage }));
  else if (format === 'pptx') bytes = Buffer.from(await exportPptx(model, { title: def.name, lang: def.locale, fontStore: fontStore(), fetchImage }));
  else if (format === 'xlsx') { bytes = await exportXlsx(model, { currency: def.currency, title: def.name, formulas: formulasOn(opt.formulas), fontStore: fontStore(), fetchImage }); }
  else bytes = Buffer.from(JSON.stringify(model));
  return { bytes, model, contentType: FORMATS[format].type, ext: FORMATS[format].ext };
}
