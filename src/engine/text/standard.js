// @ts-check
/**
 * The 14 standard PDF fonts (Helvetica, Times, Courier in four faces each, Symbol, ZapfDingbats): every PDF reader has
 * them, so a PDF names them and embeds nothing. Their metrics are Adobe's AFM files, as @pdf-lib/standard-fonts (pdf-lib's
 * own dependency) ships them; this wraps one in the part of fontkit's font API the engine and the PDF exporters read, so
 * layout measures with the widths the PDF's /Widths array gives. A glyph ID here is the character's code in the font's
 * encoding (WinAnsi; Symbol and ZapfDingbats have their own), one byte; 0 = not in the encoding.
 */

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
 * A standard font as a fontkit-like object (unitsPerEm 1000). Loaded on first use: the metrics are about 130 KB.
 * @param {string} key a PostScript name of STANDARD_FACES
 */
export async function standardFont(key) {
  const { Font, Encodings } = await import('@pdf-lib/standard-fonts');
  const afm = /** @type {any} */ (Font.load(/** @type {any} */ (key)));
  const enc = /** @type {any} */ (key === 'Symbol' ? Encodings.Symbol : key === 'ZapfDingbats' ? Encodings.ZapfDingbats : Encodings.WinAnsi);
  /** code → advance width; cp → code; code → cp */
  const widths = new Array(256).fill(0), codeOf = new Map(), cpOf = new Array(256).fill(0);
  for (const [cp, [code, name]] of Object.entries(enc.unicodeMappings)) {
    if (cp === '173') continue; // a soft hyphen is drawn as nothing (WinAnsi would draw it as a hyphen)
    codeOf.set(Number(cp), code);
    widths[code] = afm.CharWidths[name] ?? 250; // pdf-lib's default for a glyph the AFM lacks
    if (!cpOf[code] || Number(cp) === code) cpOf[code] = Number(cp);
  }
  /** @type {Map<number, any>} */
  const glyphs = new Map();
  const getGlyph = (/** @type {number} */ id) => {
    let g = glyphs.get(id);
    if (!g) glyphs.set(id, g = { id, advanceWidth: widths[id] || 0, codePoints: cpOf[id] ? [cpOf[id]] : [] });
    return g;
  };
  const [x0, y0, x1, y1] = afm.FontBBox;
  return {
    standard: true,
    postscriptName: key,
    familyName: afm.FamilyName,
    unitsPerEm: 1000,
    ascent: afm.Ascender ?? y1,
    descent: afm.Descender ?? y0,
    capHeight: afm.CapHeight ?? y1,
    xHeight: afm.XHeight ?? 0,
    italicAngle: Number(afm.ItalicAngle) || 0,
    underlinePosition: afm.UnderlinePosition ?? -100,
    underlineThickness: afm.UnderlineThickness ?? 50,
    bbox: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    /** WinAnsi for the text fonts (Symbol and ZapfDingbats use their own built-in encodings) */
    winAnsi: enc === Encodings.WinAnsi,
    widths,
    /** @param {number} cp */
    hasGlyphForCodePoint: (cp) => codeOf.has(cp),
    /** @param {number} cp */
    glyphForCodePoint: (cp) => getGlyph(codeOf.get(cp) || 0),
    getGlyph,
  };
}
