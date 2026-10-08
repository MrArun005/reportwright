// @ts-check
// SQLite connections (sqlite:/path/file.db), run in a child process, never on the server's own threads.
// node:sqlite is synchronous and builds each value in full before JavaScript sees it, so in-process one query could hold
// the event loop for as long as it likes (a recursive CTE) or abort the whole server (a value past V8's string limit,
// printf('%.*c', 900000000, 'x'), is a fatal error, not an exception). Here each query runs in a small Node process:
//   - the deadline (limits.ms) kills the process: the query stops, nothing else waited for it;
//   - a crash (V8's fatal error, the heap limit) kills only that process: the query fails with a 400;
//   - its memory is watched while it runs (PW_SQLITE_MEMORY_MB, default 1024, also its V8 heap limit): past it, killed;
//   - rows and bytes are counted as they are read (limits.rows, limits.bytes), so the read stops at either cap;
//   - the file opens read-only with query_only on and trusted_schema off, and SQLite's own plan (EXPLAIN) is checked
//     first: it may only read the main database (no attach, no pragma or page tables, no writes). Node 22's
//     node:sqlite has no authorizer callback (setAuthorizer); the plan check is the same decision made by the parser.
// Node 22's node:sqlite has no sqlite3_limit(): SQL_LENGTH is bounded before the query is sent (MAX_QUERY, 100k
// characters), VARIABLE_NUMBER by SQLite's own 32766, LENGTH and the rest by the process boundary above.
// PW_SQLITE_PROCESSES (default 2) queries run at once per server thread; more wait their turn within their own deadline.
// The process gets an empty environment (no secrets) and is reused for the next query; idle ones exit after 30 s.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import { num as cnum } from '../config.js';

const num = (k, d, min = 1) => cnum(k, d, { min });
const memMB = () => num('PW_SQLITE_MEMORY_MB', 1024, 64);
const maxProcs = () => Math.floor(num('PW_SQLITE_PROCESSES', 2));
const IDLE_MS = 30000, WATCH_MS = 200, MAX_STMTS = 500;

