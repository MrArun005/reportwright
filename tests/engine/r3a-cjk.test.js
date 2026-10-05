// R3-A: the optional CJK and emoji fonts (npm run fonts:cjk → public/fonts/cjk) are found by the fallback table and
// loaded only when text needs them; without them the warning says how to add them.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, FontStore } from '../../src/engine/index.js';
import { fontFile } from '../../src/engine/text/fonts.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { createSubsetter } from '../../src/exporters/subset.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const have = fs.existsSync(path.join(ROOT, 'public/fonts/cjk/NotoSansJP.ttf'));
const def = (value) => ({ $schema: 'pagewright/report@1', page: { size: 'A4' }, sections: { body: { height: 40, items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 400, h: 20, value }] } } });
const TEXT = '日本語 ひらがな カタカナ 한국어 漢字 😀🎉';

describe('CJK and emoji text', () => {
  it.skipIf(!have)('draws every character with a real glyph, loading the fonts only when used', async () => {
    const loaded = [];
    const store = new FontStore((k) => { loaded.push(k); return fs.readFileSync(path.join(ROOT, 'public/fonts', fontFile(k))); });
    const latin = await render(def('Hello'), { fontStore: store });
    expect(latin.warnings).toEqual([]);
    expect(loaded.some(k => /NotoSans(JP|KR|SC)|NotoEmoji/.test(k))).toBe(false);
    const m = await render(def(TEXT), { fontStore: store });
    expect(m.warnings).toEqual([]);
    const runs = m.pages[0].items.flatMap(i => i.lines || []).flatMap(l => l.runs);
    expect(new Set(runs.map(r => r.font))).toEqual(new Set(['NotoSansJP', 'NotoSansKR', 'NotoEmoji', 'Inter-Regular']));
    for (const r of runs) for (let i = 0; i < r.glyphs.length; i += 4) expect(r.glyphs[i]).toBeGreaterThan(0); // no .notdef
    // and the PDF embeds only the glyphs it uses: a few KB, not the 10 MB fonts
    const subset = createSubsetter(() => fs.promises.readFile(path.join(ROOT, 'public/harfbuzz-subset.wasm')));
    const pdf = await exportPdf(m, store, { subset });
    expect(pdf.length).toBeLessThan(400_000);
  });
  it('without the fonts: boxes, and the warning says how to add them', async () => {
    const store = new FontStore((k) => { if (/cjk\//.test(fontFile(k))) throw new Error('missing'); return fs.readFileSync(path.join(ROOT, 'public/fonts', fontFile(k))); });
    const m = await render(def('日本語'), { fontStore: store });
    expect(m.warnings.join(' ')).toMatch(/npm run fonts:cjk/);
  });
});
