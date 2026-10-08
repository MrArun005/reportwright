// exportPdfStream when things go wrong (the 0.12.1 retest): a sink that stops reading, timeoutMs and signal, cursors
// closed on every exit, partial files, options that are not options.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { exportPdfStream } from '../../src/exporters/pdfstream.js';
import { spillSorter } from '../../src/exporters/spill.js';
import { fontStore } from '../helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b8b-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const now = new Date('2026-01-02T03:04:05Z');

/** a ledger over a SQL source; "of M" in the footer unless single */
const def = ({ single = false, sort = false } = {}) => ({
  $schema: 'pagewright/report@1', name: 'L', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'sql', connection: 'db', query: 'select id, g from t' }],
  dataSets: [{ name: 'D', source: 's', fields: [{ name: 'id', type: 'number' }, { name: 'g', type: 'string' }] }],
  sections: {
    body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 200, h: 40, columns: [{ width: 100 }, { width: 100 }],
      ...(sort ? { sort: [{ by: '=Fields.g' }] } : {}),
      header: [{ height: 14, cells: [{ value: 'Id' }, { value: 'G' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.g' }] }] }] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 300, h: 14, value: single ? 'Page {Globals.PageNumber}' : 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  },
});
/** a counting cursor: sqlRows opens one per call; closed when it ends or is returned */
const cursor = (rows, o = {}) => {
  const c = { opened: 0, closed: 0, batches: 0 };
  c.sqlRows = () => (async function* () {
    c.opened++;
    try {
      for (let i = 0; i < rows; i += 100) {
        if (o.throwAt != null && i >= o.throwAt) throw new Error('cursor broke');
        c.batches++;
        o.onBatch?.(c.batches);
        if (o.slow) await new Promise(r => setTimeout(r, o.slow));
        yield Array.from({ length: Math.min(100, rows - i) }, (_, k) => ({ id: i + k + 1, g: o.order ? o.order(i + k) : `G${(i + k) % 3}` }));
      }
    } finally { c.closed++; }
  })();
  return c;
};
const memSink = () => ({ n: 0, write: async () => {} });
const stalled = () => new Writable({ highWaterMark: 1024, write() { /* never calls back: the client stopped reading */ } });
const spillDirs = (d) => fs.readdirSync(d).filter(n => n.startsWith('pw-spill-'));
const opts = (c, extra = {}) => ({ fontStore, now, sqlRows: c.sqlRows, window: 100, ...extra });

describe('N21: a sink that stops reading', () => {
  it('timeoutMs covers the wait for drain: rejects in budget with a timeout error, cursors closed', async () => {
    const c = cursor(3000);
    const t0 = Date.now();
    const e = await exportPdfStream(def(), opts(c, { timeoutMs: 500 }), stalled()).catch(x => x);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(e).toMatchObject({ code: 'ETIMEDOUT', status: 504 });
    await new Promise(r => setTimeout(r, 50));
    expect(c.closed).toBe(c.opened);
  });
  it('signal: abort while waiting for drain rejects within ~100 ms with an AbortError', async () => {
    const c = cursor(3000);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const p = exportPdfStream(def(), opts(c, { signal: ac.signal }), stalled()).catch(x => x);
    await new Promise(r => setTimeout(r, 200));
    const t0 = Date.now();
    const e = await p;
    expect(Date.now() - t0).toBeLessThan(150);
    expect(e.name).toBe('AbortError');
    await new Promise(r => setTimeout(r, 50));
    expect(c.closed).toBe(c.opened);
  });
  it('signal: abort mid-export (rows still coming, a sort spilling) stops promptly, cursors closed, no spill folder left', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'sp-'));
    const ac = new AbortController();
    let at = 0;
    const c = cursor(20000, { onBatch: (n) => { if (n === 30) { at = Date.now(); ac.abort(); } } });
    const e = await exportPdfStream(def({ sort: true }), opts(c, { signal: ac.signal, sorter: spillSorter({ dir, run: 500 }) }), memSink()).catch(x => x);
    expect(Date.now() - at).toBeLessThan(100);
    expect(e.name).toBe('AbortError');
    expect(c.batches).toBeLessThan(40);
    await new Promise(r => setTimeout(r, 50));
    expect(c.closed).toBe(c.opened);
    expect(spillDirs(dir)).toEqual([]);
  });
  it('an aborted signal stops before anything is read', async () => {
    const c = cursor(300);
    const e = await exportPdfStream(def(), opts(c, { signal: AbortSignal.abort() }), memSink()).catch(x => x);
    expect(e.name).toBe('AbortError');
    expect(c.opened).toBe(0);
  });
});
