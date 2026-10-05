// @ts-check
/** Barcodes from bwip-js (100+ symbologies), turned into page-model paths. */
// bwip-js is about 1 MB: it loads only for reports that have a barcode (render() calls loadBarcodes first)
/** @type {any} */
let bwip = null;
export async function loadBarcodes() {
  if (!bwip) { const m = /** @type {any} */ (await import('bwip-js')); bwip = m.default || m; }
}

/**
 * The symbologies the designer offers: bwip-js id, friendly name, 2D or not, a sample that draws, and the
 * longest input accepted (checked before bwip-js runs, so a huge value cannot tie up the renderer).
 * bwip-js draws many more; any of its ids still works in a report definition.
 */
const S = (id, name, sample, max = 128, twoD = false) => ({ id, name, sample, max, twoD });
export const SYMBOLOGIES = [
  S('code128', 'Code 128', 'Pagewright-128'),
  S('gs1-128', 'GS1-128', '(01)09521234543213(10)ABC123'),
  S('code39', 'Code 39', 'CODE-39'),
  S('code39ext', 'Code 39 Extended', 'Code39 Ext'),
  S('code93', 'Code 93', 'CODE93'),
  S('code93ext', 'Code 93 Extended', 'Code93 Ext'),
  S('code11', 'Code 11', '0123452'),
  S('rationalizedCodabar', 'Codabar', 'A0123456789B'),
  S('interleaved2of5', 'Interleaved 2 of 5', '2401234567'),
  S('itf14', 'ITF-14', '04601234567893'),
  S('ean13', 'EAN-13', '9520123456788', 20),
  S('ean8', 'EAN-8', '95200002', 12),
  S('ean5', 'EAN-5 (add-on)', '90200', 5),
  S('ean2', 'EAN-2 (add-on)', '05', 2),
  S('upca', 'UPC-A', '416000336108', 20),
  S('upce', 'UPC-E', '00123457', 12),
  S('isbn', 'ISBN', '978-1-56581-231-4', 24),
  S('issn', 'ISSN', '0311-175X', 16),
  S('ismn', 'ISMN', '979-0-2605-3211-3', 24),
  S('ean14', 'EAN-14', '(01)04601234567893', 24),
  S('sscc18', 'SSCC-18', '(00)106141412345678908', 26),
  S('msi', 'MSI Plessey', '0123456709'),
  S('plessey', 'Plessey UK', '01234ABCD'),
  S('pharmacode', 'Pharmacode', '117480', 6),
  S('telepen', 'Telepen', 'Telepen'),
  S('databaromni', 'GS1 DataBar Omnidirectional', '(01)24012345678905', 20),
  S('databarlimited', 'GS1 DataBar Limited', '(01)15012345678907', 20),
  S('databarexpanded', 'GS1 DataBar Expanded', '(01)98898765432106(3202)012345(15)991231', 80),
  S('postnet', 'USPS POSTNET', '01234', 12),
  S('planet', 'USPS PLANET', '01234567890', 14),
  S('onecode', 'USPS Intelligent Mail', '0123456709498765432101234567891', 34),
  S('royalmail', 'Royal Mail 4-State', 'LE28HS9Z', 32),
  S('kix', 'Dutch KIX', '1231FZ13XHS', 32),
  S('auspost', 'Australia Post', '5956439111ABA 9', 32),
  S('japanpost', 'Japan Post', '6540123789-A-K-Z', 32),
  S('code16k', 'Code 16K', 'Code 16K', 77, true),
  S('code49', 'Code 49', 'CODE 49', 49, true),
  S('codablockf', 'Codablock F', 'CODABLOCK F', 2725, true),
  S('qrcode', 'QR Code', 'https://pagewright.dev', 7089, true),
  S('microqrcode', 'Micro QR Code', '1234', 35, true),
  S('gs1qrcode', 'GS1 QR Code', '(01)03453120000011(10)ABCD1234', 2000, true),
  S('datamatrix', 'Data Matrix', 'Data Matrix', 3116, true),
  S('gs1datamatrix', 'GS1 Data Matrix', '(01)03453120000011(17)191125(10)ABCD1234', 2000, true),
  S('pdf417', 'PDF417', 'PDF417 sample', 2710, true),
  S('micropdf417', 'MicroPDF417', 'MicroPDF417', 366, true),
  S('azteccode', 'Aztec Code', 'Aztec sample', 3832, true),
  S('maxicode', 'MaxiCode', 'MaxiCode sample', 138, true),
  S('dotcode', 'DotCode', 'DotCode sample', 450, true),
  S('hanxin', 'Han Xin', 'Han Xin sample', 3261, true),
];
const BY_ID = new Map(SYMBOLOGIES.map(s => [s.id, s]));
/** Kept for older callers: the ids in the designer's list. */
export const BARCODE_TYPES = SYMBOLOGIES.map(s => s.id);
/** Any other bwip-js id: still drawn, with a generic input cap. */
const OTHER_MAX = 4096;

