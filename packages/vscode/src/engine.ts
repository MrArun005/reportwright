// The engine side of the extension, bundled to dist/engine.js and loaded on first use (see esbuild.mjs).
// The same render and exporters as the CLI (bin/pw.mjs); fonts and the PDF subsetter come from dist/ next to this file.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
// the engine's public entry (packages/engine/entry.js), and the importer the CLI's `pw import` uses
import { render, validate, defaultFontStore, exportPdf, exportXlsx, exportDocx, exportHtml, createSubsetter, blankReport } from '../../engine/entry.js';
import { importXmlReport, decodeXml } from '../../../src/importers/index.js';
import { importRdlx } from '../../../src/importers/rdlx.js';

export { validate, blankReport };
export type Format = 'pdf' | 'xlsx' | 'docx' | 'html';
export interface RenderedFile { bytes: Uint8Array; warnings: string[] }

let fontStore: any;
const store = () => (fontStore ??= defaultFontStore({ fontsUrl: pathToFileURL(path.join(__dirname, 'fonts')).href }));
const subset = createSubsetter(() => fs.promises.readFile(path.join(__dirname, 'harfbuzz-subset.wasm')));

/** Keyed data (`{ source: rows }`) goes into the sources by name, as the viewer's mountViewer does. Copied from src/embed/index.js (withData). */
export function withData(def: any, data: any) {
  if (data == null || !def) return def;
  const srcs: any[] = def.dataSources || [];
  const keyed = typeof data === 'object' && !Array.isArray(data) && srcs.some((s) => Object.hasOwn(data, s.name));
  if (!keyed && srcs.length !== 1) throw new Error(`data must be keyed by data source name (${srcs.map((s) => s.name).join(', ') || 'the report has none'})`);
  const of = (s: any) => (keyed ? (Object.hasOwn(data, s.name) ? data[s.name] : undefined) : data);
  return { ...def, dataSources: srcs.map((s) => (of(s) === undefined ? s : { name: s.name, type: 'json', data: of(s) })) };
}

/** Renders a report to a page model (what every exporter takes). baseUrl: where relative REST sources resolve. */
export function renderModel(def: any, data?: any, baseUrl?: string): Promise<any> {
  return render(withData(def, data), { fontStore: store(), baseUrl: baseUrl || undefined });
}

/** The bytes of one export, plus the render's warnings. */
export async function renderFile(format: Format, def: any, data?: any, baseUrl?: string): Promise<RenderedFile> {
  const model = await renderModel(def, data, baseUrl);
  const fonts = store();
  const title = def.name;
  let bytes: Uint8Array;
  if (format === 'pdf') bytes = await exportPdf(model, { fonts, title, subset });
  else if (format === 'xlsx') bytes = await exportXlsx(model, { currency: def.currency, title, formulas: true, fontStore: fonts });
  else if (format === 'docx') bytes = await exportDocx(model, { title, lang: def.locale, fontStore: fonts });
  else bytes = await exportHtml(model, { fonts, title, subset, static: false, locale: def.locale, currency: def.currency });
  return { bytes, warnings: [...(model.warnings || [])] };
}

/** An SSRS (.rdl/.rdlc/.rds), JasperReports (.jrxml), BIRT (.rptdesign) or ActiveReports (.rdlx-json) file as a ReportWright definition, with the import notes. Same routes as src/cli/importBatch.js. */
export function importReport(bytes: Uint8Array, name: string, activeReports = false): { definition?: any; warnings: string[]; error?: string; stats?: any } {
  let r: any;
  if (activeReports) {
    try { r = importRdlx(JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '')), { name }); }
    catch (e) { return { warnings: [], error: `The file is not valid JSON (${(e as Error).message}).` }; }
  } else r = importXmlReport(decodeXml(bytes), { name });
  return { definition: r.error ? undefined : r.definition, warnings: r.warnings || [], error: r.error, stats: r.stats };
}
