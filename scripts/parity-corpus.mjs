// The Phase B corpus of scripts/writer-parity.mjs: a report for every feature that only the pdf-lib whole-model path
// draws today (images, SVG, rounded boxes, path items, form fields, encryption, signing, whole-model PDF/A and
// PDF/UA, mixed page sizes, restarted page numbers). Usage: node scripts/writer-parity.mjs --baseline pdflib --corpus scripts/parity-corpus.mjs
// A case may carry `accept`: an owner-decided difference, with its reason, printed in the gate's output.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.join(import.meta.dirname, '..');
const ICC = fs.readFileSync(path.join(root, 'public/icc/sRGB-v2-magic.icc'));

/** A PNG of w×h pixels: colour type 2 (RGB) or 6 (RGBA), bit depth 8 or 16; px(x, y) gives [r, g, b, a] in 0–1. */
function png(w, h, { type = 2, depth = 8 }, px) {
  const ch = type === 6 ? 4 : 3, bpc = depth / 8, max = depth === 16 ? 65535 : 255;
  const raw = Buffer.alloc(h * (1 + w * ch * bpc));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const v = px(x, y);
      for (let c = 0; c < ch; c++) { const n = Math.round(v[c] * max); if (bpc === 2) { raw.writeUInt16BE(n, o); o += 2; } else raw[o++] = n; }
    }
  }
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = type;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const uri = (mime, b) => `data:${mime};base64,${Buffer.from(b).toString('base64')}`;
const grad = (w, h) => (x, y) => [x / (w - 1), y / (h - 1), 1 - x / (w - 1), 1];
const PNG8 = uri('image/png', png(48, 24, { type: 2, depth: 8 }, grad(48, 24)));
const PNG16 = uri('image/png', png(48, 24, { type: 2, depth: 16 }, grad(48, 24)));
const PNGA = uri('image/png', png(48, 24, { type: 6, depth: 8 }, (x, y) => [0.15, 0.4, 0.9, Math.min(1, Math.hypot(x - 24, y - 12) / 24)]));
const JPEG_BYTES = fs.readFileSync(path.join(root, 'tests/fixtures/images/photo.jpg'));
const JPEG = uri('image/jpeg', JPEG_BYTES);
/** the JPEG with an EXIF APP1 saying orientation 6 (rotate 90° clockwise to show it upright) */
function exifRotated(jpg, orientation = 6) {
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(body.length + 2);
  return Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xff, 0xe1]), len, body, jpg.subarray(2)]);
}
const JPEG_EXIF = uri('image/jpeg', exifRotated(JPEG_BYTES));
const SVG = uri('image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
<rect x="2" y="2" width="116" height="76" rx="10" fill="#eef2ff" stroke="#4f46e5" stroke-width="2"/>
<path d="M20 60 A 30 30 0 0 1 80 60 Z" fill="#22c55e"/><path d="M60 20 a 15 25 30 1 0 30 10" fill="none" stroke="#ef4444" stroke-width="3"/>
<circle cx="95" cy="55" r="12" fill="#f59e0b"/><ellipse cx="30" cy="25" rx="14" ry="8" fill="#0ea5e9" opacity="0.6"/>
<polyline points="10,75 40,65 70,72 110,62" fill="none" stroke="#111827" stroke-width="1.5"/></svg>`);

const base = (name, body, extra = {}) => ({
  $schema: 'reportwright/report@1', name, page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: extra.data || { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }],
  sections: { pageHeader: { height: 0, items: [] }, body: { items: body }, pageFooter: extra.footer || { height: 0, items: [] } },
});
const tb = (value, x, y, w = 200, h = 16, style = {}) => ({ type: 'textbox', x, y, w, h, value, style });
const img = (src, x, y, extra = {}) => ({ type: 'image', x, y, w: 96, h: 57, src, alt: 'Logo', ...extra });
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((m, i) => ({ m, amt: [120, 90, 160, 140, 70, 180][i] }));

const invoice = base('Logo invoice', [
  img(PNG8, 0, 0), img(JPEG, 110, 0), img(JPEG_EXIF, 220, 0), img(PNG16, 330, 0), img(PNGA, 430, 0, { w: 90 }),
  img(PNG8, 0, 70, { fit: 'cover', w: 60, h: 60 }), img(JPEG, 70, 70, { fit: 'fill', w: 60, h: 30 }), img(PNGA, 140, 70, { fit: 'clip', w: 30, h: 20 }),
  tb('INVOICE #1042', 0, 140, 300, 20, { fontWeight: 'bold', fontSize: 14 }),
  { type: 'table', name: 'Lines', dataSet: 'Rows', x: 0, y: 170, w: 400, h: 40, columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, style: { backgroundColor: '#eef2f7', fontWeight: 'bold' }, cells: [{ value: 'Month' }, { value: 'Amount' }] }],
    detail: [{ height: 14, cells: [{ value: '=Fields.m' }, { value: '=Fields.amt', style: { format: 'N2', textAlign: 'right' } }] }] },
], { data: { rows: months } });
const svgs = base('SVG image', [img(SVG, 0, 0, { w: 240, h: 160 }), img(SVG, 250, 0, { w: 120, h: 40, fit: 'fill' }), img(SVG, 250, 60, { w: 60, h: 60, fit: 'cover' })]);
const rounded = base('Rounded boxes', [
  tb('Rounded', 0, 0, 120, 30, { backgroundColor: '#eeeeee', border: '1 solid #333333', radius: 6 }),
  tb('Dashed', 140, 0, 120, 30, { border: '2 dashed #2563eb', radius: 10 }),
  tb('Fill only', 280, 0, 120, 30, { backgroundColor: '#fde68a', radius: 15 }),
  { type: 'container', name: 'C', x: 0, y: 50, w: 200, h: 60, items: [], style: { border: '1 solid #333333', radius: 8, backgroundColor: '#f0fdf4' } },
]);
const chart = (chartType, x, y, extra = {}) => ({ type: 'chart', name: `C${chartType}${y}`, x, y, w: 260, h: 180, dataSet: 'Rows', category: '=Fields.m', chartType, series: [{ name: 'Amount', value: '=Sum(Fields.amt)' }], ...extra });
const paths = base('Path items', [chart('line', 0, 0), chart('pie', 270, 0), chart('area', 0, 200), chart('donut', 270, 200, { labelPosition: 'outside' }), chart('radar', 0, 400)], { data: { rows: months } });
const field = (name, extra) => ({ type: 'field', name, x: 0, y: 0, w: 220, h: 18, ...extra });
const fields = base('Form fields', [
  field('Name', { kind: 'text', fieldName: 'customerName', value: 'Zoë Ünlü', required: true }),
  field('Notes', { kind: 'multiline', fieldName: 'notes', value: 'Line one\nLine two', y: 24, h: 40 }),
  field('Agree', { kind: 'checkbox', fieldName: 'agree', value: '=1 = 1', y: 70, w: 14, h: 14 }),
  field('Off', { kind: 'checkbox', fieldName: 'off', value: '=1 = 0', x: 30, y: 70, w: 14, h: 14 }),
  field('Plan', { kind: 'choice', fieldName: 'plan', options: 'Basic, Plus, Pro', value: 'Plus', y: 90, readOnly: true }),
  field('Arabic', { kind: 'text', fieldName: 'ar', value: 'مرحبا بالعالم', y: 114, label: 'Arabic name' }),
  field('Hindi', { kind: 'text', fieldName: 'hi', value: 'नमस्ते दुनिया', y: 138, label: 'Hindi name' }),
]);
// every feature on one page, then a second section of another size that restarts the page numbers
const mixed = () => {
  const d = base('Mixed', [tb('First section', 0, 0, 300, 16, { fontWeight: 'bold' }), img(PNG8, 0, 20), tb('Boxed', 0, 90, 120, 30, { border: '1 solid #333', radius: 6 })],
    { footer: { height: 16, items: [tb('Page {Globals.PageNumber} of {Globals.TotalPages}', 323, 2, 200, 12, { textAlign: 'right', fontSize: 7 })] } });
  d.sections.body = [d.sections.body, { page: { size: 'A5', orientation: 'landscape' }, newSection: true, items: [tb('Second section', 0, 0, 300, 16, { fontWeight: 'bold' }), { type: 'bookmark', label: 'Second' }] }];
  return d;
};
const sizes = () => {
  const d = base('Page sizes', [tb('A4 page', 0, 0, 300, 16, { fontWeight: 'bold' })]);
  d.sections.pageHeader = { height: 20, items: [tb('Header', 0, 0, 200, 16)] };
  d.sections.body = [d.sections.body, { page: { size: 'Letter', orientation: 'landscape' }, items: [{ ...tb('Letter landscape', 0, 0, 300, 16), bookmark: 'Letter' }] }, { page: { size: 'A5' }, items: [{ ...tb('A5', 0, 0, 300, 16), bookmark: 'A5' }] }];
  return d;
};
const restart = base('Restarted numbering', [
  { type: 'list', name: 'L', x: 0, y: 0, w: 200, h: 20, dataSet: 'Rows', newSection: true, pageBreakBetween: true, items: [{ ...tb('=Fields.m', 0, 0, 100, 16), bookmark: '=Fields.m' }] },
], { data: { rows: months.slice(0, 3) }, footer: { height: 16, items: [tb('Page {Globals.PageNumber} of {Globals.TotalPages}', 323, 2, 200, 12, { textAlign: 'right', fontSize: 7 })] } });
const all = () => { const d = mixed(); d.sections.body[0].items.push({ ...field('Who', { kind: 'text', fieldName: 'who', value: 'Asha', label: 'Who' }), y: 130 }, { ...img(SVG, 0, 160, { w: 120, h: 80 }), alt: 'Diagram' }, { ...chart('pie', 200, 160), alt: 'Pie chart' }); d.dataSources[0].data = { rows: months }; return d; };

/** the report without its form fields @param {any} d */
const noFields = (d) => { for (const b of d.sections.body) b.items = b.items.filter((/** @type {any} */ i) => i.type !== 'field'); return d; };
const EXIF = 'EXIF-rotated JPEG comes out upright (owner: a bug fix; pdf-lib ignored the orientation)';
const PERMS = { none: {}, printOnly: { modify: false, copy: false, annotate: false, fillForms: false, assemble: false }, noPrint: { print: false, printHighQuality: false }, nothing: { print: false, modify: false, copy: false, annotate: false, fillForms: false, accessibility: false, assemble: false, printHighQuality: false } };

export const CORPUS = [
  { id: 'images-invoice', def: invoice, accept: { pixels: EXIF } },
  { id: 'svg-image', def: svgs },
  { id: 'rounded', def: rounded },
  { id: 'paths', def: paths },
  { id: 'fields', def: fields },
  ...Object.entries(PERMS).map(([k, permissions]) => ({ id: `encrypt-${k}`, def: invoice, opts: { encrypt: { ownerPassword: 'owner-pw', permissions } }, accept: { pixels: EXIF } })),
  { id: 'encrypt-userpw', def: fields, opts: { encrypt: { userPassword: 'open-me', ownerPassword: 'owner-pw' } }, password: 'open-me' },
  { id: 'signed', def: invoice, opts: { sign: true }, accept: { pixels: EXIF } },
  { id: 'pdfa-2b', def: all(), opts: { pdfa: { icc: ICC } } },
  { id: 'pdfa-2b-nofields', def: (() => { const d = noFields(all()); d.sections.body[0].items.push(img(PNGA, 300, 0)); return d; })(), opts: { pdfa: { icc: ICC } } },
  { id: 'pdfua', def: all(), opts: { tagged: { lang: 'en' } } },
  { id: 'pdfa-ua', def: all(), opts: { pdfa: { icc: ICC }, tagged: { lang: 'en' } } },
  { id: 'page-sizes', def: sizes() },
  { id: 'restart-numbers', def: restart },
  { id: 'mixed', def: mixed() },
];
