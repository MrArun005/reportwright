// @ts-check
// The Designer's Import action: a JasperReports, SSRS or BIRT design (XML) through the importers, or a ReportWright
// definition (.pw.json). Pure: the Designer decides what to do with the result.
import { importXmlReport } from '../importers/index.js';

const XML_FILE = /\.(jrxml|rdl|rdlc|rptdesign)$/i;

/**
 * @param {string} name the file's name (its extension says what it is)
 * @param {string} text the file's text
 * @returns {{ definition?: object, warnings: string[], error?: string }}
 */
export function readReportFile(name, text) {
  if (XML_FILE.test(name)) {
    const r = importXmlReport(text, { name: name.replace(/\.[^.]+$/, '') });
    return r.error ? { warnings: r.warnings, error: r.error } : { definition: r.definition, warnings: r.warnings };
  }
  if (/\.json$/i.test(name)) {
    let def;
    try { def = JSON.parse(text); } catch (e) { return { warnings: [], error: `${name} is not valid JSON (${e instanceof Error ? e.message : e})` }; }
    if (!def || typeof def !== 'object' || !def.sections) return { warnings: [], error: `${name} is not a report definition (it has no sections)` };
    return { definition: def, warnings: [] };
  }
  return { warnings: [], error: `${name} is not a report file: use .jrxml, .rdl, .rptdesign or .pw.json` };
}
