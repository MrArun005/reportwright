// E07: PostgreSQL pool exhaustion and stalled readers. A mocked pg pool (no database needed): a connection that is not
// free in time is a 503 with Retry-After (not a 500), an aborted reader releases its connection at once, and the query
// runs under a statement_timeout from its first statement.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { runSql, runSqlRows } from '../../src/server/sql.js';

const URL_ = 'postgres://u:secret@db.test/app';
const pools = globalThis.__pwSqlPools;
const fakeClient = ({ fetch = () => Promise.resolve({ rows: [] }) } = {}) => {
  const stream = new EventEmitter(); stream.destroy = () => {};
  const c = { log: [], released: null, processID: 7, connection: { stream }, on() {},
    query: (q) => { const t = typeof q === 'string' ? q : q.text; c.log.push(t); return /^FETCH/.test(t) ? fetch() : Promise.resolve({ rows: [] }); },
    release: (destroy) => { c.released = destroy ? 'destroyed' : 'returned'; } };
  return c;
};
const fakePg = { Client: class { on() {} connect() { return Promise.reject(new Error('no')); } query() {} end() { return Promise.resolve(); } } };
const use = (pool) => pools.set(URL_, { pool, pg: fakePg, checked: Date.now() + 3600e3 });

describe('E07 postgres pool', () => {
  beforeEach(() => { process.env.PW_DB_MAIN = URL_; process.env.PW_DB_ACQUIRE_MS = '50'; });
  afterEach(() => { pools.delete(URL_); delete process.env.PW_DB_MAIN; delete process.env.PW_DB_ACQUIRE_MS; });

  it('every connection busy: 503 with Retry-After, and a connection that frees later goes back to the pool', async () => {
    let free;
    use({ connect: () => new Promise(r => { free = r; }), totalCount: 10, waitingCount: 1 });
    const e = await runSql({ connection: 'main', query: 'select 1' }).catch(x => x);
    expect(e.status).toBe(503);
    expect(e.retryAfter).toBeGreaterThan(0);
    expect(e.message).not.toMatch(/secret/);
    const late = fakeClient(); free(late);
    await new Promise(r => setTimeout(r, 10));
    expect(late.released).toBe('returned');
  });

  it('PW_DB_ACQUIRE_MS unset: a waiter waits for a connection up to the deadline, not a fixed 5 s', async () => {
    delete process.env.PW_DB_ACQUIRE_MS;
    let free;
    use({ connect: () => new Promise(r => { free = r; }), totalCount: 10, waitingCount: 1 });
    const q = runSql({ connection: 'main', query: 'select 1' });
    await new Promise(r => setTimeout(r, 5300)); // past the old fixed 5 s, well within the 30 s deadline
    const c = fakeClient(); free(c);
    expect(await q).toEqual([]);
    expect(c.released).toBe('returned');
  }, 15000);

  it('sets statement_timeout before the query is declared', async () => {
    const c = fakeClient();
    use({ connect: async () => c });
    await runSql({ connection: 'main', query: 'select 1' });
    const st = c.log.findIndex(t => /statement_timeout/.test(t)), decl = c.log.findIndex(t => /^DECLARE/.test(t));
    expect(st).toBeGreaterThan(-1);
    expect(st).toBeLessThan(decl);
  });

  it('a reader that aborts releases its connection at once (no waiting for the deadline)', async () => {
    const c = fakeClient({ fetch: () => new Promise(() => {}) }); // a stalled fetch
    use({ connect: async () => c });
    const ac = new AbortController();
    const it_ = runSqlRows({ connection: 'main', query: 'select 1' }, {}, { ms: 60000, signal: ac.signal });
    const first = it_.next();
    await new Promise(r => setTimeout(r, 20));
    expect(c.released).toBeNull();
    ac.abort();
    await new Promise(r => setTimeout(r, 20));
    expect(c.released).toBe('destroyed');
    const r = await first.catch(x => x);
    expect(r.done === true || r.status === 499).toBe(true);
  });
});
