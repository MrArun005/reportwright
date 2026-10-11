// #2 perf: a font's subset (and its deflated stream) is cached by subsetter + font bytes + exact glyph set; a hit
// writes the same bytes as a fresh subset, and a different glyph set subsets again.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSubsetter } from '../../src/exporters/subset.js';
import { createPdfStream, subsetCacheSize } from '../../src/exporters/pdfstream.js';
import { fontStore } from '../helpers.js';

const root = path.join(import.meta.dirname, '../..');
const real = createSubsetter(() => fs.promises.readFile(path.join(root, 'public/harfbuzz-subset.wasm')));
const counted = () => { const f = async (...a) => { f.calls++; return real(...a); }; f.calls = 0; return f; };
const pdf = async (subset, text) => {
  await fontStore.load(['Inter-Regular']);
  const parts = [];
  const w = createPdfStream({ write: async (u8) => { parts.push(Buffer.from(u8)); } }, { fontStore, fonts: ['Inter-Regular'], subset });
  await w.addPage({ width: 300, height: 200, content: `BT /${w.fontName('Inter-Regular')} 12 Tf 20 150 Td <${w.encode('Inter-Regular', text)}> Tj ET` });
  await w.finish();
  return Buffer.concat(parts);
};
// the file /ID and dates differ per write (time-based), cached or not
const norm = (b) => b.toString('latin1').replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '').replace(/\/(Creation|Mod)Date \([^)]*\)/g, '');
describe('subset cache', () => {
  it('a re-render hits and writes identical bytes; another glyph set misses', async () => {
    const a = counted(), b = counted();
    const cold = await pdf(a, 'Hello');
    const warm = await pdf(a, 'Hello');
    expect(a.calls).toBe(1);
    expect(norm(warm)).toBe(norm(cold));
    expect(norm(await pdf(b, 'Hello'))).toBe(norm(cold)); // a fresh subsetter: uncached, same bytes
    await pdf(a, 'World');
    expect(a.calls).toBe(2);
    expect(subsetCacheSize(a, fontStore.bytes.get('Inter-Regular'))).toBe(2);
  });
});
