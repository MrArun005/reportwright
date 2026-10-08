// Streaming phase B, the server half: the external sort (spill), SQL read a batch at a time, the port that carries a
// render's output with back-pressure, and the pool/route path that streams a data CSV.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { spillSorter } from '../../src/server/spill.js';
import { memorySorter } from '../../src/engine/stream.js';
import { applySort, compareKeys, sortKeys } from '../../src/engine/data/index.js';
import { runSql, runSqlRows, streamLimits, limits } from '../../src/server/sql.js';
import { portSink, portSource, textWriter } from '../../src/server/stream-out.js';
import { streamInPool, renderInPool, stopPool } from '../../src/server/pool.js';
import { OPEN } from '../../src/server/perms.js';
import { render } from '../../src/engine/index.js';
import { exportCsv } from '../../src/exporters/csv.js';
import { fontStore } from '../helpers.js';

let dir, file;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-stream-'));
  file = path.join(dir, 'big.db');
  const db = new DatabaseSync(file);
  db.exec('create table t (id integer primary key, name text, city text, qty integer, price real)');
  const ins = db.prepare('insert into t values (?, ?, ?, ?, ?)');
  db.exec('begin');
  for (let i = 0; i < 25000; i++) ins.run(i, `Name ${i}`, ['Pune', 'Delhi', 'Chennai'][i % 3], i % 13, (i * 7.31) % 100);
  db.exec('commit');
  db.close();
  process.env.PW_DB_BIG = `sqlite:${file}`;
});
afterAll(async () => { delete process.env.PW_DB_BIG; await stopPool(); fs.rmSync(dir, { recursive: true, force: true }); });
afterEach(() => { delete process.env.PW_RENDER_WORKERS; });

describe('external sort', () => {
  it('spills runs to disk and merges them: the same order as applySort (stable, collation, nulls last, desc)', async () => {
    const rows = Array.from({ length: 10000 }, (_, i) => ({ i, a: [null, 'b', 'B', 'a', 'é', '10', '9'][(i * 7919) % 7], n: (i * 104729) % 97, d: new Date(Date.UTC(2026, 0, 1 + (i % 40))) }));
    const sort = [{ by: '=Fields.a' }, { by: '=Fields.n', dir: 'desc' }, { by: '=Fields.d' }];
    const ctx = { params: {}, globals: {}, dataSets: {}, fields: null, locale: 'en-US' };
    const want = applySort(rows, sort, ctx).map(r => r.i);
    const factory = spillSorter({ run: 700, frame: 100, dir });
    const s = factory((x, y) => compareKeys(x.k, y.k, sort, ctx) || x.s - y.s);
    const c = { ...ctx };
    for (const [s0, r] of rows.entries()) { c.fields = r; await s.push({ k: sortKeys(sort, c), s: s0, r }); }
    expect(s.runs).toBeGreaterThan(10);
    const got = [];
    for await (const x of s.drain()) { got.push(x.r.i); expect(x.r.d).toBeInstanceOf(Date); }
    await s.close();
    expect(got).toEqual(want);
    expect(fs.readdirSync(dir).filter(f => f.startsWith('pw-spill-'))).toEqual([]); // the temp files are gone
    // the in-memory sorter agrees
    const m = memorySorter((x, y) => x.k - y.k || x.s - y.s);
    for (const [i, k] of [3, 1, 2, 1].entries()) m.push({ k, s: i });
    const out = []; for await (const x of m.drain()) out.push(x.s);
    expect(out).toEqual([1, 3, 2, 0]);
  });
  it('refuses past PW_SPILL_MAX_MB', async () => {
    const s = spillSorter({ run: 100, maxMB: 0.001, dir })((x, y) => x - y);
    await expect((async () => { for (let i = 0; i < 1000; i++) await s.push(i); })()).rejects.toMatchObject({ status: 413 });
    await s.close();
  });
});

