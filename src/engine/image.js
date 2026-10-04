// @ts-check
/**
 * Image sources for the engine: embedded images (`embedded:<name>` from the report's `images` map), data URIs,
 * base64 text from a data field (with or without a data: prefix) and byte arrays from a database driver all
 * become one plain data URI, so every exporter and the viewer see the same thing. Also the natural size of an
 * image (PNG, JPEG, GIF, SVG), read from its header without decoding pixels.
 * No DOM, no Node modules: runs in the browser and in Node.
 */

export const IMAGE_LIMITS = {
  bytes: 10 * 1024 * 1024,   // one image
  total: 50 * 1024 * 1024,   // all images of one render (each distinct image counted once)
  pixels: 40e6,              // a PNG larger than this is not decoded (a small file can inflate to gigabytes)
  svgBytes: 2 * 1024 * 1024, // an SVG drawn as vector paths in the PDF
  svgShapes: 10000,
};
/** 1 image pixel = 0.75 pt (96 dpi, as in CSS). */
export const PX = 0.75;

const MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

/** @param {Uint8Array} b @returns {keyof MIME | null} */
export function sniff(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  const head = String.fromCharCode(...b.subarray(0, 512)).replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart();
  if (/^<(\?xml|svg|!--|!DOCTYPE svg)/i.test(head) && /<svg[\s>]/i.test(head + (b.length > 512 ? '<svg ' : ''))) return 'svg';
  return null;
}

/** @param {Uint8Array} b */
function toBase64(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
/** @param {string} s */
function fromBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * A data URI for bytes or bare base64; anything else (a URL, a data URI) comes back as it was.
 * @param {unknown} v
 * @returns {unknown}
 */
export function toDataUri(v) {
  if (v instanceof ArrayBuffer) v = new Uint8Array(v);
  if (v instanceof Uint8Array) {
    if (v.length > IMAGE_LIMITS.bytes) return null;
    const type = sniff(v);
    return type ? `data:${MIME[type]};base64,${toBase64(v)}` : null;
  }
  if (typeof v !== 'string' || v.length < 16 || v.startsWith('data:')) return v;
  // base64 from a data field: no scheme, only base64 characters (line breaks allowed)
  if (/[^A-Za-z0-9+/=\r\n]/.test(v)) return v;
  const s = v.replace(/[\r\n]/g, '');
  if (!B64.test(s) || s.length % 4) return v;
  let type;
  try { type = sniff(fromBase64(s.slice(0, 700))); } catch { return v; }
  return type ? `data:${MIME[type]};base64,${s}` : v;
}

/**
 * The parts of a data URI: one rule for every caller (the size cap and the decoder must agree).
 * Base64 when the last parameter is exactly "base64".
 * @param {string} uri
 */
export function splitDataUri(uri) {
  if (typeof uri !== 'string' || !/^data:/i.test(uri)) return null;
  const c = uri.indexOf(',');
  if (c < 0) return null;
  const meta = uri.slice(5, c);
  return { meta, b64: meta.slice(meta.lastIndexOf(';') + 1).trim().toLowerCase() === 'base64' && meta.includes(';'), body: uri.slice(c + 1) };
}

/** Decoded size of a data URI, without decoding it (an upper bound). @param {string} uri */
export function dataUriBytes(uri) {
  const d = splitDataUri(uri);
  if (!d) return 0;
  return d.b64 ? Math.floor(d.body.length * 3 / 4) : d.body.length;
}

/**
 * The first bytes of a data URI (enough for any image header), or all of it with max = Infinity.
 * @param {string} uri
 * @returns {Uint8Array | null}
 */
export function dataUriHead(uri, max = 262144) {
  const d = splitDataUri(uri);
  if (!d) return null;
  try {
    if (d.b64) return fromBase64(d.body.slice(0, Number.isFinite(max) ? Math.ceil(max / 3) * 4 : undefined).replace(/\s/g, ''));
    return new TextEncoder().encode(decodeURIComponent(d.body.slice(0, max)));
  } catch { return null; }
}

/** All the bytes of a data URI (callers check the size first). @param {string} uri */
export function dataUriBytesOf(uri) { return dataUriHead(uri, Infinity); }

const UNIT = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, '': 1 };
/** An SVG length in px; null for a percentage or nonsense. @param {string|undefined} v */
export function svgLength(v) {
  const t = String(v ?? '').trim();
  if (t.length > 64) return null;
  const m = /^([\d.]+(?:e[-+]?\d+)?)(px|pt|pc|mm|cm|in)?$/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]) * UNIT[(m[2] || '').toLowerCase()];
  return Number.isFinite(n) && n > 0 ? n : null;
}

const isName = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === ':' || c === '-' || c === '.';
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * The tags of an XML text, in order: one pass with indexOf and a quote-aware scan, so the time is linear in
 * the length whatever the input (no regular expression that can backtrack). Comments, CDATA, <?…?> and
 * <!…> are skipped; an unfinished construct ends the scan.
 * @param {string} text
 * @returns {Generator<{ close: boolean, name: string, attrs: string, self: boolean }>}
 */
export function* xmlTags(text) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) return;
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); if (e < 0) return; i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); if (e < 0) return; i = e + 3; continue; }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') { const e = text.indexOf('>', lt + 2); if (e < 0) return; i = e + 1; continue; }
    let j = lt + 1, q = '';
    for (; j < n; j++) {
      const c = text[j];
      if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    if (j >= n) return;
    i = j + 1;
    let body = text.slice(lt + 1, j);
    const close = body[0] === '/';
    if (close) body = body.slice(1);
    const self = body.endsWith('/');
    if (self) body = body.slice(0, -1);
    let k = 0;
    while (k < body.length && isName(body[k])) k++;
    const name = body.slice(0, k);
    if (!/^[a-zA-Z]/.test(name)) continue;
    yield { close, name, attrs: body.slice(k), self };
  }
}

