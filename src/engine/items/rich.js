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
export const RICH_DEFAULTS = { listIndent: 18, paragraphSpacing: 4, linkColor: '#0563c1', maxFragments: 20000 };

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The markup of a rich text value. Template parts ({Fields.x}) are escaped, so data never adds tags;
 * a value that is one =expression is the author's markup and is parsed as it is.
 * @param {any} v @param {any} ctx
 */
export function richValue(v, ctx) {
  const p = parseValue(v);
  if (p.kind === 'lit') return p.v == null ? '' : String(p.v);
  if (p.kind === 'expr') { const r = evaluate(p.ast, ctx); return typeof r === 'string' ? r.slice(0, RICH_LIMITS.maxLength + 1) : escapeHtml(toText(r, null, ctx)); }
  // stop once the result is past the parser's limit: a field can hold megabytes (the parser cuts and warns)
  let out = '';
  for (const part of p.parts) {
    if (out.length > RICH_LIMITS.maxLength) break;
    out += typeof part === 'string' ? part : escapeHtml(String(toText(evaluate(part.ast, ctx), null, ctx)).slice(0, RICH_LIMITS.maxLength + 1));
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
 * @param {{ listIndent?: number, paragraphSpacing?: number }} [opt]
 */
export function layoutRich(blocks, st, width, m, opt = {}) {
  const pad = padding(st);
  const inner = Math.max(1, width - pad[1] - pad[3]);
  const lhf = Number(st.lineHeight) || 1.25;
  const baseSize = Number(st.fontSize) || 9;
  const baseAlign = st.textAlign === 'center' || st.textAlign === 'right' ? st.textAlign : 'left';
  const indent = Number.isFinite(Number(opt.listIndent)) && opt.listIndent != null ? Math.max(0, Number(opt.listIndent)) : RICH_DEFAULTS.listIndent;
  const spacing = Number.isFinite(Number(opt.paragraphSpacing)) && opt.paragraphSpacing != null ? Math.max(0, Number(opt.paragraphSpacing)) : RICH_DEFAULTS.paragraphSpacing;
  /** @type {Map<any, Look>} */
  const looks = new Map();
  const lookOf = (rs) => {
    let l = looks.get(rs);
    if (l) return l;
    const key = resolveFontKey(rs.fontFamily || st.fontFamily, rs.fontWeight || st.fontWeight, rs.fontStyle || st.fontStyle);
    const lineSize = rs.fontSize || baseSize;
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
  let fragCount = 0;
  blocks.forEach((b, bi) => {
    const left = Math.max(b.level, b.marker ? 1 : 0) * indent;
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
      const h = Math.max(ls * lhf, above + below);
      if (first && b.marker) {
        const ml = lookOf(b.runs[0]?.st || {});
        const mw = width1(b.marker, ml);
        frags.unshift({ text: b.marker, look: { ...ml, under: false, strike: false, bg: undefined, href: undefined, rise: 0, size: ml.lineSize, id: 'marker' }, x: -Math.min(indent, mw + ml.lineSize * 0.4), w: mw });
      }
      fragCount += frags.length;
      lines.push({ frags, w: x, h, base: (h - above - below) / 2 + above, left, align, p: bi, br, gap: 0 });
      segs = []; lw = 0; br = nextBr; first = false; prevSpace = null;
    };
    for (const wd of words) {
      if (fragCount > RICH_DEFAULTS.maxFragments) break;
      if (wd.br) { endLine(true); continue; }
      const ww = wd.parts.reduce((s, p) => s + width1(p.text, p.look), 0);
      const sp = prevSpace ? width1(' ', prevSpace) : 0;
      if (segs.length && lw + sp + ww <= avail) {
        segs.push({ text: ' ', look: /** @type {Look} */ (prevSpace) });
        segs.push(...wd.parts); lw += sp + ww;
      } else {
        if (segs.length) endLine(false);
        if (ww <= avail) { segs.push(...wd.parts); lw = ww; } else {
          // a word wider than the line breaks by character
          for (const p of wd.parts) for (const ch of p.text) {
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
