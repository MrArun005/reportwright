// @ts-check
/**
 * The page painter both PDF writers share (pdf.js: the whole document through pdf-lib; pdfstream.js: page by page):
 * a page's operators as text (Content), shaped runs drawn by glyph ID (drawRun, glyphText), colours and numbers.
 * A font here is anything with { embedder: { font } } (fontkit) whose resource name shared.font(pf) gives.
 */
import { parseColor } from './color.js';
import { FORMAT_CHAR } from '../engine/text/measure.js';

/** a colour for pdf-lib (color) and for our own operators (rgb: "r g b") */
const colors = new Map();
export const col = (c) => {
  const hit = colors.get(c);
  if (hit !== undefined || colors.has(c)) return hit;
  const p = parseColor(c), v = p ? { color: rgb(p.r, p.g, p.b), opacity: p.a, rgb: `${n3(p.r)} ${n3(p.g)} ${n3(p.b)}` } : null;
  if (colors.size < 1000) colors.set(c, v); // ponytail: a bounded memo; report colours are few
  return v;
};
export const BLACK = { color: rgb(0, 0, 0), opacity: 1, rgb: '0 0 0' };
/** pdf-lib's rgb() and PDFHexString.fromText(s).toString(), here so the streaming writer never loads pdf-lib */
/** @param {number} red @param {number} green @param {number} blue @returns {import('pdf-lib').RGB} */
function rgb(red, green, blue) { return { type: /** @type {any} */ ('RGB'), red, green, blue }; }
const hexText = (/** @type {string} */ s) => { let h = '<FEFF'; for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'); return `${h}>`; };
// numbers in content streams: positions to 1/100 pt, colours and matrices finer
export const n2 = (v) => Math.round(v * 100) / 100;
export const n3 = (v) => Math.round(v * 1000) / 1000;
export const n4 = (v) => Math.round(v * 10000) / 10000;
export const hex4 = (id) => id.toString(16).padStart(4, '0');
export const KAPPA = 4 * ((Math.SQRT2 - 1) / 3);
// as pdf-lib's drawText cleaned text: tabs and line separators become four spaces
export const cleanText = (t) => (ODD.test(t) ? t.replace(/\t|\u0085|\u2028|\u2029/g, '    ').replace(/[\b\v]/g, '') : t);
const ODD = /[\t\b\v\u0085\u2028\u2029]/;

/**
 * Draw one run of shaped glyphs by ID, where the engine placed them: a TJ array whose numbers move each
 * glyph from where the font's own advance (the W array) leaves it to the shaper's position; marks that sit
 * higher or lower use the text rise. /ActualText gives copy and search the characters: for a left-to-right
 * run the whole run in reading order; a right-to-left run (drawn in visual order, which readers reorder
 * themselves) reads through ToUnicode, glyph by glyph, and only a cluster ToUnicode cannot spell gets a span
 * (`spans`, from glyphText); glyphs that stand for nothing (`texts`: '') go last. A span per joined letter, and
 * the dots of joined letters drawn among the letters, made pdftotext split words ("الج ميل", "الت قن ية").
 * @param {Content} c @param {Set<number>} [spans] @param {Map<number, string>} [texts]
 */
/** True when the character at a cluster's start is a Unicode format character (see FORMAT_CHAR in measure.js). */
const formatAt = (run, cl) => { const cp = run.text.codePointAt(cl); return cp !== undefined && FORMAT_CHAR.test(String.fromCodePoint(cp)); };
export function drawRun(c, run, x, y, size, pf, color, spans, texts) {
  const f = pf.embedder.font;
  const per = 1000 / size;
  const span = (text) => `/Span <</ActualText ${hexText(text)}>> BDC\n`;
  c.et();
  c.paint(color, null); c.font(pf, size);
  if (!run.rtl) c.s += span(run.text);
  c.s += `BT ${n2(x)} ${n2(y)} Td\n`;
  let arr = '';
  let pen = 0, rise = 0;
  const flush = () => { if (arr) c.s += `[${arr}] TJ\n`; arr = ''; };
  const all = run.glyphs;
  const adv = (id) => f.getGlyph(id).advanceWidth;
  /** @type {number[]} */
  let g = all, quietAt = -1;
  if (run.rtl) {
    // Glyphs that stand for nothing (the dots of a joined letter; the marks of a cluster in a span) go last, in
    // one empty /ActualText: drawn among the letters they split a reader's words, and a span that starts or ends
    // on a mark has the wrong box ("ف اتورة").
    const hasBase = new Set();
    for (let i = 0; i < all.length; i += 4) if (adv(all[i]) > 0) hasBase.add(all[i + 3]);
    const quiet = (i) => (spans?.has(all[i + 3]) ? adv(all[i]) === 0 && hasBase.has(all[i + 3]) : texts?.get(all[i]) === '');
    g = [];
    for (const late of [false, true]) {
      if (late) quietAt = g.length;
      for (let i = 0; i < all.length; i += 4) if (quiet(i) === late) g.push(all[i], all[i + 1], all[i + 2], all[i + 3]);
    }
    if (quietAt === g.length) quietAt = -1;
  }
  const starts = run.rtl ? [...new Set(all.filter((_, i) => i % 4 === 3))].sort((a, b) => a - b) : [];
  let inSpan = false;
  for (let i = 0; i < g.length; i += 4) {
    const id = g[i], gx = g[i + 1], gy = g[i + 2], cl = g[i + 3];
    if (i === quietAt) { flush(); c.s += span(''); inSpan = true; }
    else if (run.rtl && spans?.has(cl) && (quietAt < 0 || i < quietAt) && (i === 0 || g[i - 1] !== cl)) { // the first glyph of a cluster
      flush(); c.s += span(run.text.slice(cl, starts[starts.indexOf(cl) + 1] ?? run.text.length)); inSpan = true;
    }
    if (gy !== rise) { flush(); c.s += `${n4(gy)} Ts\n`; rise = gy; }
    const adj = Math.round((pen - gx) * per * 1000) / 1000;
    // a tagged PDF or a PDF/A file draws no .notdef (PDF/UA 7.21.8, PDF/A 6.2.11.8): the glyph is left out, its place kept; so is a format character's (no glyph, no box)
    if (id === 0 && (c.noNotdef || formatAt(run, cl))) pen = gx;
    else {
      arr += (adj ? `${adj}` : '') + `<${f.standard ? id.toString(16).padStart(2, '0') : hex4(id)}>`; // a standard font: one byte
      pen = gx + (adv(id) * size) / f.unitsPerEm;
    }
    if (inSpan && (i + 4 >= g.length || (quietAt < 0 || i + 4 < quietAt) && g[i + 7] !== cl || i + 4 === quietAt)) { flush(); c.s += 'EMC\n'; inSpan = false; }
  }
  flush();
  if (rise) c.s += '0 Ts\n'; // the rise outlives the text object
  c.s += 'ET\n';
  if (!run.rtl) c.s += 'EMC\n';
}

/**
 * The text each shaped glyph stands for, for the font's ToUnicode map: the character whose own (character-map)
 * glyph it is; the characters of its cluster that have no glyph of their own there (a conjunct, a joined
 * Arabic form, a reph) go to ONE glyph, the first that is not a mark, and the cluster's other glyphs (dots,
 * marks) stand for nothing, so a reader gets each character once. A glyph keeps its first text: a
 * right-to-left cluster that would read differently with the texts already set goes into `spans` (drawRun
 * gives it /ActualText). Left-to-right runs always get one span for the whole run.
 * @param {any} run @param {any} font fontkit font @param {Map<number, string>} out
 * @param {WeakMap<any, Set<number>>} [spans]
 */
export function glyphText(run, font, out, spans) {
  const g = run.glyphs;
  const starts = [...new Set(g.filter((_, i) => i % 4 === 3))].sort((a, b) => a - b);
  for (let k = 0; k < starts.length; k++) {
    const chars = [...run.text.slice(starts[k], starts[k + 1] ?? run.text.length)];
    const ids = [];
    for (let i = 0; i < g.length; i += 4) if (g[i + 3] === starts[k]) ids.push(g[i]);
    const own = new Map(chars.map(ch => [font.glyphForCodePoint(ch.codePointAt(0)).id, ch]));
    const rest = chars.filter(ch => !ids.includes(font.glyphForCodePoint(ch.codePointAt(0)).id)).join('');
    const carrier = rest ? (ids.find(id => !own.has(id) && font.getGlyph(id).advanceWidth > 0) ?? ids.find(id => !own.has(id))) : undefined;
    let ok = !rest || carrier !== undefined;
    const want = new Map();
    for (const id of ids) {
      const t = own.get(id) ?? (id === carrier ? rest : '');
      if (want.has(id) && want.get(id) !== t) ok = false; // the same glyph twice in one cluster, standing for different text
      want.set(id, t);
    }
    for (const [id, t] of want) {
      if (!out.has(id)) out.set(id, t);
      else if (out.get(id) !== t) ok = false;
    }
    if (!ok && run.rtl && spans) {
      let s = spans.get(run);
      if (!s) spans.set(run, s = new Set());
      s.add(starts[k]);
    }
  }
}

/**
 * Text inside its clip box needs no clip: the lines' advances within it across, the font's ascent and descent
 * within it down. A cell's text almost always fits, and a clip per cell is most of a table page's operators.
 */
export function insideClip(it, m) {
  const k = it.clip, asc = m.asc * it.size, desc = m.desc * it.size;
  return it.lines.every(l => l.w != null && !l.runs && l.x >= k.x && l.x + l.w <= k.x + k.w && l.y - asc >= k.y && l.y + desc <= k.y + k.h);
}

const eq = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) < 0.005;
/**
 * A page's operators as text. The graphics state is tracked, so a colour, line width, dash, opacity or font
 * that is already set is not set again; q/Q save and restore it as the PDF does.
 */
