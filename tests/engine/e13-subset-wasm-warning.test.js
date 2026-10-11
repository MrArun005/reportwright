// E13: when harfbuzz-subset.wasm cannot load, fonts embed in full (PDFs ~50x bigger). That is said once, on the console
// and in the result's warnings, naming where the file was expected and how to configure it. (Here @reportwright/fonts
// does not resolve from the source tree, which is the missing-WASM case.)
import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, FontStore, fontFile, blankReport, exportPdf, exportPdfStream } from '../../packages/engine/entry.js';

const root = path.join(import.meta.dirname, '..', '..');
const fonts = new FontStore((k) => fs.readFileSync(path.join(root, 'public/fonts', fontFile(k))));

it('warns once, naming the expected path and the subset option', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const m1 = await render(blankReport(), { fontStore: fonts });
    await exportPdf(m1, { fonts });
    const m2 = await render(blankReport(), { fontStore: fonts });
    await exportPdf(m2, { fonts });
    const r = await exportPdfStream(blankReport(), { fonts }, { write() {} });
    const ours = warn.mock.calls.map(c => String(c[0])).filter(s => /harfbuzz-subset\.wasm/.test(s));
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatch(/@reportwright\/fonts\/public\/harfbuzz-subset\.wasm/);
    expect(ours[0]).toMatch(/createSubsetter/);
    for (const w of [m1.warnings, m2.warnings, r.warnings]) expect(w.filter(s => /harfbuzz-subset\.wasm/.test(s))).toHaveLength(1);
  } finally { warn.mockRestore(); }
}, 60000);
