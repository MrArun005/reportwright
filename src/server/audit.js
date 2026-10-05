// @ts-check
// The audit log (enterprise item 3): who did what, to which report, when and from where. Append-only: nothing here
// changes or deletes an event, except retention, which drops events older than PW_AUDIT_RETENTION_DAYS (default 365).
// Stored in the configured storage (src/server/storage): data/audit/<day>.jsonl on files, pw_audit in a database.
//
// Never in an event: passwords, keys, cookies, tokens, connection URLs or parameter values. Parameters are recorded as
// a keyed hash (HMAC-SHA256 with PW_AUDIT_KEY, else PW_SESSION_SECRET), so two renders with the same values can be
// matched without the values being readable. API keys appear as the first 8 hex of their SHA-256.
//
// Tamper evidence (batch 5): every event is chained. Each process (and render thread) writes its own stream: an event
// carries chain { s: stream, n: its number in the stream, prev: the hash of the event before } and hash = SHA-256 of the
// event's canonical JSON (keys sorted, without hash and sig). Streams per process need no lock across servers; changing,
// removing or inserting an event inside a stream breaks its links. Every PW_AUDIT_CHECKPOINT_MINUTES (15) each process
// publishes its stream head and writes a checkpoint event listing the heads of every stream it knows, signed with
// Ed25519 (sig): a whole stream removed, or a stream cut short before a head a checkpoint names, shows too. The signing
// key is PW_AUDIT_SIGNING_KEY (a PEM Ed25519 private key), else one derived from PW_AUDIT_KEY / PW_SESSION_SECRET; its
// public key is on the audit page, so a copy of it kept elsewhere can check the checkpoints. What a chain cannot show: the
// newest events after the last checkpoint removed together with everything after them; ship the log to a SIEM
// (src/server/siem.js) for a copy that is out of reach. verifyAudit() checks it all (the audit page and pw audit verify).
import crypto from 'node:crypto';
import os from 'node:os';
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
const ZERO = '0'.repeat(64);

/* ---------------- the chain ---------------- */

/** JSON with object keys sorted at every level. @param {any} v @returns {string} */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
/** An event's hash: SHA-256 of its canonical JSON without hash and sig. @param {any} e */
export const hashEntry = (e) => { const { hash: _h, sig: _s, ...rest } = e; return crypto.createHash('sha256').update(canonical(rest)).digest('hex'); };

/** This process's (or thread's) stream: { s, n, prev, pending: Set<n>, recent: Map<n, hash> }. */
function chain() {
  if (!g.__pwAudit.chain) {
    let tid = 0;
    try { tid = /** @type {any} */ (process.getBuiltinModule?.('node:worker_threads'))?.threadId || 0; } catch { /* none */ }
    g.__pwAudit.chain = { s: `${os.hostname().slice(0, 40)}:${process.pid}${tid ? `.${tid}` : ''}:${crypto.randomBytes(4).toString('hex')}`, n: 0, prev: ZERO, pending: new Set(), recent: new Map() };
  }
  return g.__pwAudit.chain;
}
/** Link an event into this stream (synchronously: the order of calls is the order of the chain). @param {any} entry */
function link(entry) {
  const c = chain();
  entry.chain = { s: c.s, n: c.n, prev: c.prev };
  entry.hash = hashEntry(entry);
  c.pending.add(c.n);
  c.recent.set(c.n, { hash: entry.hash, at: entry.at });
  if (c.recent.size > 5000) c.recent.delete(c.recent.keys().next().value);
  c.prev = entry.hash; c.n++;
  return entry;
}
/** The newest event of this stream that is surely written (every event before it is written too), or null. */
function writtenHead() {
  const c = chain();
  const n = (c.pending.size ? Math.min(...c.pending) : c.n) - 1;
  return n >= 0 && c.recent.has(n) ? { n, ...c.recent.get(n) } : null;
}

/* ---------------- checkpoint signatures (Ed25519) ---------------- */

function signingKey() {
  if (process.env.PW_AUDIT_SIGNING_KEY) return crypto.createPrivateKey(String(process.env.PW_AUDIT_SIGNING_KEY).replace(/\\n/g, '\n'));
  const secret = process.env.PW_AUDIT_KEY || process.env.PW_SESSION_SECRET || 'pagewright-audit';
  const seed = crypto.createHmac('sha256', secret).update('pagewright-audit-checkpoint-v1').digest();
  return crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
}
/** Where the signing key comes from (the audit page says how much a signature proves). */
export const keySource = () => (process.env.PW_AUDIT_SIGNING_KEY ? 'PW_AUDIT_SIGNING_KEY' : process.env.PW_AUDIT_KEY ? 'PW_AUDIT_KEY' : process.env.PW_SESSION_SECRET ? 'PW_SESSION_SECRET' : 'none');
/** The public key that checks the checkpoints: PW_AUDIT_PUBLIC_KEY when given (PEM), else this server's. */
export function publicKey() {
  if (process.env.PW_AUDIT_PUBLIC_KEY) return crypto.createPublicKey(String(process.env.PW_AUDIT_PUBLIC_KEY).replace(/\\n/g, '\n'));
  return crypto.createPublicKey(signingKey());
}
/** { pem, fingerprint } of the public key. */
export function publicKeyInfo() {
  const k = publicKey();
  const der = k.export({ type: 'spki', format: 'der' });
  return { pem: String(k.export({ type: 'spki', format: 'pem' })), fingerprint: crypto.createHash('sha256').update(der).digest('hex').slice(0, 16) };
}

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
  startCheckpoints();
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
  await write(entry, type);
}

