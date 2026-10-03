// @ts-check
/** Barcodes from bwip-js (100+ symbologies), turned into page-model paths. */
import bwipModule from 'bwip-js';

/** @type {any} */
const bwip = /** @type {any} */ (bwipModule).default || bwipModule;

export const BARCODE_TYPES = ['code128', 'code39', 'ean13', 'ean8', 'upca', 'itf14', 'qrcode', 'datamatrix', 'pdf417', 'azteccode', 'gs1-128'];
const TWO_D = new Set(['qrcode', 'datamatrix', 'pdf417', 'azteccode', 'microqrcode']);

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
 * @returns {{ items: any[], error?: string }} paths in item-local coordinates
 */
export function paintBarcode({ type = 'code128', text, x, y, w, h, color = '#000000', showText = true, textHeight = 0 }) {
  if (!text) return { items: [] };
  let svg;
  try {
    svg = bwip.toSVG({ bcid: type, text: String(text), scale: 1, height: 10, includetext: false, paddingwidth: 0, paddingheight: 0 });
  } catch (e) {
    return { items: [], error: String(e.message || e).replace(/^bwipp\.\w+#\d+:\s*/, '') };
  }
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!vb) return { items: [], error: 'No barcode output' };
  const vw = Number(vb[1]), vh = Number(vb[2]);
  const availH = Math.max(1, h - (showText && !TWO_D.has(type) ? textHeight : 0));
  let sx = w / vw, sy = availH / vh, ox = x, oy = y;
  if (TWO_D.has(type)) { const s = Math.min(sx, sy); sx = sy = s; ox = x + (w - vw * s) / 2; oy = y + (availH - vh * s) / 2; }
  const items = [];
  for (const m of svg.matchAll(/<path([^>]*)d="([^"]+)"/g)) {
    const attrs = m[1];
    const sw = /stroke-width="([\d.]+)"/.exec(attrs);
    const d = transformPath(m[2], sx, sy, 0, 0);
    if (/stroke=/.test(attrs) && sw) items.push({ t: 'path', x: ox, y: oy, d, fill: null, stroke: color, strokeWidth: Number(sw[1]) * sx, lineCap: 'butt' });
    else items.push({ t: 'path', x: ox, y: oy, d, fill: color, stroke: null });
  }
  return { items, twoD: TWO_D.has(type) };
}
