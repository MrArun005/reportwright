// @ts-check
// Figures for the editable exports (Word, PowerPoint): the items one chart, picture, map, barcode, shape or in-cell
// visual drew (the engine tags them, layout.js `tag`), cut out of the page as one picture. The picture is an SVG of
// those items with their text turned into glyph outlines (Word, PowerPoint and rasterisers do not have the report's
// fonts), plus a PNG of it for readers without SVG support.
import { pageToSvg } from './svg.js';
import { dataUriBytesOf, imageInfoOf, IMAGE_LIMITS } from '../engine/image.js';

/** Item kinds that are pictures in Word and PowerPoint (a heading tag alone is not). */
export const FIGURE_KINDS = new Set(['image', 'chart', 'map', 'barcode', 'shape', 'line', 'sparkline', 'databar', 'bullet', 'iconset', 'rangebar']);

/**
 * The figures of a page, in page order: { tag, items, at, box } (at: index of the first item). A figure's items are
 * consecutive in the page. One tag id marks one figure, also in a model that went through JSON (a tag copy per item).
 * @param {any[]} items page items
 */
export function figures(items) {
  const shared = items.some((it, i) => i > 0 && it.tag && it.tag === items[i - 1].tag);
  const same = (a, b) => a === b || (!!a && !!b && (a.id != null ? a.id === b.id : !shared && a.k === b.k && a.alt === b.alt && a.h === b.h));
  const out = [];
  let cur = null;
  items.forEach((it, i) => {
    const t = it.tag;
    if (!t || !FIGURE_KINDS.has(t.k)) { cur = null; return; }
    if (cur && same(cur.tag, t) && cur.last === i - 1) { cur.items.push(it); cur.last = i; return; }
    cur = { tag: t, items: [it], at: i, last: i };
    out.push(cur);
  });
  for (const f of out) f.box = boxOf(f.items);
  return out.filter(f => f.box && f.box.w > 0.5 && f.box.h > 0.5);
}

