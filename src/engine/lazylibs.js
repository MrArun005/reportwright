// @ts-check
/**
 * pdf-lib and fontkit, loaded on first use rather than at import: evaluating them was most of the engine's import time
 * (about 110 ms and 180 ms on an M2). await loadFontkit() (a font is parsed) or loadPdfLib() (exportPdf) first; the
 * bindings below are set then (ES modules' live bindings: `import { PDFName } from './lazylibs.js'` sees them).
 * Node: require() (both are CommonJS; import() of one costs ~60 ms more, its named exports read by Node's CJS lexer
 * through every re-exported file). Elsewhere (a bundler, a browser): import(), which a bundler may split into a chunk.
 */
/** @typedef {typeof import('pdf-lib')} PdfLib */

/** @type {any} @pdf-lib/fontkit */ export let fontkit;
/** @type {PdfLib['PDFDocument']} */ export let PDFDocument;
/** @type {PdfLib['PDFName']} */ export let PDFName;
/** @type {PdfLib['PDFString']} */ export let PDFString;
/** @type {PdfLib['PDFHexString']} */ export let PDFHexString;
/** @type {PdfLib['PDFRawStream']} */ export let PDFRawStream;
/** @type {PdfLib['PDFStream']} */ export let PDFStream;
/** @type {PdfLib['PDFArray']} */ export let PDFArray;
/** @type {PdfLib['PDFDict']} */ export let PDFDict;
/** @type {PdfLib['PDFNumber']} */ export let PDFNumber;
/** @type {PdfLib['PDFBool']} */ export let PDFBool;
/** @type {PdfLib['rgb']} */ export let rgb;
/** @type {PdfLib['pushGraphicsState']} */ export let pushGraphicsState;
/** @type {PdfLib['popGraphicsState']} */ export let popGraphicsState;
/** @type {PdfLib['concatTransformationMatrix']} */ export let concatTransformationMatrix;

/** Node's require, from this module; undefined in a browser or bundle without process.getBuiltinModule (Node 20.16+) */
const req = (() => { try { return /** @type {any} */ (globalThis).process?.getBuiltinModule?.('module')?.createRequire(import.meta.url); } catch { return undefined; } })();
/** @param {string} name @param {() => Promise<any>} imp */
const load = async (name, imp) => { if (req) try { return req(name); } catch { /* not resolvable from here (a bundle): import() */ } return imp(); };

/** @type {Promise<void>|undefined} */ let fk;
/** @type {Promise<void>|undefined} */ let pl;
/** @returns {Promise<void>} */
export const loadFontkit = () => (fk ||= load('@pdf-lib/fontkit', () => import('@pdf-lib/fontkit')).then((/** @type {any} */ m) => { const d = m.default || m; fontkit = d.default || d; }));
/** pdf-lib and fontkit (exportPdf embeds fonts with both). @returns {Promise<void>} */
export const loadPdfLib = () => (pl ||= Promise.all([load('pdf-lib', () => import('pdf-lib')), loadFontkit()]).then(([L]) => {
  ({ PDFDocument, PDFName, PDFString, PDFHexString, PDFRawStream, PDFStream, PDFArray, PDFDict, PDFNumber, PDFBool, rgb,
    pushGraphicsState, popGraphicsState, concatTransformationMatrix } = L);
}));
