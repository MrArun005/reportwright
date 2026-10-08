// @ts-check
/**
 * The standard PDF fonts in a PDF (engine/text/standard.js has their metrics): a Type1 font dictionary that names the
 * font and embeds nothing, with WinAnsiEncoding (Symbol and ZapfDingbats keep their built-in encodings) and the AFM
 * widths, so every reader places the text where the engine measured it. One byte per character: the glyph ID is the code.
 *
 * PDF/A and PDF/UA forbid fonts that are not embedded: there, standard-font text is drawn in its embedded stand-in
 * (embeddedFace: Inter, JetBrains Mono for Courier) as runs whose glyphs sit at the standard font's positions, so the
 * layout (line breaks, alignment) is the one measured. No metric-compatible face ships, so the letters' widths differ.
 */
import { embeddedFace, fontCss, isStandard } from '../engine/text/fonts.js';

/** The font dictionary's entries (pdf-lib's context.obj takes them as they are: strings become names). @param {any} f a standard font */
export function standardFontEntries(f) {
  return {
    Type: 'Font', Subtype: 'Type1', BaseFont: f.postscriptName,
    ...(f.winAnsi ? { Encoding: 'WinAnsiEncoding' } : {}),
    FirstChar: 32, LastChar: 255, Widths: f.widths.slice(32, 256),
  };
}
/** The same dictionary as PDF syntax. @param {any} f */
export function standardFontDict(f) {
  const e = standardFontEntries(f);
  return `<< /Type /Font /Subtype /Type1 /BaseFont /${e.BaseFont}${e.Encoding ? ` /Encoding /${e.Encoding}` : ''} /FirstChar 32 /LastChar 255 /Widths [${e.Widths.join(' ')}] >>`;
}

const esc = (/** @type {number} */ b) => (b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + String.fromCharCode(b) : b === 0x0d ? '\\r' : String.fromCharCode(b));
/** A literal string's body: one byte per character, escaped. @param {any} f a standard font @param {string} text */
export function standardLiteral(f, text) {
  let out = '';
  for (const ch of text) out += esc(f.glyphForCodePoint(/** @type {number} */ (ch.codePointAt(0))).id);
  return out;
}

/**
 * A page whose standard-font text is redrawn in the embedded stand-ins (PDF/A, PDF/UA), at the standard font's glyph
 * positions. The page and the items it changes are copies; families gets the standard families it found.
 * @param {any} pg @param {(key: string) => any} fontOf the loaded fonts by key @param {Set<string>} families
 */
export function embeddedPage(pg, fontOf, families) {
  const line = (/** @type {any} */ l, /** @type {string} */ key, /** @type {number} */ size) => {
    const runs = l.runs || [{ font: key, x: 0, text: l.text, glyphs: null }];
    if (!runs.some((/** @type {any} */ r) => isStandard(r.font))) return l;
    return { ...l, runs: runs.map((/** @type {any} */ r) => {
      if (!isStandard(r.font)) return r;
      families.add(fontCss(r.font).family);
      const std = fontOf(r.font), sub = embeddedFace(r.font), emb = fontOf(sub);
      /** @type {number[]} */
      const glyphs = [];
      if (r.glyphs) { // a run of the layout: [code, x, y, cluster]; the cluster is the character's index in its text
        for (let i = 0; i < r.glyphs.length; i += 4) glyphs.push(emb.glyphForCodePoint(r.text.codePointAt(r.glyphs[i + 3])).id, r.glyphs[i + 1], r.glyphs[i + 2], r.glyphs[i + 3]);
        return { ...r, font: sub, glyphs };
      }
      let pen = 0;
      for (let i = 0; i < r.text.length;) {
        const cp = /** @type {number} */ (r.text.codePointAt(i));
        glyphs.push(emb.glyphForCodePoint(cp).id, pen, 0, i);
        pen += std.glyphForCodePoint(cp).advanceWidth * size / 1000;
        i += cp > 0xffff ? 2 : 1;
      }
      return { ...r, font: sub, w: pen, glyphs };
    }) };
  };
  const item = (/** @type {any} */ it) => {
    if (it.t === 'field') { const draw = it.draw.map(item); return draw.some((/** @type {any} */ d, /** @type {number} */ i) => d !== it.draw[i]) ? { ...it, draw } : it; }
    if (it.t !== 'text') return it;
    const lines = it.lines.map((/** @type {any} */ l) => line(l, it.font, it.size));
    return lines.some((/** @type {any} */ l, /** @type {number} */ i) => l !== it.lines[i]) ? { ...it, lines } : it;
  };
  const items = pg.items.map(item);
  return items.some((/** @type {any} */ x, /** @type {number} */ i) => x !== pg.items[i]) ? { ...pg, items } : pg;
}

/** The warnings for the standard families a PDF/A or PDF/UA file drew in their stand-ins (a family's name is its regular face's key). @param {Set<string>} families */
export function embeddedWarnings(families) {
  return [...families].map(f => `PDF/A and PDF/UA need embedded fonts, and "${f}" is a standard font that is not embedded: its text is drawn in `
    + `${fontCss(embeddedFace(f)).family} at ${f}'s spacing (no metric-compatible font ships, so the letters' widths differ).`);
}
