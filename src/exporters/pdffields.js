// @ts-check
/**
 * Form field appearances for the paged writer (@reportwright/pdf), drawn exactly as exportPdf's pdf-lib path draws
 * them: pdf-lib 1.17.1's default appearance providers (api/form/appearances.js, api/operations.js drawTextField,
 * drawCheckBox, drawCheckMark, api/text/layout.js; MIT, Copyright (c) 2019 Andrew Dillon), with the field look pdf.js
 * gives them (a 0.75 pt #9ca3af-ish border, white fill, 1 pt padding, the report font at the item's size). Text that
 * needs shaping gets the engine's own glyphs (as pdf.js does). The operators are the same, number for number, so the
 * pages are pixel-identical; the fonts are named by the shared Resources instead of a resource of their own.
 */
import { pdfNum } from './svgpath.js';
import { Content, drawRun, glyphText, cleanText, col, BLACK, n2 } from './pdfpaint.js';

const op = (/** @type {string} */ name, /** @type {number[]} */ args) => (args.length ? args.map(pdfNum).join(' ') + ' ' : '') + name;
/** pdf.js's field look: rgb(0.61, 0.64, 0.69) border 0.75 wide, white background */
const BORDER = [0.61, 0.64, 0.69], BG = [1, 1, 1], BW = 0.75;
const rg = (/** @type {number[]} */ c, /** @type {string} */ name) => op(name, c);
/** pdf-lib's drawRectangle (no rotation or skew) */
const rect = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {number[]|null} */ fill) => [
  'q', fill && rg(fill, 'rg'), rg(BORDER, 'RG'), op('w', [BW]), '[] 0 d', op('cm', [1, 0, 0, 1, x, y]), '1 0 0 1 0 0 cm', '1 0 0 1 0 0 cm',
  '0 0 m', op('l', [0, h]), op('l', [w, h]), op('l', [w, 0]), 'h', fill ? 'B' : 'S', 'Q',
].filter(Boolean);
/** rotateInPlace for rotation 0 */
const ROT0 = ['1 0 0 1 0 0 cm', '1 0 0 1 0 0 cm'];

/**
 * A check box's on and off appearances (pdf-lib's defaultCheckBoxAppearanceProvider, normal state).
 * @param {number} width @param {number} height
 */
export function checkboxAppearance(width, height) {
  const x = BW / 2, y = BW / 2, w = width - BW, h = height - BW;
  const outline = rect(x, y, w, h, BG);
  // drawCheckMark: three points of a unit check mark, scaled by half the smaller side
  const size = Math.min(w, h) / 2;
  const p2x = -1 + 0.75, p2y = -1 + 0.51, p3y = 1 - 0.525, p3x = 1 - 0.31, p1x = -1 + 0.325;
  const p1y = -((p1x - p2x) * (p3x - p2x)) / (p3y - p2y) + p2y;
  const mark = ['q', rg([0, 0, 0], 'RG'), op('w', [1.5]), op('cm', [1, 0, 0, 1, w / 2, h / 2]), op('m', [p1x * size, p1y * size]), op('l', [p2x * size, p2y * size]), op('l', [p3x * size, p3y * size]), 'S', 'Q'];
  return { on: [...ROT0, 'q', ...outline, ...mark, 'Q'].join('\n') + '\n', off: [...ROT0, ...outline].join('\n') + '\n' };
}

/**
 * A text field's or a drop-down's appearance and /DA (pdf-lib's defaultTextFieldAppearanceProvider and
 * defaultDropdownAppearanceProvider, left-aligned, at the given size).
 * @param {string} text @param {boolean} multiline @param {number} width @param {number} height @param {number} size
 * @param {any} font fontkit font @param {string} fname its resource name @param {(text: string) => string} encode the
 *   text as a PDF string ("<…>" or "(…)") of the font's glyphs
 */
