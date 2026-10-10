// Streaming phase D, the server half of the streaming PDF: /api/reports/<id>/pdf and the pool stream a flowing report's
// PDF through the same port as the data CSV (stream-out.js), with its protections: the server's row cap, the
// deadline, a reader that stalls or leaves, and a failure after the head that never puts its text in the body.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GET as pdfRoute } from '../../app/api/reports/[id]/pdf/route.js';
import { writeReport } from '../../src/server/reports.js';
import { stampDefinition, OPEN } from '../../src/server/perms.js';
import { streamInPool, stopPool, poolStats } from '../../src/server/pool.js';
import { streamLimits } from '../../src/server/sql.js';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { createSubsetter } from '../../src/exporters/subset.js';
import { fontStore } from '../helpers.js';

const root = path.join(import.meta.dirname, '../..');
const subset = createSubsetter(() => fs.promises.readFile(path.join(root, 'public/harfbuzz-subset.wasm')));
const hasPoppler = spawnSync('pdftotext', ['-v']).status === 0;
let tmp;
const pdftotext = (bytes) => {
  const f = path.join(tmp, `t${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, bytes);
  const r = spawnSync('pdftotext', ['-layout', f, '-']);
  return { text: r.stdout.toString(), err: r.stderr.toString() };
};
const REGIONS = ['North', 'South', 'East', 'West'];
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, account: `AC${String(1000 + (i * 7) % 900).padStart(5, '0')}`, region: REGIONS[i % 4],
  date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, amount: Math.round(((i * 7919) % 200000 - 100000) * 1.37) / 100,
  reference: i % 37 === 0 ? `Reversal of an earlier transfer between linked accounts, batch ${i}` : `REF-${i * 31}` }));
const ledger = (n) => ({
  $schema: 'reportwright/report@1', name: 'Ledger', locale: 'en-IN', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows: rows(n) } }],
  dataSets: [{ name: 'Tx', source: 'src', path: '$.rows', fields: [{ name: 'id', type: 'number' }, { name: 'account', type: 'string' }, { name: 'region', type: 'string' }, { name: 'date', type: 'date' }, { name: 'amount', type: 'number' }, { name: 'reference', type: 'string' }],
    sort: [{ by: '=Fields.region' }, { by: '=Fields.id', dir: 'desc' }] }],
  sections: {
    pageHeader: { height: 22, items: [{ type: 'textbox', name: 'Title', x: 0, y: 0, w: 300, h: 18, value: 'Transactions ledger', style: { fontWeight: 'bold' } }] },
    body: { items: [{ type: 'table', name: 'Tx', dataSet: 'Tx', x: 0, y: 0, w: 520, h: 40, columns: [{ width: 50 }, { width: 70 }, { width: 60 }, { width: 70 }, { width: 80 }, { width: 190 }],
      header: [{ height: 16, style: { fontWeight: 'bold', backgroundColor: '#eef2f7' }, cells: ['Id', 'Account', 'Region', 'Date', 'Amount', 'Reference'].map(value => ({ value })) }],
      detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.account' }, { value: '=Fields.region' }, { value: '=Fields.date', style: { format: 'd' } }, { value: '=Fields.amount', style: { format: 'N2', textAlign: 'right' } }, { value: '=Fields.reference', style: { fontSize: 8 } }] }],
      footer: [{ height: 16, style: { fontWeight: 'bold' }, cells: [{ value: 'Total' }, { value: '=CountRows()' }, null, null, { value: '=Sum(Fields.amount)', style: { format: 'N2', textAlign: 'right' } }, null] }] }] },
    pageFooter: { height: 18, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 520, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}', style: { textAlign: 'right' } }] },
  },
});
const env = (k, v) => { const old = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; return () => { if (old === undefined) delete process.env[k]; else process.env[k] = old; }; };
const settle = async () => { for (let i = 0; i < 100 && (poolStats().principals.running || poolStats().workers.busy); i++) await new Promise(r => setTimeout(r, 50)); };

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-stream-d-'));
  process.env.PW_STORAGE = `sqlite:${path.join(tmp, 's.db')}`;
});
afterAll(async () => { delete process.env.PW_STORAGE; await stopPool(); fs.rmSync(tmp, { recursive: true, force: true }); });
afterEach(() => { delete process.env.PW_RENDER_WORKERS; delete process.env.PW_STREAM_STALL_MS; });

describe('the server streams a flowing report\'s PDF', () => {
  it.skipIf(!hasPoppler)('GET /api/reports/<id>/pdf: 20,000 rows streamed (no length), the text exportPdf draws', async () => {
    process.env.PW_RENDER_WORKERS = '1';
    await stopPool();
    const def = ledger(20000);
    await stampDefinition({ kind: 'service' }, 'ledger', def);
    await writeReport('ledger', def);
    const res = await pdfRoute(new Request('http://pw.test/api/reports/ledger/pdf', { headers: { host: 'pw.test' } }), { params: Promise.resolve({ id: 'ledger' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-length')).toBeNull(); // streamed
    const got = Buffer.from(await res.arrayBuffer());
    const want = await exportPdf(await render(def, { fontStore }), fontStore, { subset });
    const a = pdftotext(want), b = pdftotext(got);
    expect(b.err).toBe('');
    expect(a.text.length).toBeGreaterThan(1e6);
    expect(b.text).toBe(a.text);
    // an accessible PDF/A of the same report streams too, with the same text
    const pdfa = await pdfRoute(new Request('http://pw.test/api/reports/ledger/pdf?pdfa=1&ua=1', { headers: { host: 'pw.test' } }), { params: Promise.resolve({ id: 'ledger' }) });
    expect(pdfa.headers.get('content-length')).toBeNull();
    // (each item its own marked text object, as exportPdf's tagged file: it reads as that file in pdftotext's layout)
    const tagged = pdftotext(await exportPdf(await render(def, { fontStore, exportData: true }), fontStore, { subset, tagged: { lang: 'en' } }));
    expect(pdftotext(Buffer.from(await pdfa.arrayBuffer())).text).toBe(tagged.text);
  }, 240000);

  it('a client that leaves stops the render and frees its place in the pool', async () => {
    process.env.PW_RENDER_WORKERS = '0';
    await stopPool();
    const r = await streamInPool({ def: ledger(20000), opt: { format: 'pdf', principal: OPEN } });
    expect(r.stream).toBeDefined();
    const rd = r.stream.getReader();
    await rd.read();
    await rd.cancel();
    await r.done; // the render ended (cancelled at its next write)
    await settle();
    expect(poolStats().principals.running).toBe(0);
    expect(poolStats().workers.busy).toBe(0);
  }, 120000);

  it('a reader that stalls past PW_STREAM_STALL_MS stops the render; the broken body has no error text', async () => {
    process.env.PW_RENDER_WORKERS = '0';
    process.env.PW_STREAM_STALL_MS = '300';
    await stopPool();
    const logged = [];
    const keep = console.error; console.error = (x) => logged.push(String(x));
    try {
      const r = await streamInPool({ def: ledger(20000), opt: { format: 'pdf', principal: OPEN } });
      await r.done; // nobody reads: the render stops after PW_STREAM_STALL_MS
      let text = '', err = null;
      const rd = r.stream.getReader();
      try { for (;;) { const { done, value } = await rd.read(); if (done) break; text += Buffer.from(value).toString('latin1'); } } catch (e) { err = e; }
      expect(r.contentType).toBe('application/pdf'); // it had started: the head was out
      expect(text).not.toMatch(/%%EOF|PW_STREAM_STALL_MS|read nothing/); // a broken download (what was queued is dropped), nothing of the error in it
      expect(err?.message).toMatch(/failed after it started \(reference [0-9a-f]{8}\)/);
      const ref = err.message.match(/reference ([0-9a-f]{8})/)[1];
      expect(JSON.parse(logged.find(l => l.includes(ref)))).toMatchObject({ ref, format: 'pdf', error: { status: 408 } });
      await settle();
      expect(poolStats().principals.running).toBe(0);
    } finally { console.error = keep; }
  }, 120000);

  it('PW_STREAM_MAX_ROWS stops a streaming PDF (413) before any output; request options cannot raise it', async () => {
    process.env.PW_RENDER_WORKERS = '0';
    await stopPool();
    const kept = streamLimits.rows;
    streamLimits.rows = 1000;
    try {
      await expect(streamInPool({ def: ledger(5000), opt: { format: 'pdf', principal: OPEN, maxRows: 1e12, sorter: null } })).rejects.toMatchObject({ status: 413 });
    } finally { streamLimits.rows = kept; }
  }, 120000);

  it('the render deadline holds for a streaming PDF (504)', async () => {
    process.env.PW_RENDER_WORKERS = '0';
    await stopPool();
    const restore = env('PW_RENDER_TIMEOUT_MS', '1');
    try {
      await expect(streamInPool({ def: ledger(20000), opt: { format: 'pdf', principal: OPEN } })).rejects.toMatchObject({ status: 504 });
    } finally { restore(); }
  }, 120000);

  it('a report that cannot stream answers with bytes as before', async () => {
    process.env.PW_RENDER_WORKERS = '0';
    await stopPool();
    const def = ledger(300);
    def.sections.body.items[0].groups = [{ name: 'R', expr: '=Fields.region', newSection: true, header: [{ cells: [{ value: '=Fields.region' }] }] }];
    const r = await streamInPool({ def, opt: { format: 'pdf', principal: OPEN } });
    expect(r.stream).toBeUndefined();
    expect(Buffer.from(r.bytes).subarray(0, 5).toString()).toBe('%PDF-');
  }, 120000);
});
