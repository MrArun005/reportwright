// @ts-check
import { parseValue, evaluate, toText } from '../expr/evaluate.js';
import { resolveFontKey } from '../text/fonts.js';
import { padding } from '../style.js';
import { paintBox } from './paint.js';
import { RICH_LIMITS } from '../text/rich.js';

/**
 * Rich text layout. Blocks of styled runs (src/engine/text/rich.js) become lines of fragments; each
 * fragment is one piece of text in one font, size, colour and decoration. The page model gets one
 * ordinary `text` item per fragment, so every exporter draws it where it was measured. Fragments carry
 * `rich: {id, p, l, br?}` (box, paragraph, line, line started by <br>) so text exports can rejoin them.
 */

/** Item defaults; a rich text item can set `listIndent` and `paragraphSpacing` (points). */
export const RICH_DEFAULTS = { listIndent: 18, paragraphSpacing: 4, linkColor: '#0563c1', maxFragments: 20000, maxLines: 5000 };
/** Geometry clamps: definitions are untrusted, so one span must not make a line taller than any page. */
const SIZE = { min: 1, max: 400 }, LINE_HEIGHT = { min: 0.5, max: 5 }, MAX_LIST_LEVEL = 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Data as text: quotes and ';' too, so a value inside an attribute or a CSS value cannot end it. */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', ';': '&#59;' };
const escapeHtml = (s) => String(s).replace(/[&<>"';]/g, (c) => ESC[c]);

/**
 * The markup of a rich text value. Only the literal markup the author typed is HTML. Everything that comes
 * from evaluation (a {Fields.x} part of a template, or the result of a value that is one =expression) is
 * escaped and shows as text, unless the item sets `htmlFromData: true` (HTML stored in trusted data); then
 * it is parsed too, through the same allow-list.
 * @param {any} v @param {any} ctx @param {boolean} [htmlFromData]
 */
export function richValue(v, ctx, htmlFromData = false) {
  const p = parseValue(v);
  const data = (r) => { const s = String(toText(r, null, ctx)).slice(0, RICH_LIMITS.maxLength + 1); return htmlFromData ? s : escapeHtml(s); };
  if (p.kind === 'lit') return p.v == null ? '' : String(p.v);
  if (p.kind === 'expr') return data(evaluate(p.ast, ctx));
  // stop once the result is past the parser's limit: a field can hold megabytes (the parser cuts and warns)
  let out = '';
  for (const part of p.parts) {
    if (out.length > RICH_LIMITS.maxLength) break;
    out += typeof part === 'string' ? part : data(evaluate(part.ast, ctx));
  }
  return out;
}

/**
 * @typedef {{ id: string, key: string, size: number, lineSize: number, rise: number, color: string,
 *   under: boolean, strike: boolean, bg?: string, href?: string }} Look
 * @typedef {{ text: string, look: Look, x: number, w: number }} Frag
 * @typedef {{ frags: Frag[], w: number, h: number, base: number, left: number, align: string, p: number, br: boolean, gap: number }} RichLine
 */

/**
 * @param {import('../text/rich.js').RichBlock[]} blocks
 * @param {any} st the item's resolved style
 * @param {number} width
 * @param {import('../text/measure.js').TextMeasurer} m
 * @param {{ listIndent?: number, paragraphSpacing?: number, maxLineHeight?: number, warn?: (msg: string) => void }} [opt]
 */
export function layoutRich(blocks, st, width, m, opt = {}) {
  const pad = padding(st);
  const inner = Math.max(1, width - pad[1] - pad[3]);
  const lhf = clamp(Number(st.lineHeight) || 1.25, LINE_HEIGHT.min, LINE_HEIGHT.max);
  const baseSize = clamp(Number(st.fontSize) || 9, SIZE.min, SIZE.max);
  const warn = opt.warn || (() => {});
  const maxH = opt.maxLineHeight > 0 ? opt.maxLineHeight : Infinity;
  const baseAlign = st.textAlign === 'center' || st.textAlign === 'right' ? st.textAlign : 'left';
  const indent = Number.isFinite(Number(opt.listIndent)) && opt.listIndent != null ? clamp(Number(opt.listIndent), 0, 144) : RICH_DEFAULTS.listIndent;
  const spacing = Number.isFinite(Number(opt.paragraphSpacing)) && opt.paragraphSpacing != null ? clamp(Number(opt.paragraphSpacing), 0, 144) : RICH_DEFAULTS.paragraphSpacing;
  /** @type {Map<any, Look>} */
  const looks = new Map();
  const lookOf = (rs) => {
    let l = looks.get(rs);
    if (l) return l;
    const key = resolveFontKey(rs.fontFamily || st.fontFamily, rs.fontWeight || st.fontWeight, rs.fontStyle || st.fontStyle);
    const lineSize = clamp(rs.fontSize || baseSize, SIZE.min, SIZE.max);
    let size = lineSize, rise = 0;
    if (rs.script) {
      const sc = m.script(key);
      size = Math.round(lineSize * (rs.script === 'sup' ? sc.supScale : sc.subScale) * 100) / 100;
      rise = rs.script === 'sup' ? lineSize * sc.supRise : -lineSize * sc.subDrop;
    }
    const under = rs.underline ?? (rs.href ? true : false);
    const color = rs.color || (rs.href ? RICH_DEFAULTS.linkColor : st.color || '#000');
    l = { id: '', key, size, lineSize, rise, color, under: !!under, strike: !!rs.strike, bg: rs.background, href: rs.href };
    l.id = [key, size, rise, color, l.under, l.strike, l.bg || '', l.href || ''].join('|');
    looks.set(rs, l);
    return l;
  };
  /** @type {RichLine[]} */
  const lines = [];
  let fragCount = 0, full = false;
  blocks.forEach((b, bi) => {
    if (full) return;
    const left = Math.min(MAX_LIST_LEVEL, Math.max(b.level, b.marker ? 1 : 0)) * indent;
    const avail = Math.max(1, inner - left);
    const align = b.align || baseAlign;
    // words: pieces of text between spaces (a word may change style midway); space = the look of the space after it
    /** @type {{ parts: { text: string, look: Look }[], space: Look|null, br?: boolean }[]} */
    const words = [];
    let cur = null;
    for (const run of b.runs) {
      const look = lookOf(run.st);
      for (const ch of run.text) {
        if (ch === '\n') { cur = null; words.push({ parts: [], space: null, br: true }); continue; }
        if (ch === ' ') { if (cur) { cur.space = look; cur = null; } continue; }
        if (!cur) { cur = { parts: [], space: null }; words.push(cur); }
        const last = cur.parts[cur.parts.length - 1];
        if (last && last.look === look) last.text += ch; else cur.parts.push({ text: ch, look });
      }
    }
    /** @type {{ text: string, look: Look }[]} */
    let segs = [];
    let lw = 0, br = false, first = true, prevSpace = /** @type {Look|null} */ (null);
    const width1 = (t, l) => m.width(t, l.key, l.size);
    const endLine = (nextBr) => {
      if (full) return;
      if (lines.length >= RICH_DEFAULTS.maxLines || fragCount >= RICH_DEFAULTS.maxFragments) {
        full = true;
        warn(`more than ${RICH_DEFAULTS.maxLines} lines or ${RICH_DEFAULTS.maxFragments} styled pieces; the rest is cut.`);
        return;
      }
      // merge neighbours of one look into fragments, measured once each
      /** @type {Frag[]} */
      const frags = [];
      for (const s of segs) {
        const f = frags[frags.length - 1];
        if (f && f.look.id === s.look.id) f.text += s.text; else frags.push({ text: s.text, look: s.look, x: 0, w: 0 });
      }
      let x = 0, above = 0, below = 0, ls = 0;
      for (const f of frags) {
        f.w = width1(f.text, f.look); f.x = x; x += f.w;
        const mt = m.metrics(f.look.key, f.look.size);
        above = Math.max(above, mt.ascent + f.look.rise);
        below = Math.max(below, mt.descent - f.look.rise);
        ls = Math.max(ls, f.look.lineSize);
      }
      if (!frags.length) { const mt = m.metrics(resolveFontKey(st.fontFamily, st.fontWeight, st.fontStyle), baseSize); above = mt.ascent; below = mt.descent; ls = baseSize; }
      const h = Math.min(maxH, Math.max(ls * lhf, above + below)); // never taller than a page
      if (first && b.marker) {
        const ml = lookOf(b.runs[0]?.st || {});
        const mw = width1(b.marker, ml);
        // the marker carries a space, so text exports read "• item"
        frags.splice(0, 0, { text: `${b.marker} `, look: { ...ml, under: false, strike: false, bg: undefined, href: undefined, rise: 0, size: ml.lineSize, id: 'marker' }, x: -Math.min(indent, mw + ml.lineSize * 0.4), w: mw + width1(' ', ml) });
      }
      fragCount += frags.length;
      lines.push({ frags, w: x, h, base: (h - above - below) / 2 + above, left, align, p: bi, br, gap: 0 });
      segs = []; lw = 0; br = nextBr; first = false; prevSpace = null;
    };
    const pushParts = (parts) => { for (let k = 0; k < parts.length; k++) segs.push(parts[k]); };
    for (const wd of words) {
      if (full) break;
      if (wd.br) { endLine(true); continue; }
      const ww = wd.parts.reduce((s, p) => s + width1(p.text, p.look), 0);
      const sp = prevSpace ? width1(' ', prevSpace) : 0;
      if (segs.length && lw + sp + ww <= avail) {
        segs.push({ text: ' ', look: /** @type {Look} */ (prevSpace) });
        pushParts(wd.parts); lw += sp + ww;
      } else {
        if (segs.length) endLine(false);
        if (ww <= avail) { pushParts(wd.parts); lw = ww; } else {
          // a word wider than the line breaks by character (the line cap stops a long word in a narrow box)
          for (const p of wd.parts) for (const ch of p.text) {
            if (full) break;
            const cw = width1(ch, p.look);
            if (lw + cw > avail && segs.length) endLine(false);
            const last = segs[segs.length - 1];
            if (last && last.look === p.look) last.text += ch; else segs.push({ text: ch, look: p.look });
            lw += cw;
          }
        }
      }
      prevSpace = wd.space;
    }
    // a block that ends in <br> has no empty line after it
    if (segs.length || !words.length || !words[words.length - 1].br) endLine(false);
    else if (!lines.length || lines[lines.length - 1].p !== bi) endLine(false);
    if (b.spaceAfter && bi < blocks.length - 1) lines[lines.length - 1].gap = spacing;
  });
  const needed = lines.reduce((s, l) => s + l.h + l.gap, 0) + pad[0] + pad[2];
  return { lines, needed, pad, inner, fragments: fragCount };
}

/**
 * Page-model items for rich text lines in a box: background, span backgrounds, one text item per fragment,
 * decorations, borders, then links. Lines that do not fit the box are left out.
 * @param {{ x: number, y: number, w: number, h: number, st: any, rl: { lines: RichLine[], pad: number[], inner: number },
 *   m: import('../text/measure.js').TextMeasurer, id: string }} o
 */
export function paintRich({ x, y, w, h, st, rl, m, id }) {
  const box = paintBox({ x, y, w, h, st, tl: null, m });
  const nb = (st.backgroundColor ? 1 : 0) + (st.backgroundImage ? 1 : 0);
  const { lines, pad, inner } = rl;
  const bgs = [], texts = [], decos = [], links = [];
  const avail = h - pad[0] - pad[2];
  let blockH = 0;
  for (let i = 0; i < lines.length; i++) blockH += lines[i].h + (i < lines.length - 1 ? lines[i].gap : 0);
  let top = y + pad[0];
  if (st.verticalAlign === 'middle') top += Math.max(0, (avail - blockH) / 2);
  else if (st.verticalAlign === 'bottom') top += Math.max(0, avail - blockH);
  const clip = { x, y, w, h };
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    if (top + ln.h > y + h - pad[2] + 1.01 && ln !== lines[0]) break; // 1pt tolerance, as can-grow
    const avl = Math.max(1, inner - ln.left);
    let lx = x + pad[3] + ln.left;
    if (ln.align === 'right') lx += avl - ln.w;
    else if (ln.align === 'center') lx += (avl - ln.w) / 2;
    const baseY = top + ln.base;
    ln.frags.forEach((f, k) => {
      const L = f.look, fx = lx + f.x, by = baseY - L.rise;
      const mt = m.metrics(L.key, L.size);
      if (L.bg) bgs.push({ t: 'rect', x: fx, y: by - mt.ascent, w: f.w, h: mt.ascent + mt.descent, fill: L.bg });
      const rich = { id, p: ln.p, l: li };
      if (ln.br && k === 0) rich.br = true;
      if (ln.align !== 'left') rich.a = ln.align; // for Word
      if (L.rise) { rich.s = L.rise > 0 ? 'sup' : 'sub'; rich.z = L.lineSize; }
      const t = { t: 'text', font: L.key, size: L.size, color: L.color, lines: [{ x: fx, y: by, text: f.text, w: f.w }], clip, rich };
      if (L.under || L.strike) {
        t.deco = [L.under ? 'underline' : '', L.strike ? 'line-through' : ''].filter(Boolean).join(' ');
        if (f.text.trim()) {
          const d = m.decoration(L.key, L.size);
          if (L.under) decos.push({ t: 'line', x1: fx, y1: by + d.underlineY, x2: fx + f.w, y2: by + d.underlineY, stroke: L.color, strokeWidth: d.underlineWidth, dash: null });
          if (L.strike) decos.push({ t: 'line', x1: fx, y1: by + d.strikeY, x2: fx + f.w, y2: by + d.strikeY, stroke: L.color, strokeWidth: d.strikeWidth, dash: null });
        }
      }
      texts.push(t);
      if (L.href && f.text.trim()) links.push({ t: 'link', x: fx, y: top, w: f.w, h: ln.h, action: { type: 'url', href: L.href } });
    });
    top += ln.h + ln.gap;
  }
  return [...box.slice(0, nb), ...bgs, ...texts, ...decos, ...box.slice(nb), ...links];
}

/* ---------------------------------------------------------------- vertical text */
/** Characters set upright in vertical text: CJK ideographs, kana, Hangul, CJK punctuation and full-width forms. */
const upright = (cp) => (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff)
  || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3ffff);