const QR = ['qrcode', 'microqrcode', 'gs1qrcode'];
const DM = ['datamatrix', 'gs1datamatrix'];
const PDF = ['pdf417', 'micropdf417'];
/**
 * Per-symbology options, as flat item keys. Each is checked against a list or a range: nothing a report
 * author types reaches bwip-js unchecked.
 */
export const BARCODE_OPTIONS = [
  { key: 'qrErrorLevel', label: 'Error correction', for: QR, opt: 'eclevel', enum: ['L', 'M', 'Q', 'H'] },
  { key: 'qrVersion', label: 'Version (1–40, empty = smallest)', for: QR, opt: 'version', int: [1, 40], str: true },
  { key: 'qrMask', label: 'Mask (1–8)', for: QR, opt: 'mask', int: [1, 8] },
  { key: 'dmShape', label: 'Shape', for: DM, opt: 'format', enum: ['square', 'rectangle'] },
  { key: 'dmSize', label: 'Rows×columns (e.g. 24x24)', for: DM, opt: 'rows', size: true },
  { key: 'pdfColumns', label: 'Columns (1–30)', for: PDF, opt: 'columns', int: [1, 30] },
  { key: 'pdfRows', label: 'Rows (3–90)', for: ['pdf417'], opt: 'rows', int: [3, 90] },
  { key: 'pdfErrorLevel', label: 'Error correction (0–8)', for: ['pdf417'], opt: 'eclevel', int: [0, 8] },
  { key: 'pdfCompact', label: 'Compact (truncated)', for: ['pdf417'], opt: 'compact', bool: true },
  { key: 'aztecLayers', label: 'Layers (1–32)', for: ['azteccode'], opt: 'layers', int: [1, 32] },
  { key: 'aztecErrorPercent', label: 'Error correction % (5–95)', for: ['azteccode'], opt: 'eccpercent', int: [5, 95] },
  { key: 'maxiMode', label: 'Mode (2–6)', for: ['maxicode'], opt: 'mode', int: [2, 6] },
  { key: 'checkDigit', label: 'Add a check digit', for: ['code39', 'code39ext', 'code93', 'code93ext', 'interleaved2of5', 'rationalizedCodabar', 'code11', 'msi'], opt: 'includecheck', bool: true },
  { key: 'barRatio', label: 'Wide-to-narrow ratio (2–3)', for: ['code39', 'code39ext', 'interleaved2of5', 'rationalizedCodabar'], opt: 'barratio', num: [2, 3] },
];

/**
 * bwip-js options from an item's flat keys, for its symbology only.
 * @param {Record<string, any>} item
 */
export function bwipOptions(item) {
  const sym = item.symbology || item.type || 'code128';
  /** @type {Record<string, any>} */
  const out = {};
  for (const o of BARCODE_OPTIONS) {
    if (!o.for.includes(sym)) continue;
    const v = item[o.key];
    if (v == null || v === '') continue;
    if (o.enum) { if (o.enum.includes(String(v))) out[o.opt] = String(v); }
    else if (o.bool) { if (v === true || v === 'true') out[o.opt] = true; }
    else if (o.size) {
      const m = /^(\d{1,3})\s*[x×]\s*(\d{1,3})$/i.exec(String(v).trim());
      if (m) { out.rows = Number(m[1]); out.columns = Number(m[2]); }
    } else {
      const [lo, hi] = o.int || o.num;
      const n = Number(v);
      if (Number.isFinite(n) && n >= lo && n <= hi && (!o.int || Number.isInteger(n))) out[o.opt] = o.str ? String(n) : n;
    }
  }
  return out;
}

