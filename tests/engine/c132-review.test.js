// Regression tests for the perf-startup code-review findings (M1, M2, L1, L3, L4, L2).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createSubsetter } from '../../src/exporters/subset.js';
import { createPdfStream, exportPdfStream } from '../../src/exporters/pdfstream.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { render } from '../../src/engine/index.js';
import { report } from '../helpers.js';
import { planPaged } from '../../src/engine/paged.js';
import { fontStore } from '../helpers.js';

const now = new Date('2026-01-02T03:04:05Z');
const ledger = () => ({
  $schema: 'reportwright/report@1', name: 'L', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'sql', connection: 'db', query: 'select id from t' }],
  dataSets: [{ name: 'D', source: 's', fields: [{ name: 'id', type: 'number' }] }],
  sections: {
    body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 100, h: 40, columns: [{ width: 100 }],
      header: [{ height: 14, cells: [{ value: 'Id' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.id' }] }] }] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 300, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  },
});
const counted = (rows) => {
  const c = { read: 0 };
  c.sqlRows = () => (async function* () {
    for (let i = 0; i < rows; i += 100) { c.read += 100; yield Array.from({ length: 100 }, (_, k) => ({ id: i + k + 1 })); }
  })();
  return c;
};

describe('M1: an early worker error stops the counting pass', () => {
  it('a parallel "of M" report whose first job fails rejects without reading every row', async () => {
    const c = counted(200000);
    const plan = /** @type {any} */ (await planPaged(ledger(), { fontStore, now, window: 100, sqlRows: c.sqlRows }));
    expect(plan.why).toBeUndefined();
    const run = async () => { throw new Error('worker died'); };
    const e = await (async () => { for await (const _ of plan.pages({ run, parallel: 2 })) { /* drain */ } })().catch(x => x);
    expect(e?.message).toBe('worker died');
    expect(c.read).toBeLessThan(50000);
  });
});

const realSubset = createSubsetter(() => fs.promises.readFile(path.join(import.meta.dirname, '../../public/harfbuzz-subset.wasm')));
/** a subset whose glyf table the directory says is empty: every drawn outline lies past its end */
const truncatedGlyf = async (...a) => {
  const sub = new Uint8Array(await realSubset(...a)), dv = new DataView(sub.buffer, sub.byteOffset, sub.byteLength);
  for (let i = 0, n = dv.getUint16(4); i < n; i++) if (String.fromCharCode(...sub.subarray(12 + 16 * i, 16 + 16 * i)) === 'glyf') dv.setUint32(12 + 16 * i + 12, 0);
  return sub;
};
const fontPdf = async (subset) => {
  await fontStore.load(['Inter-Regular']);
  const parts = [], w = createPdfStream({ write: async (u8) => { parts.push(Buffer.from(u8)); } }, { fontStore, fonts: ['Inter-Regular'], subset });
  await w.addPage({ width: 300, height: 200, content: `BT /${w.fontName('Inter-Regular')} 12 Tf 20 150 Td <${w.encode('Inter-Regular', 'Hello')}> Tj ET` });
  await w.finish();
  const f = path.join(os.tmpdir(), `c132-m2-${process.pid}.pdf`);
  fs.writeFileSync(f, Buffer.concat(parts));
  try { return execFileSync('pdffonts', [f]).toString(); } finally { fs.rmSync(f, { force: true }); }
};

describe('M2: the subset check reads the drawn glyphs\' outline bounds', () => {
  it.skipIf(spawnSync('pdffonts', ['-v']).status !== 0)('a subset whose glyf is truncated falls back to the full font', async () => {
    expect(await fontPdf(realSubset)).toMatch(/^[A-Z]{6}\+Inter-Regular /m); // the control: a good subset is used
    const pdf = await fontPdf(truncatedGlyf);
    expect(pdf).not.toMatch(/[A-Z]{6}\+Inter/);
    expect(pdf).toMatch(/^Inter-Regular /m);
  });
});

describe('L1: the V8 flag toggle stays out of worker threads', () => {
  it('a subsetter compiled in a worker thread never calls setFlagsFromString', async () => {
    const { Worker } = await import('node:worker_threads');
    const root = path.join(import.meta.dirname, '../..');
    const code = `
      const { parentPort } = require('node:worker_threads');
      const v8 = process.getBuiltinModule('node:v8'), fs = require('node:fs'), path = require('node:path');
      const calls = []; const real = v8.setFlagsFromString; v8.setFlagsFromString = (f) => { calls.push(f); return real(f); };
      (async () => {
        const { createSubsetter } = await import(${JSON.stringify(new URL('src/exporters/subset.js', `file://${root}/`).href)});
        const subset = createSubsetter(() => fs.promises.readFile(${JSON.stringify(path.join(root, 'public/harfbuzz-subset.wasm'))}));
        const out = await subset(fs.readFileSync(${JSON.stringify(path.join(root, 'public/fonts/Inter-Regular.ttf'))}), [72, 105]);
        parentPort.postMessage({ calls, bytes: out.length });
      })().catch((e) => parentPort.postMessage({ error: String(e) }));`;
    const w = new Worker(code, { eval: true, env: { ...process.env, PW_NO_LIFTOFF: '' } });
    const msg = await new Promise((ok, no) => { w.once('message', ok); w.once('error', no); });
    await w.terminate();
    expect(msg.error).toBeUndefined();
    expect(msg.bytes).toBeGreaterThan(0);
    expect(msg.calls).toEqual([]);
  });
});

describe('L3: the test-only knobs can only lower the built-in caps', () => {
  const long = (n) => ({
    $schema: 'reportwright/report@1', name: 'Long', page: { size: 'A4', margins: [36, 36, 36, 36] },
    dataSources: [{ name: 's', type: 'json', data: { rows: Array.from({ length: n }, (_, i) => ({ t: Array.from({ length: 300 }, (_, k) => `w${i}x${k}`).join(' ') })) } }],
    dataSets: [{ name: 'D', source: 's', path: '$.rows' }],
    sections: {
      body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 200, h: 40, columns: [{ width: 200 }],
        detail: [{ height: 14, cells: [{ value: '=Fields.t' }] }] }] },
      pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 300, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
    },
  });
  it('holdItems: Infinity holds no more than the default cap (240,000 items)', async () => {
    const held = async (holdItems) => {
      const plan = /** @type {any} */ (await planPaged(long(4200), { fontStore, now, window: 200, holdItems }));
      for await (const _ of plan.pages()) { /* drain */ }
      return plan.info.held;
    };
    expect(await held(undefined)).toBe(false); // over the default cap: not held
    expect(await held(Infinity)).toBe(false);
  }, 120000);
});

describe('L4: pdfWriter is checked on every path', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const img = report([{ type: 'image', x: 0, y: 0, w: 20, h: 20, src: PNG }]);
  it("pdfWriter: 'legcy' on an image report is the same 400 from exportPdf and exportPdfStream", async () => {
    const m = await render(img, { fontStore, now });
    const a = await exportPdf(m, fontStore, { pdfWriter: 'legcy' }).catch(e => e);
    const b = await exportPdfStream(img, { fontStore, now, pdfWriter: 'legcy' }, { write: async () => {} }).catch(e => e);
    for (const e of [a, b]) expect(e).toMatchObject({ status: 400, message: "pdfWriter is 'pdf' (the default) or 'legacy', not \"legcy\"" });
  });
});

describe('L2: the compile cache base must be under the home folder', () => {
  it('XDG_CACHE_HOME=/tmp (or any folder outside home) gives no cache', async () => {
    const { compileCacheDir } = await import('../../scripts/compile-cache-dir.mjs');
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'c132-cc-'));
    try {
      expect(compileCacheDir({ XDG_CACHE_HOME: t })).toBeUndefined();
      expect(fs.existsSync(path.join(t, 'reportwright'))).toBe(false); // nothing made there either
      expect(compileCacheDir({ XDG_CACHE_HOME: '/tmp' })).toBeUndefined();
      expect(compileCacheDir({ XDG_CACHE_HOME: path.join(os.homedir(), '..', 'x') })).toBeUndefined();
    } finally { fs.rmSync(t, { recursive: true, force: true }); }
  });
});
