// @ts-check
/**
 * Text measurement and line breaking with fontkit advances.
 * Renderers never wrap text: they draw the lines this module returns.
 * Kerning is off everywhere (engine, PDF and SVG), so widths match.
 */
export class TextMeasurer {
  /** @param {import('./fonts.js').FontStore} store */
  constructor(store) {
    this.store = store;
    /** @type {Map<string, Map<number, number>>} */
    this.adv = new Map();
  }

  /** Advance width in points. @param {string} text @param {string} key @param {number} size */
  width(text, key, size) {
    let m = this.adv.get(key);
    if (!m) { m = new Map(); this.adv.set(key, m); }
    const font = this.store.get(key);
    let units = 0;
    for (const ch of text) {
      const cp = /** @type {number} */ (ch.codePointAt(0));
      let a = m.get(cp);
      if (a === undefined) { a = font.glyphForCodePoint(cp).advanceWidth || 0; m.set(cp, a); }
      units += a;
    }
    return (units * size) / font.unitsPerEm;
  }

  /** @param {string} key @param {number} size */
  metrics(key, size) {
    const f = this.store.get(key);
    return { ascent: (f.ascent * size) / f.unitsPerEm, descent: (-f.descent * size) / f.unitsPerEm };
  }

  /**
   * Greedy word wrap. Words longer than the width break by character.
   * @param {string} text @param {string} key @param {number} size @param {number} maxWidth
   * @returns {{text: string, width: number}[]}
   */
  wrap(text, key, size, maxWidth) {
    const out = [];
    const sp = this.width(' ', key, size);
    for (const para of String(text).split(/\r?\n/)) {
      const words = para.split(/ +/);
      let line = '', lw = 0;
      const push = () => { out.push({ text: line, width: lw }); line = ''; lw = 0; };
      for (let wi = 0; wi < words.length; wi++) {
        const w = words[wi];
        if (w === '' && wi > 0) continue;
        const ww = this.width(w, key, size);
        if (line === '') {
          if (ww <= maxWidth || maxWidth <= 0) { line = w; lw = ww; continue; }
        } else if (lw + sp + ww <= maxWidth) { line += ' ' + w; lw += sp + ww; continue; }
        else {
          push();
          if (ww <= maxWidth) { line = w; lw = ww; continue; }
        }
        // break a long word by characters
        for (const ch of w) {
          const cw = this.width(ch, key, size);
          if (lw + cw > maxWidth && line !== '') push();
          line += ch; lw += cw;
        }
      }
      push();
    }
    return out;
  }

  /** Cut a line so it fits, then add "…". */
  ellipsize(text, key, size, maxWidth) {
    const ell = '…';
    if (this.width(text, key, size) <= maxWidth) return text;
    const ew = this.width(ell, key, size);
    let s = text;
    while (s.length && this.width(s, key, size) + ew > maxWidth) s = s.slice(0, -1);
    return s.trimEnd() + ell;
  }
}
