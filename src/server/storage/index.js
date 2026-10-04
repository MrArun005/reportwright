// @ts-check
// One storage for reports, report versions, schedules, job records and users.
// PW_STORAGE=file (the default): today's files: reports/<id>.pw.json, reports/.history/<id>/,
//   data/schedules.json, data/jobs/<id>/job.json, data/users.json, data/fonts/<id>.json, data/folders.json,
//   data/report-access.json (permissions), data/tokens.json (sign-in state).
// PW_STORAGE=sqlite:/abs/path.db | postgres://… | mysql://… | mssql://… (or sql:<name> for the URL in PW_DB_<NAME>):
//   tables pw_reports, pw_report_versions, pw_schedules, pw_jobs, pw_users, pw_fonts, so several servers share them.
// Values are text (JSON); the callers own the format. Batch output files always stay in data/.
import { fileStore } from './file.js';
import { sqlStore } from './sql.js';
import { AsyncLocalStorage } from 'node:async_hooks';

/** @typedef {'reports'|'schedules'|'jobs'|'users'|'fonts'|'folders'|'reportacl'|'tokens'} Kind */
/**
 * @typedef {object} Store
 * @property {(kind: Kind, id: string) => Promise<string|null>} get
 * @property {(kind: Kind, id: string, text: string) => Promise<void>} put insert or replace
 * @property {(kind: Kind, id: string) => Promise<boolean>} remove true when it was there
 * @property {(kind: Kind) => Promise<string[]>} ids
 * @property {(kind: Kind) => Promise<{ id: string, text: string, updatedAt: string }[]>} list every record (unreadable ones are left out)
 * @property {(id: string) => Promise<{ version: string, bytes: number }[]>} versions a report's saved versions, newest first
 * @property {(id: string, version: string) => Promise<string|null>} getVersion
 * @property {(id: string, version: string, text: string, keep: number) => Promise<void>} addVersion then drop all but the newest `keep`
 * @property {(id: string) => Promise<void>} removeVersions a deleted report's history goes with it
 * @property {(name: string, owner: string, ttlMs: number) => Promise<boolean>} lease take or renew a named lease; false when
 *   another owner holds it and it has not expired (one job runner per batch, one scheduler for all servers)
 * @property {(name: string, owner: string) => Promise<void>} release
 * @property {(entry: any) => Promise<void>} appendAudit add one audit event (never changed afterwards)
 * @property {(q: { from?: string, to?: string, type?: string, actor?: string, report?: string, before?: string, limit: number }) => Promise<any[]>} queryAudit newest first
 * @property {(before: string) => Promise<number>} pruneAudit remove events older than this ISO time (whole days on files)
 */

/**
 * Run fn holding the named lock, on every server (a storage lease): permission checks and the writes they allow,
 * and permission changes, take the "acl" lock, so a revoke cannot land between a check and its write.
 * Re-entrant: code already inside the lock (in the same async flow) runs at once.
 * ponytail: one lock for all permissions; per-report locks if saves ever queue behind each other
 * @template T @param {string} name @param {() => Promise<T>} fn @returns {Promise<T>}
 */
export async function withLock(name, fn, waitMs = 15000) {
  const held = locks.getStore();
  if (held?.has(name)) return fn();
  const owner = `${process.pid}:${Math.random().toString(36).slice(2)}`;
  const t0 = Date.now();
  while (!(await store().lease(`lock:${name}`, owner, 30000))) {
    if (Date.now() - t0 > waitMs) throw Object.assign(new Error('The server is busy with a permission change. Try again.'), { status: 503 });
    await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
  }
  try { return await locks.run(new Set([...(held || []), name]), fn); } finally { await store().release(`lock:${name}`, owner).catch(() => {}); }
}
const locks = new AsyncLocalStorage();

/** @type {{ key: string, store: Store } | null} */
let current = null;

/** The store PW_STORAGE names. Files live under the working folder. @returns {Store} */
export function store() {
  let spec = process.env.PW_STORAGE || 'file';
  const key = spec === 'file' ? `file:${process.cwd()}` : spec;
  if (current?.key === key) return current.store;
  if (/^sql:\w+$/.test(spec)) {
    const env = `PW_DB_${spec.slice(4).toUpperCase()}`;
    spec = process.env[env] || '';
    if (!spec) throw new Error(`PW_STORAGE names ${env}, which is not set.`);
  }
  let s;
  if (spec === 'file') s = fileStore(process.cwd());
  else if (/^(sqlite:|postgres(ql)?:\/\/|mysql:\/\/|mssql:\/\/)/.test(spec)) s = sqlStore(spec);
  else throw new Error('PW_STORAGE must be file, sqlite:/path/file.db, postgres://…, mysql://…, mssql://… or sql:<connection name>.');
  current = { key, store: s };
  return s;
}
