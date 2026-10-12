// CI diagnostic (not a test of behaviour): one scenario per process, on the CLOB-only query that hung in db-live.
// DIAG_SCENARIO=D1|D2|D3|P1|P2|P3|P4 PW_LIVE_ORACLE=... npx vitest run tests/live/oracle-diag.live.test.js
import { it } from 'vitest';
import oracledb from 'oracledb';
import { oracleConfig } from '../../src/server/sql/oracle.js';
import { runSql } from '../../src/server/sql.js';

const Q = 'select notes from pwowner.types_t where id = 1';
const CNT = 'select count(*) as n from pwowner.types_t';
const t0 = Date.now();
const log = (...a) => console.log(`[DIAG +${Date.now() - t0}ms]`, ...a);
process.env.PW_DB_X = process.env.PW_LIVE_ORACLE;

const withConn = async (fn) => {
  const c = await oracledb.getConnection(oracleConfig(process.env.PW_LIVE_ORACLE));
  c.callTimeout = 5000;
  try { return await fn(c); } finally { await c.close({ drop: true }).catch(() => {}); }
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
const drv = async (label, q) => {
  const t = Date.now();
  try { const r = await runSql({ connection: 'x', query: q }); log(label, 'ok', Date.now() - t, 'ms', JSON.stringify(r).slice(0, 40)); }
  catch (e) { log(label, 'ERR', Date.now() - t, 'ms', e.status, e.message); }
};
const scenarios = {
  D1: () => withConn(c => readAll(c, Q, { fetchArraySize: 100, prefetchRows: 100 })),
  D2: () => withConn(c => readAll(c, Q, { fetchArraySize: 1, prefetchRows: 1 })),
  D3: () => withConn(c => readAll(c, Q, {})),
  P1: () => drv('clob', Q),
  P2: async () => { await drv('select1', 'select 1 as one from dual'); await drv('clob', Q); },
  P3: async () => { await drv('clob1', Q); await drv('clob2', Q); },
  P4: async () => { await drv('count', CNT); await drv('clob', Q); },
};
const name = process.env.DIAG_SCENARIO;
it.skipIf(!name)(`diagnostic ${name}`, async () => {
  const s = scenarios[name];
  if (!s) throw new Error(`no scenario ${name}`);
  try { await s(); log('OK'); } catch (e) { log('ERROR', e.code || '', e.message.split('\n')[0]); }
}, 60000);
