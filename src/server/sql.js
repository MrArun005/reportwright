// @ts-check
// SQL data sources, run on the server only.
// Connections come only from the environment: PW_DB_<NAME>=sqlite:/path/file.db | postgres://… | mysql://… | mssql://…
// A report names a connection; it can never give a host, a password or a file of its own.
// "@name" in the query binds the report parameter "name" through the driver; values never become SQL text.
// Every query runs read-only, as one statement, for at most limits.ms and limits.rows rows.
// Use a database user that can only read: the read-only transaction is a second guard, not the first.
import { readReport } from './reports.js';
import { resolveParameters } from '@/engine/index.js';
import { isoDate } from '@/engine/expr/format.js';

/** Mutable so tests can lower them. */
export const limits = { rows: 100000, ms: 30000 };

/** @param {string} msg @param {number} status */
const fail = (msg, status) => Object.assign(new Error(msg), { status });

/** @param {string} name connection name from the report ("main" → PW_DB_MAIN) */
function connectionUrl(name) {
  if (typeof name !== 'string' || !/^\w{1,64}$/.test(name)) throw fail('Give the SQL source a connection name (letters, digits and _).', 400);
  const key = `PW_DB_${name.toUpperCase()}`;
  const url = process.env[key];
  if (!url) throw fail(`The connection "${name}" is not set up on the server. Set ${key}.`, 400);
  return { url, key };
}

const SCALAR = new Set(['string', 'number', 'boolean']);

/**
 * "@name" → driver placeholders ("?" or "$n"), with the values in order. A list expands to "?, ?, ?";
 * an empty list becomes NULL, so `x in (@list)` matches nothing (and so does `x not in (@list)`).
 * @ inside '…', "…", `…`, -- and /* *\/ is left alone; so is @@var (MySQL system variables).
 * SQL Server: "@pw_1", "@pw_2"… (request inputs); [bracketed names] are left alone too. opt.standIns: instead of
 * placeholders, typed stand-ins with no value in them (CAST(0 AS BIGINT), N'', …), for SQL Server's parse-only check.
 * @param {string} query @param {Record<string, any>} params @param {'sqlite'|'postgres'|'mysql'|'mssql'} dialect
 * @param {{ standIns?: boolean }} [opt]
 */
export function bindSql(query, params, dialect, opt = {}) {
  // MySQL lets a backslash escape a quote inside a string; standard SQL does not
  const str = dialect === 'mysql' ? String.raw`'(?:[^'\\]|\\[\s\S]|'')*'|"(?:[^"\\]|\\[\s\S]|"")*"` : `'(?:[^']|'')*'|"(?:[^"]|"")*"`;
  const brackets = dialect === 'mssql' ? String.raw`\[[^\]]*\]|` : '';
  const re = new RegExp(String.raw`${str}|${brackets}\x60[^\x60]*\x60|--[^\n]*|/\*[\s\S]*?\*/|@@\w+|@([A-Za-z_]\w*)|(\?|(?<![\w$])\$\d+)|[^'"\x60@?$/\[-]+|[\s\S]`, 'g');
  const values = [];
  const ph = () => (dialect === 'postgres' ? `$${values.length}` : dialect === 'mssql' ? `@pw_${values.length}` : '?');
  const standIn = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? 'CAST(0 AS BIGINT)' : 'CAST(0 AS FLOAT)') : typeof v === 'boolean' ? 'CAST(0 AS BIT)' : typeof v === 'string' ? "N''" : 'NULL');
  const one = (v, name) => {
    if (v instanceof Date) v = isoDate(v);
    if (v != null && !SCALAR.has(typeof v)) throw fail(`The parameter "${name}" must be a value or a list of values.`, 400);
    values.push(dialect === 'sqlite' && typeof v === 'boolean' ? Number(v) : v ?? null); // node:sqlite cannot bind booleans
    return opt.standIns ? standIn(v) : ph();
  };
  const text = query.replace(re, (tok, name, raw) => {
    if (raw && (raw !== '?' || dialect !== 'postgres')) throw fail(`Write parameters as @name in the query, not ${raw}.`, 400);
    if (!name) return tok;
    if (!Object.hasOwn(params, name)) throw fail(`The query uses @${name}, but there is no parameter "${name}".`, 400);
    const v = params[name];
    if (!Array.isArray(v)) return one(v, name);
    return v.length ? v.map(x => one(x, name)).join(', ') : 'NULL';
  });
  return { text, values };
}

