// B10 A1.9: Word and Excel written to a sink as the rows come (exportDocxStream / exportXlsxStream), mirroring
// exportPdfStream: the same file as the model path, a sink's back-pressure, timeoutMs and signal, and the whole-model
// path (said in why) for a report that cannot stream. Memory: scripts/mem-office.mjs (flat from 20k to 50k rows).
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { unzipSync, strFromU8 } from 'fflate';
import { render } from '../../src/engine/index.js';
import { exportDocx } from '../../src/exporters/docx.js';
import { exportXlsx } from '../../src/exporters/xlsx.js';
import { exportDocxStream, exportXlsxStream } from '../../src/exporters/officestream.js';
import { fontStore } from '../helpers.js';

const now = new Date('2026-01-02T03:04:05Z');
const def = (n = 300, extra = {}) => ({
  $schema: 'pagewright/report@1', name: 'Ledger', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'json', data: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Name ${i + 1} & <co>`, amt: (i % 7) * 1.5 })) }],
  dataSets: [{ name: 'D', source: 's', fields: [{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }, { name: 'amt', type: 'number' }] }],
  sections: {
    body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 300, h: 40, columns: [{ width: 60 }, { width: 160 }, { width: 80 }],
      header: [{ height: 14, cells: [{ value: 'Id' }, { value: 'Name' }, { value: 'Amount' }] }],
      detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }, { value: '=Fields.amt', style: { format: 'N2' } }] }],
      footer: [{ height: 14, cells: [{ value: 'Total' }, null, { value: '=Sum(Fields.amt)', style: { format: 'N2' } }] }] }, ...(extra.items || [])] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 300, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  },
});
/** a sink that keeps the chunks (each write awaited) */
const memSink = () => { const s = { chunks: /** @type {Uint8Array[]} */ ([]), write: async (u8) => { s.chunks.push(u8); } }; return s; };
const bytesOf = (s) => { const out = new Uint8Array(s.chunks.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of s.chunks) { out.set(c, at); at += c.length; } return out; };
const stalled = () => new Writable({ highWaterMark: 1024, write() { /* never calls back */ } });

describe('B10 A1.9 exportDocxStream', () => {
  it('streams a table report: the same document.xml as exportDocx of the rendered model, in many writes', async () => {
    const sink = memSink();
    const r = await exportDocxStream(def(), { fontStore, now }, sink);
    expect(r.streamed).toBe(true);
    expect(r.pages).toBeGreaterThan(4);
    expect(sink.chunks.length).toBeGreaterThan(3);
    const files = unzipSync(bytesOf(sink));
    const model = await render(def(), { fontStore, now, exportData: true });
    const whole = unzipSync(await exportDocx(model, { fontStore }));
    expect(strFromU8(files['word/document.xml'])).toBe(strFromU8(whole['word/document.xml']));
    expect(Object.keys(files).sort()).toEqual(Object.keys(whole).sort());
    expect(strFromU8(files['word/document.xml'])).toContain('Name 300 &amp; &lt;co&gt;');
  });

  it('a report that cannot stream is rendered whole and written once; why says so', async () => {
    const sink = memSink();
    const chart = { type: 'chart', name: 'C', x: 0, y: 200, w: 200, h: 100, dataSet: 'D', chartType: 'bar', category: '=Fields.name', series: [{ value: '=Fields.amt' }] };
    const r = await exportDocxStream(def(20, { items: [chart] }), { fontStore, now, figures: false }, sink);
    expect(r.streamed).toBe(false);
    expect(r.why).toBeTruthy();
    expect(r.warnings[0]).toMatch(/not streamed/);
    expect(strFromU8(unzipSync(bytesOf(sink))['word/document.xml'])).toContain('Name 20 &amp;');
  });

  it('timeoutMs covers a sink that stops reading (504, ETIMEDOUT); signal aborts with its reason', async () => {
    const t = Date.now();
    const e = await exportDocxStream(def(3000), { fontStore, now, timeoutMs: 300 }, stalled()).catch(x => x);
    expect(e.code).toBe('ETIMEDOUT');
    expect(e.status).toBe(504);
    expect(Date.now() - t).toBeLessThan(5000);
    const ac = new AbortController();
    const p = exportDocxStream(def(3000), { fontStore, now, signal: ac.signal }, stalled()).catch(x => x);
    setTimeout(() => ac.abort(), 50);
    expect((await p).name).toBe('AbortError');
    expect((await exportDocxStream(def(), { fontStore, signal: AbortSignal.abort() }, memSink()).catch(x => x)).name).toBe('AbortError');
  });
});

describe('B10 A1.9 exportXlsxStream', () => {
  it('streams a table report: the same sheet as exportXlsx of the rendered model', async () => {
    const sink = memSink();
    const r = await exportXlsxStream(def(), { fontStore, now }, sink);
    expect(r.streamed).toBe(true);
    const files = unzipSync(bytesOf(sink));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('Name 300 &amp; &lt;co&gt;');
    expect(sheet).toMatch(/<f>SUBTOTAL\(9,C2:C301\)<\/f>/);
    const whole = unzipSync(await exportXlsx(await render(def(), { fontStore, now, exportData: true }), { fontStore }));
    expect(sheet).toBe(strFromU8(whole['xl/worksheets/sheet1.xml']));
  });

  it('a report that cannot stream is exported from the model; signal and timeoutMs as for Word', async () => {
    const sink = memSink();
    const chart = { type: 'chart', name: 'C', x: 0, y: 200, w: 200, h: 100, dataSet: 'D', chartType: 'bar', category: '=Fields.name', series: [{ value: '=Fields.amt' }] };
    const r = await exportXlsxStream(def(20, { items: [chart] }), { fontStore, now }, sink);
    expect(r.streamed).toBe(false);
    expect(strFromU8(unzipSync(bytesOf(sink))['xl/worksheets/sheet1.xml'])).toContain('Name 20 &amp;');
    const e = await exportXlsxStream(def(20000), { fontStore, now, timeoutMs: 300 }, stalled()).catch(x => x);
    expect(e.code).toBe('ETIMEDOUT');
    expect((await exportXlsxStream(def(), { fontStore, signal: AbortSignal.abort() }, memSink()).catch(x => x)).name).toBe('AbortError');
  });
});

describe('B10 A1.9 the engine package exports both', () => {
  it('exportDocxStream / exportXlsxStream from @reportwright/engine take { fonts } and stream', async () => {
    const pkg = await import('../../packages/engine/entry.js');
    for (const [fn, part] of [[pkg.exportDocxStream, 'word/document.xml'], [pkg.exportXlsxStream, 'xl/worksheets/sheet1.xml']]) {
      const sink = memSink();
      const r = await fn(def(50), { fonts: fontStore, now }, sink);
      expect(r.streamed).toBe(true);
      expect(strFromU8(unzipSync(bytesOf(sink))[part])).toContain('Name 50 &amp;');
    }
  });
});
