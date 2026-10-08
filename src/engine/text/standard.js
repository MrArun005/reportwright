// @ts-check
/**
 * The 14 standard PDF fonts (Helvetica, Times, Courier in four faces each, Symbol, ZapfDingbats): every PDF reader has
 * them, so a PDF names them and embeds nothing. Their metrics are Adobe's AFM files, generated into standard-metrics.js
 * (scripts/gen-standard-metrics.mjs, from @pdf-lib/standard-fonts); this wraps one in the part of fontkit's font API
 * the engine and the PDF exporters read, so layout measures with the widths the PDF's /Widths array gives. A glyph ID
 * here is the character's code in the font's encoding (WinAnsi; Symbol and ZapfDingbats have their own), one byte;
 * 0 = not in the encoding. */

/** [family, PostScript name, weight, style] */
export const STANDARD_FACES = [
  ['Helvetica', 'Helvetica', 400, 'normal'], ['Helvetica', 'Helvetica-Bold', 700, 'normal'],
  ['Helvetica', 'Helvetica-Oblique', 400, 'italic'], ['Helvetica', 'Helvetica-BoldOblique', 700, 'italic'],
  ['Times-Roman', 'Times-Roman', 400, 'normal'], ['Times-Roman', 'Times-Bold', 700, 'normal'],
  ['Times-Roman', 'Times-Italic', 400, 'italic'], ['Times-Roman', 'Times-BoldItalic', 700, 'italic'],
  ['Courier', 'Courier', 400, 'normal'], ['Courier', 'Courier-Bold', 700, 'normal'],
  ['Courier', 'Courier-Oblique', 400, 'italic'], ['Courier', 'Courier-BoldOblique', 700, 'italic'],
  ['Symbol', 'Symbol', 400, 'normal'], ['ZapfDingbats', 'ZapfDingbats', 400, 'normal'],
];
export const STANDARD_KEYS = new Set(STANDARD_FACES.map(f => String(f[1])));
/** @param {string} key */
export const isStandard = (key) => STANDARD_KEYS.has(key);

/**
 * A standard font as a fontkit-like object (unitsPerEm 1000). The tables (about 22 KB) load on first use.
 * @param {string} key a PostScript name of STANDARD_FACES
 */
export async function standardFont(key) {
  const { METRICS, ENCODINGS } = await import('./standard-metrics.js');
  const m = /** @type {any} */ (METRICS)[key], pairs = /** @type {number[]} */ (/** @type {any} */ (ENCODINGS)[m.encoding]);
  const widths = m.widths;
  /** cp → code; code → cp */
  const codeOf = new Map(), cpOf = new Array(256).fill(0);
  for (let i = 0; i < pairs.length; i += 2) {
    const cp = pairs[i], code = pairs[i + 1];
    codeOf.set(cp, code);
    if (!cpOf[code] || cp === code) cpOf[code] = cp;
  }
  /** @type {Map<number, any>} */
  const glyphs = new Map();
  const getGlyph = (/** @type {number} */ id) => {
    let g = glyphs.get(id);
    if (!g) glyphs.set(id, g = { id, advanceWidth: widths[id] || 0, codePoints: cpOf[id] ? [cpOf[id]] : [] });
    return g;
  };
  const [x0, y0, x1, y1] = m.bbox;
  return {
    standard: true,
    postscriptName: key,
    familyName: m.familyName,
    unitsPerEm: 1000,
    ascent: m.ascent,
    descent: m.descent,
    capHeight: m.capHeight,
    xHeight: m.xHeight,
    italicAngle: m.italicAngle,
    underlinePosition: m.underlinePosition,
    underlineThickness: m.underlineThickness,
    bbox: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    /** WinAnsi for the text fonts (Symbol and ZapfDingbats use their own built-in encodings) */
    winAnsi: m.encoding === 'WinAnsi',
    widths,
    /** @param {number} cp */
    hasGlyphForCodePoint: (cp) => codeOf.has(cp),
    /** @param {number} cp */
    glyphForCodePoint: (cp) => getGlyph(codeOf.get(cp) || 0),
    getGlyph,
  };
}
