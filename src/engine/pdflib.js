// @ts-check
/**
 * pdf-lib, loaded on first use (exportPdf awaits loadPdfLib(); an optional install since B4); the bindings below are set then (ES modules' live
 * bindings: `import { PDFName } from './pdflib.js'` sees them). Apart from lazylibs.js (fontkit), so the viewer's first
 * load does not carry it.
 */
import { req, load, loadFontkit } from './lazylibs.js';
/** @typedef {typeof import('pdf-lib')} PdfLib */
/* the classes as types too (JSDoc such as @param {PDFDocument} doc in the modules that import these) */
/** @typedef {import('pdf-lib').PDFDocument} PDFDocument */
/** @typedef {import('pdf-lib').PDFName} PDFName */
/** @typedef {import('pdf-lib').PDFString} PDFString */
/** @typedef {import('pdf-lib').PDFHexString} PDFHexString */
/** @typedef {import('pdf-lib').PDFRawStream} PDFRawStream */
/** @typedef {import('pdf-lib').PDFStream} PDFStream */
/** @typedef {import('pdf-lib').PDFArray} PDFArray */
/** @typedef {import('pdf-lib').PDFDict} PDFDict */
/** @typedef {import('pdf-lib').PDFNumber} PDFNumber */
/** @typedef {import('pdf-lib').PDFBool} PDFBool */

/** @type {PdfLib['PDFDocument']} */ export let PDFDocument;
/** @type {PdfLib['PDFName']} */ export let PDFName;
/** @type {PdfLib['PDFString']} */ export let PDFString;
/** @type {PdfLib['PDFHexString']} */ export let PDFHexString;
/** @type {PdfLib['PDFRawStream']} */ export let PDFRawStream;
/** @type {PdfLib['PDFImage']} */ export let PDFImage;
/** @type {PdfLib['PngEmbedder']} */ export let PngEmbedder;
/** @type {PdfLib['PDFStream']} */ export let PDFStream;
/** @type {PdfLib['PDFArray']} */ export let PDFArray;
/** @type {PdfLib['PDFDict']} */ export let PDFDict;
/** @type {PdfLib['PDFNumber']} */ export let PDFNumber;
/** @type {PdfLib['PDFBool']} */ export let PDFBool;
/** @type {PdfLib['rgb']} */ export let rgb;
/** @type {PdfLib['pushGraphicsState']} */ export let pushGraphicsState;
/** @type {PdfLib['popGraphicsState']} */ export let popGraphicsState;
/** @type {PdfLib['concatTransformationMatrix']} */ export let concatTransformationMatrix;
/** @type {Promise<void>|undefined} */ let pl;
/**
 * Node: pdf-lib's one-file build (dist/pdf-lib.min.js, the same 1.17.1 code) instead of its CommonJS tree of ~200
 * files: about 25 ms to load instead of ~100. It is put in require's cache under the package's main file, so a later
 * require('pdf-lib') (a prepare hook, the signer) gets the same classes; one already loaded is used as it is.
 * ponytail: relies on pdf-lib's layout (cjs/index.js + dist/pdf-lib.min.js); anything else falls back to require.
 * @returns {any} the module, or undefined
 */
function pdfLibOneFile() {
  try {
    const Module = /** @type {any} */ (globalThis).process.getBuiltinModule('module'), main = req.resolve('pdf-lib');
    if (Module._cache[main]) return Module._cache[main].exports;
    const one = req.resolve('pdf-lib/dist/pdf-lib.min.js');
    if (!main.endsWith('cjs/index.js')) return undefined;
    const m = req(one);
    Module._cache[main] = Module._cache[one];
    return m;
  } catch { return undefined; }
}
/** the specifier, not a literal: bundlers leave pdf-lib out (it is no dependency of the packages any more) */
const PDF_LIB = 'pdf-lib';
/**
 * pdf-lib and fontkit, for what still takes pdf-lib's path: pdfWriter 'legacy' (pictures, fields, PDF/A, tagged,
 * encryption) and the deprecated prepare and save options, until 0.15. pdf-lib is not installed with the packages: the
 * caller installs it (npm i pdf-lib@1.17.1). @returns {Promise<void>}
 */
export const loadPdfLib = () => (pl ||= Promise.all([(req && pdfLibOneFile()) || load(PDF_LIB, () => import(/* @vite-ignore */ /* webpackIgnore: true */ PDF_LIB)).catch((/** @type {any} */ e) => {
  throw Object.assign(new Error(`This PDF export takes pdf-lib's path (pdfWriter 'legacy', or the deprecated prepare and save options), and pdf-lib is not installed: npm i pdf-lib@1.17.1, or use the default writer (${e?.code || e?.message || e})`), { status: 501, cause: e });
}), loadFontkit()]).then(([L]) => {
  // plain assignments, not a destructuring one: Turbopack's build did not update the exported bindings from that
  PDFDocument = L.PDFDocument; PDFName = L.PDFName; PDFString = L.PDFString; PDFHexString = L.PDFHexString; PDFRawStream = L.PDFRawStream; PDFImage = L.PDFImage; PngEmbedder = L.PngEmbedder; PDFStream = L.PDFStream; PDFArray = L.PDFArray; PDFDict = L.PDFDict; PDFNumber = L.PDFNumber; PDFBool = L.PDFBool; rgb = L.rgb; pushGraphicsState = L.pushGraphicsState; popGraphicsState = L.popGraphicsState; concatTransformationMatrix = L.concatTransformationMatrix;
}));