/** Link and append one event; never throws. @param {any} entry @param {string} type */
async function write(entry, type) {
  link(entry);
  const c = chain();
  try {
    await store().appendAudit(entry);
    c.pending.delete(entry.chain.n);
    ship(entry);
    if (Date.now() - g.__pwAudit.pruned > HOUR) {
      g.__pwAudit.pruned = Date.now();
      await store().pruneAudit(new Date(Date.now() - retentionDays() * 24 * HOUR).toISOString());
    }
  } catch (e) {
    c.pending.delete(entry.chain.n); // a gap in the stream now: verification shows it, as it should
    console.error(`[pagewright] audit log: could not record ${type}: ${/** @type {Error} */ (e).message}`);
  }
}

/** Hand a written event to the SIEM shipper when one is set (loaded lazily). @param {any} entry */
function ship(entry) {
  if (!process.env.PW_AUDIT_SIEM) return;
  import('./siem.js').then(m => m.shipAudit(entry), () => {});
}

/* ---------------- checkpoints ---------------- */

const checkpointMs = () => { const n = Number(process.env.PW_AUDIT_CHECKPOINT_MINUTES); return (Number.isFinite(n) && n > 0 ? n : 15) * 60000; };
function startCheckpoints() {
  if (g.__pwAudit.timer || process.env.PW_AUDIT_CHECKPOINTS === 'off') return;
  g.__pwAudit.timer = setInterval(() => { checkpoint().catch(e => console.error(`[pagewright] audit checkpoint: ${e.message}`)); }, checkpointMs());
  g.__pwAudit.timer.unref?.();
}

/**
 * Publish this stream's head and write a signed checkpoint naming every stream head known (src/server/settings.js keeps
 * the heads). Returns the checkpoint event, or null when there was nothing to do.
 * @param {{ actor?: string }} [o]
 */
export async function checkpoint({ actor = 'system' } = {}) {
  const { getRecord: _g, putRecord } = await import('./settings.js');
  const head = writtenHead();
  const c = chain();
  if (head) await putRecord(`audit-head:${c.s}`, { s: c.s, n: head.n, hash: head.hash, at: head.at });
  const cut = Date.now() - retentionDays() * 24 * HOUR;
  const heads = {};
  for (const r of await store().list('settings')) {
    if (!r.id.startsWith('audit-head:')) continue;
    try {
      const h = JSON.parse(r.text);
      if (Date.parse(h.at) < cut) { await store().remove('settings', r.id); continue; } // a stream long gone
      heads[h.s] = [h.n, h.hash, h.at]; // number, hash and time of the stream's newest written event
    } catch { /* skip */ }
  }
  if (!Object.keys(heads).length) return null;
  const entry = { id: '', at: new Date().toISOString(), type: 'audit.checkpoint', actor, ip: '-', status: 'ok', detail: { heads, key: publicKeyInfo().fingerprint } };
  entry.id = `${entry.at}-${String((g.__pwAudit.seq = ((g.__pwAudit.seq || 0) + 1) % 1e6)).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex')}`;
  link(entry);
  entry.sig = crypto.sign(null, Buffer.from(entry.hash, 'hex'), signingKey()).toString('base64');
  try { await store().appendAudit(entry); c.pending.delete(entry.chain.n); ship(entry); }
  catch (e) { c.pending.delete(entry.chain.n); throw e; }
  return entry;
}

/* ---------------- verification ---------------- */

/**
 * Check the log (or a window of it): every chained event's hash, the links in every stream, the checkpoint signatures
 * and the stream heads they name. Events written before the chain existed are counted, not judged.
 * @param {{ from?: string, to?: string, onProgress?: (n: number) => void }} [q]
 * @returns {Promise<{ ok: boolean, events: number, unchained: number, streams: number, checkpoints: number, lastCheckpoint: string|null,
 *   problems: { kind: string, id?: string, stream?: string, detail: string }[], key: { fingerprint: string, source: string } }>}
 */
