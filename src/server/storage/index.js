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
 * @property {(name: string, owner: string, ttlMs: number) => Promise<boolean>} lease take or renew a named lease; false when
 *   another owner holds it and it has not expired (one job runner per batch, one scheduler for all servers)
 * @property {(name: string, owner: string) => Promise<void>} release
 */

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