/** JSON-safe cells: BigInt → number when exact, else a string; Date → ISO text. */
const cell = (v) => (typeof v === 'bigint' ? (Number.isSafeInteger(Number(v)) ? Number(v) : String(v)) : v instanceof Date ? v.toISOString() : v);
const plainRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)]));

/**
 * Run a query on a connection from the environment.
 * @param {{ connection: string, query: string }} src
 * @param {Record<string, any>} [params] report parameters (lists are arrays)
 * @returns {Promise<object[]>}
 */
export async function runSql({ connection, query }, params = {}) {
  const { url, key } = connectionUrl(connection);
  if (typeof query !== 'string' || !query.trim()) throw fail('The SQL source has no query.', 400);
  // first guard: a report reads data. (WITH … UPDATE passes this; the read-only transaction stops it.)
  if (!/^[\s(]*(select|with)\b/i.test(query.replace(/^(\s*(--[^\n]*|\/\*[\s\S]*?\*\/))+/, ''))) throw fail('A SQL source can only run a SELECT query.', 400);
  const dialect = kindOf(url);
  if (dialect === 'unknown') throw fail(`${key} must start with sqlite:, postgres://, mysql:// or mssql://.`, 500);
  const { text, values } = bindSql(query, params, dialect);
  let rows;
  try {
    rows = await DRIVERS[dialect](url, text, values, dialect === 'mssql' ? bindSql(query, params, dialect, { standIns: true }).text : '');
  } catch (e) {
    if (TIMEOUT_CODES.has(e.code)) throw fail(`The query ran longer than ${limits.ms / 1000} s.`, 504);
    throw e;
  }
  if (rows.length > limits.rows) throw fail(`The query returned more than ${limits.rows} rows. Filter or group it in SQL.`, 400);
  return rows.map(plainRow);
}

// Postgres query_canceled, MySQL max_execution_time, MariaDB max_statement_time, SQL Server request timeout
const TIMEOUT_CODES = new Set(['57014', 'ER_QUERY_TIMEOUT', 'ER_STATEMENT_TIMEOUT', 'ETIMEOUT']);

/** @returns {'sqlite'|'postgres'|'mysql'|'mssql'|'unknown'} */
const kindOf = (v) => (/^sqlite:/.test(v) ? 'sqlite' : /^postgres(ql)?:\/\//.test(v) ? 'postgres' : /^mysql:\/\//.test(v) ? 'mysql' : /^mssql:\/\//.test(v) ? 'mssql' : 'unknown');

/**
 * mssql://user:password@host[:port]/database[?encrypt=false&trustServerCertificate=true&instance=NAME] → a config
 * for the mssql package. User and password are percent-decoded. Encryption is on by default.
 * @param {string} url
 */
export function mssqlConfig(url) {
  const u = new URL(url);
  const q = u.searchParams;
  const flag = (k, d) => (q.has(k) ? q.get(k) === 'true' || q.get(k) === '1' : d);
  return {
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), server: u.hostname,
    port: u.port ? Number(u.port) : 1433, database: decodeURIComponent(u.pathname.slice(1)) || undefined,
    options: { encrypt: flag('encrypt', true), trustServerCertificate: flag('trustServerCertificate', false), ...(q.get('instance') ? { instanceName: q.get('instance') } : {}) },
  };
}

/** The connections set up on this server: names and kinds only (the URLs hold passwords). */
export function listConnections() {
  return Object.entries(process.env)
    .filter(([k, v]) => /^PW_DB_\w+$/.test(k) && v)
    .map(([k, v]) => ({ name: k.slice(6).toLowerCase(), kind: kindOf(v) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Try a connection with a read-only "select 1". Errors never show the connection URL. */
export async function testConnection(name) {
  const t0 = Date.now();
  try {
    await runSql({ connection: name, query: 'select 1 as ok' }, {});
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    let msg = String(e.message || e);
    const url = process.env[`PW_DB_${String(name).toUpperCase()}`];
    if (url) for (const part of [url, url.replace(/^sqlite:/, ''), ...url.split(/[/@:?&=]/).filter(x => x.length > 3).flatMap(x => { try { return [x, decodeURIComponent(x)]; } catch { return [x]; } })]) msg = msg.split(part).join('…');
    return { ok: false, ms: Date.now() - t0, error: msg };
  }
}

/**
 * Run the query saved in a report: the client names the report and the source, never the SQL.
 * Parameters get the report's defaults and types, as in a render.
 * @param {string} reportId "id" or "id@version" @param {string} sourceName @param {Record<string, any>} [given]
 */
export async function runSavedSql(reportId, sourceName, given = {}) {
  const def = await readReport(reportId);
  if (!def) throw fail(`Report "${reportId}" not found.`, 404);
  const src = (def.dataSources || []).find(s => s.name === sourceName && s.type === 'sql');
  if (!src) throw fail(`The report "${reportId}" has no SQL source "${sourceName}".`, 404);
  return runSql(src, resolveParameters(def, given, { lenient: true }));
}

/* ---------------- drivers: each returns at most limits.rows + 1 rows ---------------- */

/** @type {Map<string, any>} one pool per connection URL, kept across hot reloads */
const pools = (/** @type {any} */ (globalThis).__pwSqlPools ||= new Map());

/** pg and mysql2 are optional: load them only when a connection needs them. */
async function driver(pkg, kind) {
  try {
    return await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pkg);
  } catch {
    const name = pkg.split('/')[0];
    throw fail(`Install ${name} to use ${kind} connections: npm install ${name}`, 500);
  }
}

const DRIVERS = {
  // ponytail: node:sqlite is synchronous, so a slow query holds the server's event loop and the time limit
  // cannot stop it. Fine for a local file; move it to a worker thread if big SQLite files appear.
  async sqlite(url, text, values) {
    const { DatabaseSync } = /** @type {typeof import('node:sqlite')} */ (process.getBuiltinModule('node:sqlite'));
    const db = new DatabaseSync(url.slice('sqlite:'.length), { readOnly: true });
    try {
      const st = db.prepare(text);
      st.setReadBigInts(true);
      const rows = [];
      for (const r of st.iterate(...values)) if (rows.push(r) > limits.rows) break;
      return rows;
    } finally { db.close(); }
  },

  async postgres(url, text, values) {
    if (!pools.has(url)) {
      const pg = (await driver('pg', 'postgres')).default;
      // DATE and TIMESTAMP (no zone) stay as written: a JS Date would move them to the server's time zone
      const raw = new Set([1082, 1114]);
      const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10000, types: { getTypeParser: (oid, fmt) => (raw.has(oid) ? (v) => v : pg.types.getTypeParser(oid, fmt)) } });
      pool.on('error', () => {}); // an idle client that drops must not crash the server
      pools.set(url, pool);
    }
    const c = await pools.get(url).connect();
    try {
      await c.query('BEGIN READ ONLY');
      await c.query(`SET LOCAL statement_timeout = ${Number(limits.ms)}`);
      // extended protocol: one statement only, so "…; COMMIT; DELETE …" cannot end the read-only transaction.
      // A cursor fetches at most limits.rows + 1 rows, however many the query would return.
      await c.query({ text: `DECLARE pw_rows NO SCROLL CURSOR FOR ${text}`, values, queryMode: 'extended' });
      return (await c.query(`FETCH ${Number(limits.rows) + 1} FROM pw_rows`)).rows;
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  },

  // Not tested against a live MySQL server yet (none was available); the SQLite and Postgres paths are.
  async mysql(url, text, values) {
    if (!pools.has(url)) {
      const mysql = (await driver('mysql2/promise', 'mysql')).default;
      pools.set(url, mysql.createPool({ uri: url, connectionLimit: 5, connectTimeout: 10000, dateStrings: true, supportBigNumbers: true }));
    }
    const c = await pools.get(url).getConnection();
    try {
      // session-wide too: DDL commits the transaction it runs in, and a read-only session still refuses it
      await c.query('SET SESSION TRANSACTION READ ONLY');
      await c.query(`SET SESSION sql_select_limit = ${Number(limits.rows) + 1}`);
      await c.query(`SET SESSION max_execution_time = ${Number(limits.ms)}`).catch(() => c.query(`SET SESSION max_statement_time = ${Number(limits.ms) / 1000}`)); // MySQL, else MariaDB
      await c.query('START TRANSACTION READ ONLY');
      const [rows] = await c.execute(text, values); // a server-side prepared statement: one statement, values bound
      return rows;
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  },

  // SQL Server has no read-only transaction and needs no ";" between statements, so a text check cannot tell one
  // statement from two. The server itself parses the query first (SHOWPLAN_XML: compiled, not run) and it must be
  // exactly one SELECT. Then it runs inside a transaction that is always rolled back, with SET ROWCOUNT as the row cap
  // and the pool's request timeout as the time limit.
  async mssql(url, text, values, check) {
    const key = `${url}|${limits.ms}`;
    const sql = (await driver('mssql', 'SQL Server')).default;
    if (!pools.has(key)) {
      const pool = new sql.ConnectionPool({ ...mssqlConfig(url), pool: { max: 5 }, connectionTimeout: 10000, requestTimeout: Number(limits.ms) });
      pool.on('error', () => {});
      pools.set(key, pool.connect().catch((e) => { pools.delete(key); throw e; }));
    }
    const tx = new sql.Transaction(await pools.get(key));
    await tx.begin();
    const req = () => new sql.Request(tx);
    try {
      await req().batch('SET SHOWPLAN_XML ON');
      let plan;
      try { plan = await req().batch(check); } finally { await req().batch('SET SHOWPLAN_XML OFF'); }
      const types = (plan.recordsets || []).flatMap(rs => rs.flatMap(r => [...String(Object.values(r)[0]).matchAll(/<Stmt\w+ [^>]*?StatementType="([^"]+)"/g)].map(m => m[1])));
      if (types.length !== 1 || !/^SELECT( WITHOUT QUERY)?$/.test(types[0])) throw fail('A SQL source can only run one SELECT query (one statement).', 400);
      await req().batch(`SET ROWCOUNT ${Number(limits.rows) + 1}`);
      try {
        const r = req();
        values.forEach((v, i) => r.input(`pw_${i + 1}`, mssqlType(sql, v), v));
        const out = await r.query(text);
        const cols = Object.values(out.recordset?.columns || {});
        return (out.recordset || []).map(row => { for (const c of cols) row[c.name] = mssqlCell(sql, c.type, row[c.name]); return row; });
      } finally { await req().batch('SET ROWCOUNT 0').catch(() => {}); }
    } finally { await tx.rollback().catch(() => {}); }
  },
};

/** The SQL Server type of a bound value. */
function mssqlType(sql, v) {
  if (typeof v === 'number') return Number.isInteger(v) ? (Math.abs(v) <= 2147483647 ? sql.Int : sql.BigInt) : sql.Float;
  if (typeof v === 'boolean') return sql.Bit;
  return sql.NVarChar(sql.MAX);
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Cells as the other drivers give them: BIGINT a number when exact; DATE as written; DATETIME without a zone. */
function mssqlCell(sql, type, v) {
  if (v == null) return v;
  if (type === sql.BigInt && typeof v === 'string') return Number.isSafeInteger(Number(v)) ? Number(v) : v;
  if (v instanceof Date) {
    const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    if (type === sql.Date) return d;
    if (type === sql.DateTime || type === sql.DateTime2 || type === sql.SmallDateTime) return `${d}T${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}.${pad(v.getUTCMilliseconds(), 3)}`;
  }
  return v;
}
