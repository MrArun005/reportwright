// 1.0.1 (an early tester's report on 1.0.0): a misconfigured subsetter throws instead of silently embedding full fonts,
// HTML export subsets by default, and "C" with no locale is en-US dollars (as the designer shows).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSubsetter } from '../../src/exporters/subset.js';
import { exportHtml } from '../../src/exporters/html.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { render } from '../../src/engine/index.js';
import { exportHtml as engineExportHtml } from '../../packages/engine/entry.js';
import { fontStore, report } from '../helpers.js';

const WASM = path.join(import.meta.dirname, '..', '..', 'public', 'harfbuzz-subset.wasm');
const good = createSubsetter(() => fs.promises.readFile(WASM));
const def = (extra = {}) =>
  report(
    [
      {
        type: 'table',
        name: 'T',
        dataSet: 'Rows',
        x: 0,
        y: 0,
        w: 300,
        h: 40,
        columns: [{ width: 200 }, { width: 100 }],
        detail: [
          { height: 16, cells: [{ value: '=Fields.item' }, { value: '=Fields.amount', style: { format: 'C2' } }] },
        ],
      },
    ],
    {
      data: {
        rows: [
          { item: 'Hosting', amount: 1234.5 },
          { item: 'Support', amount: 80 },
          { item: 'Training', amount: 342.25 },
        ],
      },
      ...extra,
    },
  );
const text = (m) =>
  m.pages
    .flatMap((p) => p.items)
    .filter((i) => i.t === 'text')
    .flatMap((i) => i.lines.map((l) => l.text));

describe('1.0.1: font subsetter', () => {
  it('createSubsetter() without its wasm loader throws a clear TypeError', () => {
    // @ts-expect-error the loader is required
    expect(() => createSubsetter()).toThrow(/createSubsetter\(loadWasm\): loadWasm must be a function/);
  });
  it('a subsetter whose wasm does not load makes HTML and PDF export throw, never silently embed full fonts', async () => {
    const m = await render(def(), { fontStore, exportData: true });
    const broken = createSubsetter(async () => {
      throw new Error('ENOENT');
    });
    await expect(exportHtml(m, { fonts: fontStore, subset: broken })).rejects.toThrow(
      /harfbuzz-subset\.wasm did not load \(ENOENT\)/,
    );
    await expect(exportPdf(m, fontStore, { subset: broken })).rejects.toThrow(/did not load/);
    const notWasm = createSubsetter(async () => new TextEncoder().encode('<html>404</html>'));
    await expect(exportHtml(m, { fonts: fontStore, subset: notWasm })).rejects.toThrow(/not WebAssembly/);
  });
  it("lenient (the engine's default and the viewer's): a missing wasm embeds full fonts", async () => {
    const m = await render(def(), { fontStore, exportData: true });
    const lenient = createSubsetter(
      async () => {
        throw new Error('ENOENT');
      },
      { lenient: true },
    );
    const full = await exportHtml(m, { fonts: fontStore });
    expect((await exportHtml(m, { fonts: fontStore, subset: lenient })).length).toBe(full.length);
  });
  it('a working subsetter makes a 3-row HTML file a small fraction of the full-font one; the engine subsets by default', async () => {
    const m = await render(def(), { fontStore, exportData: true });
    const full = await exportHtml(m, { fonts: fontStore });
    const small = await exportHtml(m, { fonts: fontStore, subset: good });
    expect(small.length * 10).toBeLessThan(full.length);
    expect((await engineExportHtml(m, { fonts: fontStore, subset: false })).length).toBe(full.length);
    expect((await engineExportHtml(m, { fonts: fontStore, subset: good })).length).toBe(small.length);
  }, 30000);
});

describe('1.0.1: currency with no locale', () => {
  it('"C2" with neither locale nor currency is en-US dollars; a report\'s locale and currency still win', async () => {
    expect(text(await render(def(), { fontStore }))).toContain('$1,234.50');
    expect(text(await render(def({ def: { currency: 'EUR' } }), { fontStore }))).toContain('€1,234.50');
    expect(text(await render(def({ def: { locale: 'en-IN' } }), { fontStore }))).toContain('₹1,234.50');
  });
});
