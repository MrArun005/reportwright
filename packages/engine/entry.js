// @reportwright/engine: the report engine, the exporters and helpers, for Node and browsers.
import { FontStore } from '../../src/engine/index.js';
import { fontFile } from '../../src/engine/text/fonts.js';
export { FontStore, ITEMS, parameterOptions, resolveParameters } from '../../src/engine/index.js';
/** @typedef {import('../../src/engine/index.js').RenderOptions} RenderOptions */
export { fontFile };
export { validate } from '../../src/engine/schema/validate.js';
export { blankReport, blankDashboard } from '../../src/engine/schema/template.js';
import { exportPdf as exportPdfFull } from '../../src/exporters/pdf.js';
import { createSubsetter } from '../../src/exporters/subset.js';
export { createSubsetter };

// Fonts, the shaper and harfbuzz-subset.wasm live in @reportwright/fonts (kept out of the engine for size).
const NODE_FS = 'node:fs/promises'; // a variable, so browser bundlers leave the import alone
/** URL of a file in @reportwright/fonts/public (or another package folder), or undefined when it can't be resolved. @param {string} file @param {string} [pkg] */
function fontsUrl(file, pkg = '@reportwright/fonts/public') {
  try { return new URL(/** @type {any} */ (import.meta).resolve(`${pkg}/${file}`)); } catch { /* no import.meta.resolve (a bundler, older Node): the Node module API below */ }
  try { // Node: require.resolve from this module, where getBuiltinModule exists (Node 20.16+, 22.3+)
    const proc = /** @type {any} */ (globalThis).process;
    const req = proc?.getBuiltinModule?.('module')?.createRequire(import.meta.url);
    return req ? proc.getBuiltinModule('url').pathToFileURL(req.resolve(`${pkg}/${file}`)) : undefined;
  } catch { return undefined; }
}
/** A folder as a URL: a URL as it is, a relative URL against the page, or (Node) a path. @param {string} s */
function folderUrl(s) {
  const folder = s.replace(/\/?$/, '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(folder)) return new URL(folder);
  if (globalThis.location) return new URL(folder, globalThis.location.href);
  return /** @type {any} */ (globalThis).process.getBuiltinModule('url').pathToFileURL(folder);
}
/** @param {URL} url */
const readUrl = async (url) => {
  if (url.protocol === 'file:') return (await import(/* @vite-ignore */ /* webpackIgnore: true */ NODE_FS)).readFile(url);
  const res = await globalThis.fetch(url); // a browser: the fonts folder's URL
  if (!res.ok) throw new Error(`Font ${url.pathname.split('/').pop()} did not load (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
};

/**
 * A FontStore over the @reportwright/fonts package (install it next to the engine). Throws when it isn't installed.
 * In a bundled browser app, pass `fontsUrl`: the URL (or, in Node, the path) of a copy of the package's public/fonts
 * folder; each font is read from there, and a missing one is an error.
 * @param {{ fontsUrl?: string }} [opts]
 * @returns {FontStore}
 */
export function defaultFontStore(opts = {}) {
  if (opts.fontsUrl) {
    const base = folderUrl(String(opts.fontsUrl));
    return new FontStore(async (key) => readUrl(new URL(fontFile(key), base)));
  }
  if (!fontsUrl('fonts/Inter-Regular.ttf')) throw new Error('Install @reportwright/fonts, or pass { fontsUrl } (a copy of its public/fonts folder), or your own FontStore');
  return new FontStore(async (key) => {
    const file = fontFile(key);
    // Chinese, Japanese, Korean and emoji: @reportwright/fonts-cjk (npx reportwright-fonts-cjk downloads them) when installed
    const cjk = file.startsWith('cjk/') ? fontsUrl(file.slice(4), '@reportwright/fonts-cjk/fonts') : undefined;
    if (cjk) try { return await readUrl(cjk); } catch { /* not downloaded: the fonts package's cjk/ folder, else no font */ }
    return readUrl(/** @type {URL} */ (fontsUrl(`fonts/${file}`)));
  });
}
/** @type {ReturnType<typeof createSubsetter>|undefined} */
let defaultSubset;

/** @type {Set<string>} */
const warned = new Set();
/** One console warning per deprecated form. @param {string} key @param {string} msg */
import { render as renderFull } from '../../src/engine/index.js';
import { checkOptions } from '../../src/engine/options.js';
/** @type {typeof renderFull} */
export async function render(def, opts) {
  const warn = checkOptions(opts);
  const model = await renderFull(def, opts);
  if (warn.length && model?.warnings) model.warnings.push(...warn);
  // A1.5: a model this size is most of render + exportPdf's memory; exportPdfStream lays a flowing table out in windows
  const rows = Math.max(0, ...Object.values(model?.stats?.rows || {}).map(Number));
  const limit = opts?.largeReportRows ?? LARGE_ROWS; // 0 or false: off
  if (limit && rows > Number(limit) && !opts?.dataOnly && model?.warnings) {
    const w = `Large report (${rows.toLocaleString('en-US')} rows): exportPdfStream writes it in about 320 MB; render + exportPdf holds it all in memory`;
    model.warnings.push(w);
    if (!warned.has('large')) { warned.add('large'); console.warn(`[@reportwright/engine] ${w}`); }
  }
  return model;
}
const LARGE_ROWS = 100_000; // render's largeReportRows default
const deprecated = (key, msg) => { if (!warned.has(key)) { warned.add(key); console.warn(`[@reportwright/engine] DEPRECATED: ${msg}`); } };
const isFontStore = (/** @type {any} */ x) => x instanceof FontStore || (!!x && typeof x === 'object' && typeof x.load === 'function' && typeof x.get === 'function');
/** @param {string} fn @param {any} model */
function checkModel(fn, model) {
  if (!model || typeof model !== 'object' || !Array.isArray(model.pages)) throw new TypeError(`${fn}(model, options): model must be the page model render() returns (an object with pages), got ${model === null ? 'null' : Array.isArray(model) ? 'an array' : typeof model}`);
}
/**
 * The options object of exportX(model, options), from either signature: (model, { fonts, ... }) or the 0.7
 * positional one (model, fontStore | ExcelJS, options), which still works in 0.8 with a deprecation warning.
 * @param {string} fn @param {any[]} args @param {'fonts'|'excel'|'none'} legacy what the 0.7 second argument was
 */
function optionsOf(fn, args, legacy) {
  const [model, second, third] = args;
  checkModel(fn, model);
  if (legacy === 'fonts' && isFontStore(second)) {
    deprecated(fn, `${fn}(model, fontStore, options) is replaced by ${fn}(model, { fonts: fontStore, ...options }); the old form will be removed in 1.0`);
    return { ...(third || {}), fonts: second };
  }
  if (legacy === 'excel' && second && (typeof second === 'function' || typeof second.Workbook === 'function')) {
    deprecated(fn, `${fn}(model, ExcelJS, options) is replaced by ${fn}(model, options): ExcelJS is no longer used; the old form will be removed in 1.0`);
    return { ...(third || {}) };
  }
  if (second != null && (typeof second !== 'object' || Array.isArray(second))) throw new TypeError(`${fn}(model, options): options must be an object such as { fonts }, got ${Array.isArray(second) ? 'an array' : typeof second}`);
  const o = { ...(second || {}) };
  if (o.fonts != null && !isFontStore(o.fonts)) throw new TypeError(`${fn}(model, { fonts }): fonts must be a FontStore (defaultFontStore() or new FontStore(loader)), got ${typeof o.fonts}`);
  return o;
}
/** The FontStore of the options, else the one over @reportwright/fonts. @param {any} o */
const fontsOf = (o) => o.fonts || o.fontStore || defaultFontStore();

/**
 * @typedef {Omit<NonNullable<Parameters<typeof exportPdfFull>[2]>, 'subset' | 'pdfa'> & {
 *   fonts?: FontStore, subset?: false | NonNullable<Parameters<typeof exportPdfFull>[2]>['subset'],
 *   pdfa?: boolean | { icc?: Uint8Array, [k: string]: unknown } }} PdfOptions
 */
/**
 * Page model → PDF bytes: exportPdf(model, { fonts, title, ... }). fonts: the FontStore render() used (default: the
 * one over @reportwright/fonts). Fonts are subset with harfbuzz-subset.wasm from @reportwright/fonts (when it can't be
 * loaded the full font is embedded); `subset: false` embeds every font in full, a function replaces the subsetter.
 * The 0.7 form exportPdf(model, fontStore, options) still works in 0.8 (deprecated).
 * @param {any} model  render() output
 * @param {PdfOptions} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function exportPdf(model, options) {
  const opt = optionsOf('exportPdf', [...arguments], 'fonts');
  for (const w of checkOptions(opt)) (opt.onWarning || console.warn)(w);
  const subset = opt.subset === false ? undefined : opt.subset || (defaultSubset ||= createSubsetter(async () => {
    const url = fontsUrl('harfbuzz-subset.wasm');
    if (!url) throw new Error('@reportwright/fonts is not installed');
    return readUrl(url);
  }));
  const { fonts, fontStore, ...rest } = opt;
  // pdfa: true (or without icc): the sRGB profile from @reportwright/fonts/public/icc
  if (rest.pdfa && !(typeof rest.pdfa === 'object' && rest.pdfa.icc)) {
    const url = fontsUrl('icc/sRGB-v2-magic.icc');
    if (!url) throw new Error('PDF/A needs an sRGB colour profile: install @reportwright/fonts, or pass pdfa: { icc: bytes }');
    rest.pdfa = { ...(typeof rest.pdfa === 'object' ? rest.pdfa : {}), icc: new Uint8Array(await readUrl(url)) };
  }
  return exportPdfFull(model, fontsOf(opt), /** @type {any} */ ({ ...rest, subset }));
}
/**
 * Page model → .xlsx bytes: exportXlsx(model, { fonts, currency, formulas, ... }) (needs render(def, { exportData: true })).
 * The 0.7 form exportXlsx(model, ExcelJS, options) still works in 0.8 (deprecated; ExcelJS is not used).
 * @param {any} model @param {NonNullable<Parameters<typeof exportXlsxFull>[1]> & { fonts?: FontStore }} [options]
 * @returns {Promise<Uint8Array>}
 */
export function exportXlsx(model, options) {
  const opt = optionsOf('exportXlsx', [...arguments], 'excel');
  return exportXlsxFull(model, { ...opt, fontStore: opt.fonts || opt.fontStore });
}
/**
 * Page model → .docx bytes: exportDocx(model, { fonts, ... }) (needs render(def, { exportData: true })).
 * @param {any} model @param {NonNullable<Parameters<typeof exportDocxFull>[1]> & { fonts?: FontStore }} [options]
 * @returns {Promise<Uint8Array>}
 */
export function exportDocx(model, options) {
  const opt = optionsOf('exportDocx', [...arguments], 'none');
  return exportDocxFull(model, { ...opt, fontStore: opt.fonts || opt.fontStore });
}
/**
 * Page model → .pptx bytes: exportPptx(model, { fonts, ... }).
 * @param {any} model @param {NonNullable<Parameters<typeof exportPptxFull>[1]> & { fonts?: FontStore }} [options]
 * @returns {Promise<Uint8Array>}
 */
export function exportPptx(model, options) {
  const opt = optionsOf('exportPptx', [...arguments], 'none');
  return exportPptxFull(model, { ...opt, fontStore: opt.fonts || opt.fontStore });
}
export { exportHtml } from '../../src/exporters/html.js';
export { exportCsv } from '../../src/exporters/csv.js';
export { needsExportData } from '../../src/exporters/regions.js';
import { exportXlsx as exportXlsxFull } from '../../src/exporters/xlsx.js';
import { exportDocx as exportDocxFull } from '../../src/exporters/docx.js';
import { exportPptx as exportPptxFull } from '../../src/exporters/pptx.js';
export { pageToSvg } from '../../src/exporters/svg.js';
import { exportPdfStream as exportPdfStreamFull, createPdfStream, paintPage, paintEnv } from '../../src/exporters/pdfstream.js';
import { latin1 } from '../../src/exporters/pdfpaint.js';
import { spillSorter, canSpill } from '../../src/exporters/spill.js';
/** internal: the paint worker (dist/pdfstreamworker.js) uses this bundle's painter, not a copy of the engine */
export const __streamPaint = { createPdfStream, paintPage, paintEnv, latin1 };
export { planPaged } from '../../src/engine/paged.js';

/**
 * @typedef {RenderOptions & Omit<PdfOptions, 'fonts'> & { fonts?: FontStore, tagged?: { lang?: string, maxElements?: number },
 *   window?: number, parallel?: number, maxRows?: number, id?: string, presorted?: boolean, signal?: AbortSignal,
 *   spill?: false | { dir?: string, maxMB?: number }, sorter?: (cmp: (a: any, b: any) => number) => any }} PdfStreamOptions
 *   render()'s options and exportPdf's, plus: window (rows laid out at once, 1000), parallel (Node: worker threads
 *   that lay out and paint pages, opt-in; the file is the same, each thread costs memory), maxRows (rows read,
 *   5,000,000), id (the file ID). presorted: the rows come in the report's order (its sort, its groups together), so
 *   they are not sorted, only checked as they pass (a row out of order stops the export). spill: where a sort's runs go
 *   (Node: the system temp folder, 2 GB at most; false sorts in memory); in a browser a sort is in memory.
 *   timeoutMs: the whole export's time limit, waits for the sink included (504, code 'ETIMEDOUT'). signal: an
 *   AbortSignal that stops the export at its next wait (rejects with the signal's reason, an AbortError); sqlRows gets
 *   it as its third argument ({ signal }) so a database cursor can cancel its query.
 */
/**
 * Report definition → PDF written to a sink as it is made, for reports too large to hold as a page model: a flowing
 * table (and its groups) is laid out a window of rows at a time and each page leaves memory once written. Other
 * reports are rendered whole and written by exportPdf in one piece (the result says why). sink: a Node Writable
 * (fs.createWriteStream) or anything with write(bytes) that may return a promise (back-pressure); it is not closed.
 * @param {any} def the report definition
 * @param {PdfStreamOptions} options
 * @param {{ write(bytes: Uint8Array): any, once?: (ev: string, cb: () => void) => any }} sink
 * @returns {Promise<{ streamed: boolean, pages: number, warnings: string[], why?: string }>}
 */
export async function exportPdfStream(def, options, sink) {
  const unknown = checkOptions(options);
  const { fonts, fontStore, subset: sub, pdfa, spill, ...rest } = /** @type {any} */ (options || {});
  const store = fonts || fontStore || defaultFontStore();
  const subset = sub === false ? undefined : sub || (defaultSubset ||= createSubsetter(async () => {
    const url = fontsUrl('harfbuzz-subset.wasm');
    if (!url) throw new Error('@reportwright/fonts is not installed');
    return readUrl(url);
  }));
  let pdfaOpt = pdfa;
  if (pdfa && !(typeof pdfa === 'object' && pdfa.icc)) {
    const url = fontsUrl('icc/sRGB-v2-magic.icc');
    if (!url) throw new Error('PDF/A needs an sRGB colour profile: install @reportwright/fonts, or pass pdfa: { icc: bytes }');
    pdfaOpt = { ...(typeof pdfa === 'object' ? pdfa : {}), icc: new Uint8Array(await readUrl(url)) };
  }
  // a sort (table sort, groups) spills its rows to disk in Node, so a grouped report's memory stays flat
  const sorter = rest.sorter || (spill !== false && canSpill() ? spillSorter({ ...(spill?.dir ? { dir: spill.dir } : {}), ...(spill?.maxMB ? { maxMB: spill.maxMB } : {}) }) : undefined);
  const r = await exportPdfStreamFull(def, { ...rest, sorter, fontStore: store, subset, pdfa: pdfaOpt, exportData: !!rest.tagged }, sink);
  if (unknown.length) r.warnings = [...unknown, ...r.warnings];
  return r;
}
export { tableFor, matrixFor } from '../../src/designer/tableGen.js';