export class Content {
  constructor(shared) {
    this.shared = shared;
    this._s = '';
    this.bt = false; this.tx = 0; this.ty = 0;
    this.st = { fill: '0 0 0', stroke: '0 0 0', lw: 1, dash: '[] 0', ca: 1, CA: 1, font: '', size: 0 };
    /** @type {any[]} */ this.saved = [];
    /** straight lines waiting to be drawn after the text around them: { key, stroke, w, dash, segs: [x1, y1, x2, y2][] } */
    this.lines = null;
    this.tagged = false;
    /** PDF/A or tagged: a glyph the font lacks (.notdef, id 0) is never drawn; the text is left out and its place kept */
    this.noNotdef = false;
    /** tagged, lines wait all the same and are drawn as one artifact (the streamed PDF's painter sets it) */
    this.artLines = false;
  }
  /**
   * The operators so far. Any other drawing reads or appends to it, so the lines waiting are drawn first: the text
   * of a table's cells stays in one text object (relative moves, which compress to little) instead of one per cell.
   */
  get s() { this.flushLines(); return this._s; }
  set s(v) { this._s = v; }
  /**
   * A straight line. Untagged, it waits until something other than text is drawn (table borders between cell
   * texts); collinear segments that touch, in the same stroke, become one (a row's border is one line).
   * ponytail: lines move after the text drawn just after them; both are thin and do not cover each other.
   */
  line(stroke, w, dash, x1, y1, x2, y2) {
    if (this.tagged && !this.artLines) { this.paint(null, stroke, w, dash); this._s += `${n2(x1)} ${n2(y1)} m ${n2(x2)} ${n2(y2)} l S\n`; return; }
    const L0 = this.lines;
    // the same stroke objects (col() and DASH share them) are the same key: a table's borders skip building it
    if (!(L0 && L0.stroke === stroke && L0.w === w && L0.dash === dash)) {
      const key = `${stroke.rgb}|${stroke.opacity}|${w}|${(dash || []).join(' ')}`;
      if (L0 && L0.key !== key) this.flushLines();
      this.lines ||= { key, stroke, w, dash, segs: [] };
    }
    const segs = this.lines.segs, last = segs[segs.length - 1];
    if (last && eq(last[1], y1) && eq(last[3], y2) && eq(y1, y2) && eq(last[2], x1)) last[2] = x2; // horizontal, end to end
    else if (last && eq(last[0], x1) && eq(last[2], x2) && eq(x1, x2) && eq(last[3], y1)) last[3] = y2; // vertical
    else segs.push([x1, y1, x2, y2]);
  }
  flushLines() {
    const L = this.lines;
    if (!L) return;
    this.lines = null;
    this.et();
    const end = this.artLines ? 'EMC\n' : '';
    if (end) this._s += '/Artifact BMC\n';
    this.paint(null, L.stroke, L.w, L.dash);
    const g = L.segs;
    // a table's row borders: the same line a row height apart. Drawn once and moved down (cm) for each row, so the
    // operators repeat exactly and compress to almost nothing
    const dy = g.length > 2 ? Math.round((g[1][1] - g[0][1]) * 100) : 0;
    if (dy && g.every((q, i) => q[1] === q[3] && n2(q[0]) === n2(g[0][0]) && n2(q[2]) === n2(g[0][2]) && Math.abs(q[1] - (g[0][1] + i * dy / 100)) < 0.01)) {
      const one = `${n2(g[0][0])} ${n2(g[0][1])} m ${n2(g[0][2])} ${n2(g[0][1])} l S\n`;
      this._s += `q\n${one}${`1 0 0 1 0 ${dy / 100} cm ${one}`.repeat(g.length - 1)}Q\n${end}`;
      return;
    }
    this._s += g.map(([a, b, c, d]) => `${n2(a)} ${n2(b)} m ${n2(c)} ${n2(d)} l`).join(' ') + ' S\n' + end;
  }
  q() { this.et(); this._s += 'q\n'; this.saved.push({ ...this.st }); }
  Q() { this.et(); this._s += 'Q\n'; this.st = this.saved.pop(); }
  /**
   * A line of plain text at (x, y). Lines follow one another in one text object, each placed relative to the
   * last (in whole hundredths, so nothing drifts): most of a table page is these.
   * @param {string} str the glyphs, as a literal string's escaped body (array: a TJ array's body)
   */
  text(pf, size, color, x, y, str, array = false) {
    this.setPaint(color, null);
    this.setFont(pf, size);
    // in tenths of a point (0.035 mm): table rows repeat the same moves, which compress to little
    const X = Math.round(x * 10) * 10, Y = Math.round(y * 10) * 10;
    if (!this.bt) { this._s += 'BT\n'; this.bt = true; this.tx = 0; this.ty = 0; }
    this._s += array ? `${(X - this.tx) / 100} ${(Y - this.ty) / 100} Td [${str}] TJ\n` : `${(X - this.tx) / 100} ${(Y - this.ty) / 100} Td (${str}) Tj\n`;
    this.tx = X; this.ty = Y;
  }
  /** end the open text object, if any: anything but text needs that (and draws the lines waiting) */
  et() { if (this.bt) { this._s += 'ET\n'; this.bt = false; } if (this.lines) this.flushLines(); }
  lineWidth(w) { if (this.lines) this.flushLines(); this.setLineWidth(w); }
  setLineWidth(w) { if (this.st.lw !== w) { this._s += `${n3(w)} w\n`; this.st.lw = w; } }
  /** the graphics state that sets these opacities, or undefined when they are set already */
  gsFor(ca, CA) { return ca === this.st.ca && CA === this.st.CA ? undefined : this.shared.gs(ca, CA); }
  alpha(ca, CA) { if (this.lines) this.flushLines(); this.setAlpha(ca, CA); }
  setAlpha(ca, CA) { const g = this.gsFor(ca, CA); if (g) { this._s += `/${g} gs\n`; this.st.ca = ca; this.st.CA = CA; } }
  /** set up to fill with fill and/or stroke with stroke (width w, dash); the lines waiting are drawn first */
  paint(fill, stroke, w = 1, dash = null) { if (this.lines) this.flushLines(); this.setPaint(fill, stroke, w, dash); }
  setPaint(fill, stroke, w = 1, dash = null) {
    const st = this.st;
    if (fill && fill.rgb !== st.fill) { this._s += `${fill.rgb} rg\n`; st.fill = fill.rgb; }
    if (stroke) {
      if (stroke.rgb !== st.stroke) { this._s += `${stroke.rgb} RG\n`; st.stroke = stroke.rgb; }
      this.setLineWidth(w);
      const d = `[${(dash || []).map(n3).join(' ')}] 0`;
      if (d !== st.dash) { this._s += `${d} d\n`; st.dash = d; }
    }
    this.setAlpha(fill ? fill.opacity : st.ca, stroke ? stroke.opacity : st.CA);
  }
  font(pf, size) { if (this.lines) this.flushLines(); this.setFont(pf, size); }
  setFont(pf, size) {
    const name = this.shared.font(pf);
    if (name !== this.st.font || size !== this.st.size) { this._s += `/${name} ${n3(size)} Tf\n`; this.st.font = name; this.st.size = size; }
  }
}

