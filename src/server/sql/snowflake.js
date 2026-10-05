// @ts-check
// Snowflake connections: snowflake://user:password@account/database/schema?warehouse=W&role=R — the snowflake-sdk
// package. Not tested against a live Snowflake account (none was available): the safety logic is unit-tested with a
// mocked driver (tests/engine/sql-connectors.test.js).
// Guards: the connection must name a role (give it read-only grants: USAGE on the warehouse, database and schema, and
// SELECT); the text passes the statement check in sql.js (one statement, no write or session words); the session runs
// one statement per call (MULTI_STATEMENT_COUNT = 1) with Snowflake's own statement timeout; rows are streamed and
// counted on the client, and the statement is cancelled at the row or byte cap or the deadline.

/** @param {string} url */
export function snowflakeConfig(url) {
  const u = new URL(url);
  const q = u.searchParams;
  const [database, schema] = u.pathname.slice(1).split('/').map(decodeURIComponent);
  const role = q.get('role');
  return {
    account: u.hostname, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    ...(database ? { database } : {}), ...(schema ? { schema } : {}),
    ...(q.get('warehouse') ? { warehouse: q.get('warehouse') } : {}), ...(role ? { role } : {}),
    application: 'Pagewright',
  };
}

// The grants a reading role may hold (SHOW GRANTS TO ROLE, followed into every granted role and PUBLIC): anything else
// (OWNERSHIP, CREATE …, USAGE on an integration, function, procedure or stage, SELECT on an external table, …) refuses it.
const ALLOWED = new Set(['USAGE WAREHOUSE', 'USAGE DATABASE', 'USAGE SCHEMA', 'SELECT TABLE', 'SELECT VIEW', 'SELECT MATERIALIZED_VIEW', 'SELECT DYNAMIC_TABLE']);
const PROBE_MS = 60000; // SHOW GRANTS is metadata (no warehouse); once a minute per pool

/** Run one statement on a connection and collect its rows (small: SHOW output). */
const all = (conn, sqlText, binds = []) => new Promise((resolve, reject) => conn.execute({ sqlText, binds, complete: (e, _st, rows) => (e ? reject(e) : resolve(rows || [])) }));

/**
 * What the role can do beyond reading, or ''. Follows granted roles (and PUBLIC, which every role has) to the end.
 * @param {any} conn @param {string} role
 */
export async function probeSnowflake(conn, role, user) {
  // the user's own roles: only the named role (and PUBLIC); any other could be switched on
  if (user) {
    for (const g of await all(conn, 'SHOW GRANTS TO USER IDENTIFIER(?)', [user])) {
      const r = String(g.role || g.name || '').replace(/^"|"$/g, '').toUpperCase();
      if (r && r !== role.toUpperCase() && r !== 'PUBLIC') return `the user also has the role ${r.slice(0, 100)}`;
    }
  }
  const seen = new Set(), todo = [role.toUpperCase(), 'PUBLIC'];
  while (todo.length) {
    const r = todo.shift();
    if (seen.has(r)) continue;
    seen.add(r);
    if (seen.size > 50) return 'more than 50 roles in its hierarchy';
    for (const g of await all(conn, 'SHOW GRANTS TO ROLE IDENTIFIER(?)', [r])) {
      const priv = String(g.privilege || '').toUpperCase(), on = String(g.granted_on || '').toUpperCase().replace(/ /g, '_');
      if (on === 'ROLE' && priv === 'USAGE') { todo.push(String(g.name || '').replace(/^"|"$/g, '').toUpperCase()); continue; }
      if (!ALLOWED.has(`${priv} ${on}`)) return `${r} has ${priv} on ${on} ${String(g.name || '').slice(0, 100)}`;
    }
  }
  return '';
}

/**
 * @param {string} url @param {string} text @param {any[]} values
 * @param {import('../sql.js').DriverContext} ctx
 */
export async function snowflake(url, text, values, ctx) {
  const { pools, limits, fail, clock, count, driver } = ctx;
  const cfg = snowflakeConfig(url);
  if (!cfg.role) throw fail('A Snowflake connection must name a read-only role: add ?role=REPORTING_READER to its URL.', 500);
  const key = `snowflake|${url}`;
  const mod = await driver('snowflake-sdk', 'Snowflake');
  const sf = mod.default || mod;
  if (!pools.has(key)) {
    sf.configure?.({ logLevel: 'OFF' });
    // VARIANT, OBJECT and ARRAY stay text: a parsed JSON value takes many times its size
    pools.set(key, { pool: sf.createPool({ ...cfg, jsonColumnVariantParser: (raw) => raw }, { max: 5, min: 0, acquireTimeoutMillis: 60000 }), checked: 0 });
  }
  const entry = pools.get(key);
  const clk = clock(Number(limits.ms));
  try {
    return await clk.inTime((async () => {
      const conn = await entry.pool.acquire();
      let ok = false;
      try {
        await all(conn, 'USE SECONDARY ROLES NONE'); // on every query: only the named role's grants apply
        if (Date.now() - entry.checked > PROBE_MS) {
          const why = await probeSnowflake(conn, cfg.role, cfg.username);
          if (why) throw fail(`This Snowflake role can do more than read (${why}). Give report connections a role with USAGE and SELECT grants only (see docs/DATA-SQL.md).`, 500);
          entry.checked = Date.now();
        }
        const rows = await run(conn);
        ok = true;
        return rows;
      } finally {
        // a cancelled, capped or failed statement: the connection is destroyed, not pooled
        if (ok) entry.pool.release(conn); else entry.pool.destroy(conn);
      }
    })());
  } finally { clk.stop(); }

  function run(conn) {
    return new Promise((resolve, reject) => {
      const seconds = Math.max(1, Math.ceil(clk.left() / 1000));
      let stmt;
      try { clk.overdue(); } catch (e) { reject(e); return; }
      stmt = conn.execute({
        sqlText: text, binds: values, streamResult: true,
        parameters: { MULTI_STATEMENT_COUNT: 1, STATEMENT_TIMEOUT_IN_SECONDS: seconds },
        complete: (err, st) => {
          if (err) return reject(err);
          const rows = [];
          const take = count();
          const stream = st.streamRows();
          let done = false;
          const stop = (e) => { if (done) return; done = true; stream.destroy(); try { st.cancel(() => {}); } catch { /* finished */ } reject(e); };
          try { clk.track({ cancel: () => stop(clk.late()) }); } catch (e) { stop(e); return; }
          stream.on('data', (row) => { if (done) return; try { take(row); rows.push(row); } catch (e) { stop(e); } });
          stream.on('error', (e) => { if (!done) { done = true; reject(e); } });
          stream.on('end', () => { if (!done) { done = true; resolve(rows); } });
        },
      });
      try { clk.track({ cancel: () => { try { stmt?.cancel(() => {}); } catch { /* finished */ } } }); } catch (e) {
        try { stmt?.cancel(() => {}); } catch { /* finished */ } // the deadline passed while it was sent: cancel it now
        reject(e);
      }
    });
  }
}
