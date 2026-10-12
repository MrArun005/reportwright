// @ts-check
// What the streaming PDF's paint worker (pdfstreamworker.js) needs from the engine, behind one module. In the repo the
// worker imports it from here; in @reportwright/engine the package build makes this module external and points it at
// dist/index.js (which re-exports __streamPaint), so the worker uses the bundle's engine instead of a second copy.
import { render, FontStore } from '../engine/index.js';
import { reband, CAPPED } from '../engine/paged.js';
import { createPdfStream, paintPage, paintEnv } from './pdfstream.js';
import { latin1 } from './pdfpaint.js';

/** internal: the paint worker's engine */
export const __streamPaint = { render, FontStore, createPdfStream, paintPage, paintEnv, latin1, reband, CAPPED };