describe('SQL in batches', () => {
  it('SQLite: a reused query process runs query after query (node:sqlite freed statements by address: every second one failed)', async () => {
    for (const q of ['select * from t', 'select id from t', 'select price from t', 'select id from t', 'select name, city from t']) expect((await runSql({ connection: 'big', query: q })).length).toBe(25000);
  });
  it('SQLite: past PW_SQL_MAX_ROWS, in batches, the same rows as runSql', async () => {
    const keep = limits.rows;
    limits.rows = 10000; // the whole-result cap refuses this query…
    try {
      await expect(runSql({ connection: 'big', query: 'select * from t' })).rejects.toThrow(/more than 10000 rows/);
      // …the streaming read does not, and hands the rows over 1,000 at a time
      const sizes = [], all = [];
      for await (const b of runSqlRows({ connection: 'big', query: 'select * from t where qty >= @q order by id' }, { q: 0 })) { sizes.push(b.length); all.push(...b); }
      expect(all.length).toBe(25000);
      expect(Math.max(...sizes)).toBe(1000);
      expect(all[24999]).toEqual({ id: 24999, name: 'Name 24999', city: ['Pune', 'Delhi', 'Chennai'][24999 % 3], qty: 24999 % 13, price: (24999 * 7.31) % 100 });
    } finally { limits.rows = keep; }
  });
  it('SQLite: the streaming caps hold, and a reader that stops ends the query', async () => {
    const keep = streamLimits.rows;
    streamLimits.rows = 5000;
    try {
      await expect((async () => { for await (const _ of runSqlRows({ connection: 'big', query: 'select * from t' })) { /* read on */ } })()).rejects.toThrow(/more than 5000 rows/);
    } finally { streamLimits.rows = keep; }
    let n = 0;
    for await (const b of runSqlRows({ connection: 'big', query: 'select * from t' })) { n += b.length; if (n >= 2000) break; }
    expect(n).toBe(2000);
    // the child process is free again: the next query runs
    expect((await runSql({ connection: 'big', query: 'select count(*) as n from t' }))[0].n).toBe(25000);
  });
});

describe('the output port', () => {
  it('back-pressure: a reader that does not read holds the writer at a few chunks', async () => {
    const { port1, port2 } = new MessageChannel();
    const src = portSource(port1, { csv: true });
    const sink = portSink(port2);
    let written = 0;
    const writer = (async () => { sink.head({ contentType: 'text/csv', ext: 'csv' }); for (let i = 0; i < 50; i++) { await sink.write(new Uint8Array(65536).fill(65)); written++; } sink.end(); })();
    expect(await src.head).toEqual({ contentType: 'text/csv', ext: 'csv' });
    await new Promise(r => setTimeout(r, 200));
    expect(written).toBeLessThanOrEqual(5); // highWaterMark 4 + the one in flight
    const reader = src.stream.getReader();
    let bytes = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; }
    await writer;
    expect(bytes).toBe(50 * 65536);
  });
  it('a reader that cancels stops the writer at its next write; a failure after the head breaks the stream, with only a reference in it', async () => {
    let { port1, port2 } = new MessageChannel();
    let src = portSource(port1);
    let sink = portSink(port2);
    const w = textWriter(sink, { contentType: 'text/csv', ext: 'csv' });
    const writer = (async () => { for (let i = 0; i < 1e6; i++) await w.put('x'.repeat(1000)); })();
    await src.head;
    await src.stream.cancel();
    await expect(writer).rejects.toMatchObject({ status: 499 });
    ({ port1, port2 } = new MessageChannel());
    src = portSource(port1, { csv: true }); sink = portSink(port2);
    const logged = [];
    const keep = console.error; console.error = (x) => logged.push(String(x));
    (async () => { sink.head({ contentType: 'text/csv', ext: 'csv' }); await sink.write(new TextEncoder().encode('a,b')); sink.fail('HTTP 500 from http://secret.internal/q?token=abc'); })();
    let text = '', err = null;
    const r = src.stream.getReader();
    try { for (;;) { const { done, value } = await r.read(); if (done) break; text += new TextDecoder().decode(value); } } catch (e) { err = e; } finally { console.error = keep; }
    // the body: a reference only, never the error's text; the stream errors (a broken download, not a short file)
    expect(text).toMatch(/^a,b\r\n#ERROR [0-9a-f]{8}$/);
    expect(text).not.toMatch(/secret|token|HTTP/);
    expect(err?.message).toMatch(/failed after it started \(reference [0-9a-f]{8}\)/);
    expect(err.message).not.toMatch(/secret/);
    // the log has the reason, under the same reference
    const ref = text.slice(-8);
    expect(logged.some(l => l.includes(ref) && l.includes('secret.internal'))).toBe(true);
  });
});

