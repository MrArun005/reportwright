// Phase 7: TOC numbering, image sources and sizes, barcode options, PDF passwords.
import { describe, it, expect } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from '../../src/engine/index.js';
import { fontStore, report, texts } from '../helpers.js';
import { tocNumbers, formatNumber } from '../../src/engine/items/toc.js';
import { toDataUri, imageInfo, imageInfoOf, svgRootAttrs, IMAGE_LIMITS } from '../../src/engine/image.js';
import { parseSvg, parseTransform } from '../../src/exporters/svgimage.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { pdfEncryptOptions } from '../../src/exporters/encrypt.js';
import { pageToSvg } from '../../src/exporters/svg.js';
import { SYMBOLOGIES, bwipOptions, paintBarcode, loadBarcodes } from '../../src/engine/items/barcode.js';
import { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value, ...extra });

describe('TOC numbering', () => {
  it('formats decimal, roman and alpha', () => {
    expect([1, 4, 9, 14, 2026].map(n => formatNumber(n, 'roman'))).toEqual(['I', 'IV', 'IX', 'XIV', 'MMXXVI']);
    expect([1, 26, 27, 52, 703].map(n => formatNumber(n, 'alpha'))).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
    expect(formatNumber(7, 'decimal')).toBe('7');
    expect(formatNumber(5000, 'roman')).toBe('5000'); // no Roman numeral that large
  });
  it('numbers nested levels, one format per level (the last repeats)', () => {
    const e = [{ level: 0 }, { level: 1 }, { level: 1 }, { level: 0 }, { level: 1 }, { level: 2 }];
    expect(tocNumbers(e, 'decimal')).toEqual(['1', '1.1', '1.2', '2', '2.1', '2.1.1']);
    expect(tocNumbers(e, ['roman', 'alpha'])).toEqual(['I', 'I.A', 'I.B', 'II', 'II.A', 'II.A.A']);
    expect(tocNumbers([{ level: 2 }], 'decimal')).toEqual(['1.1.1']); // a skipped level counts as 1
  });

  const def = (toc) => report([
    { type: 'toc', name: 'Toc', x: 0, y: 0, w: 400, h: 20, title: 'Contents', ...toc },
    tb('H1', 'Intro', 40, { headingLevel: 1 }),
    tb('H2', 'Scope', 60, { headingLevel: 2 }),
    tb('B', 'Marked', 80, { bookmark: 'Marked' }),
    tb('H3', 'Results', 100, { headingLevel: 1, pageBreakBefore: true }),
  ]);
  it('source: headings lists text boxes with headingLevel, numbered; the PDF outline keeps bookmarks only', async () => {
    const m = await render(def({ source: 'headings', numbering: 'decimal' }), { fontStore });
    const t = texts(m.pages[0]);
    expect(t).toContain('1 Intro');
    expect(t).toContain('1.1 Scope');
    expect(t).toContain('2 Results');
    expect(t).not.toContain('Marked'.padStart(8, ' '));
    expect(t.filter(s => /Marked/.test(s))).toEqual(['Marked']); // the text box itself, not a TOC line
    expect(m.bookmarks.map(b => b.label)).toEqual(['Marked']);
    // page numbers: Results is on page 2
    const i = t.indexOf('2 Results');
    expect(t[i + 1]).toBe('2');
  });
  it('source: bookmarks (the default) ignores headings; numbering is optional', async () => {
    const t = texts((await render(def({}), { fontStore })).pages[0]);
    expect(t).not.toContain('Intro'.padStart(6));
    expect(t.filter(s => s === 'Marked').length).toBe(2); // TOC line + the text box
    const r = texts((await render(def({ numbering: ['roman'] }), { fontStore })).pages[0]);
    expect(r).toContain('I Marked');
  });
});

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAC0lEQVR4nGNoAAMACocDAcTGH2YAAAAASUVORK5CYII='; // 2×1
const PNG40 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAIklEQVR4nGNoGCDAMGrxqMWjFo9aPGrxqMWjFo9aPHIsBgA127A9GFEYHQAAAABJRU5ErkJggg=='; // 40×20
const SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect x="2" y="2" width="36" height="16" rx="3" fill="#ff0000"/><g transform="translate(5 5)" stroke="blue"><circle cx="5" cy="5" r="4" fill="none"/></g><text>hidden</text></svg>');
async function pageOps(bytes) {
  const doc = await PDFDocument.load(bytes);
  const c = doc.getPage(0).node.Contents();
  if (!c) return ''; // nothing drawn
  const streams = c instanceof PDFArray ? c.asArray().map(r => doc.context.lookup(r)) : [c];
  return streams.map(s => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString('latin1')).join('\n');
}
const img = (extra) => ({ type: 'image', name: 'Img', x: 10, y: 0, w: 100, h: 100, ...extra });
const imgsOf = async (def) => { const m = await render(def, { fontStore }); return { m, imgs: m.pages[0].items.filter(i => i.t === 'image') }; };