// The child: plain CommonJS for `node -e`, so no bundler touches it. Answers { rows } or { over } or { err }.
const CHILD = `
const { DatabaseSync } = require('node:sqlite');
const ppid = process.ppid;
const size = (v) => typeof v === 'string' ? Math.max(Buffer.byteLength(v), v.length * 2) : v instanceof Uint8Array ? v.length : 8;
// SQLite's own parser decides what the statement does (as SHOWPLAN does for SQL Server): its program (EXPLAIN) may
// only read the main database. Refused: any write or schema opcode, a write transaction, an attached database,
// attach/detach/load_extension calls, and every virtual table but json_each/json_tree (pragma_* tables such as
// pragma_database_list, dbstat, sqlite_dbpage, FTS: they read files, pages or server state). A virtual table is known
// by its per-connection object, learnt here from json_each('[]') itself, whatever the query calls it.
// (Insert/NewRowid/Delete also fill the query's own temporary tables: a real table needs OpenWrite first)
const WRITE_OPS = new Set(['OpenWrite', 'VUpdate', 'VCreate', 'VDestroy',
  'VBegin', 'Vacuum', 'IncrVacuum', 'ParseSchema', 'SqlExec', 'Destroy', 'Clear', 'CreateBtree', 'JournalMode', 'DropTable',
  'DropIndex', 'DropTrigger', 'LoadAnalysis', 'Expire', 'Pagecount', 'MaxPgcnt', 'SetCookie', 'ReadCookie', 'VRename', 'FkCheck', 'IntegrityCk']);
const FN_DENY = /^(sqlite_attach|sqlite_detach|load_extension|readfile|writefile|edit|fts3_tokenizer|sqlite_dbpage)\\b/i;
// catalog: the server's own schema reads (sql/schema.js, never a caller's text) also read pragma_table_info and
// pragma_foreign_key_list.
function refused(db, text, values, catalog) {
  const plan = (q, v = []) => prep(db, 'EXPLAIN ' + q).all(...v);
  const vt = ['json_each', 'json_tree', ...(catalog ? ['pragma_table_info', 'pragma_foreign_key_list'] : [])];
  const okVtab = new Set(vt.map(f => (plan("SELECT * FROM " + f + "('[]')").find(r => r.opcode === 'VOpen') || {}).p4));
  for (const r of plan(text, values)) {
    const op = r.opcode, p4 = r.p4 == null ? '' : String(r.p4);
    if (WRITE_OPS.has(op)) return 'A SQL source can only read: the query would change or inspect the database file (' + op + ').';
    if (op === 'Transaction' && (r.p2 !== 0 || r.p1 > 1)) return "A SQL source can only read the connection's own database.";
    if ((op === 'OpenRead' || op === 'ReopenIdx') && r.p3 > 1) return "A SQL source can only read the connection's own database.";
    if (op === 'VOpen' && !okVtab.has(p4)) return 'A SQL source cannot read SQLite pragmas, pages, attached databases or other virtual tables.';
    if ((op === 'Function' || op === 'PureFunc' || op === 'AggStep' || op === 'AggFinal') && FN_DENY.test(p4)) return 'A SQL source cannot attach databases or load files.';
  }
  return '';
}
// a streaming read (m.batch): rows go out in batches of m.batch, the next batch only after the parent's ack
let ack = null;
process.on('message', (m) => {
  if (m && m.ack) { const a = ack; ack = null; if (a) a(); return; }
  run(m);
});
// node:sqlite (Node 22.14) finalizes a statement when its JavaScript object is collected, and a later statement that
// SQLite placed at the same address then fails ("statement has been finalized") or crashes: every second query in a
// reused process failed. So no statement here is ever collected or closed: one connection per file for the life of
// this process, and its statements kept by their text (reused when a query repeats). The parent replaces a process
// that holds more than MAX_STMTS of them. Read-only, query_only: nothing a query leaves behind changes the next one.
// Keyed by the file's inode too: a file replaced on disk (a new copy renamed over it) gets a new connection.
const dbs = new Map();
function open(file) {
  let key = file;
  try { const st = require('node:fs').statSync(file); key = file + '|' + st.dev + ':' + st.ino; } catch {}
  let db = dbs.get(key);
  if (!db) {
    db = new DatabaseSync(file, { readOnly: true });
    // query_only: no write even through a path readOnly misses; trusted_schema off: a view or trigger in the file
    // cannot call functions with side effects
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;');
    db.stmts = new Map();
    dbs.set(key, db);
  }
  return db;
}
let held = 0;
function prep(db, text) {
  let st = db.stmts.get(text);
  if (!st) { st = db.prepare(text); db.stmts.set(text, st); held++; }
  return st;
}
// a query's last message says how many statements this process holds (the parent replaces it past MAX_STMTS)
const reply = (x) => process.send({ ...x, held });
async function run(m) {
  let db;
  try {
    db = open(m.file);
    const bad = refused(db, m.text, m.values, m.catalog);
    if (bad) return reply({ err: bad });
    const st = prep(db, m.text);
    st.setReadBigInts(true);
    const rows = [];
    let bytes = 0;
    let n = 0;
    for (const r of st.iterate(...m.values)) {
      // the parent's timers cannot reach a query that never yields; between rows this process checks for itself that
      // the server is still there and the deadline has not passed (a parent killed outright leaves no one to kill it)
      if (++n % 256 === 0 && (process.ppid !== ppid || Date.now() > m.until)) process.exit(0);
      if (n > m.rows) return reply({ over: 'rows' });
      for (const k in r) bytes += size(r[k]);
      if (bytes > m.bytes) return reply({ over: 'bytes' });
      rows.push(r);
      if (m.batch && rows.length >= m.batch) {
        await new Promise((res) => { ack = res; process.send({ batch: rows.splice(0) }); });
      }
    }
    reply(m.batch ? { batch: rows, end: true } : { rows });
  } catch (e) {
    reply({ err: String(e && e.message || e) });
  }
}
process.on('disconnect', () => process.exit(0));
`;

/** @typedef {{ cp: import('node:child_process').ChildProcess, idle: any }} Child */
const S = /** @type {{ idle: Child[], busy: number, wait: (() => void)[], stats: { queries: number, killed: number, crashed: number } }} */ (
  /** @type {any} */ (globalThis).__pwSqlite ||= { idle: [], busy: 0, wait: [], stats: { queries: 0, killed: 0, crashed: 0 } });

/** Counters for /api/v1/metrics. */
export const sqliteStats = () => ({ ...S.stats, running: S.busy, waiting: S.wait.length });

function start() {
  const mb = memMB();
  const cp = spawn(process.execPath, ['--no-warnings', `--max-old-space-size=${mb}`, '-e', CHILD], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced', env: {} });
  cp.on('error', () => {}); // reported through 'exit'
  return { cp, idle: null };
}

/** Resident memory of a process in MB: /proc on Linux (VmRSS, whatever the page size), ps elsewhere; null when unknown. @param {number} pid */
function rssMB(pid) {
  try {
    const kb = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]);
    if (kb) return Promise.resolve(kb / 1024);
  } catch { /* not Linux */ }
  return new Promise((resolve) => execFile('ps', ['-o', 'rss=', '-p', String(pid)], (e, out) => resolve(e ? null : Number(out) / 1024)));
}

