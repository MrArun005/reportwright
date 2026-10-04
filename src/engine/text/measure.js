// @ts-check
/**
 * Text measurement and line breaking. Renderers never wrap or reorder text: they draw what this returns.
 *
 * Fast path (Latin and other simple text the font covers): a sum of fontkit advances. Kerning and
 * ligatures are off everywhere (engine, PDF and SVG), so widths match. This is the path every report
 * took before scripts were supported, and it is unchanged.
 *
 * Complex path (Indic, Arabic, Hebrew, CJK, a character the font lacks): the Unicode bidi algorithm,
 * a font per run (a bundled fallback when the chosen font has no glyph), HarfBuzz shaping, and line
 * breaks only where they are allowed. Such a line carries `runs` (see runs()): visually ordered pieces
 * in one font and one direction, with the glyphs the PDF draws and the widths the SVG reproduces.
 */
import bidiFactory from 'bidi-js';
import { fallbackKey, fontCss, resolveFontKey, DEFAULT_FAMILY, SHAPER } from './fonts.js';

const bidi = bidiFactory();

/** Characters the fast path leaves to the complex path: RTL and Indic scripts, CJK (line breaking), format characters. */
function special(cp) {
  if (cp < 0x0590) return false;
  if (cp <= 0x1cff) return true;
  if (cp >= 0x2000 && cp <= 0x206f) return (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || cp >= 0x2060;
  return (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xa830 && cp <= 0xabff) || (cp >= 0xac00 && cp <= 0xd7af)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe00 && cp <= 0xfe0f)
    || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xfe70 && cp <= 0xfefe) || (cp >= 0xff00 && cp <= 0xffef) || cp >= 0x10000;
}
/** CJK: a line may break between any two of these characters. */
const cjk = (cp) => (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff)
  || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3ffff);
// Kinsoku: never at the start of a line / never at the end of one.
const NO_START = new Set('、。，．・：；？！ー）」』】〕〉》〗〙〟’”｝｠ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々〻‐゠–〜～…‥,.!?:;)]}%ゝゞヽヾ゛゜ㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ｡｣､･ｰ％］｠');
const NO_END = new Set('（「『【〔〈《〖〘〝‘“｛｟([{［｢＄￥￡');
/** Only text with a character from U+0590 up can need the complex path (a quick test before the per-character one). */
const MAYBE = /[^\u0000-\u058f]/;
const RTL_OR_CONTROLS = /[֐-ࣿיִ-﷿ﹰ-﻾‎‏‪-‮⁦-⁩]|[\uD802\uD803\uD83A]/;

const SCRIPTS = ['Latin', 'Greek', 'Cyrillic', 'Armenian', 'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Devanagari', 'Bengali', 'Gurmukhi',
  'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Tibetan', 'Myanmar', 'Georgian', 'Hangul',
  'Ethiopic', 'Khmer', 'Mongolian', 'Han', 'Hiragana', 'Katakana', 'Bopomofo'].map(s => /** @type {[string, RegExp]} */ ([s, new RegExp(`\\p{Script=${s}}`, 'u')]));
/** Scripts drawn glyph by glyph from the character map; everything else is shaped. */
const SIMPLE = new Set(['Latin', 'Greek', 'Cyrillic', 'Armenian', 'Georgian', 'Hangul', 'Han', 'Hiragana', 'Katakana', 'Bopomofo', 'Common']);
const STICKY = /[\p{M}\p{Cf}]/u; // marks, joiners, bidi controls: stay in the font of the character before
const SPACE = /\s/u;
/** @type {Map<number, string>} */
const scriptCache = new Map();
function scriptOf(cp) {
  let s = scriptCache.get(cp);
  if (s === undefined) {
    const ch = String.fromCodePoint(cp);
    s = 'Common';
    for (const [name, re] of SCRIPTS) if (re.test(ch)) { s = name; break; }
    scriptCache.set(cp, s);
  }
  return s;
}
const INTL = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
const GRAPHEMES = INTL ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const JOINS = /[\p{M}\u200c\u200d\ufe00-\ufe0f]/u;
/**
 * Grapheme clusters: where a too-long word may break. Intl.Segmenter when there is one; else code points with
 * marks, joiners and variation selectors kept on the character before (and the character after a ZWJ).
 * @param {string} s @param {boolean} [intl] false: the fallback (tests)
 */
