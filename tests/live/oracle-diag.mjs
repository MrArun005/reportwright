// CI diagnostic (not a test): one scenario per process, on the CLOB-only query that hung in db-live.
// usage: node tests/live/oracle-diag.mjs <variant>   (env PW_LIVE_ORACLE, PW_SQL_TIMEOUT_MS)
import oracledb from 'oracledb';
import { oracleConfig } from '../../src/server/sql/oracle.js';
import { runSql } from '../../src/server/sql.js';

const v = process.argv[2];
const Q = 'select notes from pwowner.types_t where id = 1';
const t0 = Date.now();
const log = (...a) => console.log(`[${v} +${Date.now() - t0}ms]`, ...a);
const withConn = async (fn, opts = {}) => {
  const c = await oracledb.getConnection(oracleConfig(process.env.PW_LIVE_ORACLE));
  c.callTimeout = 5000;
  try { return await fn(c); } finally { await c.close(opts).catch(() => {}); }
};
const readAll = async (c, sql, o) => {
  await c.execute('SET TRANSACTION READ ONLY');
  const r = await c.execute(sql, [], { resultSet: true, outFormat: oracledb.OUT_FORMAT_OBJECT, ...o });
  const rs = r.resultSet;
  try {
    for (;;) {
      const b = await rs.getRows(100);
      if (!b.length) break;
      for (const row of b) for (const val of Object.values(row)) if (val && typeof val.getData === 'function') log('lob', (await val.getData()).length);
    }
  } finally { await rs.close(); }
  await c.rollback();
};
// the driver's own path (pool, probe, statement info, read-only, batches), one query, in this process
const drv = async (label, q) => { const t = Date.now(); try { const r = await runSql({ connection: 'x', query: q }); log(label, 'ok', Date.now() - t, 'ms', JSON.stringify(r).slice(0, 50)); } catch (e) { log(label, 'ERR', Date.now() - t, 'ms', e.status, e.message); } };
const scenarios = {
  // plain node-oracledb, fetch options as the driver uses them
  D1: () => withConn(c => readAll(c, Q, { fetchArraySize: 100, prefetchRows: 100 })),
  D2: () => withConn(c => readAll(c, Q, { fetchArraySize: 1, prefetchRows: 1 })),
  D3: () => withConn(c => readAll(c, Q, {})),
  // the driver's path, first call / after a count / twice
  P1: () => drv('clob', Q),
  P2: async () => { await drv('select1', 'select 1 as one from dual'); await drv('clob', Q); },
  P3: async () => { await drv('clob1', Q); await drv('clob2', Q); },
  P4: async () => { await drv('count', 'select count(*) as n from pwowner.types_t'); await drv('clob', Q); },
};
const s = scenarios[v];
if (!s) { log('unknown'); process.exit(2); }
try { await s(); log('OK'); } catch (e) { log('ERROR', e.code || '', e.message.split('\n')[0]); }
process.exit(0);