const kill = (c) => { clearTimeout(c.idle); try { c.cp.kill('SIGKILL'); } catch { /* gone */ } };

/** A child process for one query, within the deadline (they are shared by PW_SQLITE_PROCESSES slots). */
async function acquire(deadline, late) {
  while (S.busy >= maxProcs()) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => { const i = S.wait.indexOf(go); if (i >= 0) S.wait.splice(i, 1); reject(late()); }, Math.max(0, deadline - Date.now()));
      const go = () => { clearTimeout(t); resolve(undefined); };
      S.wait.push(go);
    });
  }
  S.busy++;
  let c;
  while ((c = S.idle.pop())) { clearTimeout(c.idle); if (c.cp.connected && c.cp.exitCode === null) return c; }
  return start();
}

function release(c, reuse) {
  S.busy--;
  if (reuse && c.cp.connected) {
    c.idle = setTimeout(() => { const i = S.idle.indexOf(c); if (i >= 0) S.idle.splice(i, 1); kill(c); }, IDLE_MS);
    c.idle.unref?.();
    c.cp.unref(); /** @type {any} */ (c.cp).channel?.unref?.();
    S.idle.push(c);
  } else kill(c);
  S.wait.shift()?.();
}

/**
 * Run one read on a SQLite file in a child process. Same contract as the other drivers: rows, or an Error with status.
 * @param {string} url sqlite:/path @param {string} text @param {any[]} values
 * @param {import('../sql.js').DriverContext} ctx
 */
export async function sqlite(url, text, values, ctx) {
  const { limits, fail } = ctx;
  const ms = Number(limits.ms);
  const deadline = Date.now() + ms;
  const late = () => Object.assign(fail(`The query ran longer than ${ms / 1000} s.`, 504), { code: 'ETIMEOUT' });
  const c = await acquire(deadline, late);
  S.stats.queries++;
  const cp = c.cp;
  cp.ref(); /** @type {any} */ (cp).channel?.ref?.();
  return new Promise((resolve, reject) => {
    let done = false;
    const end = (reuse, e, rows) => {
      if (done) return;
      if (held > MAX_STMTS) reuse = false; // its statements are never freed (see the child): a fresh process next time
      done = true;
      clearTimeout(timer); clearInterval(watch);
      cp.off('message', onMsg); cp.off('exit', onExit);
      release(c, reuse);
      if (e) reject(e); else resolve(rows);
    };
    const big = (what) => fail(what === 'rows' ? `The query returned more than ${limits.rows} rows. Filter or group it in SQL.`
      : `The query returned more than ${Math.round(limits.bytes / 1048576)} MB. Filter or group it in SQL.`, 400);
    let held = 0;
    const onMsg = (m) => {
      if (m?.held != null) held = m.held;
      if (m?.batch) { // a streaming read: hand the batch over, ask for the next when the reader has taken it
        Promise.resolve(m.batch.length ? ctx.onRows?.(m.batch) : undefined).then(() => { if (m.end) end(true, null, []); else if (!done) cp.send({ ack: true }); }, (e) => end(false, e));
        return;
      }
      if (m?.rows) end(true, null, m.rows); else end(true, m?.over ? big(m.over) : fail(String(m?.err || 'The query failed.'), 400));
    };
    const onExit = () => { S.stats.crashed++; end(false, fail('The query stopped: it built a value or a result too large for the server (SQLite). Filter or shorten it in SQL.', 400)); };
    const timer = setTimeout(() => { S.stats.killed++; end(false, late()); }, Math.max(0, deadline - Date.now()));
    const cap = memMB();
    const watch = setInterval(() => {
      if (cp.pid) rssMB(cp.pid).then((mb) => { if (mb != null && mb > cap && !done) { S.stats.killed++; end(false, fail(`The query used more than ${cap} MB of memory and was stopped. Filter or shorten it in SQL.`, 400)); } });
    }, WATCH_MS);
    cp.on('message', onMsg);
    cp.once('exit', onExit);
    try {
      cp.send({ file: url.slice('sqlite:'.length), text, values, catalog: !!ctx.catalog, rows: Number(limits.rows), bytes: Number(limits.bytes), until: deadline + 1000, batch: ctx.onRows ? 1000 : 0 });
    } catch { onExit(); }
  });
}

/** Stop every SQLite process (tests). */
export function stopSqlite() {
  for (const c of S.idle.splice(0)) kill(c);
}
