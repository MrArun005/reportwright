// sfnt.js reads a font the way fontkit does: every value the engine reads from it, for every bundled font.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { liteFont } from '../../src/engine/text/sfnt.js';

const fontkit = createRequire(import.meta.url)('@pdf-lib/fontkit');
const dir = path.join(import.meta.dirname, '../../public/fonts');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ttf'));

describe('sfnt.js against fontkit', () => {
  it.each(files)('%s', (file) => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, file)));
    const fk = fontkit.create(bytes);
    let parsed = 0;
    const lite = liteFont(bytes, () => { parsed++; return fontkit.create(bytes); });
    if (!lite) return; // fontkit's font (a variable font…)
    for (const k of ['unitsPerEm', 'ascent', 'descent', 'capHeight', 'xHeight', 'italicAngle', 'postscriptName']) expect(lite[k], k).toEqual(fk[k]);
    expect({ ...lite.bbox }).toMatchObject({ minX: fk.bbox.minX, minY: fk.bbox.minY, maxX: fk.bbox.maxX, maxY: fk.bbox.maxY });
    expect(lite.noSubsetting).toBe(!!fk['OS/2']?.fsType?.noSubsetting);
    expect(lite.fixedPitch).toBe(!!fk.post.isFixedPitch);
    expect(Object.keys(lite.directory.tables).sort()).toEqual(Object.keys(fk.directory.tables).sort());
    for (let cp = 0; cp < 0x30000; cp += cp < 0x3000 ? 1 : 7) {
      const has = fk.hasGlyphForCodePoint(cp);
      expect(lite.hasGlyphForCodePoint(cp), `U+${cp.toString(16)}`).toBe(has);
      if (has) expect(lite.glyphForCodePoint(cp).id, `U+${cp.toString(16)}`).toBe(fk.glyphForCodePoint(cp).id);
    }
    for (let id = 0; id < fk.numGlyphs; id++) {
      let want;
      try { want = fk.getGlyph(id).advanceWidth; } catch { continue; } // fontkit reads the outline header too, and the last glyph's of a font can end the file (JetBrains Mono)
      expect(lite.getGlyph(id).advanceWidth, `glyph ${id}`).toBe(want);
    }
    expect(parsed).toBe(0); // none of that needed fontkit
    expect(typeof lite.layout('Hi').glyphs.length).toBe('number'); // anything else is fontkit's
    expect(parsed).toBe(1);
  }, 60000);
});