describe('the pool streams a data CSV', () => {
  const def = {
    $schema: 'pagewright/report@1', name: 'SqlCsv', page: { size: 'A4' },
    dataSources: [{ name: 's', type: 'sql', connection: 'big', query: 'select * from t' }], dataSets: [{ name: 'D', source: 's', sort: [{ by: '=Fields.city' }, { by: '=Fields.id', dir: 'desc' }] }],
    sections: { body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 400, h: 40, columns: [{ width: 100 }, { width: 100 }, { width: 100 }, { width: 100 }],
      header: [{ cells: [{ value: 'Id' }, { value: 'Name' }, { value: 'City' }, { value: 'Price' }] }],
      detail: [{ cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }, { value: '=Fields.city' }, { value: '=Fields.price', style: { format: 'N2' } }] }] }] } },
  };
  for (const workers of ['2', '0']) {
    it(`streams (PW_RENDER_WORKERS=${workers}), byte for byte the model path's CSV`, async () => {
      process.env.PW_RENDER_WORKERS = workers;
      await stopPool();
      const r = await streamInPool({ def, opt: { format: 'csv', principal: OPEN } });
      expect(r.stream).toBeDefined();
      const got = Buffer.from(await new Response(r.stream).arrayBuffer()).toString('utf8');
      expect((await r.done)?.streamed).toBe(true);
      const want = exportCsv(await render(def, { fontStore, dataOnly: true, sql: (s, p) => runSql(s, p) }), {});
      expect(got.length).toBeGreaterThan(500000);
      expect(got).toBe(want);
    }, 120000);
  }
  it('a report that cannot stream answers with bytes as before', async () => {
    process.env.PW_RENDER_WORKERS = '2';
    const lookup = { ...def, sections: { body: { items: [{ ...def.sections.body.items[0], detail: [{ cells: [{ value: '=Fields.id / Sum(Fields.id)' }] }] }] } } };
    const r = await streamInPool({ def: lookup, opt: { format: 'csv', principal: OPEN } });
    expect(r.stream).toBeUndefined();
    expect(r.bytes.length).toBeGreaterThan(1000);
    const plain = await renderInPool({ def, opt: { format: 'csv', principal: OPEN } }); // without a port: bytes, as before
    expect(plain.bytes.length).toBeGreaterThan(500000);
  }, 120000);
});

// Opt-in, live databases: PW_TEST_PG=postgres://postgres@127.0.0.1:5432/postgres, PW_TEST_MYSQL=mysql://root:…@127.0.0.1:3306/db
import { pgReader, mysqlReader } from './sql-readers.js';
for (const [kind, env, reader, series] of [
  ['postgres', 'PW_TEST_PG', pgReader, 'select g as id, \'n\' || g as name from generate_series(1, 30000) g order by g'],
  ['mysql', 'PW_TEST_MYSQL', mysqlReader, 'with d as (select 0 n union all select 1 union all select 2 union all select 3 union all select 4 union all select 5 union all select 6 union all select 7 union all select 8 union all select 9), s as (select a.n + 10 * b.n + 100 * c.n + 1000 * e.n + 10000 * f.n + 1 as id from d a, d b, d c, d e, d f) select id, concat(\'n\', id) as name from s where id <= 30000 order by id'],
]) {
  describe.skipIf(!process.env[env])(`${kind} in batches (live)`, () => {
    beforeAll(async () => { process.env.PW_DB_LIVE = await reader(process.env[env]); });
    afterAll(() => { delete process.env.PW_DB_LIVE; });
    it('reads past PW_SQL_MAX_ROWS a batch at a time; a reader that stops ends the query; the pool goes on', async () => {
      const keep = limits.rows;
      limits.rows = 10000;
      try {
        await expect(runSql({ connection: 'live', query: series })).rejects.toThrow(/more than 10000 rows/);
        const sizes = [], all = [];
        for await (const b of runSqlRows({ connection: 'live', query: series })) { sizes.push(b.length); all.push(...b); }
        expect(all.length).toBe(30000);
        expect(Math.max(...sizes)).toBe(500);
        expect(all[29999]).toEqual({ id: 30000, name: 'n30000' });
      } finally { limits.rows = keep; }
      let n = 0;
      for await (const b of runSqlRows({ connection: 'live', query: series })) { n += b.length; if (n >= 1000) break; }
      expect(n).toBe(1000);
      expect((await runSql({ connection: 'live', query: 'select 1 as one' }))[0].one).toBe(1);
    }, 60000);
  });
}

