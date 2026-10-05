// @ts-check
// SQL data sources, run on the server only.
// Connections come only from the environment: PW_DB_<NAME>=sqlite:/path/file.db | postgres://… | mysql://… | mssql://…
//   | oracle://… | snowflake://… | bigquery://… (drivers in ./sql/). PW_DB_<NAME>_PROCS=a,b allow-lists stored procedures.
// A report names a connection; it can never give a host, a password or a file of its own.
// "@name" in the query binds the report parameter "name" through the driver; values never become SQL text.
// Every query runs read-only, as one statement, for at most limits.ms and limits.rows rows.
// Use a database user that can only read: the read-only transaction is a second guard, not the first.
import { readRunnable, defaultPrincipal } from './perms.js';
import { resolveParameters } from '@/engine/index.js';
import { isoDate } from '@/engine/expr/format.js';
import crypto from 'node:crypto';
import { codeOnly, assertCalls, visibleName } from './sql/check.js';
import { oracle } from './sql/oracle.js';
import { snowflake } from './sql/snowflake.js';
import { bigquery } from './sql/bigquery.js';

/** Mutable so tests can lower them. */
export const limits = { rows: 100000, ms: 30000, bytes: 64 * 1024 * 1024 };

/** @param {string} msg @param {number} status */
const fail = (msg, status) => Object.assign(new Error(msg), { status });