/**
 * Every symbology bwip-js draws (its symbolList bcids, kept here so a check needs no 1 MB import; a test compares).
 * A report may use any of them; the designer offers SYMBOLOGIES.
 */
export const BWIP_IDS = new Set([
  'ean5', 'ean2', 'ean13', 'ean8', 'upca', 'upce', 'isbn', 'ismn', 'issn', 'mands', 'code128', 'gs1-128', 'ean14',
  'sscc18', 'code39', 'code39ext', 'code32', 'pzn', 'code93', 'code93ext', 'interleaved2of5', 'itf14', 'identcode',
  'leitcode', 'databaromni', 'databarstacked', 'databarstackedomni', 'databartruncated', 'databarlimited',
  'databarexpanded', 'databarexpandedstacked', 'gs1northamericancoupon', 'pharmacode', 'pharmacode2', 'code2of5',
  'industrial2of5', 'iata2of5', 'matrix2of5', 'coop2of5', 'datalogic2of5', 'code11', 'bc412', 'rationalizedCodabar',
  'onecode', 'postnet', 'planet', 'royalmail', 'auspost', 'kix', 'japanpost', 'msi', 'plessey', 'telepen',
  'telepennumeric', 'posicode', 'codablockf', 'code16k', 'code49', 'channelcode', 'flattermarken', 'raw', 'daft',
  'symbol', 'pdf417', 'pdf417compact', 'micropdf417', 'datamatrix', 'datamatrixrectangular',
  'datamatrixrectangularextension', 'mailmark', 'qrcode', 'swissqrcode', 'microqrcode', 'rectangularmicroqrcode',
  'maxicode', 'azteccode', 'azteccodecompact', 'aztecrune', 'codeone', 'hanxin', 'dotcode', 'ultracode', 'gs1-cc',
  'ean13composite', 'ean8composite', 'upcacomposite', 'upcecomposite', 'databaromnicomposite',
  'databarstackedcomposite', 'databarstackedomnicomposite', 'databartruncatedcomposite', 'databarlimitedcomposite',
  'databarexpandedcomposite', 'databarexpandedstackedcomposite', 'gs1-128composite', 'd3aqr', 'gs1datamatrix',
  'gs1datamatrixrectangular', 'gs1dldatamatrix', 'gs1qrcode', 'gs1dlqrcode', 'gs1dotcode', 'hibccode39',
  'hibccode128', 'hibcdatamatrix', 'hibcdatamatrixrectangular', 'hibcpdf417', 'hibcmicropdf417', 'hibcqrcode',
  'hibccodablockf', 'hibcazteccode',
]);
/** Short names people write for a symbology (qr, dm, ean): the id they mean. */
const NICK = { qr: 'qrcode', 'qr-code': 'qrcode', dm: 'datamatrix', 'data-matrix': 'datamatrix', ean: 'ean13', upc: 'upca', c128: 'code128', aztec: 'azteccode', pdf: 'pdf417', itf: 'interleaved2of5', codabar: 'rationalizedCodabar' };
/**
 * Why a symbology cannot draw, with the id that was probably meant ("qr" → "qrcode"); null when it is known.
 * @param {any} sym
 */
export function symbologyError(sym) {
  const s = String(sym ?? '');
  if (BWIP_IDS.has(s)) return null;
  const lower = s.toLowerCase();
  const all = [...BWIP_IDS];
  const near = NICK[lower] || all.find(id => id.toLowerCase() === lower)
    || (lower.length >= 2 ? SYMBOLOGIES.find(x => x.id.startsWith(lower))?.id || all.find(id => id.startsWith(lower)) : null);
  return `"${s.slice(0, 40)}" is not a barcode symbology${near ? ` (did you mean "${near}"?)` : ''}`;
}