export async function verifyAudit(q = {}) {
  const windowed = !!(q.from || q.to);
  const iso = (v, end) => (v ? (v.length === 10 ? (end ? new Date(Date.parse(v) + 24 * HOUR).toISOString() : `${v}T00:00:00.000Z`) : new Date(v).toISOString()) : undefined);
  const from = iso(q.from, false), to = iso(q.to, true);
  const pub = publicKey();
  /** @type {Map<string, Map<number, { hash: string, prev: string, id: string, at: string }>>} */
  const streams = new Map();
  const problems = [];
  const bad = (p) => { if (problems.length < 200) problems.push(p); };
  const refs = [];
  let events = 0, unchained = 0, checkpoints = 0, lastCheckpoint = null, oldest = null, before;
  for (;;) {
    const page = await store().queryAudit({ from, to, before, limit: 10000 });
    for (const e of page) {
      events++;
      if (!oldest || e.at < oldest) oldest = e.at;
      if (!e.chain || typeof e.hash !== 'string') { unchained++; continue; }
      if (hashEntry(e) !== e.hash) bad({ kind: 'altered', id: e.id, stream: e.chain.s, detail: 'The event does not match its hash: it was changed after it was written.' });
      const m = streams.get(e.chain.s) || new Map();
      streams.set(e.chain.s, m);
      if (m.has(e.chain.n)) bad({ kind: 'duplicate', id: e.id, stream: e.chain.s, detail: `Two events claim number ${e.chain.n} in this stream.` });
      m.set(Number(e.chain.n), { hash: e.hash, prev: e.chain.prev, id: e.id, at: e.at });
      if (e.type === 'audit.checkpoint') {
        checkpoints++;
        if (!lastCheckpoint || e.at > lastCheckpoint) lastCheckpoint = e.at;
        let ok = false;
        try { ok = typeof e.sig === 'string' && crypto.verify(null, Buffer.from(e.hash, 'hex'), pub, Buffer.from(e.sig, 'base64')); } catch { ok = false; }
        if (!ok) bad({ kind: 'signature', id: e.id, stream: e.chain.s, detail: 'The checkpoint signature does not check with the audit public key.' });
        for (const [s, h] of Object.entries(e.detail?.heads || {})) if (Array.isArray(h)) refs.push({ s, n: Number(h[0]), hash: String(h[1]), at: String(h[2] || e.at), by: e.id });
      }
    }
    q.onProgress?.(events);
    if (page.length < 10000) break;
    before = page.at(-1).id;
  }
  // retention (pruneAudit, hourly) removes events before the start of the day PW_AUDIT_RETENTION_DAYS ago: only events
  // older than that edge (plus a day and an hour of slack) may be missing at the start of a stream, or behind a head
  const edge = new Date(Date.now() - retentionDays() * 24 * HOUR).setUTCHours(0, 0, 0, 0) + 25 * HOUR;
  for (const [s, m] of streams) {
    const ns = [...m.keys()].sort((a, b) => a - b);
    const first = m.get(ns[0]);
    if (ns[0] !== 0 && !windowed && Date.parse(first.at) > edge) bad({ kind: 'missing', stream: s, id: first.id, detail: `The stream starts at event ${ns[0]}: the ones before it are gone.` });
    for (let i = 1; i < ns.length; i++) {
      const cur = m.get(ns[i]);
      if (ns[i] !== ns[i - 1] + 1) bad({ kind: 'missing', stream: s, id: cur.id, detail: `Events ${ns[i - 1] + 1} to ${ns[i] - 1} of this stream are gone.` });
      else if (cur.prev !== m.get(ns[i - 1]).hash) bad({ kind: 'broken', stream: s, id: cur.id, detail: 'The event does not link to the one before it.' });
    }
  }
  for (const r of refs) {
    const m = streams.get(r.s);
    if ((from && r.at < from) || Date.parse(r.at) < edge) continue; // outside the window, or retention may have taken it
    if (!m) { bad({ kind: 'missing', stream: r.s, id: r.by, detail: `A checkpoint names stream ${r.s}, which is gone from the log.` }); continue; }
    const ns = [...m.keys()];
    const max = Math.max(...ns), min = Math.min(...ns);
    if (r.n > max && !(to && r.at >= to)) bad({ kind: 'missing', stream: r.s, id: r.by, detail: `A checkpoint names event ${r.n} of the stream, but it ends at ${max}: its newest events are gone.` });
    else if (r.n >= min && r.n <= max && m.get(r.n)?.hash !== r.hash) bad({ kind: 'altered', stream: r.s, id: r.by, detail: `Event ${r.n} of the stream differs from what a checkpoint recorded.` });
  }
  return { ok: !problems.length, events, unchained, streams: streams.size, checkpoints, lastCheckpoint, problems, key: { fingerprint: publicKeyInfo().fingerprint, source: keySource() } };
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
