// @pagewrightjs/engine: the report engine, the exporters and helpers, for Node and browsers.
export { render, FontStore, ITEMS, parameterOptions, resolveParameters } from '../../src/engine/index.js';
export { fontFile } from '../../src/engine/text/fonts.js';
export { validate } from '../../src/engine/schema/validate.js';
export { blankReport, blankDashboard } from '../../src/engine/schema/template.js';
import { exportPdf as exportPdfFull } from '../../src/exporters/pdf.js';
import { createSubsetter } from '../../src/exporters/subset.js';
export { createSubsetter };

// The package's own harfbuzz-subset.wasm (public/ next to dist/): read from disk in Node, fetched in a browser.
const WASM = new URL('../public/harfbuzz-subset.wasm', import.meta.url);
const NODE_FS = 'node:fs/promises'; // a variable, so browser bundlers leave the import alone
/** @type {ReturnType<typeof createSubsetter>|undefined} */
let defaultSubset;

/**
 * Page model → PDF bytes. Fonts are subset by default with the package's own harfbuzz-subset.wasm (a failed
 * load embeds the full font); `subset: false` embeds every font in full, a function replaces the subsetter.
 * @param {any} model  render() output
 * @param {import('../../src/engine/text/fonts.js').FontStore} fontStore
 * @param {Omit<NonNullable<Parameters<typeof exportPdfFull>[2]>, 'subset'> & { subset?: false | NonNullable<Parameters<typeof exportPdfFull>[2]>['subset'] }} [opt]
 * @returns {Promise<Uint8Array>}
 */
export function exportPdf(model, fontStore, opt = {}) {
  const subset = opt.subset === false ? undefined : opt.subset || (defaultSubset ||= createSubsetter(async () =>
    WASM.protocol === 'file:' ? (await import(/* @vite-ignore */ /* webpackIgnore: true */ NODE_FS)).readFile(WASM) : (await fetch(WASM)).arrayBuffer()));
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