/** @param {string} name connection name from the report ("main" → PW_DB_MAIN) */
function connectionUrl(name) {
  if (typeof name !== 'string' || !/^\w{1,64}$/.test(name) || /_procs$/i.test(name)) throw fail('Give the SQL source a connection name (letters, digits and _).', 400);
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
 * Oracle: ":1", ":2"…; Snowflake and BigQuery: "?".
 * @param {string} query @param {Record<string, any>} params @param {Dialect} dialect
 */
export function bindSql(query, params, dialect) {
  if (dialect === 'mssql') return bindTsql(query, params);
  // MySQL, Snowflake and BigQuery let a backslash escape a quote inside a string; standard SQL does not
  const str = ['mysql', 'snowflake', 'bigquery'].includes(dialect) ? String.raw`'(?:[^'\\]|\\[\s\S]|'')*'|"(?:[^"\\]|\\[\s\S]|"")*"` : `'(?:[^']|'')*'|"(?:[^"]|"")*"`;
  const re = new RegExp(String.raw`${str}|\x60[^\x60]*\x60|--[^\n]*|/\*[\s\S]*?\*/|@@\w+|@([A-Za-z_]\w*)|(\?|(?<![\w$])\$\d+)|[^'"\x60@?$/-]+|[\s\S]`, 'g');
  const values = [];
  const ph = () => (dialect === 'postgres' ? `$${values.length}` : dialect === 'oracle' ? `:${values.length}` : '?');
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
      const e = q.slice(i).search(/[\r\n]/); // SQL Server ends a -- comment at a CR as well as an LF
      i = e < 0 ? q.length : i + e;
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
 * Run a query, or an allow-listed stored procedure, on a connection from the environment.
 * @param {{ connection: string, query?: string, procedure?: string, args?: { name: string, param: string }[] }} src
 * @param {Record<string, any>} [params] report parameters (lists are arrays)
 * @returns {Promise<object[]>}
 */
export async function runSql({ connection, query, procedure, args }, params = {}) {
  const { url, key } = connectionUrl(connection);
  const dialect = kindOf(url);
  if (dialect === 'unknown') throw fail(`${key} must start with sqlite:, postgres://, mysql://, mssql://, oracle://, snowflake:// or bigquery://.`, 500);
  let text, values, names = [], code = '';
  if (procedure != null && procedure !== '') ({ text, values, names = [] } = procCall(connection, dialect, procedure, args, params));
  else {
    if (typeof query !== 'string' || !query.trim()) throw fail('The SQL source has no query.', 400);
    // a huge text costs the database server time to compile, and a cancel does not always stop a compile
    if (query.length > MAX_QUERY) throw fail(`The query is longer than ${MAX_QUERY / 1000}k characters.`, 400);
    // first guard: a report reads data. (WITH … UPDATE passes this; the read-only transaction stops it.)
    if (!/^[\s(]*(select|with)\b/i.test(query.replace(/^(\s*(--[^\n]*|\/\*[\s\S]*?\*\/))+/, ''))) throw fail('A SQL source can only run a SELECT query.', 400);
    ({ text, values } = bindSql(query, params, dialect));
    // every dialect: one statement, no write or session words, only built-in functions (a second guard beside each
    // database's own: the read-only login, the server's parse, the read-only transaction, the dry run)
    code = assertOneRead(text, dialect);
  }
  let rows;
  try {
    rows = await DRIVERS[dialect](url, text, values, { ...driverContext, code, allowed: procsOf(connection), procedure: procedure ? { name: text, names } : null });
  } catch (e) {
    if (TIMEOUT_CODES.has(e.code)) throw fail(`The query ran longer than ${limits.ms / 1000} s.`, 504);
    // the report author sees this message: never the connection URL or a part of it (the password)
    // cut after scrubbing (a cut first could leave half a password); a server message can repeat a long value
    throw Object.assign(new Error(scrub(String(e.message || e), url).slice(0, MAX_ERROR)), { status: e.status, code: e.code });
  }
  if (rows.length > limits.rows) throw fail(`The query returned more than ${limits.rows} rows. Filter or group it in SQL.`, 400);
  // the row cap does not bound one huge value (string_agg, FOR JSON in a subquery, repeat()): count the text too
  // ponytail: counted after the driver has the rows (SQLite, Postgres, MySQL); the other drivers count as they read
  let bytes = 0;
  for (const r of rows) for (const v of Object.values(r)) bytes += sizeOf(v);
  if (bytes > limits.bytes) throw fail(`The query returned more than ${Math.round(limits.bytes / 1048576)} MB. Filter or group it in SQL.`, 400);
  return rows.map(plainRow);
}

/** @typedef {'sqlite'|'postgres'|'mysql'|'mssql'|'oracle'|'snowflake'|'bigquery'} Dialect */

/* ---------------- statement check (every dialect; see ./sql/check.js) ---------------- */

export { codeOnly, assertCalls };

// statement words that never belong in a report's SELECT (outside strings and comments): the grammar, not a list of
// bad functions (calls are checked against an allow-list in assertCalls)
const READ_DENY = /\b(insert|update|delete|merge|upsert|create|drop|alter|truncate|rename|grant|revoke|call|exec|execute|begin|commit|rollback|savepoint|copy|put|remove|unload|use|set|unset|declare|lock|undrop|into|export|load|procedure|function|transaction|outfile|dumpfile|infile)\b/i;

/** T-SQL code from tsqlParts (nested comments, [names]): strings blanked, names kept as their text. */
const tsqlCode = (q) => tsqlParts(q).map(p => (p.code ? p.text : /^\/\*/.test(p.text) && p.text.slice(2, -2).includes('/*') ? (() => { throw fail('A SQL source cannot use nested comments.', 400); })() : /^[[\x22]/.test(p.text) ? ` ${visibleName(p.text.slice(1, -1))} ` : /^(--|\/\*)/.test(p.text) ? ' ' : ' x ')).join('');

/**
 * One statement (a trailing ";" at most), no statement word from READ_DENY in code, every call an allowed built-in,
 * and no @name left (Oracle database links, Snowflake stages). @returns {string} the code
 * @param {string} text the bound text @param {Dialect} dialect
 */
export function assertOneRead(text, dialect) {
  const code = dialect === 'mssql' ? tsqlCode(text) : codeOnly(text, dialect);
  // fail closed: braces ({fn …}) and anything outside printable ASCII in code (lookalikes, Unicode spaces, controls)
  if (/[{}]|[^\x09\x0a\x0d\x20-\x7e]/.test(code)) throw fail('A SQL source cannot use { } or characters outside plain ASCII except inside strings.', 400);
  if (code.replace(/[;\s]+$/, '').includes(';')) throw fail('A SQL source can only run one SELECT query (one statement).', 400);
  const word = READ_DENY.exec(code);
  if (word) throw fail(`A SQL source can only run one SELECT query: "${word[1]}" is not allowed.`, 400);
  if ((dialect === 'oracle' || dialect === 'snowflake') && code.includes('@')) throw fail('A SQL source cannot use a database link or a stage (@).', 400);
  assertCalls(code, dialect);
  return code;
}

/* ---------------- stored procedures (opt-in per connection) ---------------- */

const PROC_NAME = /^[A-Za-z_][\w$#]{0,127}(\.[A-Za-z_][\w$#]{0,127})?$/;
/** "dbo.Sales" → "dbo.sales": the name as the allow-list compares it (schema dbo when SQL Server gets none). */
const procName = (n) => String(n).trim().toLowerCase();

/** The procedures PW_DB_<NAME>_PROCS allows on a connection ([] when none: the default). */
export function procsOf(connection) {
  const v = process.env[`PW_DB_${String(connection).toUpperCase()}_PROCS`] || '';
  return v.split(',').map(x => x.trim()).filter(x => PROC_NAME.test(x));
}

/** The call text and bound values for an allow-listed procedure. Arguments are report parameters, bound by the driver. */
function procCall(connection, dialect, procedure, args, params) {
  if (typeof procedure !== 'string' || !PROC_NAME.test(procedure.trim())) throw fail('Give the stored procedure as name or schema.name.', 400);
  const allowed = procsOf(connection);
  if (!allowed.some(p => procName(p) === procName(procedure))) throw fail(`The procedure "${procedure.slice(0, 128)}" is not allowed on this connection. The admin lists allowed ones in PW_DB_${String(connection).toUpperCase()}_PROCS.`, 400);
  const list = args == null ? [] : args;
  if (!Array.isArray(list) || list.length > 100) throw fail('The procedure arguments must be a list of { name, param }.', 400);
  const values = [], names = [];
  for (const a of list) {
    if (!a || typeof a.name !== 'string' || !/^@?[A-Za-z_]\w{0,127}$/.test(a.name)) throw fail('Each procedure argument needs a name (letters, digits and _).', 400);
    if (typeof a.param !== 'string' || !Object.hasOwn(params, a.param)) throw fail(`The procedure argument "${a.name}" uses the report parameter "${String(a.param).slice(0, 64)}", which does not exist.`, 400);
    const v = params[a.param];
    if (Array.isArray(v)) throw fail(`The report parameter "${a.param}" is a list; a procedure argument takes one value.`, 400);
    values.push(bindValue(v, a.param, dialect));
    names.push(a.name.replace(/^@/, ''));
  }
  const name = procedure.trim();
  if (dialect === 'mssql') return { text: name, values, names };
  if (dialect === 'postgres') return { text: `SELECT * FROM ${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`, values };
  if (dialect === 'mysql' || dialect === 'snowflake') return { text: `CALL ${name}(${values.map(() => '?').join(', ')})`, values };
  throw fail(`Stored procedures are not supported on ${dialect} connections.`, 400);
}

const MAX_ERROR = 1000, MAX_QUERY = 100000;
// Postgres query_canceled, MySQL max_execution_time, MariaDB max_statement_time, SQL Server request timeout
const TIMEOUT_CODES = new Set(['57014', 'ER_QUERY_TIMEOUT', 'ER_STATEMENT_TIMEOUT', 'ETIMEOUT']);

/** @returns {Dialect|'unknown'} */
const kindOf = (v) => (/^sqlite:/.test(v) ? 'sqlite' : /^postgres(ql)?:\/\//.test(v) ? 'postgres' : /^(mysql|mssql|oracle|snowflake|bigquery):\/\//.exec(v)?.[1] ?? 'unknown');

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
    .filter(([k, v]) => /^PW_DB_\w+$/.test(k) && !/_PROCS$/.test(k) && v)
    .map(([k, v]) => ({ name: k.slice(6).toLowerCase(), kind: kindOf(v), procs: procsOf(k.slice(6)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A message with the connection URL and its parts (user, password, host) taken out. */
function scrub(msg, url) {
  for (const part of [url, url.replace(/^sqlite:/, ''), ...url.split(/[/@:?&=]/).filter(x => x.length > 3).flatMap(x => { try { return [x, decodeURIComponent(x)]; } catch { return [x]; } })]) msg = msg.split(part).join('…');
  return msg;
}

/** Try a connection with a read-only "select 1". Errors never show the connection URL. */
export async function testConnection(name) {
  const t0 = Date.now();
  try {
    await runSql({ connection: name, query: 'select 1 as ok' }, {});
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    const url = process.env[`PW_DB_${String(name).toUpperCase()}`];
    const msg = url ? scrub(String(e.message || e), url) : String(e.message || e);
    return { ok: false, ms: Date.now() - t0, error: msg };
  }
}

/**
 * Run the query saved in a report: the client names the report and the source, never the SQL.
 * Parameters get the report's defaults and types, as in a render. Only for a principal that may view the report.
 * @param {string} reportId "id" or "id@version" @param {string} sourceName @param {Record<string, any>} [given]
 * @param {import('./perms.js').Principal} [principal]
 */
export async function runSavedSql(reportId, sourceName, given = {}, principal = defaultPrincipal()) {
  let def;
  try { def = await readRunnable(principal, reportId); } catch (e) { throw e.status === 404 ? fail(`Report "${reportId}" not found.`, 404) : e; }
  const src = (def.dataSources || []).find(s => s.name === sourceName && s.type === 'sql');
  if (!src) throw fail(`The report "${reportId}" has no SQL source "${sourceName}".`, 404);
  return runSql(src, resolveParameters(def, given, { lenient: true }));
}

/* ---------------- drivers: each returns at most limits.rows + 1 rows ---------------- */

/**
 * A counter for drivers that read row by row: `take(row)` refuses the row past limits.rows or the byte past
 * limits.bytes; `take.reserve(n)` refuses a value of n bytes before it is read.
 */
function count() {
  let n = 0, bytes = 0;
  const big = () => fail(`The query returned more than ${Math.round(limits.bytes / 1048576)} MB. Filter or group it in SQL.`, 400);
  const take = (row) => {
    if (++n > limits.rows) throw fail(`The query returned more than ${limits.rows} rows. Filter or group it in SQL.`, 400);
    for (const v of Object.values(row)) bytes += sizeOf(v);
    if (bytes > limits.bytes) throw big();
  };
  take.reserve = (more) => { if (!(bytes + more <= limits.bytes)) throw big(); };
  return take;
}

/**
 * What a driver in ./sql/ gets besides the text: the shared pools, the caps, and the helpers that enforce them.
 * @typedef {{ pools: Map<string, any>, limits: typeof limits, fail: typeof fail, clock: typeof clock, count: typeof count,
 *   driver: typeof driver, code: string, allowed: string[], procedure: null | { name: string, names: string[] } }} DriverContext
 */

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

/**
 * Run `work` while counting the bytes the connection's socket receives: past half of limits.bytes (text arrives as
 * UTF-8 and is held as 2 bytes a character, so half on the wire is the most a result within the cap can need), or at
 * the deadline, the socket is destroyed, so the driver never buffers more, and the work fails with the cap's error
 * (marked `wire`: the connection is gone and must not go back to the pool). `onCut` stops the query on the server.
 * @param {import('node:net').Socket} socket @param {ReturnType<typeof clock>} clk @param {() => Promise<any>} work
 */
export async function onWire(socket, clk, work, onCut = () => {}) {
  let n = 0, why = null;
  const cut = (e) => { if (!why) { why = Object.assign(e, { wire: true }); onCut(); socket.destroy(); } };
  const data = (b) => { n += b.length; if (n > Number(limits.bytes) / 2 + 65536) cut(fail(`The query returned more than ${Math.round(limits.bytes / 1048576)} MB. Filter or group it in SQL.`, 400)); };
  socket.on('data', data);
  try {
    clk.track({ cancel: () => cut(clk.late()) });
    return await work();
  } catch (e) { throw why || e; } finally { socket.off('data', data); }
}

const KILL_MS = 5000;
/** Stop a PostgreSQL backend from a connection of its own (a role may end its own backends). Best effort, bounded. */
function killPostgres(pg, url, pid) {
  if (!pid) return;
  const k = new pg.Client({ connectionString: url, connectionTimeoutMillis: KILL_MS });
  k.on('error', () => {});
  const t = setTimeout(() => k.end().catch(() => {}), KILL_MS);
  k.connect().then(() => k.query('SELECT pg_terminate_backend($1)', [pid])).catch(() => {}).finally(() => { clearTimeout(t); k.end().catch(() => {}); });
}
/** KILL a MySQL thread from a connection of its own (a user may kill its own threads). Best effort, bounded. */
function killMysql(mysql, url, thread) {
  if (!thread) return;
  mysql.createConnection({ uri: url, connectTimeout: KILL_MS }).then(async (k) => {
    k.connection.on?.('error', () => {});
    await k.query(`KILL ${Number(thread)}`).catch(() => {});
    k.destroy();
  }, () => {});
}

/** Every right the PostgreSQL login holds, as one row (see whyNotPostgres). */
const PG_PROBE = `SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
  (SELECT string_agg(b.rolname, ', ') FROM pg_roles b WHERE b.rolname <> current_user AND b.rolname <> 'pg_read_all_data' AND pg_has_role(current_user, b.oid, 'MEMBER')) AS roles,
  (SELECT string_agg(extname, ', ') FROM pg_extension WHERE extname <> 'plpgsql') AS extensions,
  (SELECT string_agg(nspname, ', ') FROM pg_namespace WHERE has_schema_privilege(oid, 'CREATE')) AS create_in,
  has_database_privilege(current_database(), 'CREATE') AS create_db,
  (SELECT string_agg(n, ', ') FROM (SELECT relname AS n FROM pg_class WHERE relowner = r.oid UNION ALL SELECT proname FROM pg_proc WHERE proowner = r.oid
     UNION ALL SELECT nspname FROM pg_namespace WHERE nspowner = r.oid LIMIT 5) o) AS owns,
  (SELECT string_agg(n, ', ') FROM (SELECT c.relname AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND s.nspname NOT IN ('pg_catalog', 'information_schema')
       AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE') OR has_table_privilege(c.oid, 'DELETE')
         OR has_table_privilege(c.oid, 'TRUNCATE') OR has_table_privilege(c.oid, 'TRIGGER') OR has_table_privilege(c.oid, 'REFERENCES')) LIMIT 5) w) AS writes
  FROM pg_roles r WHERE r.rolname = current_user`;
/** @returns {string} what this login could do beyond reading, or '' */
function whyNotPostgres(r) {
  for (const k of ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'rolbypassrls']) if (r[k] !== false) return k.slice(3);
  if (r.roles) return `member of ${String(r.roles).slice(0, 200)}`;
  if (r.extensions) return `the database has the extensions ${String(r.extensions).slice(0, 200)}`;
  if (r.create_in) return `CREATE in the schemas ${String(r.create_in).slice(0, 200)}`;
  if (r.create_db !== false) return 'CREATE in the database';
  if (r.owns) return `owner of ${String(r.owns).slice(0, 200)}`;
  if (r.writes) return `write rights on ${String(r.writes).slice(0, 200)}`;
  return '';
}

/** The procedures listed for the connection whose URL this is (the MySQL probe allows EXECUTE on them). */
const procsOfUrl = (url) => { const k = Object.entries(process.env).find(([key, v]) => v === url && /^PW_DB_\w+$/.test(key) && !/_PROCS$/.test(key))?.[0]; return k ? procsOf(k.slice(6)) : []; };

/**
 * A positive list of SHOW GRANTS lines: USAGE on *.*, SELECT and SHOW VIEW on a database or table, EXECUTE on a listed
 * procedure. Anything else (a role, FILE, PROCESS, a write right, WITH GRANT OPTION) refuses the login.
 * @param {string[]} lines @param {string[]} procs @returns {string}
 */
export function whyNotMysql(lines, procs = []) {
  const ok = new Set(procs.map(p => p.toLowerCase().split('.').pop()));
  for (const l of lines) {
    if (/WITH GRANT OPTION/i.test(l)) return 'it may grant rights';
    if (/^GRANT USAGE ON \*\.\* TO /i.test(l)) continue;
    if (/^GRANT (SELECT|SHOW VIEW)(, (SELECT|SHOW VIEW))* ON (`[^`]+`|\w+)\.(`[^`]+`|\*|\w+) TO /i.test(l)) continue;
    const m = /^GRANT EXECUTE ON PROCEDURE (?:`[^`]+`|\w+)\.`?([^`\s]+)`? TO /i.exec(l);
    if (m && ok.has(m[1].toLowerCase())) continue;
    return `granted: ${l.replace(/ TO .*$/, '').slice(0, 200)}`;
  }
  return '';
}

/** @type {Omit<DriverContext, 'code' | 'procedure' | 'allowed'>} */
const driverContext = { pools, limits, fail, clock: (ms) => clock(ms), count, driver };

const DRIVERS = {
  oracle, snowflake, bigquery,
  // ponytail: node:sqlite is synchronous, so a slow query holds the server's event loop and the time limit
  // cannot stop it, and SQLite builds each value in full (up to its own 1 GB limit) before it is counted. Fine for a
  // local file the admin chose; move it to a worker thread if big SQLite files appear. Rows and bytes are counted as
  // they are read, and the read stops at either cap.
  async sqlite(url, text, values) {
    const { DatabaseSync } = /** @type {typeof import('node:sqlite')} */ (process.getBuiltinModule('node:sqlite'));
    const db = new DatabaseSync(url.slice('sqlite:'.length), { readOnly: true });
    try {
      const st = db.prepare(text);
      st.setReadBigInts(true);
      const rows = [];
      const take = count();
      for (const r of st.iterate(...values)) { take(r); rows.push(r); }
      return rows;
    } finally { db.close(); }
  },

  // The client side bounds both: the socket's bytes are counted as they arrive (onWire), and at the cap or the
  // deadline it is destroyed, so no value or batch is ever buffered past the cap, whatever the server sends.
  // PostgreSQL. The login is checked first (probePostgres, every 5 s at most): no superuser or role-making rights, no
  // role but pg_read_all_data, no extension but plpgsql, nothing it owns, no CREATE anywhere, no write right on any
  // table. Then a READ ONLY transaction, one statement (extended protocol), a cursor read in counted batches; the
  // socket's bytes are counted as they arrive, and at a cap or the deadline the backend is terminated from another
  // connection (a dropped socket alone does not stop a running query, and the query can turn statement_timeout off),
  // the socket is cut and the connection thrown away. Only plain scalar types are parsed: json, arrays and the rest
  // stay text (a parsed JSON value takes many times its size).
  async postgres(url, text, values) {
    if (!pools.has(url)) {
      const pg = (await driver('pg', 'postgres')).default;
      const parsed = new Set([16, 20, 21, 23, 26, 700, 701, 1700, 1184]); // bool, integers, oid, floats, numeric (text), timestamptz
      const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10000, types: { getTypeParser: (oid, fmt) => (parsed.has(oid) ? pg.types.getTypeParser(oid, fmt) : (v) => v) } });
      pool.on('error', () => {}); // an idle client that drops must not crash the server
      pools.set(url, { pool, pg, checked: 0 });
    }
    const entry = pools.get(url);
    const clk = clock(Number(limits.ms));
    try {
      const c = await clk.inTime(entry.pool.connect(), (x) => x.release());
      if (!c.pwQuiet) { c.pwQuiet = true; c.on('error', () => {}); } // a socket we cut must not crash the server
      let ok = false;
      try {
        const rows = await onWire(c.connection.stream, clk, async () => {
          if (Date.now() - entry.checked > PROBE_MS) {
            const why = whyNotPostgres((await c.query(PG_PROBE)).rows[0] || {});
            if (why) throw fail(`This PostgreSQL login can do more than read (${why}). Give report connections a role with CONNECT and SELECT only (see docs/DATA-SQL.md).`, 500);
            entry.checked = Date.now();
          }
          await c.query('BEGIN READ ONLY');
          // extended protocol: one statement only, so "…; COMMIT; DELETE …" cannot end the read-only transaction
          await c.query({ text: `DECLARE pw_rows NO SCROLL CURSOR FOR ${text}`, values, queryMode: 'extended' });
          const out = [];
          const take = count();
          for (;;) {
            clk.overdue();
            await c.query(`SET LOCAL statement_timeout = ${Math.max(1, clk.left())}`); // again: the query may have changed it
            const got = (await c.query('FETCH 500 FROM pw_rows')).rows;
            for (const r of got) { take(r); out.push(r); }
            if (got.length < 500) return out;
          }
        }, () => killPostgres(entry.pg, url, c.processID));
        ok = true;
        return rows;
      } finally {
        if (ok) await c.query('ROLLBACK').then(() => c.release(), () => c.release(true));
        else { killPostgres(entry.pg, url, c.processID); c.release(true); } // any failure: the connection is not reused
      }
    } finally { clk.stop(); }
  },

  // MySQL. The login is checked first (SHOW GRANTS, every 5 s at most): only USAGE, SELECT and SHOW VIEW grants
  // (EXECUTE on the connection's listed procedures). Then a read-only session and transaction, a server-side prepared
  // statement (one statement), sql_select_limit and max_execution_time; the socket's bytes are counted as they arrive,
  // and at a cap or the deadline the query is killed from another connection (KILL; an optimizer hint or a CALL is not
  // bound by max_execution_time) and the connection thrown away. JSON and geometry stay text and bytes.
  async mysql(url, text, values) {
    if (!pools.has(url)) {
      const mysql = (await driver('mysql2/promise', 'mysql')).default;
      const typeCast = (field, next) => (field.type === 'JSON' ? field.string() : field.type === 'GEOMETRY' ? field.buffer() : next());
      pools.set(url, { pool: mysql.createPool({ uri: url, connectionLimit: 5, connectTimeout: 10000, dateStrings: true, supportBigNumbers: true, typeCast }), mysql, checked: 0 });
    }
    const entry = pools.get(url);
    const clk = clock(Number(limits.ms));
    try {
      const c = await clk.inTime(entry.pool.getConnection(), (x) => x.release());
      if (!c.connection.pwQuiet) { c.connection.pwQuiet = true; c.connection.on('error', () => {}); } // a socket we cut must not crash the server
      const thread = c.connection.threadId;
      let ok = false;
      try {
        const rows = await onWire(c.connection.stream, clk, async () => {
          if (Date.now() - entry.checked > PROBE_MS) {
            const [grants] = await c.query('SHOW GRANTS');
            const why = whyNotMysql(grants.map(g => String(Object.values(g)[0])), procsOfUrl(url));
            if (why) throw fail(`This MySQL login can do more than read (${why}). Give report connections a user with SELECT grants only (see docs/DATA-SQL.md).`, 500);
            entry.checked = Date.now();
          }
          // session-wide too: DDL commits the transaction it runs in, and a read-only session still refuses it
          await c.query('SET SESSION TRANSACTION READ ONLY');
          await c.query(`SET SESSION sql_select_limit = ${Number(limits.rows) + 1}`);
          await c.query(`SET SESSION max_execution_time = ${Number(limits.ms)}`).catch(() => c.query(`SET SESSION max_statement_time = ${Number(limits.ms) / 1000}`)); // MySQL, else MariaDB
          await c.query('START TRANSACTION READ ONLY');
          const [res] = await c.execute(text, values); // a server-side prepared statement: one statement, values bound
          const out = Array.isArray(res[0]) ? res[0] : res; // CALL: the procedure's first result set
          const take = count();
          for (const r of out) take(r);
          return out;
        }, () => killMysql(entry.mysql, url, thread));
        ok = true;
        return rows;
      } finally {
        if (ok) await c.query('ROLLBACK').then(() => c.release(), () => c.connection.destroy());
        else { killMysql(entry.mysql, url, thread); c.connection.destroy(); } // any failure: the connection is not reused
      }
    } finally { clk.stop(); }
  },

  // SQL Server. The guard that holds is the login: before a connection runs any report query, the server is asked
  // what the login may do (probeReadOnly), and a login that could write anything (sysadmin, db_owner, db_datawriter,
  // db_ddladmin, INSERT/UPDATE/DELETE/ALTER/EXECUTE/CREATE rights, …) is refused outright; a CREATE TABLE in a
  // rolled-back transaction must fail too. The probe repeats every 10 minutes. Then, as a second guard: no statement
  // keyword outside strings and comments (bindTsql); the server compiles the same text with the same @pw_n declared,
  // under SHOWPLAN_XML (compiled, not run), and the plan must be exactly one SELECT; it runs in a transaction that is
  // always rolled back, under SET ROWCOUNT (the row cap) and the pool's request timeout (the time limit).
  async mssql(url, text, values, ctx) {
    const proc = ctx?.procedure || null, allowed = ctx?.allowed || [];
    const key = `mssql|${url}|${allowed.join(',')}`; // the probe allows EXECUTE on the connection's listed procedures
    const sql = (await driver('mssql', 'SQL Server')).default;
    if (!pools.has(key)) {
      // requestTimeout 0: our own deadline below; a wait for a pooled connection gives up on its own too
      const pool = new sql.ConnectionPool({ ...mssqlConfig(url), pool: { max: 5, acquireTimeoutMillis: 60000 }, connectionTimeout: 10000, requestTimeout: 0 });
      pool.on('error', () => {});
      const ready = pool.connect();
      ready.catch(() => { if (pools.get(key)?.ready === ready) pools.delete(key); }); // handled at once: no unhandled rejection
      pools.set(key, { ready, probe: null });
    }
    // One wall-clock deadline for everything (connect, probe, a pooled connection, parse check, describe, run): when it
    // passes, every request in flight is cancelled, no later step starts, and the caller has its 504 at once, even if
    // a cleanup step (session reset, rollback) is still waiting on a stuck connection.
    const clk = clock(Number(limits.ms));
    try { return await clk.inTime(mssqlRun(sql, pools.get(key), text, values, clk, proc, allowed)); } finally { clk.stop(); }
  },

};

/**
 * One wall-clock deadline. `track` registers a request (refused once the deadline passed: mssql resets a request's
 * cancelled state on each batch, so a request begun after the timer fired would run); when the timer fires every
 * tracked request is cancelled. `inTime(p, after)` is p, or the 504 at the deadline (then `after` cleans up whatever
 * p gives later).
 * @param {number} ms
 */
export function clock(ms) {
  const deadline = Date.now() + ms;
  const live = new Set();
  let fired = false;
  const late = () => Object.assign(fail(`The query ran longer than ${limits.ms / 1000} s.`, 504), { code: 'ETIMEOUT' });
  // one way to fire, from every path that ends a wait: two timers set for the same moment can fire in either order
  const fire = () => { if (fired) return; fired = true; for (const r of live) { try { r.cancel(); } catch { /* finished */ } } live.clear(); };
  const timer = setTimeout(fire, ms);
  const overdue = () => { if (fired || Date.now() > deadline) throw late(); };
  return {
    late, overdue,
    get fired() { return fired; },
    left: () => Math.max(0, deadline - Date.now()),
    track(r) { overdue(); live.add(r); return r; },
    inTime: (p, after = () => {}) => new Promise((resolve, reject) => {
      const t = setTimeout(() => { fire(); p.then(after, () => {}); reject(late()); }, Math.max(0, deadline - Date.now()));
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(fired || Date.now() > deadline ? late() : e); });
    }),
    stop: () => { clearTimeout(timer); if (Date.now() >= deadline) fire(); },
  };
}

const QUIET_MS = 5000; // a session reset or cleanup request that takes longer than this is cancelled

async function mssqlRun(sql, entry, text, values, clk, proc = null, allowed = []) {
  const pool = await clk.inTime(entry.ready);
  // the login is asked again before every query (a 5-second cache covers the queries of one render), on a fresh
  // connection from the pool; any error in the probe refuses the query (fail closed). The probe has a clock of its own
  // with the same time limit (it is shared by the queries that wait for it); this query waits for it until its deadline.
  const probe = () => {
    if (!entry.probe || entry.probe.pc.fired || Date.now() - entry.probe.at > PROBE_MS) { // a probe out of time is no answer
      const at = Date.now();
      const pc = clock(Number(limits.ms));
      const result = probeReadOnly(sql, pool, pc, allowed).catch((e) => { throw pc.fired ? pc.late() : e; }).finally(pc.stop);
      entry.probe = { at, result, pc };
      result.catch(() => { if (entry.probe?.at === at) entry.probe = null; });
    }
    return clk.inTime(entry.probe.result);
  };
  let why;
  try {
    // a shared probe begun by an earlier query with a shorter time left can run out first: then once more, on our time
    why = await probe().catch((e) => { clk.overdue(); if (e.status === 504) return probe(); throw e; });
  } catch (e) { clk.overdue(); if (e.status === 504) throw e; throw fail(`Could not check what this SQL Server login may do, so the query did not run: ${String(e.message || e).slice(0, 200)}`, 500); }
  if (why) { entry.probe = null; throw fail(`This SQL Server login can write (${why}). Give report connections a login that can only read: a database user in db_datareader, with GRANT SHOWPLAN, and nothing else.`, 500); }
  clk.overdue();
  const types = values.map(v => mssqlType(sql, v));
  const tx = new sql.Transaction(pool);
  // a pooled connection, within the time left; one that comes later is given back at once
  await clk.inTime(tx.begin(), () => tx.rollback().catch(() => {}));
  const conn = tx._acquiredConnection; // ponytail: mssql internals; a failed query's connection is closed, not pooled
  let ok = false;
  const req = () => clk.track(new sql.Request(tx));
  // session resets and cleanup are not cancelled by the deadline (they must run after it), so each has a short timer of
  // its own; the session is reset first too (a cleanup that failed last time must not leave SHOWPLAN, a row cap or a
  // text size on this pooled connection)
  const quiet = (q) => {
    const r = new sql.Request(tx);
    const t = setTimeout(() => { try { r.cancel(); } catch { /* done */ } }, QUIET_MS);
    return r.batch(q).catch(() => {}).finally(() => clearTimeout(t));
  };
  try {
    await quiet('SET SHOWPLAN_XML OFF');
    await quiet('SET ROWCOUNT 0; SET TEXTSIZE 2147483647');
    if (proc) {
      // an allow-listed procedure: no plan check (the admin chose it), the same caps; the first result set only
      await req().batch(`SET ROWCOUNT ${Number(limits.rows) + 1}; SET TEXTSIZE ${textSize()}`);
      try {
        const r = req();
        values.forEach((v, i) => r.input(proc.names[i], mssqlType(sql, v).type, v));
        const { rows, cols } = await streamRows(r, (x) => x.execute(text), { sql, overdue: clk.overdue, odd: true, first: true });
        for (const row of rows) for (const c of cols) row[c.name] = mssqlCell(sql, c.type, row[c.name]);
        ok = true;
        return rows;
      } finally { await quiet('SET ROWCOUNT 0; SET TEXTSIZE 2147483647'); }
    }
    // the plan is text too: cut at the cap (isOneSelect refuses a plan that does not end), streamed like the rows
    await req().batch(`SET TEXTSIZE ${textSize()}`);
    await req().batch('SET SHOWPLAN_XML ON');
    let plan;
    try {
      const decl = types.length ? `DECLARE ${types.map((t, i) => `@pw_${i + 1} ${t.decl}`).join(', ')};\n` : '';
      plan = await streamRows(req(), (r) => r.batch(decl + text), { sql, overdue: clk.overdue, one: 'A SQL source can only run one SELECT query (one statement).' });
    } catch (e) {
      clk.overdue();
      throw e.status ? e : fail(`SQL Server cannot compile the query: ${String(e.message || e).slice(0, 300)}`, 400);
    } finally { await quiet('SET SHOWPLAN_XML OFF'); }
    clk.overdue();
    const kind = isOneSelect({ recordsets: [plan.rows] });
    if (!kind) throw fail('A SQL source can only run one SELECT query (one statement), and its plan must fit the size cap.', 400);
    if (kind === 'XML SELECT') throw fail('FOR XML is not supported in a SQL source: use a plain SELECT, or FOR JSON.', 400);
    // the worst row, before a byte of it is read: the server describes the result (a read, no extra rights)
    const describe = req();
    describe.input('t', sql.NVarChar(sql.MAX), text);
    describe.input('p', sql.NVarChar(sql.MAX), types.map((t, i) => `@pw_${i + 1} ${t.decl}`).join(', '));
    const lobSize = rowBudget((await describe.query('EXEC sp_describe_first_result_set @tsql = @t, @params = @p')).recordset || []);
    clk.overdue();
    // the server's own caps: rows (the client counts too) and the size of any one (MAX) value: TEXTSIZE is the
    // value's share of the byte cap, an even number (an nvarchar is cut at whole characters), so a value the server
    // cut is always at or over its share on the client and is refused, and no more than that crosses the wire
    await req().batch(`SET ROWCOUNT ${Number(limits.rows) + 1}; SET TEXTSIZE ${lobSize}`);
    try {
      const r = req();
      values.forEach((v, i) => r.input(`pw_${i + 1}`, types[i].type, v));
      const { rows, cols } = await streamRows(r, (x) => x.query(text), { sql, overdue: clk.overdue, lobSize, odd: true });
      for (const row of rows) for (const c of cols) row[c.name] = mssqlCell(sql, c.type, row[c.name]);
      // FOR XML / FOR JSON pack the rows into text (in chunks), in one column the server names with a fixed GUID
      // (the plan does not always say XML/JSON SELECT). SET ROWCOUNT stops them at rows + 1 source rows without a
      // word: FOR JSON's rows are counted and refused as a plain SELECT would be; FOR XML cannot be counted.
      const packed = cols.length === 1 && /^(XML|JSON)_F52E2B61-18A1-11d1-B105-00805F49916B$/i.exec(cols[0].name);
      if (packed && packed[1].toUpperCase() === 'XML') throw fail('FOR XML is not supported in a SQL source: use a plain SELECT, or FOR JSON.', 400);
      if (kind === 'JSON SELECT' || packed) {
        let n = 0;
        try { const v = JSON.parse(rows.map(r => Object.values(r)[0] ?? '').join('') || '[]'); n = Array.isArray(v) ? v.length : 1; } catch { n = limits.rows + 1; }
        if (n > limits.rows) throw fail(`The query returned more than ${limits.rows} rows. Filter or group it in SQL.`, 400);
      }
      ok = true;
      return rows;
    } finally { await quiet('SET ROWCOUNT 0; SET TEXTSIZE 2147483647'); }
  } finally {
    await tx.rollback().catch(() => {});
    // a cap, the deadline or any error: the connection may be mid-stream or left in a state; close it so the pool's
    // validation drops it (it was given back to the pool by the rollback)
    if (!ok) { try { conn?.close(); } catch { /* gone */ } }
  }
}

/**
 * True only for a SHOWPLAN_XML result of exactly one plan document holding exactly one statement element, a
 * StmtSimple whose StatementType is a read: SELECT, SELECT WITHOUT QUERY (constants) or JSON SELECT (FOR JSON).
 * Returns that type, or false. Fails closed.
 * @param {any} plan the batch result
 */
const SELECT_TYPES = new Set(['SELECT', 'SELECT WITHOUT QUERY', 'JSON SELECT', 'XML SELECT']); // XML is refused after it runs (see below)
export function isOneSelect(plan) {
  const sets = plan?.recordsets || [];
  if (sets.length !== 1 || sets[0].length !== 1) return false;
  const cells = Object.values(sets[0][0] || {});
  if (cells.length !== 1 || typeof cells[0] !== 'string') return false;
  const xml = cells[0];
  if (!/^\s*(<\?xml[^>]*\?>\s*)?<ShowPlanXML[\s>]/.test(xml) || (xml.match(/<ShowPlanXML[\s>]/g) || []).length !== 1) return false;
  if (!/<\/ShowPlanXML>\s*$/.test(xml)) return false; // cut at TEXTSIZE: not a whole plan
  if ((xml.match(/<Batch[\s>]/g) || []).length !== 1) return false;
  const stmts = xml.match(/<Stmt[A-Za-z]*[\s>/]/g) || [];
  if (stmts.length !== 1 || !stmts[0].startsWith('<StmtSimple')) return false;
  const tag = xml.slice(xml.indexOf('<StmtSimple')).match(/^<StmtSimple(\s[^>]*)?>/);
  if (!tag) return false;
  const types = [...(tag[1] || '').matchAll(/\sStatementType="([^"]*)"/g)].map(m => m[1]);
  return types.length === 1 && SELECT_TYPES.has(types[0]) ? types[0] : false;
}

/**
 * The TEXTSIZE for a query: an even number just above a quarter of limits.bytes. The driver holds a value up to four
 * times over before the client can measure it (the packet chunks, the joined buffer, then a string at 2 bytes a
 * character), so a quarter keeps even a cut value's peak within the cap.
 */
const textSize = () => Math.floor(Number(limits.bytes) / 8) * 2 + 2;
/**
 * The bytes a value can have been on the server, at most: max(UTF-8, 2 × length) for text, the length for binary, the
 * sum for a list (mssql gives a list for columns with the same name), the JSON text of anything else, 8 for a scalar.
 */
export const sizeOf = (v) => (typeof v === 'string' ? Math.max(Buffer.byteLength(v), v.length * 2)
  : Buffer.isBuffer(v) || v instanceof Uint8Array ? v.length
  : Array.isArray(v) ? v.reduce((n, x) => n + sizeOf(x), 8)
  : v && typeof v === 'object' && !(v instanceof Date) ? sizeOf(JSON.stringify(v) ?? '') : 8);
const MAX_COLUMNS = 1024, MIN_LOB = 16384; // a LOB share under 16 kB is too small to tell a cut value from a fixed one
/**
 * The TEXTSIZE that keeps the worst row within limits.bytes, from sp_describe_first_result_set: the fixed columns take
 * their max_length, the (MAX)/text/ntext/image columns share the rest (an even number). Refuses xml and CLR columns
 * (TEXTSIZE does not cut them), more than MAX_COLUMNS columns, and a row whose fixed part, or whose LOB share, does
 * not fit. Fails closed on anything it does not know.
 * @param {any[]} desc @returns {number}
 */
export function rowBudget(desc) {
  const cols = desc.filter(c => !c.is_hidden);
  if (!cols.length) throw fail('SQL Server could not describe what the query returns.', 400);
  if (cols.length > MAX_COLUMNS) throw fail(`The query returns ${cols.length} columns; a SQL source can have at most ${MAX_COLUMNS}.`, 400);
  let fixed = 0, lobs = 0;
  for (const c of cols) {
    const t = Number(c.system_type_id), n = Number(c.max_length);
    if (t === 241 || t === 240 || c.is_xml_document) throw fail(`The column "${String(c.name).slice(0, 60)}" is xml or a CLR type, which a SQL source cannot read. CAST it to NVARCHAR(MAX) in the query.`, 400);
    if (n === -1 || [34, 35, 99].includes(t)) lobs++;
    else if (Number.isFinite(n) && n >= 0) fixed += n;
    else throw fail(`SQL Server did not say how large the column "${String(c.name).slice(0, 60)}" can be.`, 400);
  }
  const cap = Number(limits.bytes);
  if (fixed >= cap) throw fail(`One row of this query can be ${Math.ceil(fixed / 1048576)} MB, more than the ${Math.round(cap / 1048576)} MB a SQL source may read. Select fewer or narrower columns.`, 400);
  if (!lobs) return textSize();
  const share = Math.floor((cap - fixed) / lobs / 8) * 2; // a quarter: see textSize
  if (share < MIN_LOB) throw fail(`The query has too many large columns (${lobs} of (MAX) size) for the ${Math.round(cap / 1048576)} MB a SQL source may read.`, 400);
  return Math.min(share, textSize());
}

const MAX_MESSAGES = 1000; // info and error messages one request may send (each counts against the byte cap too)

/**
 * Run a request as a stream and stop it on the client: more than limits.rows rows, more than limits.bytes of values and
 * messages (info and error messages count too, and at most MAX_MESSAGES of them), one value of lobSize or more (the
 * server cut it at TEXTSIZE), a second result set, xml or CLR columns (`odd`), or the deadline: the request is
 * cancelled at once and the rest never crosses the wire. `first`: a second result set ends the read (a procedure's
 * first result set is the data), it is not an error.
 * @param {any} r a request @param {(r: any) => any} start runs it (query or batch)
 * @param {{ sql: any, overdue: () => void, lobSize?: number, odd?: boolean, one?: string }} o
 * @returns {Promise<{ rows: any[], cols: any[] }>}
 */
export function streamRows(r, start, { sql, overdue, lobSize = textSize(), odd = false, first = false, one = 'A SQL source can only run one SELECT query (one statement).' }) {
  r.stream = true;
  return new Promise((resolve, reject) => {
    const rows = [];
    let cols = [], sets = 0, bytes = 0, msgs = 0, stop = null, ended = false;
    // a cap overrides a server error seen before it (an error flood must be cancelled too)
    const halt = (e) => { if (!stop?.status) { stop = e; try { r.cancel(); } catch { /* done already */ } } };
    const over = () => bytes > limits.bytes && halt(fail(`The query returned more than ${Math.round(limits.bytes / 1048576)} MB. Filter or group it in SQL.`, 400));
    const message = (m) => {
      bytes += sizeOf(String(m?.message ?? m)) + 64;
      if (++msgs > MAX_MESSAGES) halt(fail(`The query sent more than ${MAX_MESSAGES} messages. A SQL source must return rows only.`, 400));
      else over();
    };
    r.on('recordset', (c) => {
      if (++sets > 1) { if (!first) return halt(fail(one, 400)); if (!ended) { ended = true; try { r.cancel(); } catch { /* done */ } } return; }
      cols = Object.values(c);
      // TEXTSIZE does not cut xml or CLR values (geometry, hierarchyid, …): refused before a row is read
      const bad = odd && cols.find(col => [sql.Xml, sql.UDT, sql.Geography, sql.Geometry].includes(col.type) || /^(xml|udt)$/i.test(String(col.type?.declaration || '')));
      if (bad) halt(fail(`The column "${String(bad.name).slice(0, 60)}" is xml or a CLR type, which a SQL source cannot read. CAST it to NVARCHAR(MAX) in the query.`, 400));
    });
    r.on('row', (row) => {
      if (stop || ended) return;
      rows.push(row);
      for (const v of Object.values(row).flat()) { // a list: columns with the same name
        const n = sizeOf(v);
        // a value the server cut at TEXTSIZE measures at least TEXTSIZE here: refused, never passed on cut short
        if (n >= lobSize) return halt(fail(`A value is larger than the ${Math.round(lobSize / 1048576 * 10) / 10} MB this query may read in one column. Filter or shorten it in SQL.`, 400));
        bytes += n;
      }
      if (rows.length > limits.rows) halt(fail(`The query returned more than ${limits.rows} rows. Filter or group it in SQL.`, 400));
      else over();
    });
    r.on('info', message);
    r.on('error', (e) => { message(e); if (!stop && !ended) stop = e; }); // after `ended`, the cancel's own error
    r.on('done', () => {
      if (stop?.status) return reject(stop);
      try { overdue(); } catch (e) { return reject(e); }
      return stop ? reject(stop) : resolve({ rows, cols });
    });
    start(r);
  });
}

const PROBE_MS = 5000; // the probe runs before every query; this only spares the queries of one render
// database rights a reading login may hold; anything else (and any VIEW … right is fine) counts as a right to change
// The exact rights a reading login may hold (a positive list: anything else refuses it). The two VIEW ANY COLUMN … KEY
// DEFINITION rights and VIEW ANY DATABASE are what public holds by default; SHOWPLAN is needed for the parse check.
const READ_DB = new Set(['CONNECT', 'SELECT', 'SHOWPLAN', 'VIEW ANY COLUMN ENCRYPTION KEY DEFINITION', 'VIEW ANY COLUMN MASTER KEY DEFINITION']);
const READ_SERVER = new Set(['CONNECT SQL', 'VIEW ANY DATABASE', 'CONNECT ANY DATABASE', 'SELECT ALL USER SECURABLES']);
const sqlList = (set) => [...set].map(x => `'${x}'`).join(', ');

/** Every right this login holds in the current database (and on the server), as one row; see whyNot. */
const PROBE_SQL = `
    WITH roles AS (
      SELECT USER_ID() AS id UNION ALL SELECT 0
      UNION ALL SELECT m.role_principal_id FROM sys.database_role_members m JOIN roles r ON m.member_principal_id = r.id
    ), srv AS (
      SELECT principal_id FROM sys.server_principals WHERE principal_id = SUSER_ID() OR (type = 'R' AND IS_SRVROLEMEMBER(name) = 1)
    )
    SELECT
      IS_SRVROLEMEMBER('sysadmin') AS sysadmin,
      (SELECT STRING_AGG(r, ',') FROM (VALUES ('db_owner'), ('db_datawriter'), ('db_ddladmin'), ('db_securityadmin'), ('db_accessadmin'), ('db_backupoperator')) v(r) WHERE IS_ROLEMEMBER(r) = 1) AS roles,
      (SELECT STRING_AGG(CONCAT(p.permission_name, ' (', p.class_desc, CASE WHEN p.class = 1 THEN CONCAT(' ', QUOTENAME(OBJECT_SCHEMA_NAME(p.major_id)), '.', QUOTENAME(OBJECT_NAME(p.major_id))) WHEN p.class = 3 THEN CONCAT(' ', QUOTENAME(SCHEMA_NAME(p.major_id))) ELSE '' END, ')'), ', ')
        FROM sys.database_permissions p
        WHERE p.grantee_principal_id IN (SELECT DISTINCT id FROM roles) AND p.state IN ('G', 'W')
          AND NOT (p.class = 1 AND ISNULL(OBJECTPROPERTY(p.major_id, 'IsMSShipped'), 1) = 1)
          AND (p.state = 'W' -- WITH GRANT OPTION: it may hand rights out, so it can change permissions
            OR p.permission_name NOT IN (${sqlList(READ_DB)}))) AS granted,
      -- every schema's effective rights (guest, INFORMATION_SCHEMA, sys and the fixed-role schemas, ids 16384+, are
      -- owned by system principals and empty; making anything in them needs a database right, checked above)
      (SELECT STRING_AGG(CAST(CONCAT(QUOTENAME(s.name), ' ', p.permission_name) AS NVARCHAR(400)) COLLATE DATABASE_DEFAULT, ', ') FROM sys.schemas s
        CROSS APPLY fn_my_permissions(QUOTENAME(s.name), 'SCHEMA') p WHERE s.schema_id NOT IN (2, 3, 4) AND s.schema_id < 16384 AND p.permission_name <> 'SELECT') AS schemas,
      -- other things it or its roles own: database principals (roles), types, keys, certificates, assemblies, …
      (SELECT STRING_AGG(CAST(n AS NVARCHAR(400)) COLLATE DATABASE_DEFAULT, ', ') FROM (
        SELECT CONCAT('role ', QUOTENAME(name)) AS n FROM sys.database_principals WHERE is_fixed_role = 0 AND owning_principal_id IN (SELECT DISTINCT id FROM roles) AND principal_id <> USER_ID()
        UNION ALL SELECT CONCAT('type ', QUOTENAME(name)) FROM sys.types WHERE is_user_defined = 1 AND principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('certificate ', QUOTENAME(name)) FROM sys.certificates WHERE principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('asymmetric key ', QUOTENAME(name)) FROM sys.asymmetric_keys WHERE principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('symmetric key ', QUOTENAME(name)) FROM sys.symmetric_keys WHERE principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('XML schema collection ', QUOTENAME(name)) FROM sys.xml_schema_collections WHERE xml_collection_id > 65535 AND principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('assembly ', QUOTENAME(name)) FROM sys.assemblies WHERE is_user_defined = 1 AND principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('full-text catalog ', QUOTENAME(name)) FROM sys.fulltext_catalogs WHERE principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('service ', QUOTENAME(name)) FROM sys.services WHERE service_id > 3 AND principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('contract ', QUOTENAME(name)) FROM sys.service_contracts WHERE service_contract_id > 6 AND principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('message type ', QUOTENAME(name)) FROM sys.service_message_types WHERE message_type_id > 14 AND principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('route ', QUOTENAME(name)) FROM sys.routes WHERE route_id > 65535 AND principal_id IN (SELECT DISTINCT id FROM roles)
        UNION ALL SELECT CONCAT('server principal ', QUOTENAME(name)) FROM sys.server_principals WHERE owning_principal_id IN (SELECT principal_id FROM srv)
      ) o) AS ownsOther,
      -- an owner has every right on what it owns, and ownership is not in sys.database_permissions: schemas the user
      -- or its roles own (user schemas only: ids 5..16383; the fixed role schemas such as db_datareader are owned by
      -- those roles and hold nothing), and objects with an explicit owner
      (SELECT STRING_AGG(QUOTENAME(name), ', ') FROM sys.schemas WHERE schema_id BETWEEN 5 AND 16383 AND principal_id IN (SELECT DISTINCT id FROM roles)) AS ownsSchemas,
      (SELECT STRING_AGG(QUOTENAME(name), ', ') FROM sys.objects WHERE is_ms_shipped = 0 AND principal_id IN (SELECT DISTINCT id FROM roles)) AS ownsObjects,
      (SELECT STRING_AGG(permission_name, ',') FROM fn_my_permissions(NULL, 'DATABASE')) AS db,
      -- ways out of the database: operating-system commands, ad hoc remote queries, linked servers
      HAS_PERMS_BY_NAME('master.sys.xp_cmdshell', 'OBJECT', 'EXECUTE') AS cmdshell,
      (SELECT CAST(value_in_use AS INT) FROM sys.configurations WHERE name = 'Ad Hoc Distributed Queries') AS adhoc,
      (SELECT STRING_AGG(QUOTENAME(name), ', ') FROM sys.servers WHERE server_id > 0) AS linked,
      (SELECT STRING_AGG(permission_name, ',') FROM fn_my_permissions(NULL, 'SERVER')) AS srv,
      -- server rights of every class (IMPERSONATE on a login, CONTROL on a server role, …) to the login, its server
      -- roles (nested) and public; public's CONNECT on the default endpoints is fine
      (SELECT STRING_AGG(CONCAT(sp.permission_name, ' (', sp.class_desc, ')'), ', ') FROM sys.server_permissions sp
        WHERE sp.grantee_principal_id IN (SELECT principal_id FROM srv) AND sp.state IN ('G', 'W')
          AND NOT (sp.class = 105 AND sp.permission_name = 'CONNECT')
          AND (sp.state = 'W' OR sp.permission_name NOT IN (${sqlList(READ_SERVER)}))) AS srvgranted,
      (SELECT STRING_AGG(CAST(CONCAT(p.p, ' ', x.n) AS NVARCHAR(MAX)), '; ') FROM sys.objects o
        CROSS APPLY (SELECT QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name) AS n) x
        CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('ALTER'), ('CONTROL'), ('EXECUTE'), ('TAKE OWNERSHIP'), ('IMPERSONATE')) p(p)
        WHERE o.is_ms_shipped = 0 AND HAS_PERMS_BY_NAME(x.n, 'OBJECT', p.p) = 1) AS obj`;

/** "dbo.Sales" / "Sales" → "[dbo].[sales]", as the probe names objects. */
const quoted = (n) => { const [a, b] = String(n).toLowerCase().split('.'); return b ? `[${a}].[${b}]` : `[dbo].[${a}]`; };

/** What a PROBE_SQL row says this login could change, or ''. Fails closed. `allow`: EXECUTE on these procedures is fine. */
function whyNot(r, allow = []) {
  const ok = new Set(allow.map(quoted));
  const notAllowed = (list, sep, re) => String(list || '').split(sep).filter(x => { const m = re.exec(x.trim()); return !(m && ok.has(m[1].toLowerCase())); }).join(sep);
  r = { ...r, granted: notAllowed(r.granted, ', ', /^EXECUTE \(OBJECT_OR_COLUMN (\[[^\]]*\]\.\[[^\]]*\])\)$/), obj: notAllowed(r.obj, '; ', /^EXECUTE (\[[^\]]*\]\.\[[^\]]*\])$/) };
  if (r.sysadmin !== 0) return 'sysadmin';
  if (r.cmdshell === 1) return 'it may run xp_cmdshell';
  if (r.adhoc === 1) return 'the server allows ad hoc distributed queries (OPENROWSET)';
  if (r.linked) return `it can see linked servers ${String(r.linked).slice(0, 100)}`;
  if (r.roles) return r.roles;
  if (r.ownsSchemas) return `owner of the schema ${String(r.ownsSchemas).slice(0, 200)}`;
  if (r.ownsObjects) return `owner of ${String(r.ownsObjects).slice(0, 200)}`;
  if (r.ownsOther) return `owner of ${String(r.ownsOther).slice(0, 200)}`;
  if (r.granted) return `granted ${String(r.granted).slice(0, 200)}`;
  if (r.srvgranted) return `granted ${String(r.srvgranted).slice(0, 200)}`;
  const db = String(r.db || '').split(',').filter(x => x && !READ_DB.has(x));
  if (db.length) return `database rights: ${db.slice(0, 5).join(', ')}`;
  const srv = String(r.srv || '').split(',').filter(x => x && !READ_SERVER.has(x));
  if (r.schemas) return `schema rights: ${String(r.schemas).slice(0, 200)}`;
  if (srv.length) return `server rights: ${srv.slice(0, 5).join(', ')}`;
  if (r.obj) return `rights to change ${r.obj}`;
  return '';
}

/**
 * What this login could change, or '' when it can only read: PROBE_SQL in the connected database and in every other
 * user database it can enter (sp_executesql runs there; a write right anywhere counts, since one SELECT can reach any
 * database the login can enter), then a CREATE TABLE in each, in a transaction that is rolled back, which must fail.
 * Fails closed: only CONNECT, SELECT, SHOWPLAN, REFERENCES and VIEW … rights are taken as reading. Every request and
 * every wait for a pooled connection is bound to `clk` (see clock): at its deadline the probe stops and fails.
 * Database names are quoted by the server (QUOTENAME). Text answers are cut at 64 kB (TEXTSIZE), whatever they list.
 * @param {any} sql @param {any} pool @param {ReturnType<typeof clock>} [clk] @param {string[]} [allow] allow-listed procedures
 */
export async function probeReadOnly(sql, pool, clk, allow = []) {
  const track = (r) => (clk ? clk.track(r) : r);
  const inTime = (p, after) => (clk ? clk.inTime(p, after) : p);
  const SMALL = 'SET TEXTSIZE 65536;\n';
  const here = whyNot((await track(pool.request()).query(SMALL + PROBE_SQL)).recordset[0] || {}, allow); // procedures: here only
  if (here) return here;
  const others = ((await track(pool.request()).query("SELECT QUOTENAME(name) AS q, name FROM sys.databases WHERE database_id NOT IN (2, 3) AND state = 0 AND HAS_DBACCESS(name) = 1 AND name <> DB_NAME()")).recordset || [])
    .filter(r => typeof r.q === 'string' && typeof r.name === 'string');
  for (const db of others) {
    const why = whyNot((await track(pool.request()).query(`${SMALL}EXEC ${db.q}.sys.sp_executesql N'${PROBE_SQL.replace(/'/g, "''")}'`)).recordset[0] || {});
    if (why) return `in the database ${db.name.slice(0, 128)}: ${why}`;
  }
  const name = `pw_probe_${crypto.randomBytes(6).toString('hex')}`;
  for (const db of [null, ...others]) {
    const tx = new sql.Transaction(pool); // one each: a refused statement may end the transaction it ran in
    await inTime(tx.begin(), () => tx.rollback().catch(() => {}));
    try {
      await track(new sql.Request(tx)).batch(db ? `EXEC ${db.q}.sys.sp_executesql N'CREATE TABLE dbo.${name} (a INT)'` : `CREATE TABLE dbo.${name} (a INT)`);
      return db ? `in the database ${db.name.slice(0, 128)}: it could create a table` : 'it could create a table';
    } catch (e) {
      // only "permission denied" passes (262: CREATE TABLE permission denied; 2760: no such schema); any other error
      // (a cancelled request, a lost connection) is not an answer, so the probe fails and the query is refused
      const n = e?.number ?? e?.originalError?.info?.number;
      if (n !== 262 && n !== 2760) throw e;
    } finally { await tx.rollback().catch(() => {}); }
  }
  return '';
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