describe('images', () => {
  it('turns bare base64 and byte arrays into data URIs; leaves URLs and text alone', () => {
    expect(toDataUri(PNG_B64)).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(toDataUri(Uint8Array.from(atob(PNG_B64), c => c.charCodeAt(0)))).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(toDataUri('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(toDataUri('SGVsbG8gd29ybGQgdGhpcyBpcyB0ZXh0')).toBe('SGVsbG8gd29ybGQgdGhpcyBpcyB0ZXh0'); // base64, but not an image
    expect(toDataUri(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it('reads the natural size without decoding (PNG, SVG viewBox, SVG width/height)', () => {
    expect(imageInfo('data:image/png;base64,' + PNG_B64)).toMatchObject({ type: 'png', w: 2, h: 1 });
    expect(imageInfo(SVG)).toMatchObject({ type: 'svg', w: 40, h: 20 });
    expect(imageInfo('data:image/svg+xml,' + encodeURIComponent('<svg width="1in" viewBox="0 0 2 1"/>'))).toMatchObject({ w: 96, h: 48 });
  });
  it('embedded:name, a base64 field and autoSize: the box takes the image size at 96 dpi', async () => {
    const def = report([img({ src: 'embedded:logo', autoSize: true }), img({ name: 'F', y: 120, src: '=Fields.pic' })],
      { data: { rows: [{ pic: PNG_B64 }] }, def: { images: { logo: PNG40 } } });
    def.sections.body.items[1].dataSet = 'Rows';
    const { imgs } = await imgsOf(def);
    expect(imgs[0]).toMatchObject({ src: PNG40, w: 30, h: 15 });
    expect(imgs[1].src).toBe('data:image/png;base64,' + PNG_B64);
  });
  it('fit: clip draws at natural size from the top-left, cut to the box (model, SVG)', async () => {
    const { m, imgs } = await imgsOf(report([img({ src: PNG40, fit: 'clip', w: 20, h: 10 })]));
    expect(imgs[0]).toMatchObject({ fit: 'clip', w: 30, h: 15, cw: 20, ch: 10 });
    expect(pageToSvg(m.pages[0], m.width, m.height)).toMatch(/<svg x="46" y="\d+(\.\d+)?" width="20" height="10" overflow="hidden"><image x="0" y="0" width="30" height="15"/);
  });
  it('an unknown embedded name and an image over 10 MB are left out with a warning', async () => {
    const big = 'data:image/png;base64,' + PNG_B64.slice(0, 32) + 'A'.repeat(Math.ceil(IMAGE_LIMITS.bytes * 4 / 3) + 100);
    const { m, imgs } = await imgsOf(report([img({ src: 'embedded:nope' }), img({ name: 'Big', src: 'embedded:big' })], { def: { images: { big } } }));
    expect(imgs).toHaveLength(0);
    expect(m.warnings.join('\n')).toMatch(/no embedded image named "nope"/);
    expect(m.warnings.join('\n')).toMatch(/Big: the image is 10\.0 MB/);
  });
  it('a background image may be embedded', async () => {
    const def = report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 20, value: 'x', style: { backgroundImage: 'embedded:logo' } }], { def: { images: { logo: PNG40 } } });
    const { imgs } = await imgsOf(def);
    expect(imgs[0].src).toBe(PNG40);
  });
  it('background images from data obey the 10 MB and 50 MB caps (security)', async () => {
    const mb9 = (k) => 'data:image/png;base64,' + PNG_B64.slice(0, 32) + String.fromCharCode(66 + k).repeat(9 * 1048576 * 4 / 3);
    const row = { big: mb9(0) + 'A'.repeat(2 * 1048576 * 4 / 3) };
    for (let k = 1; k <= 7; k++) row['b' + k] = mb9(k);
    const box = (name, f, y) => ({ type: 'textbox', name, dataSet: 'Rows', x: 0, y, w: 100, h: 20, value: 'x', style: { backgroundImage: `=Fields.${f}` } });
    const def = report([box('Big', 'big', 0), ...Array.from({ length: 7 }, (_, k) => box('B' + (k + 1), 'b' + (k + 1), 24 * (k + 1)))], { data: { rows: [row] } });
    const { m, imgs } = await imgsOf(def);
    const w = m.warnings.join('\n');
    expect(w).toMatch(/limited to 10 MB each/);
    expect(w).toMatch(/pass 50 MB in all/);
    expect(imgs).toHaveLength(5); // 5 × 9 MB fit under 50 MB; the 6th and 7th do not
  });
  it('parses SVG shapes, transforms and paint; skips text and junk', () => {
    const s = parseSvg(decodeURIComponent(SVG.split(',')[1]));
    expect(s.shapes).toHaveLength(2);
    expect(s.shapes[0].fill).toMatchObject({ r: 1, g: 0, b: 0 });
    expect(s.shapes[1].fill).toBeNull();
    expect(s.shapes[1].stroke).toMatchObject({ b: 1 });
    expect(s.shapes[1].m.slice(4)).toEqual([5, 5]);
    expect(parseTransform('rotate(90)').map(v => Math.round(v))).toEqual([0, 1, -1, 0, 0, 0]);
    for (const junk of ['', '<svg', '<html/>', '<svg viewBox="0 0 a b"><path d="M"/></svg>', 'x'.repeat(3e6)]) expect(() => parseSvg(junk)).not.toThrow();
  });
  it('the PDF draws an SVG image as vector paths; a garbage SVG draws nothing and does not throw', async () => {
    const ops = await pageOps(await exportPdf(await render(report([img({ src: SVG })]), { fontStore }), fontStore));
    expect(ops).toMatch(/\bc\b/);       // curves of the rounded rect and circle
    expect(ops).toMatch(/1 0 0 rg/);    // red fill
    expect(ops).not.toMatch(/\bDo\b/);  // not an image XObject
    const bad = 'data:image/svg+xml,' + encodeURIComponent('<svg viewBox="0 0 1 1"><path d="M 0 0 L nonsense"/></svg>');
    await expect(exportPdf(await render(report([img({ src: bad })]), { fontStore }), fontStore)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('barcodes', () => {
  it('30+ symbologies with friendly names; each draws its sample', async () => {
    await loadBarcodes();
    expect(SYMBOLOGIES.length).toBeGreaterThanOrEqual(30);
    for (const s of SYMBOLOGIES) {
      const r = paintBarcode({ type: s.id, text: s.sample, x: 0, y: 0, w: 200, h: 80 });
      expect(r.error, s.id).toBeUndefined();
      expect(r.items.length, s.id).toBeGreaterThan(0);
      expect(s.name).toBeTruthy();
    }
  });
  it('whitelists options per symbology, with enum and range checks', () => {
    expect(bwipOptions({ symbology: 'qrcode', qrErrorLevel: 'H', qrVersion: 5 })).toEqual({ eclevel: 'H', version: '5' });
    expect(bwipOptions({ symbology: 'qrcode', qrErrorLevel: 'Z', qrVersion: 41, evil: 1, eclevel: 'L' })).toEqual({});
    expect(bwipOptions({ symbology: 'code128', qrErrorLevel: 'H' })).toEqual({}); // not a QR code
    expect(bwipOptions({ symbology: 'datamatrix', dmSize: '24x24', dmShape: 'square' })).toEqual({ rows: 24, columns: 24, format: 'square' });
    expect(bwipOptions({ symbology: 'pdf417', pdfColumns: 4, pdfErrorLevel: 9, pdfCompact: true })).toEqual({ columns: 4, compact: true });
    expect(bwipOptions({ symbology: 'code39', checkDigit: true, barRatio: 2.5 })).toEqual({ includecheck: true, barratio: 2.5 });
  });
  it('the options change the drawing: QR error level H makes a bigger code', async () => {
    await loadBarcodes();
    const n = (o) => paintBarcode({ type: 'qrcode', text: 'hello world', x: 0, y: 0, w: 100, h: 100, options: o }).items.map(i => i.d).join('').length;
    expect(n({ eclevel: 'H' })).not.toBe(n({ eclevel: 'L' }));
  });
  it('refuses a 10 MB value quickly, and an unknown symbology name', async () => {
    await loadBarcodes();
    const t0 = Date.now();
    expect(paintBarcode({ type: 'qrcode', text: 'x'.repeat(10e6), x: 0, y: 0, w: 99, h: 99 }).error).toMatch(/too long/);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(paintBarcode({ type: '../../x', text: '1', x: 0, y: 0, w: 99, h: 99 }).error).toMatch(/not a barcode/);
  });
  const bar = (extra) => report([{ type: 'barcode', name: 'B', x: 0, y: 0, w: 160, h: 48, symbology: 'code128', value: 'ABC-123', ...extra }]);
  it('caption above or below; quiet zone insets the bars; rotation turns every piece', async () => {
    const at = async (extra) => (await render(bar(extra), { fontStore })).pages[0].items;
    const below = await at({});
    const above = await at({ captionPosition: 'above' });
    const ty = (items) => items.find(i => i.t === 'text').lines[0].y;
    const py = (items) => Math.min(...items.filter(i => i.t === 'path').map(i => i.y));
    expect(ty(above)).toBeLessThan(ty(below));
    expect(py(above)).toBeGreaterThan(py(below));
    const px = (items) => Math.min(...items.filter(i => i.t === 'path').map(i => i.x));
    expect(px(await at({ quietZone: 10 })) - px(below)).toBeCloseTo(10, 3);
    const rot = await at({ rotate: '90' });
    expect(rot.filter(i => i.t !== 'link').every(i => i.rotate?.a === 90)).toBe(true);
  });
  // bwip-js paths are absolute M/L pairs: the bounding box of everything drawn, in item coordinates
  const bbox = (items) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of items.filter(i => i.t === 'path')) {
      const n = i.d.match(/-?\d*\.?\d+/g).map(Number);
      for (let k = 0; k < n.length; k += 2) { x0 = Math.min(x0, i.x + n[k]); x1 = Math.max(x1, i.x + n[k]); y0 = Math.min(y0, i.y + n[k + 1]); y1 = Math.max(y1, i.y + n[k + 1]); }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  it('a 2D code keeps its aspect ratio, fitted and centred in the box (QR is square)', async () => {
    await loadBarcodes();
    const b = bbox(paintBarcode({ type: 'qrcode', text: 'https://mrarun005.github.io/pagewright-demo/', x: 0, y: 0, w: 130, h: 130 }).items);
    expect(b.w).toBeCloseTo(130, 1);
    expect(b.h).toBeCloseTo(130, 1);
    const wide = bbox(paintBarcode({ type: 'qrcode', text: 'hello', x: 10, y: 0, w: 200, h: 100 }).items);
    expect(wide.w).toBeCloseTo(100, 1);
    expect(wide.h).toBeCloseTo(100, 1);
    expect(wide.x).toBeCloseTo(60, 1); // centred: 10 + (200 - 100) / 2
    for (const type of ['datamatrix', 'azteccode', 'hanxin']) {
      const s = bbox(paintBarcode({ type, text: 'Pagewright 2D', x: 0, y: 0, w: 90, h: 90 }).items);
      expect(s.w / s.h, type).toBeCloseTo(1, 1);
    }
  });
});

// Security review of 8086120: crafted images must be rejected quickly, never decoded at a size the caps forbid.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let x = 0xffffffff; for (const v of b) x = crcTable[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};
const ihdr = (w, h) => { const d = new Uint8Array(13), dv = new DataView(d.buffer); dv.setUint32(0, w); dv.setUint32(4, h); d[8] = 8; d[9] = 2; return d; };
const u32s = (...v) => { const d = new Uint8Array(v.length * 4), dv = new DataView(d.buffer); v.forEach((x, i) => dv.setUint32(i * 4, x)); return d; };
const concat = (...a) => { const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IDAT = chunk('IDAT', Uint8Array.from(deflateSync(Buffer.alloc(7))));
const uri = (b) => 'data:image/png;base64,' + Buffer.from(b).toString('base64');

describe('image resource caps (security)', () => {
  const quick = (fn, ms = 300) => { const t0 = performance.now(); const r = fn(); expect(performance.now() - t0).toBeLessThan(ms); return r; };
  it('SVG parsing is linear: unclosed tags, comments, long names and transforms finish fast', () => {
    const n = IMAGE_LIMITS.svgBytes - 64;
    const crafted = [
      '<svg>' + '<a'.repeat(n / 2),                                     // many unclosed tags
      '<svg>' + '<!--'.repeat(n / 4),                                   // many unterminated comments
      '<svg>' + '<![CDATA['.repeat(n / 9),
      '<svg ' + 'a'.repeat(n),                                          // one huge attribute name, no >
      '<svg><g ' + 'a'.repeat(n) + '>',                                 // a huge attribute name in a closed tag
      '<svg><g transform="' + 'matrix('.repeat(n / 8) + '"/>',          // unclosed transform functions
      '<svg width="1' + ' '.repeat(n) + 'x">',                          // a long length value
    ];
    for (const t of crafted) {
      quick(() => parseSvg(t));
      quick(() => svgRootAttrs(t));
      quick(() => imageInfo('data:image/svg+xml,' + encodeURIComponent(t)));
    }
    quick(() => svgRootAttrs('<svg'.repeat(n / 4)));
    quick(() => parseTransform('rotate('.repeat(n / 7)));
  });
  it('PNG size comes from the IHDR the decoder uses (the last one), not bytes 16–23', () => {
    const png = concat(SIG, chunk('IHDR', ihdr(1, 1)), chunk('IHDR', ihdr(9000, 9000)), IDAT, chunk('IEND', new Uint8Array()));
    expect(imageInfoOf(png)).toMatchObject({ type: 'png', w: 9000, h: 9000 });
  });
  it('the PDF refuses a PNG whose real IHDR or animation frames pass the pixel cap, quickly', async () => {
    const twoIhdr = concat(SIG, chunk('IHDR', ihdr(1, 1)), chunk('IHDR', ihdr(9000, 9000)), IDAT, chunk('IEND', new Uint8Array()));
    const apng = concat(SIG, chunk('IHDR', ihdr(1, 1)), chunk('acTL', u32s(1, 0)), chunk('fcTL', concat(u32s(0, 9000, 9000, 0, 0), new Uint8Array(6))), IDAT,
      chunk('fdAT', concat(u32s(1), IDAT.subarray(8, IDAT.length - 4))), chunk('IEND', new Uint8Array()));
    for (const b of [twoIhdr, apng]) {
      const t0 = performance.now();
      const ops = await pageOps(await exportPdf(await render(report([img({ src: uri(b) })]), { fontStore }), fontStore));
      expect(performance.now() - t0).toBeLessThan(1500);
      expect(ops).not.toMatch(/\bDo\b/);
    }
  });
  it('a data URI is base64 or not by one rule, for the cap and for decoding', () => {
    const odd = 'data:image/svg+xml;base64x,' + encodeURIComponent('<svg viewBox="0 0 4 2"/>');
    expect(imageInfo(odd)).toMatchObject({ type: 'svg', w: 4, h: 2 });
  });
});

/* ---- PDF passwords: decrypted here with node:crypto, apart from the code under test (WebCrypto) ---- */
const sha = (alg, b) => crypto.createHash(alg).update(b).digest();
function hash2B(pw, salt, ud) {
  let K = sha('sha256', Buffer.concat([pw, salt, ud]));
  for (let r = 0; ; r++) {
    const K1 = Buffer.concat(Array(64).fill(Buffer.concat([pw, K, ud])));
    const c = crypto.createCipheriv('aes-128-cbc', K.subarray(0, 16), K.subarray(16, 32)); c.setAutoPadding(false);
    const E = Buffer.concat([c.update(K1), c.final()]);
    let sum = 0; for (let i = 0; i < 16; i++) sum += E[i];
    K = sha(['sha256', 'sha384', 'sha512'][sum % 3], E);
    if (r >= 63 && E[E.length - 1] <= r + 1 - 32) return K.subarray(0, 32);
  }
}
const aes = (mode, key, iv, data, pad) => { const d = crypto.createDecipheriv(mode, key, iv); d.setAutoPadding(pad); return Buffer.concat([d.update(data), d.final()]); };
async function encOf(pdf) {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const e = doc.context.lookup(doc.context.trailerInfo.Encrypt);
  const b = (k) => Buffer.from(e.get(PDFName.of(k)).asBytes());
  return { doc, e, U: b('U'), UE: b('UE'), O: b('O'), OE: b('OE'), Perms: b('Perms'), P: e.get(PDFName.of('P')).asNumber() };
}
async function fileKey(pdf, password, owner = false) {
  const { U, UE, O, OE } = await encOf(pdf);
  const pw = Buffer.from(password.normalize('NFKC'));
  const [H, ud, E] = owner ? [O, U, OE] : [U, Buffer.alloc(0), UE];
  if (!hash2B(pw, H.subarray(32, 40), ud).equals(H.subarray(0, 32))) throw new Error('wrong password');
  return aes('aes-256-cbc', hash2B(pw, H.subarray(40, 48), ud), Buffer.alloc(16), E, false);
}
const decrypt = (key, bytes) => aes('aes-256-cbc', key, bytes.subarray(0, 16), bytes.subarray(16), true);
const pdfOf = async (opt, def = report([tb('T', 'Hello secret', 0)])) => exportPdf(await render(def, { fontStore }), fontStore, { title: 'Secret title', ...opt });

describe('PDF passwords (AES-256, R6)', () => {
  it('encrypts strings and streams; the user password unlocks them, a wrong one does not', async () => {
    const pdf = await pdfOf({ encrypt: { userPassword: 'öpen sesame', permissions: { copy: false } } });
    await expect(PDFDocument.load(pdf)).rejects.toThrow(/encrypt/i);
    expect(Buffer.from(pdf).toString('latin1')).not.toContain('Secret title');
    expect(Buffer.from(pdf).toString('latin1')).toMatch(/\/V 5[\s\S]*\/R 6|\/R 6[\s\S]*\/V 5/);
    const key = await fileKey(pdf, 'öpen sesame');
    await expect(fileKey(pdf, 'wrong')).rejects.toThrow(/wrong password/);
    const { doc } = await encOf(pdf);
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    expect(decrypt(key, Buffer.from(info.get(PDFName.of('Title')).asBytes())).toString('utf16le').replace(/^￾/, '')).toBeTruthy();
    const title = decrypt(key, Buffer.from(info.get(PDFName.of('Title')).asBytes()));
    expect(title.swap16().toString('utf16le')).toContain('Secret title'); // UTF-16BE with a BOM
    const page = doc.getPage(0).node.Contents();
    const raw = page instanceof PDFArray ? doc.context.lookup(page.get(0)) : page;
    expect(inflateSync(decrypt(key, Buffer.from(raw.contents))).toString('latin1')).toMatch(/\bBT\b/);
  });
  it('/P and the encrypted /Perms agree; permissions default to allowed', async () => {
    const pdf = await pdfOf({ encrypt: { userPassword: 'x', ownerPassword: 'boss', permissions: { copy: false, modify: false } } });
    const { P, Perms } = await encOf(pdf);
    const key = await fileKey(pdf, 'boss', true); // the owner password opens it too
    const perms = aes('aes-256-ecb', key, null, Perms, false);
    expect(perms.readInt32LE(0)).toBe(P);
    expect(perms.subarray(9, 12).toString()).toBe('adb');
    const bit = (n) => !!(P & (1 << (n - 1)));
    expect([bit(3), bit(4), bit(5), bit(12)]).toEqual([true, false, false, true]);
  });
  it('without an owner password, the user password does not unlock the owner key', async () => {
    const pdf = await pdfOf({ encrypt: { userPassword: 'u' } });
    await expect(fileKey(pdf, 'u', true)).rejects.toThrow(/wrong password/);
    await expect(fileKey(pdf, '', true)).rejects.toThrow(/wrong password/);
  });
  it('refuses PDF/A, signing, unknown permissions and passwords over 127 bytes; no password in the error', async () => {
    const secret = 'é'.repeat(70); // 140 bytes
    await expect(pdfOf({ encrypt: { userPassword: secret } })).rejects.toThrow(/too long/);
    await pdfOf({ encrypt: { userPassword: secret } }).catch(e => expect(e.message).not.toContain(secret));
    await expect(pdfOf({ encrypt: { userPassword: 'a' }, pdfa: { icc: new Uint8Array(1) } })).rejects.toThrow(/PDF\/A/);
    await expect(pdfOf({ encrypt: { userPassword: 'a' }, prepare: async () => {} })).rejects.toThrow(/signed/);
    await expect(pdfOf({ encrypt: { userPassword: 'a', permissions: { root: false } } })).rejects.toThrow(/Unknown PDF permission/);
  });
  it('checks the API request shape (400s), with no password in any message', () => {
    expect(pdfEncryptOptions(undefined)).toBeUndefined();
    expect(pdfEncryptOptions({})).toBeUndefined();
    expect(pdfEncryptOptions({ userPassword: 'a', permissions: { copy: false } })).toEqual({ userPassword: 'a', ownerPassword: undefined, permissions: { copy: false } });
    for (const bad of ['x', [], { userPassword: 1 }, { permissions: { copy: 'no' } }, { permissions: { root: false } }, { evil: 1 }, { userPassword: 'ü'.repeat(64) }]) {
      let err; try { pdfEncryptOptions(bad); } catch (e) { err = e; }
      expect(err?.status, JSON.stringify(bad)).toBe(400);
      expect(err.message).not.toContain('ü'.repeat(64));
    }
  });
  const hasPoppler = (() => { try { execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  it.skipIf(!hasPoppler)('poppler opens it with the password and reads the text', async () => {
    const f = path.join(os.tmpdir(), `pw-enc-${process.pid}.pdf`);
    fs.writeFileSync(f, await pdfOf({ encrypt: { userPassword: 'öpen sesame', permissions: { copy: false } } }));
    try {
      const info = execFileSync('pdfinfo', ['-upw', 'öpen sesame', f]).toString();
      expect(info).toMatch(/Encrypted:\s+yes/);
      expect(info).toMatch(/AES-256/);
      expect(info).toMatch(/copy:no/);
      expect(execFileSync('pdftotext', ['-upw', 'öpen sesame', f, '-']).toString()).toContain('Hello secret');
      expect(() => execFileSync('pdftotext', ['-upw', 'nope', f, '-'], { stdio: 'pipe' })).toThrow();
    } finally { fs.rmSync(f, { force: true }); }
  });
});