export function textAppearance(text, multiline, width, height, size, font, fname, encode) {
  const scale = 1000 / font.unitsPerEm;
  /** CustomFontEmbedder.heightOfFontAtSize, its quirk included (descent unscaled) */
  const heightAt = (/** @type {number} */ s, descender = true) => {
    let hh = (font.ascent || font.bbox.maxY) * scale - (font.descent || font.bbox.minY) * scale;
    if (!descender) hh -= Math.abs(font.descent) || 0;
    return (hh / 1000) * s;
  };
  /** pdf.js's plainEncoding widths: one glyph per character, advance widths */
  const widthOf = (/** @type {string} */ t) => { let w = 0; for (const ch of t) w += font.glyphForCodePoint(/** @type {number} */ (ch.codePointAt(0))).advanceWidth || 0; return (w * size) / font.unitsPerEm; };
  const pad = 1, b = { x: BW + pad, y: BW + pad, width: width - (BW + pad) * 2, height: height - (BW + pad) * 2 };
  /** @type {{ text: string, x: number, y: number }[]} */
  const lines = [];
  const clean = cleanText; // pdf-lib's cleanText (pdfpaint.js has the same)
  if (multiline) {
    const hh = heightAt(size), lineHeight = hh + hh * 0.2;
    let y = b.y + b.height;
    for (const src of clean(text).split(/[\n\f\r\u000B]/)) {
      /** @type {string|undefined} */
      let rest = src;
      while (rest !== undefined) {
        // splitOutLines: the longest head that ends at a space and fits
        const input = rest;
        let cut = input.length, line = input, remainder;
        for (;;) {
          if (cut <= 0) { line = input; remainder = undefined; break; }
          const head = input.substring(0, cut);
          if (widthOf(head) < b.width) { line = head; remainder = input.substring(cut) || undefined; break; }
          let k;
          for (k = head.length; k > 0; k--) if (/\s/.test(head[k])) break;
          cut = k > 0 ? k : 0;
        }
        y -= lineHeight;
        lines.push({ text: line, x: b.x, y });
        rest = remainder?.trim();
      }
    }
  } else {
    const line = clean(text).replace(/[\n\f\r\u000B]/g, ' ');
    lines.push({ text: line, x: b.x, y: b.y + (b.height / 2 - heightAt(size, false) / 2) });
  }
  const x = BW / 2, y = BW / 2, w = width - BW, h = height - BW;
  const cx = x + BW / 2 + pad, cy = y + BW / 2 + pad, cw = w - (BW / 2 + pad) * 2, ch = h - (BW / 2 + pad) * 2;
  const ops = [...ROT0, 'q', ...rect(x, y, w, h, BG),
    op('m', [cx, cy]), op('l', [cx, cy + ch]), op('l', [cx + cw, cy + ch]), op('l', [cx + cw, cy]), 'h', 'W', 'n',
    '/Tx BMC', 'q', 'BT', '0 0 0 rg', `/${fname} ${pdfNum(size)} Tf`];
  for (const l of lines) ops.push(op('Tm', [1, 0, 0, 1, l.x, l.y]), `${encode(l.text)} Tj`);
  ops.push('ET', 'Q', 'EMC', 'Q');
  return { normal: ops.join('\n') + '\n', da: `0 0 0 rg /${fname} ${pdfNum(size)} Tf` };
}

/**
 * A field whose value needs shaping (Arabic, Indic…) or a fallback font: the engine's glyphs, as pdf.js draws them
 * (its appearance replaces pdf-lib's). @param {any} it the field item @param {any} env paintEnv
 */
export function shapedAppearance(it, env) {
  const a = new Content(env.shared);
  const top = it.y + it.h; // page y (down) of the box's top: local y (up) = top - page y
  a.s += '/Tx BMC\n';
  a.paint({ rgb: '1 1 1', opacity: 1 }, { rgb: '0.61 0.64 0.69', opacity: 1 }, 0.75);
  a.s += `0.375 0.375 ${n2(it.w - 0.75)} ${n2(it.h - 0.75)} re B\n`;
  a.q();
  a.s += `1 1 ${n2(it.w - 2)} ${n2(it.h - 2)} re W n\n`;
  for (const d of it.draw) if (d.t === 'text') for (const l of d.lines) {
    const color = col(d.color) || BLACK;
    if (!l.runs) { a.text(env.pf(d.font), d.size, color, l.x - it.x, top - l.y, env.literal(d.font, cleanText(l.text))); continue; }
    for (const r of l.runs) {
      const g = env.shapedOf(r.font), spans = new WeakMap();
      glyphText(r, env.font(r.font), g, spans);
      if (r.text.trim()) drawRun(a, r, l.x - it.x + r.x, top - l.y, d.size, env.pf(r.font), color, spans.get(r), g);
    }
  }
  a.Q();
  a.s += 'EMC\n';
  return a.s;
}
