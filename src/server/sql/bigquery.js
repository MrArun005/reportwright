// @ts-check
// BigQuery connections: bigquery://PROJECT?keyFile=/path/key.json&location=US&maxBytes=10000000000 — the
// @google-cloud/bigquery package (no keyFile: Application Default Credentials). Not tested against live BigQuery (no
// project was available): the safety logic is unit-tested with a mocked driver (tests/engine/sql-connectors.test.js).
// Guards: a dry run first (no cost): BigQuery's own parse must say the statement type is SELECT, and the bytes it
// would scan must be within maxBytes (default 10 GB); the real job then runs with maximumBytesBilled = maxBytes and a
// job timeout, standard SQL, parameters bound positionally; result pages are read and counted on the client, and the
// job is cancelled at the row or byte cap or the deadline. Give the service account only BigQuery Data Viewer and
// Job User: the dry run is a second guard, not the first.

const DEFAULT_MAX_BYTES = 10e9;

/** @param {string} url */
export function bigqueryConfig(url) {
  const u = new URL(url);
  const q = u.searchParams;
  const maxBytes = q.has('maxBytes') ? Number(q.get('maxBytes')) : DEFAULT_MAX_BYTES;
  return {
    projectId: u.hostname, ...(q.get('keyFile') ? { keyFilename: q.get('keyFile') } : {}),
    location: q.get('location') || undefined, maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES,
  };
}

/** A BigQuery cell as the other drivers give it: dates, times and numerics as their text. */
const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && typeof v.value === 'string' ? v.value : v);

/**
 * @param {string} url @param {string} text @param {any[]} values
 * @param {import('../sql.js').DriverContext} ctx
 */
export async function bigquery(url, text, values, ctx) {
  const { pools, limits, fail, clock, count, driver } = ctx;
  const { maxBytes, ...cfg } = bigqueryConfig(url);
  const key = `bigquery|${url}`;
  if (!pools.has(key)) {
    const mod = await driver('@google-cloud/bigquery', 'BigQuery');
    pools.set(key, new (mod.BigQuery || mod.default.BigQuery)(cfg));
  }
  const bq = pools.get(key);
  // null has no type BigQuery can guess
  const types = values.map(v => (v == null ? 'STRING' : typeof v === 'number' ? (Number.isInteger(v) ? 'INT64' : 'FLOAT64') : typeof v === 'boolean' ? 'BOOL' : 'STRING'));
  const base = { query: text, params: values, types, useLegacySql: false, location: cfg.location };
  const clk = clock(Number(limits.ms));
  let job;
  try {
    return await clk.inTime((async () => {
      const [dry] = await bq.createQueryJob({ ...base, dryRun: true });
      const stats = dry.metadata?.statistics?.query || {};
      if (stats.statementType !== 'SELECT') throw fail('A SQL source can only run one SELECT query.', 400);
      const scan = Number(dry.metadata?.statistics?.totalBytesProcessed ?? stats.totalBytesProcessed);
      if (!Number.isFinite(scan)) throw fail('BigQuery did not say how much the query would read.', 400);
      if (scan > maxBytes) throw fail(`The query would read ${Math.ceil(scan / 1e9)} GB; this connection allows ${Math.round(maxBytes / 1e9 * 10) / 10} GB. Filter it, or select fewer columns.`, 400);
      clk.overdue();
      [job] = await bq.createQueryJob({ ...base, maximumBytesBilled: String(Math.floor(maxBytes)), jobTimeoutMs: Math.max(1000, clk.left()) });
      clk.track({ cancel: () => { job.cancel().catch(() => {}); } });
      const rows = [];
      const take = count();
      let pageToken;
      do {
        clk.overdue();
        // pages of at most 1,000 rows (and BigQuery's own 10 MB a page), so a page never goes far past the cap
        const [page, next] = await job.getQueryResults({ autoPaginate: false, maxResults: 1000, pageToken, timeoutMs: Math.max(1000, clk.left()) });
        for (const r of page) {
          const row = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? v.map(plain) : plain(v)]));
          take(row);
          rows.push(row);
        }
        pageToken = next?.pageToken;
      } while (pageToken);
      return rows;
    })());
  } catch (e) {
    if (job && e.status) /** @type {any} */ (job).cancel().catch(() => {}); // a cap: the rest is never read
    throw e;
  } finally { clk.stop(); }
}
