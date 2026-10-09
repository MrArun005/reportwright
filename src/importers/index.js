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
 * A report file's bytes as text, in the file's own encoding: a UTF-16 (LE/BE) or UTF-8 byte-order mark, else the XML
 * declaration's encoding="…" (ISO-8859-1, Latin-1, windows-1252, …), else UTF-8. A compiled JasperReports file (.jasper,
 * Java serialization) is refused with a message naming the .jrxml.
 * @param {Uint8Array} bytes @returns {string}
 */
export function decodeXml(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xac && b[1] === 0xed) throw new Error('This is a compiled JasperReports file; import the .jrxml source instead.');
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  // the declaration is ASCII in every encoding this reads
  const decl = /^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(String.fromCharCode(...b.subarray(0, 200)));
  let enc = decl ? decl[1].toLowerCase() : 'utf-8';
  if (enc === 'utf-16' || enc === 'unicode') enc = 'utf-8'; // no BOM: a declaration that is readable as ASCII is not UTF-16
  try { return new TextDecoder(enc).decode(b); } catch { return new TextDecoder('utf-8').decode(b); } // an encoding the runtime does not know
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
