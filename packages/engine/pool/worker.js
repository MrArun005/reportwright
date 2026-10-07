// One render thread of @reportwright/engine/pool: the engine and the fonts load once, then one job at a time.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { render, FontStore, fontFile, defaultFontStore, exportPdf, exportXlsx, exportDocx, exportPptx, exportHtml, exportCsv, needsExportData } from '@reportwright/engine';

const fonts = workerData?.fontsDir ? new FontStore((key) => fs.readFile(path.join(workerData.fontsDir, fontFile(key)))) : defaultFontStore();
const EXPORT = {
  pdf: (m, o) => exportPdf(m, { fonts, ...o }),
  xlsx: (m, o) => exportXlsx(m, { fonts, ...o }),
  docx: (m, o) => exportDocx(m, { fonts, ...o }),
  pptx: (m, o) => exportPptx(m, { fonts, ...o }),
  html: async (m, o) => new TextEncoder().encode(await exportHtml(m, fonts, o)),
  csv: async (m, o) => new TextEncoder().encode(exportCsv(m, o)),
};
/** @type {import('node:worker_threads').MessagePort} */ (parentPort).on('message', async ({ def, opts }) => {
  try {
    const format = opts.format || 'pdf';
    if (!EXPORT[format]) throw new Error(`unknown format "${format}" (pdf, xlsx, docx, pptx, html, csv)`);
    const model = await render(def, { fontStore: fonts, parameters: opts.parameters, timeZone: opts.timeZone, timeoutMs: opts.timeoutMs, exportData: needsExportData(format, opts.options) });
    const bytes = await EXPORT[format](model, opts.options || {});
    const buf = bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer;
    parentPort?.postMessage({ bytes: buf }, [buf]);
  } catch (e) {
    parentPort?.postMessage({ error: { message: String(e?.message || e), status: e?.status } });
  }
});