/** name="value" / name='value' pairs, in one linear pass. @param {string} s @returns {Record<string,string>} */
export function xmlAttrs(s) {
  /** @type {Record<string,string>} */
  const a = Object.create(null);
  const n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && !isName(s[i])) i++;
    const st = i;
    while (i < n && isName(s[i])) i++;
    const name = s.slice(st, i);
    while (i < n && isSpace(s[i])) i++;
    if (s[i] !== '=') continue;
    i++;
    while (i < n && isSpace(s[i])) i++;
    const q = s[i];
    if (q !== '"' && q !== "'") continue;
    const e = s.indexOf(q, i + 1);
    if (e < 0) break;
    if (name) a[name] = s.slice(i + 1, e);
    i = e + 1;
  }
  return a;
}

/** Attributes of the root <svg> tag. @param {string} text */
export function svgRootAttrs(text) {
  for (const t of xmlTags(String(text))) if (!t.close && t.name.toLowerCase() === 'svg') return xmlAttrs(t.attrs);
  return null;
}
/** Natural size of an SVG in px: width/height, else the viewBox. @param {string} text */
export function svgSize(text) {
  const a = svgRootAttrs(text);
  if (!a) return null;
  const vb = String(a.viewBox || '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  let w = svgLength(a.width), h = svgLength(a.height);
  if (w && !h) h = hasVb ? w * vb[3] / vb[2] : null;
  if (h && !w) w = hasVb ? h * vb[2] / vb[3] : null;
  if (!w && hasVb) { w = vb[2]; h = vb[3]; }
  return w && h ? { w, h } : null;
}

/**
 * Type and natural size (px) of image bytes, from the header.
 * @param {Uint8Array} b
 * @returns {{ type: string, w: number, h: number } | { type: string } | null}
 */
export function imageInfoOf(b) {
  const type = sniff(b);
  if (!type) return null;
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (type === 'png') return pngInfo(b);
  if (type === 'gif' && b.length >= 10) return { type, w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (type === 'jpeg') {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk === 0xff) { i++; continue; }
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { type, w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return { type };
  }
  if (type === 'svg') {
    const s = svgSize(new TextDecoder().decode(b));
    return s ? { type, ...s } : { type };
  }
  return { type };
}

/**
 * PNG size as pdf-lib's decoder (UPNG) will see it: it walks every chunk and keeps the LAST IHDR, and an
 * animated PNG (acTL/fcTL/fdAT) allocates a buffer per frame from the frame's own size. So walk the chunks
 * exactly as it does, and report animation, rather than trusting the bytes after the signature.
 * @param {Uint8Array} b
 */
export function pngInfo(b) {
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  let w = 0, h = 0, ihdrs = 0, animated = false;
  for (let off = 8; off + 8 <= b.length;) {
    const len = u32(off);
    const t = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
    const d = off + 8;
    if (t === 'IHDR' && d + 8 <= b.length) { w = u32(d); h = u32(d + 4); ihdrs++; }
    else if (t === 'acTL' || t === 'fcTL' || t === 'fdAT') animated = true;
    else if (t === 'IEND') break;
    off = d + len + 4;
  }
  if (!ihdrs) return { type: 'png' };
  return { type: 'png', w, h, ...(animated || ihdrs > 1 ? { suspect: true } : {}) };
}

/** Type and natural size (px) of a data URI image. @param {string} uri */
export function imageInfo(uri) {
  const b = typeof uri === 'string' && uri.startsWith('data:') ? dataUriHead(uri) : null;
  return b ? imageInfoOf(b) : null;
}

/**
 * Resolve an image source to what the page model carries: a data URI, a URL, or null (left out).
 * @param {unknown} v evaluated src
 * @param {string} who for warnings
 * @param {{ images?: Record<string, string>, budget?: { seen: Set<string>, bytes: number }, warn: (m: string) => void }} c
 * @returns {string | null}
 */
export function resolveImageSrc(v, who, c) {
  if (v == null || v === '' || v === '#Error') return null;
  if (typeof v === 'string' && v.startsWith('embedded:')) {
    const name = v.slice(9);
    const img = c.images && Object.prototype.hasOwnProperty.call(c.images, name) ? c.images[name] : undefined;
    if (typeof img !== 'string' || !/^data:image\/[\w.+-]+[;,]/i.test(img)) { c.warn(`${who}: there is no embedded image named "${name}" (add it to the report's images as a data:image/… URI)`); return null; }
    v = img;
  }
  const u = toDataUri(v);
  if (u == null) { c.warn(`${who}: the image data is not a PNG, JPEG, GIF, WebP or SVG image, or is larger than 10 MB`); return null; }
  const s = String(u);
  if (s.startsWith('data:')) {
    const n = dataUriBytes(s);
    if (n > IMAGE_LIMITS.bytes) { c.warn(`${who}: the image is ${(n / 1048576).toFixed(1)} MB; images are limited to 10 MB each, so it is left out`); return null; }
    const b = c.budget;
    if (b && !b.seen.has(s)) {
      if (b.bytes + n > IMAGE_LIMITS.total) { c.warn(`${who}: the report's images pass 50 MB in all, so this one is left out`); return null; }
      b.seen.add(s); b.bytes += n;
    }
  }
  return s;
}
