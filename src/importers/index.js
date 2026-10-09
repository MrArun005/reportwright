// @ts-check
/** One entry for report files that are XML: SSRS (.rdl, .rdlc), JasperReports (.jrxml) and BIRT (.rptdesign), told apart by the root element. */
import { importRdl } from './rdl.js';
import { importJrxml } from './jrxml.js';
import { importBirt } from './birt.js';

/** The local name of the first element (after the declaration, comments and a DOCTYPE), read without parsing. */
export function rootName(s) {
  let i = 0;
  for (let n = 0; n < 64; n++) {
    i = s.indexOf('<', i);
    if (i < 0) return '';
    if (s.startsWith('<?', i) || s.startsWith('<!', i)) {
      const e = s.startsWith('<!--', i) ? s.indexOf('-->', i) : s.indexOf('>', i);
      if (e < 0) return '';
      i = e + 1; continue;
    }
    const m = /^<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/.exec(s.slice(i, i + 200));
    return m ? m[2] : '';
  }
  return '';
}

/**
 * @param {string} text @param {{ name?: string, resolve?: (kind: any, ref: string) => string | null | undefined }} [opts] resolve: see importRdl and importJrxml
 * @returns {ReturnType<typeof importRdl>}
 */
export function importXmlReport(text, opts = {}) {
  const root = rootName(String(text ?? ''));
  if (root === 'jasperReport') return importJrxml(text, opts);
  if (root === 'report') return importBirt(text, opts);
  return importRdl(text, opts);
}