/** @param {string} id */
export const isTwoD = (id) => BY_ID.get(id)?.twoD ?? false;

/** Scale and move every coordinate of an SVG path (absolute and relative commands). */
export function transformPath(d, sx, sy, tx, ty) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const out = [];
  let cmd = 'M', i = 0, argi = 0;
  const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  while (i < toks.length) {
    const t = toks[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; out.push(t); argi = 0; i++; continue; }
    const C = cmd.toUpperCase(), rel = cmd !== C;
    const n = Number(t);
    let v = n;
    if (C === 'H') v = n * sx + (rel ? 0 : tx);
    else if (C === 'V') v = n * sy + (rel ? 0 : ty);
    else if (C === 'A') {
      const k = argi % 7;
      v = k === 0 ? n * sx : k === 1 ? n * sy : k === 5 ? n * sx + (rel ? 0 : tx) : k === 6 ? n * sy + (rel ? 0 : ty) : n;
    } else {
      const isX = argi % 2 === 0;
      v = isX ? n * sx + (rel ? 0 : tx) : n * sy + (rel ? 0 : ty);
    }
    out.push(String(Math.round(v * 1000) / 1000));
    argi++; i++;
    if (ARGS[C] && argi >= ARGS[C] && C !== 'M') argi = 0;
    if (C === 'M' && argi >= 2) { argi = 0; cmd = rel ? 'l' : 'L'; }
  }
  return out.join(' ');
}

/**
 * @param {{ type?: string, text: any, x: number, y: number, w: number, h: number, color?: string, showText?: boolean,
 *   textHeight?: number, captionAbove?: boolean, options?: Record<string, any> }} a
 * @returns {{ items: any[], error?: string, twoD?: boolean }} paths in item-local coordinates
 */
export function paintBarcode({ type = 'code128', text, x, y, w, h, color = '#000000', showText = true, textHeight = 0, captionAbove = false, options = {} }) {
  if (!text) return { items: [] };
  text = String(text);
  const bad = symbologyError(type);
  if (bad) return { items: [], error: bad };
  const max = BY_ID.get(type)?.max ?? OTHER_MAX;
  if (text.length > max) return { items: [], error: `The value is too long for ${BY_ID.get(type)?.name || type} (${text.length} characters; at most ${max})` };
  if (!bwip) return { items: [], error: 'The barcode library is not loaded (call loadBarcodes() before layout)' };
  const twoD = isTwoD(type);
  let svg;
  try {
    // height sets a 1D code's bar height (stretched to the box anyway); a 2D code keeps its own module grid
    svg = bwip.toSVG({ ...options, bcid: type, text, scale: 1, ...(twoD ? {} : { height: 10 }), includetext: false, paddingwidth: 0, paddingheight: 0 });
  } catch (e) {
    return { items: [], error: String(e.message || e).replace(/^bwipp\.\w+#\d+:\s*/, '') };
  }
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!vb) return { items: [], error: 'No barcode output' };
  const vw = Number(vb[1]), vh = Number(vb[2]);
  const capH = showText && !twoD ? textHeight : 0;
  const availH = Math.max(1, h - capH);
  let sx = w / vw, sy = availH / vh, ox = x, oy = y + (captionAbove ? capH : 0);
  if (twoD) { const s = Math.min(sx, sy); sx = sy = s; ox = x + (w - vw * s) / 2; oy = y + (availH - vh * s) / 2; }
  const items = [];
  for (const m of svg.matchAll(/<path([^>]*)d="([^"]+)"/g)) {
    const attrs = m[1];
    const sw = /stroke-width="([\d.]+)"/.exec(attrs);
    const d = transformPath(m[2], sx, sy, 0, 0);
    if (/stroke=/.test(attrs) && sw) items.push({ t: 'path', x: ox, y: oy, d, fill: null, stroke: color, strokeWidth: Number(sw[1]) * sx, lineCap: 'butt' });
    else items.push({ t: 'path', x: ox, y: oy, d, fill: color, stroke: null });
  }
  return { items, twoD };
}
