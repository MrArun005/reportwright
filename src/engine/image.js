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

/** Decoded size of a data URI, without decoding it. @param {string} uri */
export function dataUriBytes(uri) {
  const c = uri.indexOf(',');
  const meta = uri.slice(0, c), body = uri.length - c - 1;
  return /;base64$/i.test(meta) ? Math.floor(body * 3 / 4) : body;
}

/**
 * The first bytes of a data URI (enough for any image header), or the whole SVG text for an SVG.
 * @param {string} uri
 * @returns {Uint8Array | null}
 */
export function dataUriHead(uri, max = 262144) {
  const m = /^data:([^,;]*)((?:;[^,;]*)*),/i.exec(uri);
  if (!m) return null;
  const body = uri.slice(m[0].length);
  try {
    if (/;base64/i.test(m[2])) return fromBase64(body.slice(0, Math.ceil(max / 3) * 4).replace(/\s/g, ''));
    return new TextEncoder().encode(decodeURIComponent(body.slice(0, max)));
  } catch { return null; }
}

/** All the bytes of a data URI (callers check the size first). @param {string} uri */
export function dataUriBytesOf(uri) { return dataUriHead(uri, Infinity); }

const UNIT = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, '': 1 };
/** An SVG length in px; null for a percentage or nonsense. @param {string|undefined} v */
export function svgLength(v) {
  const m = /^\s*([\d.]+(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(v || '');
  if (!m) return null;
  const n = Number(m[1]) * UNIT[(m[2] || '').toLowerCase()];
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** Attributes of the root <svg> tag. @param {string} text */
export function svgRootAttrs(text) {
  const m = /<svg\b([^>]*)>/i.exec(text);
  if (!m) return null;
  /** @type {Record<string,string>} */
  const a = {};
  for (const x of m[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[x[1]] = x[2] ?? x[3];
  return a;
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
  if (type === 'png' && b.length >= 24) return { type, w: u32(16), h: u32(20) };
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
