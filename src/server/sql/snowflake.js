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
    pools.set(key, sf.createPool(cfg, { max: 5, min: 0, acquireTimeoutMillis: 60000 }));
  }
  const clk = clock(Number(limits.ms));
  try {
    return await clk.inTime(pools.get(key).use((conn) => new Promise((resolve, reject) => {
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
      clk.track({ cancel: () => { try { stmt?.cancel(() => {}); } catch { /* finished */ } } });
    })));
  } finally { clk.stop(); }
}