export function clusters(s, intl = true) {
  if (intl && GRAPHEMES) return [...GRAPHEMES.segment(s)].map(x => x.segment);
  /** @type {string[]} */
  const out = [];
  for (const ch of s) {
    if (out.length && (JOINS.test(ch) || out[out.length - 1].endsWith('\u200d'))) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}
const graphemes = (/** @type {string} */ s) => clusters(s);

/** Scripts written without spaces between words (UAX #14 class SA): Thai, Lao, Myanmar, Khmer, Tai Tham, Tai Viet. */
const SA = /[\u0e00-\u0eff\u1000-\u109f\u1780-\u17ff\u19e0-\u19ff\u1a20-\u1aaf\ua9e0-\ua9ff\uaa60-\uaadf]/;
const WORDS = INTL ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
/**
 * Where a line may break inside text written without spaces: the word boundaries ICU's dictionaries find
 * (Node and browsers ship them for Thai, Lao, Khmer and Myanmar), as UTF-16 indices next to an SA character.
 * Without a segmenter there are none (UAX #14 then treats SA as letters), and a word too long for its line
 * breaks between grapheme clusters, as any long word does.
 * @param {string} text @param {Intl.Segmenter|null} [segmenter]
 * @returns {Set<number>}
 */
export function saBreaks(text, segmenter = WORDS) {
  const out = new Set();
  if (!segmenter) return out;
  for (const { index } of segmenter.segment(text)) {
    if (index > 0 && (SA.test(text[index]) || SA.test(text[index - 1]))) out.add(index);
  }
  return out;
}

/**
 * @typedef {{ font: string, x: number, w: number, text: string, rtl?: boolean, shaped?: boolean, glyphs: number[] }} Run
 *   One font, one direction. x and w in points from the start of the line; glyphs: [id, x, y, cluster] per glyph
 *   in visual order, x from the start of the run, y up, cluster = UTF-16 index into `text`.
 */

export class TextMeasurer {
  /** @param {import('./fonts.js').FontStore} store */
  constructor(store) {
    this.store = store;
    /** @type {Map<string, any>} per loaded face: its metrics and advances (see face()) */
    this.faces = new Map();
    /** text layouts of boxes in a static (frozen) style: style → width → text → layout (items/paint.js) */
    this.boxes = new WeakMap();
    this.boxCount = 0;
    /** a frozen style's font key, size, padding and line height (items/paint.js) */
    this.looks = new WeakMap();
    /** @type {Map<string, Map<number, boolean>>} */
    this.cover = new Map();
    /** @type {Map<string, any>} complex layouts at size 1 */
    this.cache = new Map();
    /** fonts (or the shaper) that text needed but the store has not loaded: render() loads them and lays out again @type {Set<string>} */
    this.missing = new Set();
    /** characters no font could draw @type {Set<string>} */
    this.noGlyph = new Set();
  }

  /** The key to measure with: `key` when loaded, else the default face of the same weight and style. */
  usable(key) {
    if (this.store.has(key)) return key;
    if (!this.store.failed.has(key)) this.missing.add(key);
    const c = fontCss(key);
    return resolveFontKey(DEFAULT_FAMILY, c.weight, c.style);
  }

  /**
   * A loaded face's numbers, read once: fontkit's getters (unitsPerEm, ascent…) decode tables on every read.
   * adv: advances per code point (-1 = not on the fast path); words: fast-path units per string (a table repeats them).
   * @param {string} key a loaded key
   */
  face(key) {
    let f = this.faces.get(key);
    if (!f) {
      const font = this.store.get(key);
      f = { font, upm: font.unitsPerEm, ascent: font.ascent, descent: font.descent, adv: new Map(), words: new Map(), met: new Map() };
      this.faces.set(key, f);
    }
    return f;
  }

  /** Font units of `text` on the fast path, or -1 when it needs the complex path. */
  fast(text, key) {
    const f = this.face(key);
    const hit = f.words.get(text);
    if (hit !== undefined) return hit;
    const m = f.adv, font = f.font;
    let units = 0;
    for (let i = 0; i < text.length; i++) {
      let cp = text.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff) { // a surrogate pair is one code point, as for…of reads it
        const lo = text.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) { cp = (cp - 0xd800) * 0x400 + lo - 0xdc00 + 0x10000; i++; }
      }
      let a = m.get(cp);
      if (a === undefined) {
        a = special(cp) || (cp >= 0x20 && !font.hasGlyphForCodePoint(cp)) ? -1 : font.glyphForCodePoint(cp).advanceWidth || 0;
        m.set(cp, a);
      }
      if (a < 0) { units = -1; break; }
      units += a;
    }
    // ponytail: bounded by clearing; an LRU only if a report with >50k distinct words per face shows up in a profile
    if (text.length <= 256) { // short words only: the cache holds at most 50,000 of them per face and render
      if (f.words.size >= 50000) f.words.clear();
      f.words.set(text, units);
    }
    return units;
  }

  /**
   * Advance width in points. @param {string} text @param {string} key @param {number} size
   * @param {'ltr'|'rtl'} [dir] paragraph direction (default: from the first strong character)
   */
  width(text, key, size, dir) {
    const k = this.store.has(key) ? key : this.usable(key);
    const u = this.fast(text, k);
    if (u >= 0) return (u * size) / this.face(k).upm;
    return this.layout(text, k, dir).w * size;
  }

  /**
   * Where underline and strike-through go, from the font's own tables (post and OS/2), in points:
   * y offsets of the stroke centre from the baseline (positive = down, as on the page) and thicknesses.
   * A font without the tables falls back to proportions of its descent and x-height.
   * @param {string} key @param {number} size
   */
  decoration(key, size) {
    const f = this.store.get(this.usable(key));
    const u = f.unitsPerEm, os2 = f['OS/2'] || {};
    const ut = f.underlineThickness > 0 ? f.underlineThickness : u / 14;
    const up = f.underlinePosition < 0 ? f.underlinePosition : f.descent / 2; // top of the stroke, y up
    const st = os2.yStrikeoutSize > 0 ? os2.yStrikeoutSize : ut;
    const sp = os2.yStrikeoutPosition > 0 ? os2.yStrikeoutPosition : (f.xHeight > 0 ? f.xHeight : f.ascent * 0.5) / 2 + st / 2;
    const k = size / u;
    return { underlineY: -(up - ut / 2) * k, underlineWidth: ut * k, strikeY: -(sp - st / 2) * k, strikeWidth: st * k };
  }

  /**
   * Superscript and subscript from the font's OS/2 table, in em: the size of the small text and how far its
   * baseline moves (rise up for superscript, drop down for subscript). Fonts without the values get the
   * proportions most fonts use.
   * @param {string} key
   */
  script(key) {
    const f = this.store.get(this.usable(key));
    const u = f.unitsPerEm, o = f['OS/2'] || {};
    const frac = (v, d) => (v > 0 && v < u * 2 ? v / u : d);
    return { supScale: frac(o.ySuperscriptYSize, 0.65), supRise: frac(o.ySuperscriptYOffset, 0.35), subScale: frac(o.ySubscriptYSize, 0.65), subDrop: frac(o.ySubscriptYOffset, 0.15) };
  }

  /** @param {string} key @param {number} size */
  metrics(key, size) {
    const f = this.face(this.usable(key));
    let r = f.met.get(size);
    if (!r) { r = Object.freeze({ ascent: (f.ascent * size) / f.upm, descent: (-f.descent * size) / f.upm }); f.met.set(size, r); }
    return r;
  }

  /**
   * The visually ordered runs of one line, or null when the line is simple (draw `text` as it is).
   * @param {string} text @param {string} key @param {number} size @param {'ltr'|'rtl'} [dir]
   * @returns {Run[]|null}
   */
  runs(text, key, size, dir) {
    if (!dir && !MAYBE.test(text)) return null; // drawn as it is, in its own font (also when a glyph is missing)
    const k = this.usable(key);
    if (this.fast(text, k) >= 0) return null;
    return this.layout(text, k, dir).runs.map(r => ({
      ...r, x: r.x * size, w: r.w * size,
      glyphs: r.glyphs.map((v, i) => (i % 4 === 1 || i % 4 === 2 ? v * size : v)),
    }));
  }

  /** Paragraph direction of text that needs shaping, bidi or CJK breaks, else undefined. */
  direction(text, key) {
    if (!MAYBE.test(text)) return undefined;
    const k = this.usable(key);
    if (this.fast(text, k) >= 0) return undefined;
    return this.layout(text, k, undefined).rtl ? 'rtl' : 'ltr';
  }

  /**
   * Greedy line breaking. Simple paragraphs break at spaces (a word longer than the line breaks by
   * character), exactly as before. Others also break between CJK characters (kinsoku applied), never
   * inside a grapheme cluster (a conjunct, a letter and its marks), and remember their direction.
   * @param {string} text @param {string} key @param {number} size @param {number} maxWidth
   * @returns {{text: string, width: number, dir?: 'ltr'|'rtl'}[]}
   */
  wrap(text, key, size, maxWidth) {
    const out = [];
    const k = this.usable(key);
    const sp = this.width(' ', k, size);
    const str = String(text);
    for (const para of str.includes('\n') ? str.split(/\r?\n/) : [str]) {
      const dir = this.direction(para, k);
      if (dir) { this.wrapComplex(para, k, size, maxWidth, dir, sp, out); continue; }
      if (!para.includes(' ')) { // one word (most cells): what the loop below does for it, without splitting
        const ww = this.width(para, k, size);
        if (ww <= maxWidth || maxWidth <= 0) { out.push({ text: para, width: ww, end: true }); continue; }
      }
      const words = para.split(/ +/);
      let line = '', lw = 0;
      const push = () => { out.push({ text: line, width: lw }); line = ''; lw = 0; };
      for (let wi = 0; wi < words.length; wi++) {
        const w = words[wi];
        if (w === '' && wi > 0) continue;
        const ww = this.width(w, k, size);
        if (line === '') {
          if (ww <= maxWidth || maxWidth <= 0) { line = w; lw = ww; continue; }
        } else if (lw + sp + ww <= maxWidth) { line += ' ' + w; lw += sp + ww; continue; }
        else {
          push();
          if (ww <= maxWidth) { line = w; lw = ww; continue; }
        }
        // break a long word by characters
        for (const ch of w) {
          const cw = this.width(ch, k, size);
          if (lw + cw > maxWidth && line !== '') push();
          line += ch; lw += cw;
        }
      }
      push();
      out[out.length - 1].end = true; // the last line of a paragraph: justify leaves it ragged
    }
    return out;
  }

  /** @param {string} para @param {string} key @param {number} size @param {number} maxWidth @param {'ltr'|'rtl'} dir @param {number} sp @param {any[]} out */
  wrapComplex(para, key, size, maxWidth, dir, sp, out) {
    // tokens: words between spaces (spaces collapse, as on the fast path), single CJK characters, and the
    // dictionary words of Thai, Lao, Khmer and Myanmar
    /** @type {{ text: string, space: boolean }[]} */
    const tokens = [];
    const sa = SA.test(para) ? saBreaks(para) : null;
    let cur = '', space = false, prev = '', at = 0;
    for (const ch of para) {
      const i = at;
      at += ch.length;
      if (ch === ' ') { if (cur) { tokens.push({ text: cur, space }); cur = ''; } space = tokens.length > 0; prev = ''; continue; }
      const cp = /** @type {number} */ (ch.codePointAt(0));
      const pcp = prev ? /** @type {number} */ (prev.codePointAt(0)) : 0;
      if (cur && (sa?.has(i) || (cjk(cp) || cjk(pcp)) && !NO_START.has(ch) && !NO_END.has(prev) && !STICKY.test(ch))) { tokens.push({ text: cur, space }); cur = ''; space = false; }
      cur += ch; prev = ch;
    }
    if (cur) tokens.push({ text: cur, space });
    let line = '', lw = 0;
    const push = () => { out.push({ text: line, width: this.width(line, key, size, dir), dir }); line = ''; lw = 0; };
    for (const t of tokens) {
      const tw = this.width(t.text, key, size, dir);
      const gap = line && t.space ? sp : 0;
      if (line === '' ? tw <= maxWidth || maxWidth <= 0 : lw + gap + tw <= maxWidth) {
        line += (line && t.space ? ' ' : '') + t.text; lw += gap + tw; continue;
      }
      if (line) push();
      if (tw <= maxWidth) { line = t.text; lw = tw; continue; }
      for (const g of graphemes(t.text)) {
        const gw = this.width(g, key, size, dir);
        if (lw + gw > maxWidth && line !== '') push();
        line += g; lw += gw;
      }
    }
    push();
  }

  /** Cut a line so it fits, then add "…". */
  ellipsize(text, key, size, maxWidth, dir) {
    const ell = '…';
    if (this.width(text, key, size, dir) <= maxWidth) return text;
    const ew = this.width(ell, key, size);
    if (this.direction(text, key)) {
      const gs = graphemes(text);
      while (gs.length && this.width(gs.join(''), key, size, dir) + ew > maxWidth) gs.pop();
      return gs.join('').trimEnd() + ell;
    }
    let s = text;
    while (s.length && this.width(s, key, size) + ew > maxWidth) s = s.slice(0, -1);
    return s.trimEnd() + ell;
  }

  /** Does this font have a glyph for the character? */
  has(key, cp) {
    let m = this.cover.get(key);
    if (!m) { m = new Map(); this.cover.set(key, m); }
    let h = m.get(cp);
    if (h === undefined) { h = !!this.store.get(key).hasGlyphForCodePoint(cp); m.set(cp, h); }
    return h;
  }

  /** The font for one character: the chosen one, else the bundled fallback for its script, else the one before. */
  pick(cp, key, prev) {
    if (cp < 0x20 || this.has(key, cp)) return key;
    const fb = fallbackKey(cp, key);
    if (fb && !this.store.failed.has(fb)) {
      if (!this.store.has(fb)) { this.missing.add(fb); return key; }
      if (this.has(fb, cp)) return fb;
    }
    if (prev && prev !== key && this.has(prev, cp)) return prev;
    if (!this.missing.size) this.noGlyph.add(String.fromCodePoint(cp));
    return key;
  }

  /**
   * Bidi levels, a font per character, runs (one font, level, script, and space or not), shaping,
   * then visual order. Cached at size 1.
   * @param {string} text @param {string} key a loaded key @param {'ltr'|'rtl'|undefined} dir
   * @returns {{ w: number, rtl: boolean, runs: Run[] }}
   */
  layout(text, key, dir) {
    const ck = `${key}\u0001${dir || ''}\u0001${text}`;
    const hit = this.cache.get(ck);
    if (hit) return hit;
    let levels = null, rtl = dir === 'rtl';
    if (dir === 'rtl' || RTL_OR_CONTROLS.test(text)) {
      const e = bidi.getEmbeddingLevels(text, dir);
      levels = e.levels;
      rtl = ((e.paragraphs[0]?.level ?? 0) & 1) === 1;
    }
    /** @type {{ start: number, end: number, font: string, level: number, script: string, ws: boolean }[]} */
    const segs = [];
    let cur = null, prevFont = '';
    for (let i = 0; i < text.length;) {
      const cp = /** @type {number} */ (text.codePointAt(i));
      const n = cp > 0xffff ? 2 : 1;
      const ch = text.slice(i, i + n);
      const font = STICKY.test(ch) && prevFont ? prevFont : this.pick(cp, key, prevFont);
      const level = levels ? levels[i] : 0;
      const ws = SPACE.test(ch);
      const script = scriptOf(cp);
      if (!cur || font !== cur.font || level !== cur.level || ws !== cur.ws || (script !== 'Common' && cur.script !== 'Common' && script !== cur.script)) {
        cur = { start: i, end: i + n, font, level, script, ws };
        segs.push(cur);
      } else {
        cur.end = i + n;
        if (cur.script === 'Common') cur.script = script;
      }
      prevFont = font;
      i += n;
    }
    const runs = segs.map(s => this.shapeRun(text.slice(s.start, s.end), s.font, (s.level & 1) === 1, s.script));
    // visual order (UBA L2) on whole runs: each run has one level
    const order = runs.map((r, i) => ({ r, level: segs[i].level }));
    let max = 0, minOdd = Infinity;
    for (const o of order) { max = Math.max(max, o.level); if (o.level & 1) minOdd = Math.min(minOdd, o.level); }
    for (let l = max; l >= minOdd; l--) {
      for (let i = 0; i < order.length;) {
        if (order[i].level < l) { i++; continue; }
        let j = i;
        while (j < order.length && order[j].level >= l) j++;
        const rev = order.slice(i, j).reverse();
        order.splice(i, j - i, ...rev);
        i = j;
      }
    }
    let x = 0;
    for (const o of order) { o.r.x = x; x += o.r.w; }
    const out = { w: x, rtl, runs: order.map(o => o.r) };
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(ck, out);
    return out;
  }

  /** One run at size 1: HarfBuzz for complex scripts and right-to-left text, else character-map glyphs. @returns {Run} */
  shapeRun(text, key, rtl, script) {
    const complex = !SIMPLE.has(script);
    const store = this.store;
    /** @type {number[]} */
    const glyphs = [];
    let pen = 0;
    if ((complex || rtl) && store.shaper) {
      const hf = store.hbFont(key);
      const g = store.shaper.shape(hf, text, rtl, !complex);
      for (let i = 0; i < g.length; i += 5) {
        glyphs.push(g[i], (pen + g[i + 2]) / hf.upem, g[i + 3] / hf.upem, g[i + 4]);
        pen += g[i + 1];
      }
      return { font: key, x: 0, w: pen / hf.upem, text, ...(rtl ? { rtl } : {}), ...(complex ? { shaped: true } : {}), glyphs };
    }
    if ((complex || rtl) && !store.failed.has(SHAPER)) this.missing.add(SHAPER);
    const f = store.get(key);
    const list = [];
    for (let i = 0; i < text.length;) {
      const cp = /** @type {number} */ (text.codePointAt(i));
      const g = f.glyphForCodePoint(cp);
      list.push([g.id, g.advanceWidth || 0, i]);
      i += cp > 0xffff ? 2 : 1;
    }
    if (rtl) list.reverse();
    for (const [id, a, c] of list) { glyphs.push(id, pen / f.unitsPerEm, 0, c); pen += a; }
    return { font: key, x: 0, w: pen / f.unitsPerEm, text, ...(rtl ? { rtl } : {}), glyphs };
  }
}

/**
 * Last step of a layout: text items whose font did not load switch to the font they were measured in, and
 * lines that need it get their runs. Mutates the items (they are fresh objects from the layout).
 * @param {any[]} items @param {TextMeasurer} m
 */
export function finishText(items, m) {
  for (const it of items) {
    if (it.t === 'field') { finishText(it.draw, m); continue; }
    if (it.t !== 'text') continue;
    it.font = m.usable(it.font);
    for (const l of it.lines) {
      const r = m.runs(l.text, it.font, it.size, l.dir);
      if (r) l.runs = r;
    }
  }
}
