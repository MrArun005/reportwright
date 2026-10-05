// @pagewrightjs/engine: the report engine, the exporters and helpers, for Node and browsers.
import { FontStore } from '../../src/engine/index.js';
import { fontFile } from '../../src/engine/text/fonts.js';
export { render, FontStore, ITEMS, parameterOptions, resolveParameters } from '../../src/engine/index.js';
export { fontFile };
export { validate } from '../../src/engine/schema/validate.js';
export { blankReport, blankDashboard } from '../../src/engine/schema/template.js';
import { exportPdf as exportPdfFull } from '../../src/exporters/pdf.js';
import { createSubsetter } from '../../src/exporters/subset.js';
export { createSubsetter };

// Fonts, the shaper and harfbuzz-subset.wasm live in @pagewrightjs/fonts (kept out of the engine for size).
const NODE_FS = 'node:fs/promises'; // a variable, so browser bundlers leave the import alone
/** URL of a file in @pagewrightjs/fonts/public, or undefined when the package can't be resolved. @param {string} file */
function fontsUrl(file) {
  try { return new URL(/** @type {any} */ (import.meta).resolve(`@pagewrightjs/fonts/public/${file}`)); } catch { return undefined; }
}
/** @param {URL} url */
const readUrl = async (url) => url.protocol === 'file:' ? (await import(/* @vite-ignore */ /* webpackIgnore: true */ NODE_FS)).readFile(url) : new Uint8Array(await (await fetch(url)).arrayBuffer());

/**
 * A FontStore over the @pagewrightjs/fonts package (install it next to the engine). Throws when it isn't installed.
 * @returns {FontStore}
 */
export function defaultFontStore() {
  if (!fontsUrl('fonts/Inter-Regular.ttf')) throw new Error('Install @pagewrightjs/fonts, or pass your own FontStore');
  return new FontStore((key) => readUrl(/** @type {URL} */ (fontsUrl(`fonts/${fontFile(key)}`))));
}
/** @type {ReturnType<typeof createSubsetter>|undefined} */
let defaultSubset;

/**
 * Page model → PDF bytes. Fonts are subset by default with harfbuzz-subset.wasm from @pagewrightjs/fonts (when it
 * can't be loaded the full font is embedded); `subset: false` embeds every font in full, a function replaces the subsetter.
 * @param {any} model  render() output
 * @param {import('../../src/engine/text/fonts.js').FontStore} fontStore
 * @param {Omit<NonNullable<Parameters<typeof exportPdfFull>[2]>, 'subset'> & { subset?: false | NonNullable<Parameters<typeof exportPdfFull>[2]>['subset'] }} [opt]
 * @returns {Promise<Uint8Array>}
 */
export function exportPdf(model, fontStore, opt = {}) {
  const subset = opt.subset === false ? undefined : opt.subset || (defaultSubset ||= createSubsetter(async () => {
    const url = fontsUrl('harfbuzz-subset.wasm');
    if (!url) throw new Error('@pagewrightjs/fonts is not installed');
    return readUrl(url);
  }));
  return exportPdfFull(model, fontStore, { ...opt, subset });
}
export { exportHtml } from '../../src/exporters/html.js';
export { exportCsv } from '../../src/exporters/csv.js';
export { needsExportData } from '../../src/exporters/regions.js';
export { exportXlsx } from '../../src/exporters/xlsx.js';
export { exportDocx } from '../../src/exporters/docx.js';
export { exportPptx } from '../../src/exporters/pptx.js';
export { pageToSvg } from '../../src/exporters/svg.js';
export { tableFor, matrixFor } from '../../src/designer/tableGen.js';
