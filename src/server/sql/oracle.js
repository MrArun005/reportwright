// @ts-check
// Oracle connections: oracle://user:password@host[:1521]/service — the oracledb package in thin mode (pure JavaScript,
// no Instant Client). Not tested against a live Oracle server (none was available): the safety logic is unit-tested
// with a mocked driver (tests/engine/sql-connectors.test.js).
// Guards: the server parses the text first (getStatementInfo) and it must be a SELECT; it runs in a transaction that
// starts with SET TRANSACTION READ ONLY and is always rolled back; rows come from a result set, counted on the client
// (rows, bytes, every LOB measured before it is read); LONG, XMLType, JSON, objects, cursors and vectors are refused
// (no size the client can check first); one deadline breaks the call in flight.

/** @param {string} url */
export function oracleConfig(url) {
  const u = new URL(url);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), connectString: `${u.hostname}:${u.port || 1521}/${decodeURIComponent(u.pathname.slice(1))}` };
}

// column types a report can read: a size the server bounds (LOBs are measured before they are read)
const READABLE = new Set(['DB_TYPE_NUMBER', 'DB_TYPE_BINARY_INTEGER', 'DB_TYPE_BINARY_FLOAT', 'DB_TYPE_BINARY_DOUBLE', 'DB_TYPE_VARCHAR', 'DB_TYPE_NVARCHAR',
  'DB_TYPE_CHAR', 'DB_TYPE_NCHAR', 'DB_TYPE_DATE', 'DB_TYPE_TIMESTAMP', 'DB_TYPE_TIMESTAMP_TZ', 'DB_TYPE_TIMESTAMP_LTZ', 'DB_TYPE_RAW', 'DB_TYPE_BOOLEAN',
  'DB_TYPE_INTERVAL_DS', 'DB_TYPE_INTERVAL_YM', 'DB_TYPE_ROWID', 'DB_TYPE_CLOB', 'DB_TYPE_NCLOB', 'DB_TYPE_BLOB']);

/**
 * @param {string} url @param {string} text @param {any[]} values
 * @param {import('../sql.js').DriverContext} ctx
 */
export async function oracle(url, text, values, ctx) {
  const { pools, limits, fail, clock, count, driver } = ctx;
  const key = `oracle|${url}`;
  const mod = await driver('oracledb', 'Oracle');
  const oracledb = mod.default || mod;
  if (!pools.has(key)) {
    const ready = oracledb.createPool({ ...oracleConfig(url), poolMin: 0, poolMax: 5, queueTimeout: 60000, connectTimeout: 10 });
    ready.catch(() => { if (pools.get(key) === ready) pools.delete(key); });
    pools.set(key, ready);
  }
  const clk = clock(Number(limits.ms));
  try {
    return await clk.inTime((async () => {
      const pool = await pools.get(key);
      const conn = await clk.inTime(pool.getConnection(), (c) => c.close().catch(() => {}));
      try {
        // break() stops the call in flight; callTimeout bounds each round trip to the time left
        clk.track({ cancel: () => { conn.break().catch(() => {}); } });
        conn.callTimeout = Math.max(1, clk.left());
        const info = await conn.getStatementInfo(text);
        if (info.statementType !== oracledb.STMT_TYPE_SELECT) throw fail('A SQL source can only run one SELECT query.', 400);
        if (/\bfor\s+update\b/i.test(ctx.code)) throw fail('A SQL source cannot lock rows (FOR UPDATE).', 400);
        clk.overdue();
        await conn.execute('SET TRANSACTION READ ONLY');
        clk.overdue();
        const r = await conn.execute(text, values, { resultSet: true, outFormat: oracledb.OUT_FORMAT_OBJECT, fetchArraySize: 200 });
        const rs = r.resultSet;
        try {
          const odd = (r.metaData || []).find(m => !READABLE.has(m.dbType?.name ?? m.dbTypeName));
          if (odd) throw fail(`The column "${String(odd.name).slice(0, 60)}" is ${odd.dbTypeName || 'a type'} a SQL source cannot read. Convert it in the query (TO_CHAR, DBMS_LOB.SUBSTR).`, 400);
          const rows = [];
          const take = count();
          for (;;) {
            clk.overdue();
            const batch = await rs.getRows(200);
            if (!batch.length) break;
            for (const row of batch) {
              for (const [k, v] of Object.entries(row)) {
                if (v && typeof v === 'object' && typeof v.getData === 'function') {
                  // a LOB: its length (characters for CLOB, bytes for BLOB) is checked before a byte of it is read
                  take.reserve(Number(v.length) * (v.type === oracledb.DB_TYPE_BLOB ? 1 : 4));
                  row[k] = await v.getData();
                  if (typeof v.close === 'function') await v.close().catch(() => {});
                }
              }
              take(row);
              rows.push(row);
            }
          }
          return rows;
        } finally { await rs.close().catch(() => {}); }
      } finally {
        await conn.rollback().catch(() => {});
        await conn.close().catch(() => {});
      }
    })());
  } finally { clk.stop(); }
}
