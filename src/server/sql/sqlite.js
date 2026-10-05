// @ts-check
// SQLite connections (sqlite:/path/file.db), run in a child process, never on the server's own threads.
// node:sqlite is synchronous and builds each value in full before JavaScript sees it, so in-process one query could hold
// the event loop for as long as it likes (a recursive CTE) or abort the whole server (a value past V8's string limit,
// printf('%.*c', 900000000, 'x'), is a fatal error, not an exception). Here each query runs in a small Node process:
//   - the deadline (limits.ms) kills the process: the query stops, nothing else waited for it;
//   - a crash (V8's fatal error, the heap limit) kills only that process: the query fails with a 400;
//   - its memory is watched while it runs (PW_SQLITE_MEMORY_MB, default 1024, also its V8 heap limit): past it, killed;
//   - rows and bytes are counted as they are read (limits.rows, limits.bytes), so the read stops at either cap.
// Node 22's node:sqlite has no sqlite3_limit(): SQL_LENGTH is bounded before the query is sent (MAX_QUERY, 100k
// characters), VARIABLE_NUMBER by SQLite's own 32766, LENGTH and the rest by the process boundary above.
// PW_SQLITE_PROCESSES (default 2) queries run at once per server thread; more wait their turn within their own deadline.
// The process gets an empty environment (no secrets) and is reused for the next query; idle ones exit after 30 s.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';

const num = (k, d, min = 1) => { const n = Number(process.env[k]); return Number.isFinite(n) && n >= min ? n : d; };
const memMB = () => num('PW_SQLITE_MEMORY_MB', 1024, 64);
const maxProcs = () => Math.floor(num('PW_SQLITE_PROCESSES', 2));
const IDLE_MS = 30000, WATCH_MS = 200;

// The child: plain CommonJS for `node -e`, so no bundler touches it. Answers { rows } or { over } or { err }.
const CHILD = `
const { DatabaseSync } = require('node:sqlite');
const size = (v) => typeof v === 'string' ? Math.max(Buffer.byteLength(v), v.length * 2) : v instanceof Uint8Array ? v.length : 8;
process.on('message', (m) => {
  let db;
  try {
    db = new DatabaseSync(m.file, { readOnly: true });
    const st = db.prepare(m.text);
    st.setReadBigInts(true);
    const rows = [];
    let bytes = 0;
    for (const r of st.iterate(...m.values)) {
      if (rows.length >= m.rows) return process.send({ over: 'rows' });
      for (const k in r) bytes += size(r[k]);
      if (bytes > m.bytes) return process.send({ over: 'bytes' });
      rows.push(r);
    }
    process.send({ rows });
  } catch (e) {
    process.send({ err: String(e && e.message || e) });
  } finally { try { db && db.close(); } catch {} }
});
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

/** Resident memory of a process in MB: /proc on Linux, ps elsewhere; null when unknown. @param {number} pid */
function rssMB(pid) {
  try {
    const pages = Number(fs.readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]);
    return Promise.resolve(pages * 4096 / 1048576);
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
      done = true;
      clearTimeout(timer); clearInterval(watch);
      cp.off('message', onMsg); cp.off('exit', onExit);
      release(c, reuse);
      if (e) reject(e); else resolve(rows);
    };
    const big = (what) => fail(what === 'rows' ? `The query returned more than ${limits.rows} rows. Filter or group it in SQL.`
      : `The query returned more than ${Math.round(limits.bytes / 1048576)} MB. Filter or group it in SQL.`, 400);
    const onMsg = (m) => (m?.rows ? end(true, null, m.rows) : end(true, m?.over ? big(m.over) : fail(String(m?.err || 'The query failed.'), 400)));
    const onExit = () => { S.stats.crashed++; end(false, fail('The query stopped: it built a value or a result too large for the server (SQLite). Filter or shorten it in SQL.', 400)); };
    const timer = setTimeout(() => { S.stats.killed++; end(false, late()); }, Math.max(0, deadline - Date.now()));
    const cap = memMB();
    const watch = setInterval(() => {
      if (cp.pid) rssMB(cp.pid).then((mb) => { if (mb != null && mb > cap && !done) { S.stats.killed++; end(false, fail(`The query used more than ${cap} MB of memory and was stopped. Filter or shorten it in SQL.`, 400)); } });
    }, WATCH_MS);
    cp.on('message', onMsg);
    cp.once('exit', onExit);
    try {
      cp.send({ file: url.slice('sqlite:'.length), text, values, rows: Number(limits.rows), bytes: Number(limits.bytes) });
    } catch { onExit(); }
  });
}

/** Stop every SQLite process (tests). */
export function stopSqlite() {
  for (const c of S.idle.splice(0)) kill(c);
}