/** Bounding box of page items (links and bookmarks left out), or null. @param {any[]} items */
export function boxOf(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, rot) => {
    if (rot) { // a turned item: its corners turned about the centre
      const a = rot.a * Math.PI / 180, dx = x - rot.cx, dy = y - rot.cy;
      x = rot.cx + dx * Math.cos(a) - dy * Math.sin(a); y = rot.cy + dx * Math.sin(a) + dy * Math.cos(a);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  const rect = (x, y, w, h, r) => { add(x, y, r); add(x + w, y, r); add(x, y + h, r); add(x + w, y + h, r); };
  for (const it of items) {
    const r = it.rotate;
    const sw = (it.stroke ? Number(it.strokeWidth) || 1 : 0) / 2;
    switch (it.t) {
      case 'rect': case 'image': rect(it.x - sw, it.y - sw, (it.cw ?? it.w) + 2 * sw, (it.ch ?? it.h) + 2 * sw, r); break;
      case 'ellipse': rect(it.cx - it.rx - sw, it.cy - it.ry - sw, 2 * (it.rx + sw), 2 * (it.ry + sw), r); break;
      case 'line': rect(Math.min(it.x1, it.x2) - sw, Math.min(it.y1, it.y2) - sw, Math.abs(it.x2 - it.x1) + 2 * sw, Math.abs(it.y2 - it.y1) + 2 * sw, r); break;
      case 'text':
        for (const l of it.lines) rect(l.x, l.y - it.size, (l.w ?? l.text.length * it.size * 0.6), it.size * 1.3, r);
        break;
      case 'path': {
        const b = pathBox(it.d);
        if (b) rect(it.x + b.x0 - sw, it.y + b.y0 - sw, b.x1 - b.x0 + 2 * sw, b.y1 - b.y0 + 2 * sw, r);
        break;
      }
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * A conservative bounding box of SVG path data: every end and control point, and an arc's end ± its radii.
 * @param {string} d
 */
export function pathBox(d) {
  const toks = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  let cx = 0, cy = 0, sx = 0, sy = 0, cmd = 'M', i = 0;
  const num = () => Number(toks[i++]);
  const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  let guard = 0;
  while (i < toks.length && guard++ < 1e6) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const C = cmd.toUpperCase(), rel = cmd !== C, n = ARGS[C];
    if (n === undefined) break;
    if (C === 'Z') { cx = sx; cy = sy; continue; }
    if (i + n > toks.length) break;
    const a = Array.from({ length: n }, num);
    if (a.some(v => !Number.isFinite(v))) break;
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'H') { cx = a[0] + ox; add(cx, cy); }
    else if (C === 'V') { cy = a[0] + oy; add(cx, cy); }
    else if (C === 'A') {
      const ex = a[5] + ox, ey = a[6] + oy;
      add(cx, cy); add(ex, ey);
      for (const [px, py] of arcExtremes(cx, cy, a[0], a[1], a[2], a[3], a[4], ex, ey)) add(px, py);
      cx = ex; cy = ey;
    } else {
      for (let k = 0; k < n; k += 2) add(a[k] + ox, a[k + 1] + oy);
      cx = a[n - 2] + ox; cy = a[n - 1] + oy;
      if (C === 'M') { sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; }
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/**
 * The points of an SVG arc where it turns (its leftmost, rightmost, top and bottom), from the centre form of the arc
 * (SVG 1.1 appendix F.6.5). A rotated ellipse gives its whole bounding box (conservative).
 */
function arcExtremes(x1, y1, rx, ry, phi, large, sweep, x2, y2) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [];
  const f = (phi % 360) * Math.PI / 180, cf = Math.cos(f), sf = Math.sin(f);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cf * dx + sf * dy, y1p = -sf * dx + cf * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const k = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = k * rx * y1p / ry, cyp = -k * ry * x1p / rx;
  const cx = cf * cxp - sf * cyp + (x1 + x2) / 2, cy = sf * cxp + cf * cyp + (y1 + y2) / 2;
  if (Math.abs(sf) > 1e-9) { const R = Math.max(rx, ry); return [[cx - R, cy - R], [cx + R, cy + R]]; }
  const ang = (ux, uy) => Math.atan2(uy, ux);
  const t1 = ang((x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((-x1p - cxp) / rx, (-y1p - cyp) / ry) - t1;
  if (sweep && dt < 0) dt += 2 * Math.PI; else if (!sweep && dt > 0) dt -= 2 * Math.PI;
  const out = [];
  for (let q = -4; q <= 4; q++) {
    const t = q * Math.PI / 2, rel = dt >= 0 ? t - t1 : t1 - t;
    const nrm = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (nrm <= Math.abs(dt) + 1e-9) out.push([cx + rx * Math.cos(t) * cf, cy + ry * Math.sin(t)]);
  }
  return out;
}

/**
 * Text as glyph outlines (SVG path data), where the engine placed it. Plain lines advance by the glyphs' own widths
 * (as the engine measured them); shaped runs place each glyph by ID.
 * @param {any} it a text item  @param {(key: string) => any} fontOf fontkit font or null
 * @returns {string|null} null when a font is missing
 */
export function textOutline(it, fontOf) {
  let d = '';
  const glyph = (f, g, x, y, size) => {
    const s = size / f.unitsPerEm;
    const p = g.path;
    for (const c of p.commands) {
      const a = [];
      for (let k = 0; k < c.args.length; k += 2) a.push(r2(x + c.args[k] * s), r2(y - c.args[k + 1] * s));
      d += ({ moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' })[c.command] + a.join(' ');
    }
  };
  for (const l of it.lines) {
    if (!l.runs) {
      const f = fontOf(it.font);
      if (!f || f.standard) return null; // a standard PDF font has no outlines: the text stays text
      let x = l.x;
      for (const ch of l.text.replace(/\t/g, '    ')) {
        const g = f.glyphForCodePoint(/** @type {number} */ (ch.codePointAt(0)));
        glyph(f, g, x, l.y, it.size);
        x += (g.advanceWidth * it.size) / f.unitsPerEm;
      }
      continue;
    }
    for (const r of l.runs) {
      const f = fontOf(r.font);
      if (!f || f.standard) return null;
      const gs = r.glyphs || [];
      for (let k = 0; k < gs.length; k += 4) glyph(f, f.getGlyph(gs[k]), l.x + r.x + gs[k + 1], l.y - gs[k + 2], it.size);
    }
  }
  return d;
}
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * The SVG of a figure: its items in their own box, text as outlines when the fonts are there.
 * @param {{ items: any[], box: { x: number, y: number, w: number, h: number } }} fig
 * @param {{ get: (key: string) => any } | null} [fontStore]
 */
export function figureSvg(fig, fontStore) {
  const fontOf = (k) => { try { return fontStore?.get(k) || null; } catch { return null; } };
  return pageToSvg({ items: fig.items.filter(i => i.t !== 'link' && i.t !== 'bookmark') }, fig.box.w, fig.box.h, { background: false, box: fig.box, outline: fontStore ? fontOf : null });
}

/**
 * PNG bytes of an SVG, `scale` pixels per point: opt.rasterize when given (the caller's own), else a canvas in a
 * browser, else sharp in Node (Next.js installs it). Null when none of them is there.
 * @param {string} svg @param {number} w @param {number} h (points)
 * @param {{ rasterize?: (svg: string, w: number, h: number, scale: number) => Promise<Uint8Array|null>, scale?: number }} [opt]
 * @returns {Promise<Uint8Array|null>}
 */
export async function rasterize(svg, w, h, opt = {}) {
  const scale = opt.scale || 2;
  const W = Math.max(1, Math.min(8000, Math.round(w * scale))), H = Math.max(1, Math.min(8000, Math.round(h * scale)));
  try {
    if (opt.rasterize) return await opt.rasterize(svg, w, h, scale);
    if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d')?.drawImage(img, 0, 0, W, H);
        const blob = await new Promise(res => c.toBlob(res, 'image/png'));
        return blob ? new Uint8Array(await /** @type {Blob} */ (blob).arrayBuffer()) : null;
      } finally { URL.revokeObjectURL(url); }
    }
    if (/** @type {any} */ (globalThis).process?.versions?.node) {
      const name = 'sharp'; // not bundled for the browser: a runtime import in Node only
      const sharp = (await import(/* @vite-ignore */ /* webpackIgnore: true */ /* turbopackIgnore: true */ name)).default;
      return new Uint8Array(await sharp(Buffer.from(svg), { density: 72 * scale }).resize(W, H, { fit: 'fill' }).png().toBuffer());
    }
  } catch { /* no rasteriser: SVG only */ }
  return null;
}

/**
 * A figure as picture parts: { png?, svg?, jpeg?, w, h, x, y } (where and how big it is drawn, in points). A figure that is one picture (an image item, maybe in a box)
 * keeps the picture's own bytes; anything else is drawn as SVG and rasterised.
 * @param {any} fig @param {{ fontStore?: any, fetchImage?: (src: string) => Promise<Uint8Array|null>, rasterize?: any }} opt
 */
export async function figurePicture(fig, opt = {}) {
  // pictures by URL: their bytes go into the SVG (an SVG drawn as a picture loads nothing itself)
  const bytesOf = async (src) => {
    try {
      const b = /^data:/i.test(src) ? dataUriBytesOf(src) : opt.fetchImage ? await opt.fetchImage(src) : null;
      const info = b && b.length <= IMAGE_LIMITS.bytes ? imageInfoOf(b) : null;
      return info && ['png', 'jpeg', 'svg'].includes(info.type) ? { b, info } : null;
    } catch { return null; }
  };
  const items = [];
  for (const it of fig.items) {
    if (it.t !== 'image') { items.push(it); continue; }
    const got = await bytesOf(it.src);
    if (!got) continue;
    // one picture, fitted whole into its box: Word and PowerPoint get its own bytes, at the size it is drawn
    const alone = fig.items.every(i => i === it || i.t === 'link' || i.t === 'bookmark');
    if (alone && (got.info.type === 'png' || got.info.type === 'jpeg') && (it.fit === 'fill' || ((it.fit || 'contain') === 'contain' && got.info.w > 0))) {
      if (it.fit === 'fill') return { [got.info.type]: got.b, w: it.w, h: it.h, x: it.x, y: it.y };
      const s = Math.min(it.w / got.info.w, it.h / got.info.h);
      const w = got.info.w * s, h = got.info.h * s;
      return { [got.info.type]: got.b, w, h, x: it.x + (it.w - w) / 2, y: it.y + (it.h - h) / 2 };
    }
    items.push({ ...it, src: `data:image/${got.info.type === 'svg' ? 'svg+xml' : got.info.type};base64,${b64(got.b)}` });
  }
  const svg = figureSvg({ items, box: fig.box }, opt.fontStore);
  const png = await rasterize(svg, fig.box.w, fig.box.h, opt);
  return { svg, png, w: fig.box.w, h: fig.box.h, x: fig.box.x, y: fig.box.y };
}

/** base64 of bytes (Node or browser). @param {Uint8Array} u8 */
export function b64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, /** @type {any} */ (u8.subarray(i, i + 0x8000)));
  return btoa(s);
}

/** A colour as six hex digits (upper case), or null: none, transparent, fully transparent, or not one we read. */
export const hexOrNull = (c) => {
  const s = String(c || '').trim();
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s) || /^#?([0-9a-f]{3})$/i.exec(s);
  if (!m || m[2] === '00') return null;
  return (m[1].length === 3 ? [...m[1]].map(x => x + x).join('') : m[1]).toUpperCase();
};

/** A figure's description: its alt text, else what it is. */
export const altOf = (tag) => tag?.alt || ({ chart: 'Chart', image: 'Picture', map: 'Map', barcode: 'Barcode', shape: 'Shape', line: 'Line', sparkline: 'Sparkline', databar: 'Data bar', bullet: 'Bullet chart', iconset: 'Status icon', rangebar: 'Range bar' })[tag?.k] || 'Graphic';

/**
 * The box a text item was painted in (paintBox: background rect, the text, its decoration lines, then the border
 * lines or one rounded border rect), read back from the items around it: { fill, radius, sides: { top, right, bottom, left } }.
 * @param {any[]} items @param {number} i the text item's index
 */
export function boxDecor(items, i) {
  const it = items[i], c = it.clip;
  if (!c) return null;
  const near = (a, b) => Math.abs(a - b) < 0.05;
  const isBox = (r) => r && r.t === 'rect' && !r.tag && near(r.x, c.x) && near(r.y, c.y) && near(r.w, c.w) && near(r.h, c.h);
  let fill = null, radius = 0;
  for (let k = i - 1; k >= Math.max(0, i - 2); k--) if (isBox(items[k]) && items[k].fill) { fill = hexOrNull(items[k].fill); radius = items[k].radius || 0; break; }
  /** @type {Record<string, any>} */
  const sides = {};
  for (let k = i + 1; k < items.length && k <= i + 6 + 2 * it.lines.length; k++) {
    const o = items[k];
    if (o.tag || o.art !== it.art) break;
    if (o.t === 'rect' && isBox(o) && o.stroke) { for (const s of ['top', 'right', 'bottom', 'left']) sides[s] = o; radius = o.radius || radius; break; }
    if (o.t !== 'line') break;
    if (near(o.y1, o.y2) && near(o.y1, c.y) && near(Math.min(o.x1, o.x2), c.x)) sides.top = o;
    else if (near(o.y1, o.y2) && near(o.y1, c.y + c.h) && near(Math.min(o.x1, o.x2), c.x)) sides.bottom = o;
    else if (near(o.x1, o.x2) && near(o.x1, c.x) && near(Math.min(o.y1, o.y2), c.y)) sides.left = o;
    else if (near(o.x1, o.x2) && near(o.x1, c.x + c.w) && near(Math.min(o.y1, o.y2), c.y)) sides.right = o;
  }
  return fill || Object.keys(sides).length ? { fill, radius, sides } : null;
}

/**
 * The in-cell visuals of the tables on a page (sparklines, data bars, icons that a table cell draws; the engine does
 * not tag those): shapes inside a table's rows that are not a cell's background. Each becomes a picture in its cell.
 * Found by position: a visual in a row with no text cell at all is not found (it stays out).
 * @param {any[]} items @param {Set<number>} used indexes already taken (marked here too)
 * @param {Map<string, { cells: any[] }>} tables table key → its cell text items (with cell tags and clips)
 * @returns {Map<string, Map<string, { items: any[], box: any }>>} table key → `${row}|${col}` → the visual
 */
export function cellVisuals(items, used, tables) {
  const out = new Map();
  if (!tables.size) return out;
  const geo = [...tables.entries()].map(([key, b]) => {
    const rows = new Map();
    let left = Infinity;
    for (const it of b.cells) {
      const c = it.clip;
      if (!c) continue;
      if (!rows.has(it.cell.row)) rows.set(it.cell.row, { y: c.y, h: c.h });
      left = Math.min(left, c.x - it.cell.cols.slice(0, it.cell.col).reduce((s, w) => s + w, 0));
    }
    const cols = b.cells[0].cell.cols;
    const edges = [left];
    for (const w of cols) edges.push(edges[edges.length - 1] + w);
    return { key, rows: [...rows.entries()], left, cols, edges, right: edges[edges.length - 1] };
  });
  const near = (a, b) => Math.abs(a - b) < 0.05;
  items.forEach((it, i) => {
    if (used.has(i) || it.tag || it.art || !['path', 'ellipse', 'rect'].includes(it.t)) return;
    const bx = boxOf([it]);
    if (!bx) return;
    const cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
    for (const g of geo) {
      if (cx < g.left || cx > g.right) continue;
      const row = g.rows.find(([, r]) => cy >= r.y && cy <= r.y + r.h);
      if (!row) continue;
      const [rid, r] = row;
      // a cell's own background or border box: from one column edge to another (a visual sits inside its padding)
      if (it.t === 'rect' && g.edges.some(e => near(e, it.x)) && g.edges.some(e => near(e, it.x + it.w))) return;
      let col = 0, x = g.left;
      while (col < g.cols.length - 1 && cx > x + g.cols[col]) x += g.cols[col++];
      const m = out.get(g.key) || out.set(g.key, new Map()).get(g.key);
      const k = `${rid}|${col}`;
      const v = m.get(k) || m.set(k, { items: [], box: null }).get(k);
      v.items.push(it);
      used.add(i);
      return;
    }
  });
  for (const m of out.values()) for (const v of m.values()) v.box = boxOf(v.items);
  return out;
}