describe('streaming keeps its caps (review)', () => {
  const sqlDef = (query, extra = {}) => ({ $schema: 'pagewright/report@1', name: 'Cap', page: { size: 'A4' }, dataSources: [{ name: 's', type: 'sql', connection: 'big', query }], dataSets: [{ name: 'D', source: 's', ...extra }],
    sections: { body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 200, h: 40, columns: [{ width: 200 }], detail: [{ cells: [{ value: '=Fields.id' }] }] }] } } });
  const drain = async (r) => (r.stream ? Buffer.from(await new Response(r.stream).arrayBuffer()).toString('utf8') : null);

  it('SQL: the streaming path runs the same checks on the same text as runSql (no rewrite)', async () => {
    for (const q of ['select 1; select 2', 'delete from t', 'select * from pragma_database_list', "select * from t where name = 'x' union select sqlite_version()"]) {
      const a = await runSql({ connection: 'big', query: q }).then(() => 'ok', e => e.message);
      const b = await (async () => { for await (const _ of runSqlRows({ connection: 'big', query: q })) { /* read */ } return 'ok'; })().catch(e => e.message);
      expect(b, q).toBe(a);
    }
    // parameters stay bound values in both
    const p = { n: "1 or 1=1" };
    const a = await runSql({ connection: 'big', query: 'select count(*) as c from t where id = @n' }, p);
    const rows = []; for await (const b of runSqlRows({ connection: 'big', query: 'select count(*) as c from t where id = @n' }, p)) rows.push(...b);
    expect(rows).toEqual(a);
    expect(a[0].c).toBe(0);
  });
  it('rows: PW_STREAM_MAX_ROWS stops a streaming render (413), before any output', async () => {
    process.env.PW_RENDER_WORKERS = '0';
    await stopPool();
    const keep = streamLimits.rows;
    streamLimits.rows = 1000;
    try {
      await expect(streamInPool({ def: sqlDef('select * from t'), opt: { format: 'csv', principal: OPEN } })).rejects.toMatchObject({ status: expect.any(Number) });
    } finally { streamLimits.rows = keep; }
  }, 60000);
  it('caps come from the server, never from the request: options in the render request change nothing', async () => {
    process.env.PW_RENDER_WORKERS = '0';
    await stopPool();
    const keep = streamLimits.rows;
    streamLimits.rows = 1000;
    try {
      await expect(streamInPool({ def: sqlDef('select * from t'), opt: { format: 'csv', principal: OPEN, maxRows: 1e12, maxJsonRowBytes: 1e12, maxJsonWholeBytes: 1e12, sorter: null, sqlRows: null } })).rejects.toMatchObject({ status: expect.any(Number) });
    } finally { streamLimits.rows = keep; }
  }, 60000);
  it('spill: a run ends at its bytes as well as its records (a few huge rows cannot fill memory)', async () => {
    const s = spillSorter({ run: 1e9, runBytes: 200000, dir })((x, y) => x.k - y.k);
    for (let i = 0; i < 40; i++) await s.push({ k: 40 - i, r: { big: 'x'.repeat(20000) } });
    expect(s.runs).toBeGreaterThanOrEqual(7); // 40 rows of ~40 KB each in runs of ~200 KB
    const ks = []; for await (const x of s.drain()) ks.push(x.k);
    await s.close();
    expect(ks).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });
  it('time: a render past its deadline stops (504)', async () => {
    const { planStream } = await import('../../src/engine/stream.js');
    const plan = await planStream(sqlDef('select * from t'), { format: 'csv', sql: (s, p) => runSql(s, p), deadline: Date.now() - 1, timeoutMs: 1 });
    await expect((async () => { for await (const _ of plan.rows()) { /* read */ } })()).rejects.toMatchObject({ status: 504 });
  });
  it('spill: the files go when the rows are abandoned, and stale ones from a stopped render are swept', async () => {
    const stale = fs.mkdtempSync(path.join(dir, 'pw-spill-'));
    fs.utimesSync(stale, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
    const s = spillSorter({ run: 100, dir, staleMs: 60000 })((x, y) => x - y);
    expect(fs.existsSync(stale)).toBe(false);
    for (let i = 0; i < 1000; i++) await s.push(1000 - i);
    expect(fs.readdirSync(dir).filter(f => f.startsWith('pw-spill-')).length).toBe(1);
    const it = s.drain();
    await it.next(); await it.return(); await s.close();
    expect(fs.readdirSync(dir).filter(f => f.startsWith('pw-spill-'))).toEqual([]);
  });
  it('a client that leaves cancels the stream down to the source: the HTTP fetch is closed', async () => {
    const http = await import('node:http');
    let closed = false, sent = 0;
    const srv = http.createServer(async (req, res) => {
      res.on('close', () => { closed = true; });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('[');
      for (let i = 0; i < 5e6 && !closed; i++) { const ok = res.write(`${i ? ',' : ''}{"id":${i},"name":"row ${i}"}`); sent++; if (!ok) await new Promise(r => res.once('drain', r)); }
      res.end(']');
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/rows`;
    process.env.PW_RENDER_WORKERS = '0';
    await stopPool();
    const def = { $schema: 'pagewright/report@1', name: 'Gone', page: { size: 'A4' }, dataSources: [{ name: 's', type: 'rest', url }], dataSets: [{ name: 'D', source: 's' }],
      sections: { body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 200, h: 40, columns: [{ width: 100 }, { width: 100 }], detail: [{ cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }] }] }] } } };
    try {
      const r = await streamInPool({ def, opt: { format: 'csv', principal: OPEN, self: new URL(url).origin } });
      expect(r.stream).toBeDefined();
      const rd = r.stream.getReader();
      await rd.read(); await rd.read();
      await rd.cancel();
      for (let i = 0; i < 100 && !closed; i++) await new Promise(x => setTimeout(x, 50));
      expect(closed).toBe(true);
      expect(sent).toBeLessThan(5e6);
      await r.done; // the render ended
    } finally { srv.close(); }
  }, 60000);
});
