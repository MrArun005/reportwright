// N40: render() and exportPdf() need no FontStore, and need not share one: each defaults to the store over
// @reportwright/fonts, and exportPdf loads the fonts the model uses into whatever store it gets. (The repo has no
// installed @reportwright/fonts, so "none" for Inter is checked in packages.test.js against the packed packages.)
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import zlib from 'node:zlib';
import { render, exportPdf, exportDocx, exportPptx, exportXlsx, defaultFontStore, blankReport, FontStore } from '../../packages/engine/entry.js';

const dir = path.join(import.meta.dirname, '../../packages/fonts/public/fonts');
const store = () => defaultFontStore({ fontsUrl: dir });
const report = (fontFamily) => {
  const def = blankReport();
  def.styles.base.fontFamily = fontFamily;
  def.sections.body.items = [{ id: 'b1', type: 'textbox', x: 10, y: 10, w: 300, h: 20, value: 'Invoice 42' }];
  return def;
};
// the PDF with its streams inflated (the font dictionaries sit in a compressed object stream)
const text = (pdf) => {
  const s = Buffer.from(pdf).toString('latin1');
  return s + [...s.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map(m => { try { return zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return ''; } }).join('');
};

describe('N40: fonts are optional on render and export', () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])('Helvetica needs no store (render store %s, export store %s)', async (r, e) => {
    const model = await render(report('Helvetica'), r ? { fontStore: store() } : {});
    const pdf = await exportPdf(model, e ? { fonts: store() } : {});
    expect(text(pdf)).toMatch(/\/BaseFont\s*\/Helvetica/);
  });
  it('Inter: render and export with different stores (exportPdf loads what the model uses)', async () => {
    const model = await render(report('Inter'), { fontStore: store() });
    expect(text(await exportPdf(model, { fonts: store() }))).toMatch(/\/BaseFont\s*\/([A-Z]{6}\+)?Inter/);
  }, 30000);
  it('the Office exports take a store that render did not fill', async () => {
    const model = await render(report('Inter'), { fontStore: store(), exportData: true });
    for (const f of [exportDocx, exportPptx, exportXlsx]) expect((await f(model, { fonts: store() }))[0]).toBe(0x50);
  }, 30000);
  it('without @reportwright/fonts an Inter render says what to do, not "this.loader is not a function"', async () => {
    await expect(render(report('Inter'))).rejects.toThrow(/Install @reportwright\/fonts, or pass \{ fontStore \}/);
    await expect(new FontStore(/** @type {any} */ (undefined)).load(['Inter-Regular'])).rejects.toThrow(/Install @reportwright\/fonts, or pass \{ fontStore \}/);
  });
});
