// @ts-check
/**
 * pdf-lib and fontkit, loaded on first use rather than at import: evaluating them was most of the engine's import time
 * (about 110 ms and 180 ms on an M2). await loadFontkit() (a font is parsed) or loadPdfLib() (exportPdf) first; the
 * bindings below are set then (ES modules' live bindings: `import { PDFName } from './lazylibs.js'` sees them).
 * Node: require() (both are CommonJS; import() of one costs ~60 ms more, its named exports read by Node's CJS lexer
 * through every re-exported file). Elsewhere (a bundler, a browser): import(), which a bundler may split into a chunk.
 */
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

/** @type {any} @pdf-lib/fontkit */ export let fontkit;
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

/** Node's require, from this module; undefined in a browser or bundle without process.getBuiltinModule (Node 20.16+) */
const req = (() => { try { return /** @type {any} */ (globalThis).process?.getBuiltinModule?.('module')?.createRequire(import.meta.url); } catch { return undefined; } })();
/** @param {string} name @param {() => Promise<any>} imp */
const load = async (name, imp) => { if (req) try { return req(name); } catch { /* not resolvable from here (a bundle): import() */ } return imp(); };

/**
 * Node: fontkit's UMD file, evaluated with its WOFF2 Brotli dictionary and its four Unicode tries (script, line
 * break, Indic and Universal shaping data) decoded on first use instead of at load: about 30 ms of every cold start,
 * and a Latin report needs none of them. Undefined (plain require) when the anchors are not all in the file, i.e.
 * another fontkit version.
 * ponytail: a text patch of one pinned dependency; the anchors check keeps an upgrade from breaking it, only slower.
 * @returns {any} the module, or undefined
 */
function lazyDictFontkit() {
  try {
    const proc = /** @type {any} */ (globalThis).process, file = req?.resolve('@pdf-lib/fontkit');
    if (!file || !file.endsWith('fontkit.umd.js')) return undefined;
    const src = proc.getBuiltinModule('fs').readFileSync(file, 'utf8');
    const eager = '\tdictionary.init(BrotliDecompressBuffer);\n', unused = '\tvar dictionary_2 = dictionary.dictionary;\n';
    if (src.split(eager).length !== 2 || src.split(unused).length !== 2) return undefined;
    const lazy = '\tObject.defineProperty(dictionary, "dictionary", { configurable: true, get() { const d = dictionaryDataCompressed.init(BrotliDecompressBuffer); Object.defineProperty(dictionary, "dictionary", { value: d }); return d; } });\n';
    // var trieData$1 = pako_1.inflate(base64Arraybuffer_2(base64DeflatedTrie$1));\n\tvar trie$1 = new unicodeTrie(trieData$1);  (only trie.get is used)
    let tries = 0;
    const patched = src.replace(unused, '').replace(eager, lazy).replace(
      /\tvar (trieData(?:\$\d)?) = (pako_1\.inflate\(base64Arraybuffer_2\(base64DeflatedTrie(?:\$\d)?\)\));\n((?:\t.*\n){0,3}?)\tvar (trie(?:\$\d)?) = new unicodeTrie\(\1\);\n/g,
      (_, _data, inflate, between, trie) => { tries++; return `${between}\tvar ${trie} = { get: function (c) { var t = new unicodeTrie(${inflate}); this.get = t.get.bind(t); return t.get(c); } };\n`; });
    if (tries !== 4) return undefined;
    const Module = proc.getBuiltinModule('module'), module = new Module(file);
    proc.getBuiltinModule('vm').compileFunction(patched, ['module', 'exports'], { filename: file })(module, module.exports);
    Object.assign(module, { filename: file, loaded: true });
    Module._cache[file] = module; // one fontkit in the process: a later require('@pdf-lib/fontkit') gets this one
    return module.exports;
  } catch { return undefined; }
}
/** @type {Promise<void>|undefined} */ let fk;
/** @type {Promise<void>|undefined} */ let pl;
/** @param {any} m */
const setFontkit = (m) => { const d = m.default || m; fontkit = d.default || d; };
/** @returns {Promise<void>} */
export const loadFontkit = () => (fk ||= (() => { const m = lazyDictFontkit(); return m ? Promise.resolve(m) : load('@pdf-lib/fontkit', () => import('@pdf-lib/fontkit')); })().then(setFontkit));
/** Whether fontkitSync() can load fontkit (Node), without loading it. */
export const canFontkitSync = () => !!req;
/**
 * fontkit now, synchronously: Node only (require), else undefined, and the caller loads it with loadFontkit().
 * @returns {any}
 */
export function fontkitSync() {
  if (fontkit || !req) return fontkit;
  try { setFontkit(lazyDictFontkit() || req('@pdf-lib/fontkit')); fk ||= Promise.resolve(); } catch { /* not resolvable from here: undefined */ }
  return fontkit;
}
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
/** pdf-lib and fontkit (exportPdf embeds fonts with both). @returns {Promise<void>} */
export const loadPdfLib = () => (pl ||= Promise.all([(req && pdfLibOneFile()) || load('pdf-lib', () => import('pdf-lib')), loadFontkit()]).then(([L]) => {
  ({ PDFDocument, PDFName, PDFString, PDFHexString, PDFRawStream, PDFImage, PngEmbedder, PDFStream, PDFArray, PDFDict, PDFNumber, PDFBool, rgb,
    pushGraphicsState, popGraphicsState, concatTransformationMatrix } = L);
}));