const MAX_VERTICAL = { tokens: 20000 };

/**
 * Vertical text (writing-mode tb-rl): columns from right to left, each read top to bottom. Upright characters
 * (CJK) are stacked one em apart, one text item per column; runs of other text (Latin, digits) are text items
 * turned 90° clockwise about their own centre, so every exporter draws them with Phase 1's rotation.
 * The box keeps its designed size; text past the last column that fits is left out.
 * @param {{ x: number, y: number, w: number, h: number, st: any, text: string, m: import('../text/measure.js').TextMeasurer }} o
 */
export function paintVertical({ x, y, w, h, st, text, m }) {
  const box = paintBox({ x, y, w, h, st, tl: null, m });
  const nb = (st.backgroundColor ? 1 : 0) + (st.backgroundImage ? 1 : 0);
  const key = resolveFontKey(st.fontFamily, st.fontWeight, st.fontStyle);
  const size = clamp(Number(st.fontSize) || 9, SIZE.min, SIZE.max);
  const colW = size * clamp(Number(st.lineHeight) || 1.25, LINE_HEIGHT.min, LINE_HEIGHT.max);
  const pad = padding(st);
  const innerH = Math.max(1, h - pad[0] - pad[2]), innerW = Math.max(1, w - pad[1] - pad[3]);
  const maxCols = Math.max(1, Math.floor((innerW + 0.01) / colW));
  const { ascent, descent } = m.metrics(key, size);
  /** @type {{ toks: { up: boolean, text: string, at: number, adv: number }[], len: number }[]} */
  const cols = [];
  let col = null, n = 0;
  const newCol = () => { if (cols.length >= maxCols) return false; col = { toks: [], len: 0 }; cols.push(col); return true; };
  const place = (up, t) => {
    const adv = up ? size : m.width(t, key, size);
    if (col.len + adv > innerH + 0.01 && col.toks.length && !newCol()) return false;
    col.toks.push({ up, text: t, at: col.len, adv });
    col.len += adv;
    return ++n < MAX_VERTICAL.tokens;
  };
  out: for (const para of String(text).split(/\r?\n/)) {
    if (!newCol()) break;
    let run = '';
    for (const ch of para) {
      const up = upright(/** @type {number} */ (ch.codePointAt(0)));
      // other text is placed a word at a time (with its space), so a column breaks between words
      if (!up && ch !== ' ') { run += ch; continue; }
      if (!up) { run += ch; if (!place(false, run)) break out; run = ''; continue; }
      if (run && !place(false, run)) break out;
      run = '';
      if (!place(true, ch)) break out;
    }
    if (run && !place(false, run)) break;
  }
  const texts = [];
  const clip = { x, y, w, h };
  cols.forEach((c, ci) => {
    const cx = x + w - pad[1] - (ci + 0.5) * colW;
    let top = y + pad[0];
    if (st.textAlign === 'center') top += (innerH - c.len) / 2;
    else if (st.textAlign === 'right') top += innerH - c.len;
    const ups = [];
    for (const t of c.toks) {
      if (t.up) {
        const cw = m.width(t.text, key, size);
        ups.push({ x: cx - cw / 2, y: top + t.at + size / 2 + (ascent - descent) / 2, text: t.text, w: cw });
        continue;
      }
      const s = t.text.trimEnd();
      if (!s) continue;
      const sw = m.width(s, key, size), cy = top + t.at + sw / 2;
      texts.push({ t: 'text', font: key, size, color: st.color || '#000', lines: [{ x: cx - sw / 2, y: cy + (ascent - descent) / 2, text: s, w: sw }],
        clip: { x: cx - sw / 2, y: cy - colW / 2, w: sw, h: colW }, rotate: { a: 90, cx, cy } });
    }
    if (ups.length) texts.push({ t: 'text', font: key, size, color: st.color || '#000', lines: ups, clip });
  });
  return [...box.slice(0, nb), ...texts, ...box.slice(nb)];
}
