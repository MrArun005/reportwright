// R12: a cut or damaged font subset falls back to the full font, with a warning, on every path.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSubsetter } from '../../src/exporters/subset.js';
import { createPdfStream } from '../../src/exporters/pdfstream.js';
import { subsetProblem } from '../../src/engine/text/sfnt.js';
import { exportPdf, render, blankReport } from '../../packages/engine/entry.js';
import { fontStore } from '../helpers.js';

const root = path.join(import.meta.dirname, '../..');
const realSubset = createSubsetter(() => fs.promises.readFile(path.join(root, 'public/harfbuzz-subset.wasm')));
const tableOf = (/** @type {Uint8Array} */ b, /** @type {string} */ tag) => {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < dv.getUint16(4); i++) if (String.fromCharCode(...b.subarray(12 + 16 * i, 16 + 16 * i)) === tag) return { offset: dv.getUint32(12 + 16 * i + 8), length: dv.getUint32(12 + 16 * i + 12) };
  throw new Error(tag);
};
/** the subset's bytes cut inside glyf (the directory still says the full length) */
const cutInGlyf = async (/** @type {any[]} */ ...a) => { const s = await realSubset(...a), g = tableOf(s, 'glyf'); return s.slice(0, g.offset + (g.length >> 1)); };
const cutShort = async (/** @type {any[]} */ ...a) => (await realSubset(...a)).slice(0, 40);
const glyfZero = async (/** @type {any[]} */ ...a) => {
  const s = new Uint8Array(await realSubset(...a)), dv = new DataView(s.buffer);
  for (let i = 0; i < dv.getUint16(4); i++) if (String.fromCharCode(...s.subarray(12 + 16 * i, 16 + 16 * i)) === 'glyf') dv.setUint32(12 + 16 * i + 12, 0);
  return s;
};

describe('R12: subsetProblem', () => {
  it('passes a good TrueType subset and names a cut or damaged one', async () => {
    await fontStore.load(['Inter-Regular']);
    const full = fontStore.bytes.get('Inter-Regular'), cps = [72, 101, 108, 111];
    expect(subsetProblem(await realSubset(full, cps))).toBe('');
    expect(subsetProblem(full)).toBe('');
    expect(subsetProblem(await cutInGlyf(full, cps))).toMatch(/glyf table runs past the end/);
    expect(subsetProblem(await cutShort(full, cps))).toMatch(/table directory|runs past/);
    expect(subsetProblem(await glyfZero(full, cps))).toMatch(/outside glyf/);
    expect(subsetProblem(new Uint8Array(3))).toBe('it could not be read');
  });
  it('checks a CFF font: the table in bounds and its header and INDEXes readable', () => {
    const otf = new Uint8Array(fs.readFileSync(path.join(root, 'tests/fixtures/fonts/NotoSansSC-Subset.otf')));
    expect(subsetProblem(otf)).toBe('');
    const c = tableOf(otf, 'CFF ');
    expect(subsetProblem(otf.slice(0, c.offset + 10))).toMatch(/CFF table runs past the end/);
    const bad = otf.slice(); bad[c.offset] = 9;
    expect(subsetProblem(bad)).toMatch(/CFF header/);
    const idx = otf.slice(); idx[c.offset + idx[c.offset + 2] + 2] = 0; // the Name INDEX's offSize 0
    expect(subsetProblem(idx)).toMatch(/CFF INDEX/);
  });
});

const streamPdf = async (/** @type {any} */ subset) => {
  await fontStore.load(['Inter-Regular']);
  const parts = [], warnings = [];
  const w = createPdfStream({ write: async (u8) => { parts.push(Buffer.from(u8)); } }, { fontStore, fonts: ['Inter-Regular'], subset, onWarning: (m) => warnings.push(m) });
  await w.addPage({ width: 300, height: 200, content: `BT /${w.fontName('Inter-Regular')} 12 Tf 20 150 Td <${w.encode('Inter-Regular', 'Hello')}> Tj ET` });
  await w.finish();
  return { pdf: Buffer.concat(parts).toString('latin1'), warnings };
};

describe('R12: the streamed writer', () => {
  it.each([['cut inside glyf', cutInGlyf], ['cut short', cutShort], ['glyf length 0', glyfZero]])('a subset %s embeds the full font, with a warning', async (_, bad) => {
    const good = await streamPdf(realSubset);
    expect(good.warnings).toEqual([]);
    const r = await streamPdf(bad);
    expect(r.pdf.length).toBeGreaterThan(good.pdf.length + 50000); // the whole font
    expect(r.warnings.join()).toMatch(/Inter-Regular is embedded whole/);
  });
});

describe('R12: exportPdf', () => {
  const run = async (/** @type {any} */ subset, /** @type {any} */ pdfWriter) => {
    await fontStore.load(['Inter-Regular']);
    const warnings = [], model = await render(blankReport(), { fontStore });
    const pdf = await exportPdf(model, { fonts: fontStore, subset, pdfWriter, onWarning: (m) => warnings.push(m) });
    return { size: pdf.length, warnings };
  };
  it.each([['pdf-lib (legacy)', 'legacy'], ['the paged writer', undefined]])('%s: a cut subset embeds the full font, with a warning', async (_, writer) => {
    const good = await run(realSubset, writer);
    expect(good.warnings.join()).not.toMatch(/embedded whole/);
    for (const bad of [cutInGlyf, cutShort, glyfZero]) {
      const r = await run(bad, writer);
      expect(r.warnings.join()).toMatch(/embedded whole: its subset could not be used/);
      expect(r.size).toBeGreaterThan(good.size + 50000);
    }
  });
});
