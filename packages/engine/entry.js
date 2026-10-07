// @reportwright/engine: the report engine, the exporters and helpers, for Node and browsers.
import { FontStore } from '../../src/engine/index.js';
import { fontFile } from '../../src/engine/text/fonts.js';
export { render, FontStore, ITEMS, parameterOptions, resolveParameters } from '../../src/engine/index.js';
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
  try { return new URL(/** @type {any} */ (import.meta).resolve(`${pkg}/${file}`)); } catch { return undefined; }
}
/** @param {URL} url */
const readUrl = async (url) => url.protocol === 'file:' ? (await import(/* @vite-ignore */ /* webpackIgnore: true */ NODE_FS)).readFile(url) : new Uint8Array(await (await globalThis.fetch(url)).arrayBuffer()); // a browser: the fonts package's URL

/**
 * A FontStore over the @reportwright/fonts package (install it next to the engine). Throws when it isn't installed.
 * @returns {FontStore}
 */
export function defaultFontStore() {
  if (!fontsUrl('fonts/Inter-Regular.ttf')) throw new Error('Install @reportwright/fonts, or pass your own FontStore');
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
    deprecated(fn, `${fn}(model, fontStore, options) is replaced by ${fn}(model, { fonts: fontStore, ...options }); the old form is removed in 0.9`);
    return { ...(third || {}), fonts: second };
  }
  if (legacy === 'excel' && second && (typeof second === 'function' || typeof second.Workbook === 'function')) {
    deprecated(fn, `${fn}(model, ExcelJS, options) is replaced by ${fn}(model, options): ExcelJS is no longer used; the old form is removed in 0.9`);
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
export { tableFor, matrixFor } from '../../src/designer/tableGen.js';
