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
 * SQL Server: "@pw_1", "@pw_2"… (request inputs), found by a T-SQL scanner (tsqlParts).
 * @param {string} query @param {Record<string, any>} params @param {'sqlite'|'postgres'|'mysql'|'mssql'} dialect
 */
export function bindSql(query, params, dialect) {
  if (dialect === 'mssql') return bindTsql(query, params);
  // MySQL lets a backslash escape a quote inside a string; standard SQL does not
  const str = dialect === 'mysql' ? String.raw`'(?:[^'\\]|\\[\s\S]|'')*'|"(?:[^"\\]|\\[\s\S]|"")*"` : `'(?:[^']|'')*'|"(?:[^"]|"")*"`;
  const re = new RegExp(String.raw`${str}|\x60[^\x60]*\x60|--[^\n]*|/\*[\s\S]*?\*/|@@\w+|@([A-Za-z_]\w*)|(\?|(?<![\w$])\$\d+)|[^'"\x60@?$/-]+|[\s\S]`, 'g');
  const values = [];
  const ph = () => (dialect === 'postgres' ? `$${values.length}` : '?');
  const one = (v, name) => {
    values.push(bindValue(v, name, dialect));
    return ph();
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

/** A value as the driver binds it. */
function bindValue(v, name, dialect) {
  if (v instanceof Date) v = isoDate(v);
  if (v != null && !SCALAR.has(typeof v)) throw fail(`The parameter "${name}" must be a value or a list of values.`, 400);
  return dialect === 'sqlite' && typeof v === 'boolean' ? Number(v) : v ?? null; // node:sqlite cannot bind booleans
}

/**
 * T-SQL split into code and the rest, exactly as SQL Server reads it: -- comments; /* *\/ comments, which NEST;
 * '…' and N'…' strings ('' inside); "…" identifiers ("" inside); […] identifiers (]] inside). Anything left open
 * (a comment, string or name with no end) is refused, so this scanner and the server never disagree on where code is.
 * @param {string} q @returns {{ code: boolean, text: string }[]}
 */
export function tsqlParts(q) {
  const out = [];
  let i = 0, start = 0;
  const push = (code, end) => { if (end > start) out.push({ code, text: q.slice(start, end) }); start = end; };
  const open = () => fail('The query has a comment, string or [name] that does not end.', 400);
  while (i < q.length) {
    const c = q[i], d = q[i + 1];
    if (c === '-' && d === '-') {
      push(true, i);
      const e = q.indexOf('\n', i);
      i = e < 0 ? q.length : e;
      push(false, i);
    } else if (c === '/' && d === '*') {
      push(true, i);
      let depth = 0;
      while (i < q.length) {
        if (q[i] === '/' && q[i + 1] === '*') { depth++; i += 2; } else if (q[i] === '*' && q[i + 1] === '/') { depth--; i += 2; if (!depth) break; } else i++;
      }
      if (depth) throw open();
      push(false, i);
    } else if (c === "'" || c === '"' || c === '[') {
      push(true, i);
      const end = c === '[' ? ']' : c;
      i++;
      for (;;) {
        if (i >= q.length) throw open();
        if (q[i] === end) { if (q[i + 1] === end) { i += 2; continue; } i++; break; }
        i++;
      }
      push(false, i);
    } else i++;
  }
  push(true, i);
  return out;
}

// Words that never belong in a report's SELECT. A second check, beside the server's own parse (SHOWPLAN): both must pass.
const TSQL_DENY = new Set(['SET', 'DECLARE', 'EXEC', 'EXECUTE', 'SP_EXECUTESQL', 'GO', 'USE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVE', 'TRAN', 'TRANSACTION',
  'WAITFOR', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'INTO', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE', 'DENY', 'BACKUP', 'RESTORE',
  'KILL', 'SHUTDOWN', 'DBCC', 'RECONFIGURE', 'OPENROWSET', 'OPENQUERY', 'OPENDATASOURCE', 'OPENXML', 'BULK', 'PRINT', 'RAISERROR', 'THROW', 'GOTO',
  'RETURN', 'IF', 'WHILE', 'CHECKPOINT', 'READTEXT', 'WRITETEXT', 'UPDATETEXT', 'SETUSER', 'REVERT']);
// letters, digits, @ $ # _ make one word in T-SQL; a word after @ is a variable
const TSQL_WORD = /(?<![\w@$#])(@@?)?([A-Za-z_][\w@$#]*)/g;

/** @name → @pw_n in code only; a word from TSQL_DENY anywhere in code → refused. */
function bindTsql(query, params) {
  const values = [];
  const text = tsqlParts(query).map(({ code, text: t }) => (!code ? t : t.replace(TSQL_WORD, (m, at, word) => {
    if (at === '@@') return m;
    if (!at) {
      if (TSQL_DENY.has(word.toUpperCase())) throw fail(`A SQL source can only run one SELECT query: "${word}" is not allowed.`, 400);
      return m;
    }
    if (!Object.hasOwn(params, word)) throw fail(`The query uses @${word}, but there is no parameter "${word}".`, 400);
    const v = params[word];
    const one = (x) => { values.push(bindValue(x, word, 'mssql')); return `@pw_${values.length}`; };
    if (!Array.isArray(v)) return one(v);
    return v.length ? v.map(one).join(', ') : 'NULL';
  }))).join('');
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
    rows = await DRIVERS[dialect](url, text, values);
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

  // SQL Server. Give the connection a login that can only read (db_datareader, no other rights): that is the guard
  // that holds. What follows is a second one. SQL Server has no read-only transaction and needs no ";" between
  // statements, so a report's text is checked twice: no statement keyword outside strings and comments (bindTsql),
  // and the server compiles the EXACT text that will run, with the same @pw_n declared, under SHOWPLAN_XML (compiled,
  // not run): the plan must list exactly one statement, a SELECT. Anything else, or a plan this code does not
  // recognise, is refused. It then runs in a transaction that is always rolled back, under SET ROWCOUNT (the row
  // cap) and the pool's request timeout (the time limit).
  async mssql(url, text, values) {
    const key = `mssql|${url}`;
    const sql = (await driver('mssql', 'SQL Server')).default;
    // the time limit is the pool's request timeout: when limits.ms changes, the old pool is closed, not kept
    if (pools.get(key)?.ms !== limits.ms) {
      pools.get(key)?.ready.then(p => p.close()).catch(() => {});
      const pool = new sql.ConnectionPool({ ...mssqlConfig(url), pool: { max: 5 }, connectionTimeout: 10000, requestTimeout: Number(limits.ms) });
      pool.on('error', () => {});
      const ready = pool.connect();
      ready.catch(() => { if (pools.get(key)?.ready === ready) pools.delete(key); }); // handled at once: no unhandled rejection
      pools.set(key, { ms: limits.ms, ready });
    }
    const types = values.map(v => mssqlType(sql, v));
    const tx = new sql.Transaction(await pools.get(key).ready);
    await tx.begin();
    const req = () => new sql.Request(tx);
    try {
      await req().batch('SET SHOWPLAN_XML ON');
      let plan;
      try {
        const decl = types.length ? `DECLARE ${types.map((t, i) => `@pw_${i + 1} ${t.decl}`).join(', ')};\n` : '';
        plan = await req().batch(decl + text);
      } catch (e) {
        throw e.status ? e : fail(`SQL Server cannot compile the query: ${String(e.message || e).slice(0, 300)}`, 400);
      } finally { await req().batch('SET SHOWPLAN_XML OFF'); }
      if (!isOneSelect(plan)) throw fail('A SQL source can only run one SELECT query (one statement).', 400);
      await req().batch(`SET ROWCOUNT ${Number(limits.rows) + 1}`);
      try {
        const r = req();
        values.forEach((v, i) => r.input(`pw_${i + 1}`, types[i].type, v));
        const out = await r.query(text);
        if ((out.recordsets || []).length !== 1) throw fail('A SQL source can only run one SELECT query (one statement).', 400);
        const cols = Object.values(out.recordset?.columns || {});
        return (out.recordset || []).map(row => { for (const c of cols) row[c.name] = mssqlCell(sql, c.type, row[c.name]); return row; });
      } finally { await req().batch('SET ROWCOUNT 0').catch(() => {}); }
    } finally { await tx.rollback().catch(() => {}); }
  },
};

/**
 * True only for a SHOWPLAN_XML result of exactly one plan document holding exactly one statement element, a
 * StmtSimple whose StatementType is a read: SELECT, SELECT WITHOUT QUERY (constants), XML SELECT or JSON SELECT
 * (FOR XML / FOR JSON). Fails closed.
 * @param {any} plan the batch result
 */
const SELECT_TYPES = new Set(['SELECT', 'SELECT WITHOUT QUERY', 'XML SELECT', 'JSON SELECT']);
export function isOneSelect(plan) {
  const sets = plan?.recordsets || [];
  if (sets.length !== 1 || sets[0].length !== 1) return false;
  const cells = Object.values(sets[0][0] || {});
  if (cells.length !== 1 || typeof cells[0] !== 'string') return false;
  const xml = cells[0];
  if (!/^\s*(<\?xml[^>]*\?>\s*)?<ShowPlanXML[\s>]/.test(xml) || (xml.match(/<ShowPlanXML[\s>]/g) || []).length !== 1) return false;
  if ((xml.match(/<Batch[\s>]/g) || []).length !== 1) return false;
  const stmts = xml.match(/<Stmt[A-Za-z]*[\s>/]/g) || [];
  if (stmts.length !== 1 || !stmts[0].startsWith('<StmtSimple')) return false;
  const tag = xml.slice(xml.indexOf('<StmtSimple')).match(/^<StmtSimple(\s[^>]*)?>/);
  if (!tag) return false;
  const types = [...(tag[1] || '').matchAll(/\sStatementType="([^"]*)"/g)].map(m => m[1]);
  return types.length === 1 && SELECT_TYPES.has(types[0]);
}

/** The SQL Server type of a bound value, for the request input and for the DECLARE in the parse-only check. */
function mssqlType(sql, v) {
  if (typeof v === 'number') return Number.isInteger(v) ? (Math.abs(v) <= 2147483647 ? { type: sql.Int, decl: 'INT' } : { type: sql.BigInt, decl: 'BIGINT' }) : { type: sql.Float, decl: 'FLOAT' };
  if (typeof v === 'boolean') return { type: sql.Bit, decl: 'BIT' };
  return { type: sql.NVarChar(sql.MAX), decl: 'NVARCHAR(MAX)' };
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
