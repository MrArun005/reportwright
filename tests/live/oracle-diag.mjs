// CI diagnostic (not a test): one node-oracledb variant per process, on the CLOB-only query that hung in db-live.
// usage: node tests/live/oracle-diag.mjs <variant>   (env PW_LIVE_ORACLE)
import oracledb from 'oracledb';
import { oracleConfig } from '../../src/server/sql/oracle.js';

const v = process.argv[2];
const Q = 'select notes from pwowner.types_t where id = 1';
const Q2 = 'select id, notes from pwowner.types_t where id = 1';
const Q3 = 'select notes from pwowner.types_t where id = 3';
const variants = {
  A: { q: Q, opts: {} },                                             // execute, defaults
  B: { q: Q, opts: { fetchArraySize: 100, prefetchRows: 100 } },
  C: { q: Q, opts: { resultSet: true, fetchArraySize: 100, prefetchRows: 100, outFormat: oracledb.OUT_FORMAT_OBJECT } },
  D: { q: Q, opts: { fetchInfo: { NOTES: { type: oracledb.STRING } } } },           // CLOB as string
  E: { q: Q, opts: { fetchTypeHandler: (m) => (m.dbType === oracledb.DB_TYPE_CLOB ? { type: oracledb.STRING } : undefined) } },
  F: { q: Q2, opts: {} },                                            // two columns
  G: { q: Q3, opts: {} },                                            // the 3.2 MB CLOB row
  H: { q: Q3, opts: { fetchInfo: { NOTES: { type: oracledb.STRING } } } },
  I: { q: Q, opts: {}, readLob: true },                               // execute, then getData on the locator
  J: { q: 'select 1 as one from dual', opts: {} },                   // control
};
const spec = variants[v];
if (!spec) { console.log('unknown variant', v); process.exit(2); }
const t0 = Date.now();
const log = (...a) => console.log(`[${v} +${Date.now() - t0}ms]`, ...a);
const conn = await oracledb.getConnection(oracleConfig(process.env.PW_LIVE_ORACLE));
conn.callTimeout = 5000; // a hang becomes an error, not a stuck process
try {
  log('connected');
  await conn.execute('SET TRANSACTION READ ONLY');
  log('readonly set');
  const r = await conn.execute(spec.q, [], { ...spec.opts });
  log('executed rows=', r.rows?.length, 'cols=', JSON.stringify(r.metaData?.map(m => m.name)));
  const first = r.rows?.[0];
  const val = Array.isArray(first) ? first[first.length - 1] : first?.NOTES;
  if (spec.readLob && val && typeof val.getData === 'function') { const s = await val.getData(); log('lob len', s.length); }
  else log('value type', typeof val, val && val.constructor?.name, typeof val === 'string' ? val.length : '');
  await conn.rollback();
  log('OK');
} catch (e) {
  log('ERROR', e.code || '', e.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  await conn.close({ drop: true }).catch(() => {});
  log('closed');
}
