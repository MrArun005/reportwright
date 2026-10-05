// R3-A: `pw render` must load the HarfBuzz shaper (key "harfbuzz" → harfbuzz.wasm through fontFile), or Arabic
// and Indic text comes out with unjoined letters and misplaced marks. Checks the glyph clusters the CLI lays out,
// not just the text (the text is the same either way).
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FontStore, render } from '../../src/engine/index.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-shape-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DEF = {
  $schema: 'pagewright/report@1', page: { size: 'A4' },
  sections: { body: { height: 100, items: [
    { type: 'textbox', x: 0, y: 0, w: 400, h: 30, value: 'क्षत्रिय' },
    { type: 'textbox', x: 0, y: 40, w: 400, h: 30, value: 'مرحبا' },
  ] } },
};
const runsOf = (model) => model.pages[0].items.flatMap(i => i.lines || []).flatMap(l => l.runs);
const clusters = (run) => run.glyphs.filter((_, i) => i % 4 === 3);
const ids = (run) => run.glyphs.filter((_, i) => i % 4 === 0);

describe('pw render shapes complex scripts', () => {
  const file = path.join(tmp, 'shape.pw.json');
  fs.writeFileSync(file, JSON.stringify(DEF));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/pw.mjs'), 'render', file, '-f', 'json', '-o', '-'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const model = JSON.parse(r.stdout);
  const [deva, arab] = runsOf(model);

  it('loads the shaper: no warning, both runs shaped', () => {
    expect(r.status).toBe(0);
    expect(model.warnings).toEqual([]);
    expect(deva.shaped).toBe(true);
    expect(arab.shaped).toBe(true);
  });
  it('Devanagari: conjuncts form and the i-matra moves before its consonant cluster', () => {
    // क्ष (0-2) is one ligature, त्रि (3-6) is the reordered matra glyph then त्र, य is 7: 4 glyphs for 8 code units
    expect(clusters(deva)).toEqual([0, 3, 3, 7]);
  });
  it('Arabic: right-to-left visual order and joined (contextual) letter forms', async () => {
    expect(arab.rtl).toBe(true);
    const cl = clusters(arab);
    expect(cl[0]).toBe(4); // visual order: the last letter first
    expect([...cl].sort((a, b) => b - a)).toEqual(cl);
    // unshaped glyphs are the isolated forms from the character map: at least the medial letters must differ
    const store = new FontStore((k) => fs.readFileSync(path.join(ROOT, 'public/fonts', k === 'harfbuzz' ? 'none' : `${k}.ttf`)));
    const plain = runsOf(await render(DEF, { fontStore: store }))[1];
    expect(plain.shaped).toBeUndefined();
    expect(ids(arab).filter(g => !ids(plain).includes(g)).length).toBeGreaterThanOrEqual(3);
  });
  it('a loader that cannot find the shaper warns instead of silently unshaping', async () => {
    const store = new FontStore((k) => fs.readFileSync(path.join(ROOT, 'public/fonts', `${k}.ttf`))); // the old README loader
    const m = await render(DEF, { fontStore: store });
    expect(m.warnings.join(' ')).toMatch(/shaper .*did not load/);
  });
});