/** one byte per char: the content stream holds the glyph bytes of literal strings as chars 0–255 */
export function latin1(s) {
  const B = /** @type {any} */ (globalThis).Buffer;
  if (B) return B.from(s, 'latin1'); // Node: native, several times faster than the loop
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * zlib (Flate) compression: Node's zlib on its thread pool (pages compress in parallel, off the main thread), else
 * the platform's CompressionStream (browsers; in Node it is the same zlib behind web streams, slower), else fflate.
 */
export async function deflate(bytes) {
  // a few at a time: each zlib job holds ~260 KB of state, so a thousand pages started at once held ~250 MB
  if (zslots.free > 0) zslots.free--; else await new Promise((ok) => zslots.wait.push(/** @type {() => void} */ (ok)));
  try { return await deflateNow(bytes); } finally { const next = zslots.wait.shift(); if (next) next(); else zslots.free++; }
}
const zslots = { free: 4, wait: /** @type {(() => void)[]} */ ([]) }; // ponytail: 4 = libuv's default thread pool
export const NODE_ZLIB = /** @type {any} */ (globalThis).process?.getBuiltinModule?.('node:zlib');
async function deflateNow(bytes) {
  const zlib = NODE_ZLIB;
  if (zlib) return new Promise((ok, fail) => zlib.deflate(bytes, { level: 9 }, (e, z) => (e ? fail(e) : ok(z))));
  if (typeof CompressionStream === 'undefined') return (await import('@reportwright/pdf/fflate')).zlibSync(bytes);
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}
