// @ts-check
// The audit log (enterprise item 3): who did what, to which report, when and from where. Append-only: nothing here
// changes or deletes an event, except retention, which drops events older than PW_AUDIT_RETENTION_DAYS (default 365).
// Stored in the configured storage (src/server/storage): data/audit/<day>.jsonl on files, pw_audit in a database.
//
// Never in an event: passwords, keys, cookies, tokens, connection URLs or parameter values. Parameters are recorded as
// a keyed hash (HMAC-SHA256 with PW_AUDIT_KEY, else PW_SESSION_SECRET), so two renders with the same values can be
// matched without the values being readable. API keys appear as the first 8 hex of their SHA-256.
import crypto from 'node:crypto';
import { store } from './storage/index.js';
import { principalId } from './perms.js';

/** @typedef {import('./perms.js').Principal} Principal */

export const AUDIT_TYPES = /** @type {const} */ ([
  'auth.login', 'auth.login_failed', 'auth.logout', 'auth.sso', 'auth.sso_failed', 'auth.sso_link', 'auth.slo', 'auth.slo_failed',
  'auth.mfa_failed', 'auth.mfa_enabled', 'auth.mfa_disabled', 'auth.mfa_recovery', 'auth.reset_request', 'auth.reset', 'auth.reset_failed',
  'report.create', 'report.update', 'report.delete', 'report.restore', 'report.import', 'report.view', 'report.render', 'report.export',
  'access.report', 'access.folder', 'access.root', 'folder.create', 'folder.delete',
  'user.create', 'user.update', 'user.delete',
  'api.call', 'batch.create', 'batch.download', 'schedule.create', 'schedule.update', 'schedule.delete', 'schedule.run', 'mail.sent', 'mail.failed',
  'settings.update', 'snapshot.clear', 'audit.checkpoint',
]);

const retentionDays = () => { const n = Number(process.env.PW_AUDIT_RETENTION_DAYS); return Number.isFinite(n) && n > 0 ? n : 365; };
const HOUR = 3600 * 1000;
const g = /** @type {any} */ (globalThis);
g.__pwAudit ||= { pruned: 0, seq: 0 };

/** The client address: the last X-Forwarded-For hop (our own proxy's), else what Next put there. @param {Request} [req] */
export const clientIp = (req) => (req?.headers.get('x-forwarded-for') || '').split(',').pop()?.trim().slice(0, 64) || '-';

/** A keyed hash of parameter values (sorted keys), 16 hex; null for none. @param {Record<string, any>|null|undefined} params */
export function paramsHash(params) {
  if (!params || typeof params !== 'object' || !Object.keys(params).length) return null;
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v);
  const key = process.env.PW_AUDIT_KEY || process.env.PW_SESSION_SECRET || 'pagewright-audit';
  return crypto.createHmac('sha256', key).update(JSON.stringify(sorted(params))).digest('hex').slice(0, 16);
}

/** URLs keep their origin and path: a query string or user:password@ may hold a token. */
const noSecrets = (s) => s.replace(/\b(https?:\/\/)(?:[^\s/@]*@)?([^\s/?#]+)([^\s?#]*)[^\s]*/gi, '$1$2$3');

/** Short, plain values only: no objects deeper than one level, strings cut at 300. */
function clean(detail) {
  if (!detail || typeof detail !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(detail).slice(0, 20)) {
    if (v == null) continue;
    if (Array.isArray(v)) out[k] = v.slice(0, 50).map(x => (typeof x === 'object' ? JSON.stringify(x).slice(0, 300) : String(x).slice(0, 300)));
    else if (typeof v === 'object') out[k] = JSON.stringify(v).slice(0, 1000);
    else out[k] = typeof v === 'string' ? noSecrets(v).slice(0, 300) : v;
  }
  return out;
}

/**
 * Record one event. Never throws: a failure to record is logged to the console (the request goes on).
 * @param {typeof AUDIT_TYPES[number]} type
 * @param {{ req?: Request, principal?: Principal, actor?: string, report?: string|null, format?: string|null,
 *   params?: Record<string, any>|null, status?: 'ok'|'failed'|'denied', detail?: Record<string, any> }} [o]
 */
export async function audit(type, o = {}) {
  const at = new Date().toISOString();
  const entry = {
    // sorts by time, then by order within this process (two events in one millisecond), then at random across servers
    id: `${at}-${String((g.__pwAudit.seq = ((g.__pwAudit.seq || 0) + 1) % 1e6)).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex')}`, at, type,
    actor: String(o.actor || (o.principal ? principalId(o.principal) : 'anon')).slice(0, 400),
    ip: clientIp(o.req),
    ...(o.report ? { report: String(o.report).slice(0, 255) } : {}),
    ...(o.format ? { format: String(o.format).slice(0, 16) } : {}),
    ...(o.params ? { params: paramsHash(o.params) } : {}),
    status: o.status || 'ok',
    ...(o.detail ? { detail: clean(o.detail) } : {}),
  };
  try {
    await store().appendAudit(entry);
    if (Date.now() - g.__pwAudit.pruned > HOUR) {
      g.__pwAudit.pruned = Date.now();
      await store().pruneAudit(new Date(Date.now() - retentionDays() * 24 * HOUR).toISOString());
    }
  } catch (e) { console.error(`[pagewright] audit log: could not record ${type}: ${/** @type {Error} */ (e).message}`); }
}

const DAY = /^\d{4}-\d{2}-\d{2}/;
/**
 * Events, newest first. from/to are ISO dates or times (to is exclusive; a bare date "to" means the end of that day).
 * @param {{ from?: string, to?: string, type?: string, actor?: string, report?: string, before?: string, limit?: number }} q
 */
export async function queryAudit(q = {}) {
  const iso = (v, end) => {
    if (!v) return undefined;
    if (!DAY.test(v) || Number.isNaN(Date.parse(v))) throw Object.assign(new Error(`"${String(v).slice(0, 40)}" is not a date (YYYY-MM-DD).`), { status: 400 });
    return v.length === 10 ? (end ? new Date(Date.parse(v) + 24 * HOUR).toISOString() : `${v}T00:00:00.000Z`) : new Date(v).toISOString();
  };
  const s = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  return store().queryAudit({
    from: iso(q.from, false), to: iso(q.to, true), type: s(q.type, 64), actor: s(q.actor, 400), report: s(q.report, 255), before: s(q.before, 64),
    limit: Math.max(1, Math.min(10000, Number(q.limit) || 200)),
  });
}

/** Events as CSV (RFC 4180; a cell that starts with = + - @ gets a ' so a spreadsheet does not run it). @param {any[]} events */
export function auditCsv(events) {
  const cols = ['at', 'type', 'status', 'actor', 'ip', 'report', 'format', 'params', 'detail'];
  const cell = (v) => {
    let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^(?:[=+@\t\r]|-.)/.test(s)) s = `'${s}`; // a lone "-" (no address) is not a formula
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...events.map(e => cols.map(c => cell(e[c])).join(','))].join('\r\n') + '\r\n';
}
