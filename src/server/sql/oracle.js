// @ts-check
// Oracle connections: oracle://user:password@host[:1521]/service — the oracledb package in thin mode (pure JavaScript,
// no Instant Client). Not tested against a live Oracle server (none was available): the safety logic is unit-tested
// with a mocked driver (tests/engine/sql-connectors.test.js).
// Guards: the login is checked first (probeOracle: it may only connect and read; a login with any other privilege,
// EXECUTE on anything, EXECUTE through PUBLIC on a network or file package, objects of its own, or a database link
// in sight is refused), every 5 s at most; the text passes sql.js's statement check (one plain SELECT or WITH, no
// PL/SQL, no FOR UPDATE, no @dblink, no UTL_/DBMS_ names, quoted names included); then the server parses the text (getStatementInfo) and it must be a SELECT; it runs in a transaction that
// starts with SET TRANSACTION READ ONLY and is always rolled back; rows come from a result set, counted on the client
// (rows, bytes, every LOB measured before it is read); LONG, XMLType, JSON, objects, cursors and vectors are refused
// (no size the client can check first); one deadline breaks the call in flight.

/** @param {string} url */
export function oracleConfig(url) {
  const u = new URL(url);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), connectString: `${u.hostname}:${u.port || 1521}/${decodeURIComponent(u.pathname.slice(1))}` };
}

// column types a report can read: a size the server bounds (LOBs are measured before they are read)
const PROBE_MS = 5000;
// PUBLIC has EXECUTE on these in a default install; a reading login must not reach the network, files, jobs or Java
const RISKY = ['UTL_HTTP', 'UTL_TCP', 'UTL_SMTP', 'UTL_MAIL', 'UTL_FILE', 'UTL_INADDR', 'DBMS_LDAP', 'HTTPURITYPE', 'DBMS_JAVA', 'DBMS_SCHEDULER', 'DBMS_JOB', 'DBMS_BACKUP_RESTORE'];

/**
 * What this Oracle login could do beyond reading, or ''. Fails closed (any error rejects).
 * @param {any} conn @param {any} oracledb
 */
export async function probeOracle(conn, oracledb) {
  const q = async (sql) => (await conn.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: 50 })).rows || [];
  const privs = (await q('SELECT privilege AS p FROM session_privs')).map(r => r.P).filter(p => p !== 'CREATE SESSION');
  if (privs.length) return `privileges ${privs.slice(0, 5).join(', ')}`;
  const grants = await q(`SELECT privilege || ' ON ' || table_schema || '.' || table_name AS p FROM all_tab_privs
    WHERE grantee IN (SELECT role FROM session_roles UNION ALL SELECT USER FROM dual) AND privilege NOT IN ('SELECT', 'READ')`);
  if (grants.length) return `granted ${grants.slice(0, 5).map(r => r.P).join(', ')}`;
  const risky = await q(`SELECT table_name AS p FROM all_tab_privs WHERE grantee = 'PUBLIC' AND privilege = 'EXECUTE' AND table_name IN (${RISKY.map(x => `'${x}'`).join(', ')})`);
  if (risky.length) return `PUBLIC may run ${risky.map(r => r.P).join(', ')} (REVOKE EXECUTE ON … FROM PUBLIC, or grant it to the users who need it)`;
  const own = await q('SELECT object_type || \' \' || object_name AS p FROM user_objects WHERE ROWNUM <= 5');
  if (own.length) return `owner of ${own.map(r => r.P).join(', ')}`;
  const links = await q('SELECT db_link AS p FROM all_db_links WHERE ROWNUM <= 5');
  if (links.length) return `it can use the database links ${links.map(r => r.P).join(', ')}`;
  return '';
}

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
    const entry = { ready, checked: 0 };
    ready.catch(() => { if (pools.get(key) === entry) pools.delete(key); });
    pools.set(key, entry);
  }
  const clk = clock(Number(limits.ms));
  try {
    return await clk.inTime((async () => {
      const entry = pools.get(key);
      const pool = await entry.ready;
      const conn = await clk.inTime(pool.getConnection(), (c) => c.close().catch(() => {}));
      try {
        // break() stops the call in flight; callTimeout bounds each round trip to the time left
        clk.track({ cancel: () => { conn.break().catch(() => {}); } });
        conn.callTimeout = Math.max(1, clk.left());
        if (Date.now() - entry.checked > PROBE_MS) {
          const why = await probeOracle(conn, oracledb);
          if (why) throw fail(`This Oracle login can do more than read (${String(why).slice(0, 300)}). Give report connections a user with CREATE SESSION and SELECT grants only.`, 500);
          entry.checked = Date.now();
        }
        clk.overdue();
        const info = await conn.getStatementInfo(text);
        if (info.statementType !== oracledb.STMT_TYPE_SELECT) throw fail('A SQL source can only run one SELECT query.', 400);
        if (/\bfor\s+update\b/i.test(ctx.code)) throw fail('A SQL source cannot lock rows (FOR UPDATE).', 400);
        clk.overdue();
        await conn.execute('SET TRANSACTION READ ONLY');
        clk.overdue();
        const r = await conn.execute(text, values, { resultSet: true, outFormat: oracledb.OUT_FORMAT_OBJECT, fetchArraySize: 1, prefetchRows: 1 });
        const rs = r.resultSet;
        try {
          const odd = (r.metaData || []).find(m => !READABLE.has(m.dbType?.name ?? m.dbTypeName));
          if (odd) throw fail(`The column "${String(odd.name).slice(0, 60)}" is ${odd.dbTypeName || 'a type'} a SQL source cannot read. Convert it in the query (TO_CHAR, DBMS_LOB.SUBSTR).`, 400);
          // the widest a row can be (a VARCHAR2 can be 32 kB; text is held at 2 bytes a character): each batch is as
          // many rows as fit in a quarter of the cap, so a batch of wide rows never goes far past it
          const widest = (r.metaData || []).reduce((n, m) => n + 2 * (Number(m.byteSize) || 64) + 64, 0);
          const per = Math.max(1, Math.min(200, Math.floor(Number(limits.bytes) / 4 / Math.max(1, widest))));
          const rows = [];
          const take = count();
          for (;;) {
            clk.overdue();
            const batch = await rs.getRows(per);
            if (!batch.length) break;
            if (batch.length > per) throw fail('Oracle sent more rows than were asked for.', 500);
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
