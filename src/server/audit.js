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
import { clientAddress } from './limits.js';
import { principalId } from './perms.js';

/** @typedef {import('./perms.js').Principal} Principal */

export const AUDIT_TYPES = /** @type {const} */ ([
  'auth.login', 'auth.login_failed', 'auth.logout', 'auth.sso', 'auth.sso_failed', 'auth.sso_link', 'auth.slo', 'auth.slo_failed',
  'auth.mfa_failed', 'auth.mfa_enabled', 'auth.mfa_disabled', 'auth.mfa_recovery', 'auth.mfa_setup', 'auth.reset_request', 'auth.reset', 'auth.reset_failed',
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
export const hashEntry = (e) => { const { hash: _h, sig: _s, oldSig: _o, ...rest } = e; return crypto.createHash('sha256').update(canonical(rest)).digest('hex'); };

/**
 * This process's (or thread's) stream: { s, n, prev, at, q }. A stream has exactly one writer by construction (its id
 * holds the host, pid, thread and random bytes; nothing else ever appends to it), so no lock across servers is needed
 * and nothing on disk can move its head: n, prev and at advance only after an event is durably written, one event at a
 * time, in the order audit() was called. A new process starts a new stream (nothing stale is reloaded).
 */
function chain() {
  if (!g.__pwAudit.chain) {
    let tid = 0;
    try { tid = /** @type {any} */ (process.getBuiltinModule?.('node:worker_threads'))?.threadId || 0; } catch { /* none */ }
    g.__pwAudit.chain = { s: `${os.hostname().slice(0, 40)}:${process.pid}${tid ? `.${tid}` : ''}:${crypto.randomBytes(4).toString('hex')}`, n: 0, prev: ZERO, at: null, q: [], busy: false };
  }
  return g.__pwAudit.chain;
}
/** The newest durably written event of this stream, or null. */
function writtenHead() {
  const c = chain();
  return c.n > 0 ? { n: c.n - 1, hash: c.prev, at: c.at } : null;
}
const QUEUE_MAX = 20000;
/**
 * Queue an event; it is linked to the stream's written head when its turn comes, appended, and only then does the head
 * move. A failed write is retried (3 tries, 0.2 / 0.4 s apart) and then dropped with an error: a dropped event never got
 * a number, so it leaves no gap that would read as tampering. sign: a checkpoint (signed over its hash).
 * @param {any} entry @param {{ sign?: boolean, oldKey?: crypto.KeyObject }} [o] @returns {Promise<boolean>} written
 */
function enqueue(entry, o = {}) {
  const c = chain();
  return new Promise((resolve) => {
    if (c.q.length >= QUEUE_MAX) { console.error(`[pagewright] audit log: the write queue is full; dropped ${entry.type}`); return resolve(false); }
    c.q.push({ entry, sign: !!o.sign, oldKey: o.oldKey || null, resolve });
    drain();
  });
}
async function drain() {
  const c = chain();
  if (c.busy) return;
  c.busy = true;
  try {
    while (c.q.length) {
      const job = c.q.shift();
      const e = job.entry;
      let ok = false, last = null;
      for (let t = 0; t < 3 && !ok; t++) {
        if (t) await new Promise(r => setTimeout(r, 200 * t));
        e.chain = { s: c.s, n: c.n, prev: c.prev };
        delete e.sig; delete e.oldSig;
        e.hash = hashEntry(e);
        if (job.sign) { const key = signingKey(); if (key) e.sig = crypto.sign(null, Buffer.from(e.hash, 'hex'), key).toString('base64'); }
        if (job.oldKey) e.oldSig = crypto.sign(null, Buffer.from(e.hash, 'hex'), job.oldKey).toString('base64');
        try { await store().appendAudit(e); ok = true; } catch (err) { last = err; }
      }
      if (ok) { c.n++; c.prev = e.hash; c.at = e.at; ship(e); }
      else console.error(`[pagewright] audit log: could not record ${e.type}: ${/** @type {Error} */ (last)?.message}`);
      job.resolve(ok);
    }
  } finally { c.busy = false; }
}

/* ---------------- checkpoint signatures (Ed25519) ---------------- */

/** The checkpoint signing key, or null when none is configured: never a key anyone could know. */
function signingKey() {
  if (process.env.PW_AUDIT_SIGNING_KEY) return crypto.createPrivateKey(String(process.env.PW_AUDIT_SIGNING_KEY).replace(/\\n/g, '\n'));
  const secret = process.env.PW_AUDIT_KEY || process.env.PW_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (!g.__pwAudit.warnedKey) { g.__pwAudit.warnedKey = true; console.error('[pagewright] audit log: no PW_AUDIT_KEY (32+ characters), PW_AUDIT_SIGNING_KEY or PW_SESSION_SECRET, so checkpoints are written UNSIGNED and the chain proves only consistency. Set PW_AUDIT_KEY.'); }
    return null;
  }
  return keyFromSecret(secret);
}
/** The Ed25519 key a secret stands for (the same secret gives the same key on every server). @param {string} secret */
export function keyFromSecret(secret) {
  const seed = crypto.createHmac('sha256', secret).update('pagewright-audit-checkpoint-v1').digest();
  return crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
}
const fingerprintOf = (pub) => crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
/** Where the signing key comes from (the audit page says how much a signature proves). */
export const keySource = () => (process.env.PW_AUDIT_SIGNING_KEY ? 'PW_AUDIT_SIGNING_KEY' : (process.env.PW_AUDIT_KEY || '').length >= 32 ? 'PW_AUDIT_KEY' : (process.env.PW_SESSION_SECRET || '').length >= 32 ? 'PW_SESSION_SECRET' : 'none');
/** The public key that checks the checkpoints: PW_AUDIT_PUBLIC_KEY when given (PEM), else this server's; null without one. */
export function publicKey() {
  if (process.env.PW_AUDIT_PUBLIC_KEY) return crypto.createPublicKey(String(process.env.PW_AUDIT_PUBLIC_KEY).replace(/\\n/g, '\n'));
  const k = signingKey();
  return k ? crypto.createPublicKey(k) : null;
}
/** { pem, fingerprint } of the public key ({ pem: '', fingerprint: 'none' } without one). */
export function publicKeyInfo() {
  const k = publicKey();
  if (!k) return { pem: '', fingerprint: 'none' };
  const der = k.export({ type: 'spki', format: 'der' });
  return { pem: String(k.export({ type: 'spki', format: 'pem' })), fingerprint: crypto.createHash('sha256').update(der).digest('hex').slice(0, 16) };
}

/** The client address (limits.js clientAddress: X-Forwarded-For only from PW_TRUSTED_PROXIES). @param {Request} [req] */
export const clientIp = (req) => clientAddress(req);

/** A keyed hash of parameter values (sorted keys), 16 hex; null for none. @param {Record<string, any>|null|undefined} params */
export function paramsHash(params) {
  if (!params || typeof params !== 'object' || !Object.keys(params).length) return null;
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v);
  // no secret configured: a random key for this process (hashes then match within one process only, never a known key)
  const key = process.env.PW_AUDIT_KEY || process.env.PW_SESSION_SECRET || (g.__pwAudit.paramKey ||= crypto.randomBytes(32).toString('hex'));
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

/** Events whose loss would hide something that matters: if one cannot be written, the request fails (fail closed). */
const SECURITY = /^(auth|user|access|settings|folder|schedule|audit|mail)\.|^report\.(export|delete|restore|import)$/;
export const isSecurityEvent = (type) => SECURITY.test(String(type));

/**
 * Record one event. A security event (isSecurityEvent: sign-ins, accounts, permissions, settings, schedules, exports
 * and deletes) that cannot be written throws (status 503), so the request that caused it fails instead of going on
 * unlogged; sign-in routes write their event before they hand out a session. Other events (api.call, report.view,
 * report.render) never throw: their loss is logged to the console.
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
  const ok = await write(entry, type);
  if (!ok && isSecurityEvent(type)) throw Object.assign(new Error('The audit log could not record this, so it was refused. Try again, or ask an admin to check the server\'s storage.'), { status: 503 });
}

/** Append one event (through the stream's queue); never throws. @param {any} entry @param {string} _type @returns {Promise<boolean>} written */
async function write(entry, _type) {
  if (!g.__pwAudit.exitHook) { g.__pwAudit.exitHook = true; process.once?.('beforeExit', () => { drain(); }); } // flush what waits before a quiet exit
  if (!(await enqueue(entry))) return false;
  const c = chain();
  // publish this stream's head every 30 s, so the next checkpoint (any server's) anchors it even if this process dies
  if (Date.now() - (c.headAt || 0) > 30000 && process.env.PW_AUDIT_CHECKPOINTS !== 'off') { c.headAt = Date.now(); publishHead().catch(() => {}); }
  if (Date.now() - g.__pwAudit.pruned > HOUR) {
    g.__pwAudit.pruned = Date.now();
    await prune().catch((e) => console.error(`[pagewright] audit retention: ${e.message}`));
  }
  return true;
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
  // and one soon after start: it anchors the heads a stopped process left
  setTimeout(() => { checkpoint().catch(() => {}); }, 10000).unref?.();
}
async function publishHead() {
  const head = writtenHead();
  if (!head) return;
  const { putRecord } = await import('./settings.js');
  await putRecord(`audit-head:${chain().s}`, { s: chain().s, n: head.n, hash: head.hash, at: head.at });
}

/**
 * Publish this stream's head and write a signed checkpoint naming every stream head known (src/server/settings.js keeps
 * the heads). Returns the checkpoint event, or null when there was nothing to do.
 * @param {{ actor?: string }} [o]
 */
export async function checkpoint({ actor = 'system' } = {}) {
  await publishHead();
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
  if (!(await enqueue(entry, { sign: true }))) throw new Error('The checkpoint could not be written to the audit log.');
  return entry;
}

/* ---------------- retention and re-keying, as signed records ---------------- */

/**
 * Retention: before events older than the start of the day PW_AUDIT_RETENTION_DAYS ago are removed, a signed
 * audit.prune record names, for every stream with events in what goes, its last removed event (number and hash). The
 * verifier accepts a stream that starts after event 0 only when such a record names exactly the event before its first.
 * If the record cannot be written, nothing is removed. Returns the number of events removed (whole days on files).
 */
export async function prune() {
  const cut = new Date(new Date(Date.now() - retentionDays() * 24 * HOUR).setUTCHours(0, 0, 0, 0)).toISOString();
  if (!(await store().queryAudit({ to: cut, limit: 1 })).length) return 0;
  const last = {};
  for (let before; ;) {
    const page = await store().queryAudit({ to: cut, before, limit: 10000 });
    for (const e of page) if (e.chain && typeof e.hash === 'string' && !(e.chain.s in last)) last[e.chain.s] = [e.chain.n, e.hash];
    if (page.length < 10000) break;
    before = page.at(-1).id;
  }
  const entry = newEntry('audit.prune', 'system', { before: cut, last });
  if (!(await enqueue(entry, { sign: true }))) throw new Error('the prune record could not be written, so nothing was removed');
  return store().pruneAudit(cut);
}

/**
 * Change the signing key without losing what the old one proves: a signed audit.rekey record carries the old public key
 * and is signed by both keys, so checkpoints the old key signed before it still check. Run with the new key configured
 * and the old one given (pw audit rekey --old-secret or --old-key). @param {crypto.KeyObject} oldKey the old private key
 */
export async function rekey(oldKey) {
  const cur = signingKey();
  if (!cur) throw new Error('Configure the new key first (PW_AUDIT_KEY or PW_AUDIT_SIGNING_KEY).');
  const oldPub = crypto.createPublicKey(oldKey);
  if (fingerprintOf(oldPub) === fingerprintOf(crypto.createPublicKey(cur))) throw new Error('The old key is the key configured now.');
  const entry = newEntry('audit.rekey', 'cli', { oldKey: String(oldPub.export({ type: 'spki', format: 'pem' })), oldFingerprint: fingerprintOf(oldPub), newFingerprint: fingerprintOf(crypto.createPublicKey(cur)) });
  if (!(await enqueue(entry, { sign: true, oldKey }))) throw new Error('The re-key record could not be written.');
  return entry;
}

/** A bare event of this process (for system records). */
function newEntry(type, actor, detail) {
  const at = new Date().toISOString();
  return { id: `${at}-${String((g.__pwAudit.seq = ((g.__pwAudit.seq || 0) + 1) % 1e6)).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex')}`, at, type, actor, ip: '-', status: 'ok', detail };
}

/* ---------------- verification ---------------- */

/**
 * Check the log (or a window of it): every chained event's hash, the links in every stream, the checkpoint signatures
 * and the stream heads they name. Events written before the chain existed are counted, not judged.
 * @param {{ from?: string, to?: string, onProgress?: (n: number) => void }} [q]
 * Fails closed: status is 'ok' only when proven (see verdict); ok mirrors status === 'ok'. pending counts the newest
 * events that no signed checkpoint covers yet.
 * @returns {Promise<{ status: 'ok'|'unverified'|'tampered'|'error', ok: boolean, events: number, unchained: number, streams: number,
 *   checkpoints: number, pending: number, lastCheckpoint: string|null, problems: { kind: string, id?: string, stream?: string, detail: string }[],
 *   key: { fingerprint: string, source: string } }>}
 */
export async function verifyAudit(q = {}) {
  const problems = [];
  const bad = (p) => { if (problems.length < 200) problems.push(p); };
  const empty = { events: 0, unchained: 0, streams: 0, checkpoints: 0, lastCheckpoint: null };
  let info = { fingerprint: 'none', source: keySource() };
  try { info = { fingerprint: publicKeyInfo().fingerprint, source: keySource() }; } catch (e) { bad({ kind: 'key', detail: `The audit public key does not load: ${/** @type {Error} */ (e).message}` }); }
  try {
    const r = await verifyNow(q, bad, problems);
    const status = verdict(problems, r);
    return { status, ...r, ok: status === 'ok', key: info };
  } catch (e) { // fail closed: an error is never a pass
    bad({ kind: 'error', detail: `The check stopped: ${/** @type {Error} */ (e).message}` });
    return { status: 'error', ...empty, pending: 0, ok: false, problems, key: info };
  }
}

/** Problems that mean the log was changed (with where), as opposed to what only leaves it unproven. */
/** The one pass test for a verification result: only an explicit status "ok" passes. @param {any} r */
export const auditProven = (r) => !!r && r.status === 'ok';
const SIGNED_TYPES = ['audit.checkpoint', 'audit.prune', 'audit.rekey'];
const TAMPER = new Set(['altered', 'missing', 'broken', 'duplicate', 'unreadable', 'unchained', 'backwards', 'signature']);
/**
 * 'ok' only when everything is proven: at least one checkpoint signed by the configured key, no problem at all.
 * 'tampered' for any sign of a change; 'unverified' when nothing is wrong but nothing proves it either (no key, no
 * signed checkpoint, an empty log, a stale or missing anchor). @param {any[]} problems @param {any} r
 * @returns {'ok'|'unverified'|'tampered'}
 */
function verdict(problems, r) {
  if (problems.some(p => TAMPER.has(p.kind))) return 'tampered';
  if (problems.length || !r.events || !r.signedCheckpoints) return 'unverified';
  return 'ok';
}

/** @param {any} q @param {(p: any) => void} bad @param {any[]} problems */
async function verifyNow(q, bad, problems) {
  const windowed = !!(q.from || q.to);
  const iso = (v, end) => (v ? (v.length === 10 ? (end ? new Date(Date.parse(v) + 24 * HOUR).toISOString() : `${v}T00:00:00.000Z`) : new Date(v).toISOString()) : undefined);
  const from = iso(q.from, false), to = iso(q.to, true);
  const pub = publicKey();
  if (!pub) bad({ kind: 'unverified', detail: 'No audit key is configured (PW_AUDIT_KEY, PW_AUDIT_SIGNING_KEY or PW_AUDIT_PUBLIC_KEY): no checkpoint can be trusted.' });
  /** @type {Map<string, Map<number, { hash: string, prev: string, id: string, at: string }>>} */
  const streams = new Map();
  const refs = [];
  /** the newest signed head of each stream: events at or before it are anchored */
  const anchored = new Map();
  const loose = []; // events without a chain, judged once the first chained event is known
  let events = 0, unchained = 0, checkpoints = 0, signedCheckpoints = 0, lastCheckpoint = null, firstChained = null, before;
  const signedRecs = [];
  for (;;) {
    const page = await store().queryAudit({ from, to, before, limit: 10000, raw: true });
    for (const e of page) {
      if (e.__unreadable !== undefined) { bad({ kind: 'unreadable', detail: `A line of ${e.__file} is not an event: ${e.__unreadable.slice(0, 60)}` }); continue; }
      events++;
      if (!e || typeof e !== 'object' || typeof e.at !== 'string') { bad({ kind: 'unreadable', id: e?.id, detail: 'An event without a time.' }); continue; }
      if (!e.chain || typeof e.hash !== 'string') { loose.push(e); continue; }
      const { s, n } = e.chain;
      if (typeof s !== 'string' || !Number.isInteger(n) || n < 0 || typeof e.chain.prev !== 'string') { bad({ kind: 'unreadable', id: e.id, detail: 'An event with a broken chain field.' }); continue; }
      if (!firstChained || e.at < firstChained) firstChained = e.at;
      if (hashEntry(e) !== e.hash) bad({ kind: 'altered', id: e.id, stream: s, detail: 'The event does not match its hash: it was changed after it was written.' });
      const m = streams.get(s) || new Map();
      streams.set(s, m);
      if (m.has(n)) bad({ kind: 'duplicate', id: e.id, stream: s, detail: `Two events claim number ${n} in this stream.` });
      m.set(n, { hash: e.hash, prev: e.chain.prev, id: e.id, at: e.at });
      if (SIGNED_TYPES.includes(e.type)) { if (e.type === 'audit.checkpoint') checkpoints++; signedRecs.push({ e, s, n }); }
    }
    q.onProgress?.(events);
    if (page.length < 10000) break;
    before = page.at(-1).id;
    if (!before) break;
  }
  // the keys a signature may be from: the configured one, then old keys handed over by a re-key record that a trusted key
  // signed (and the old key too); an old key counts only for records written before its hand-over
  const keys = pub ? [{ k: pub, until: '\uffff' }] : [];
  const sigOk = (e, sig, k) => { try { return typeof sig === 'string' && crypto.verify(null, Buffer.from(e.hash, 'hex'), k, Buffer.from(sig, 'base64')); } catch { return false; } };
  const trusted = (e) => keys.some(x => e.at <= x.until && sigOk(e, e.sig, x.k));
  for (const { e } of signedRecs.filter(r => r.e.type === 'audit.rekey').sort((x, y) => y.e.at.localeCompare(x.e.at))) {
    if (!trusted(e)) continue;
    let old = null;
    try { old = crypto.createPublicKey(String(e.detail?.oldKey)); } catch { old = null; }
    if (old && sigOk(e, e.oldSig, old)) keys.push({ k: old, until: e.at });
    else bad({ kind: 'signature', id: e.id, detail: 'A re-key record is not signed by the old key it names.' });
  }
  const prunes = [];
  for (const { e, s, n } of signedRecs) {
    if (!trusted(e)) {
      bad(typeof e.sig === 'string' && pub ? { kind: 'signature', id: e.id, stream: s, detail: `The ${e.type} signature does not check with the configured audit key or a key it handed over (another key signed it, or it was changed).` } : { kind: 'unverified', id: e.id, stream: s, detail: typeof e.sig === 'string' ? 'No audit key is configured to check this record.' : `The ${e.type} record is not signed (no audit key was set when it was written).` });
      continue;
    }
    anchored.set(s, Math.max(anchored.get(s) ?? -1, n)); // a signed record anchors its own stream up to itself
    if (e.type === 'audit.prune') {
      if (typeof e.detail?.before !== 'string' || !e.detail.last || typeof e.detail.last !== 'object') { bad({ kind: 'unreadable', id: e.id, detail: 'A prune record without its boundary.' }); continue; }
      prunes.push({ before: e.detail.before, last: e.detail.last });
      continue;
    }
    if (e.type !== 'audit.checkpoint') continue;
    signedCheckpoints++;
    if (!lastCheckpoint || e.at > lastCheckpoint) lastCheckpoint = e.at;
    const heads = e.detail?.heads;
    if (!heads || typeof heads !== 'object') { bad({ kind: 'unreadable', id: e.id, detail: 'A checkpoint without heads.' }); continue; }
    for (const [hs, h] of Object.entries(heads)) {
      if (!Array.isArray(h) || !Number.isInteger(h[0])) { bad({ kind: 'unreadable', id: e.id, detail: 'A checkpoint with a broken head.' }); continue; }
      refs.push({ s: hs, n: h[0], hash: String(h[1]), at: String(h[2] || e.at), by: e.id });
      anchored.set(hs, Math.max(anchored.get(hs) ?? -1, h[0]));
    }
  }
  /** a signed prune record removed this stream up to and including event n (with this hash) */
  const prunedTo = (st) => prunes.reduce((m, p) => (Array.isArray(p.last[st]) && Number.isInteger(p.last[st][0]) && (!m || p.last[st][0] > m[0]) ? p.last[st] : m), null);
  // events with no chain are history from before the chain; one written after chaining began was put in by hand
  for (const e of loose) { unchained++; if (firstChained && e.at >= firstChained) bad({ kind: 'unchained', id: e.id, detail: 'An event without a chain, written after the chain began: it was added outside Pagewright.' }); }
  let pending = 0; // events after their stream's newest signed head: not yet checkpointed (counted, never "proven")
  const grace = 2 * checkpointMs() + Math.min(5 * 60000, checkpointMs()); // events newer than this may not be in a checkpoint yet
  for (const [s, m] of streams) {
    const ns = [...m.keys()].sort((a, b) => a - b);
    const first = m.get(ns[0]);
    if (ns[0] !== 0 && !windowed) {
      // only retention may remove a stream's beginning, and it signs what it removed: the event just before this one
      const pr = prunedTo(s);
      if (!pr || pr[0] !== ns[0] - 1 || pr[1] !== first.prev) bad({ kind: 'missing', stream: s, id: first.id, detail: `The stream starts at event ${ns[0]}: the ones before it are gone, and no signed prune record removed them.` });
    }
    for (let i = 1; i < ns.length; i++) {
      const cur = m.get(ns[i]);
      if (ns[i] !== ns[i - 1] + 1) bad({ kind: 'missing', stream: s, id: cur.id, detail: `Events ${ns[i - 1] + 1} to ${ns[i] - 1} of this stream are gone.` });
      else if (cur.prev !== m.get(ns[i - 1]).hash) bad({ kind: 'broken', stream: s, id: cur.id, detail: 'The event does not link to the one before it.' });
      if (Date.parse(cur.at) < Date.parse(m.get(ns[i - 1]).at) - 2000) bad({ kind: 'backwards', stream: s, id: cur.id, detail: `Event ${ns[i]} is dated before event ${ns[i - 1]} of its stream.` });
    }
    pending += ns.filter(n => n > (anchored.get(s) ?? -1)).length;
    // a chain only proves something up to a signed head: older events beyond the newest head are unanchored
    const upTo = anchored.get(s) ?? -1;
    const old = ns.find(n => n > upTo && Date.now() - Date.parse(m.get(n).at) > grace && !(to && m.get(n).at >= to));
    if (old !== undefined && pub) bad({ kind: 'unverified', stream: s, id: m.get(old).id, detail: `Event ${old} and later are in no signed checkpoint although checkpoints run every ${Math.round(checkpointMs() / 60000)} minutes: the stream may have been rewritten or made up.` });
  }
  for (const r of refs) {
    const m = streams.get(r.s);
    if (from && r.at < from) continue; // outside the window
    const pr = prunedTo(r.s);
    if (pr && pr[0] >= r.n) continue; // a signed prune record removed it
    if (!m) { bad({ kind: 'missing', stream: r.s, id: r.by, detail: `A checkpoint names stream ${r.s}, which is gone from the log.` }); continue; }
    const ns = [...m.keys()];
    const max = Math.max(...ns), min = Math.min(...ns);
    if (r.n > max && !(to && r.at >= to)) bad({ kind: 'missing', stream: r.s, id: r.by, detail: `A checkpoint names event ${r.n} of the stream, but it ends at ${max}: its newest events are gone.` });
    else if (r.n >= min && r.n <= max && m.get(r.n)?.hash !== r.hash) bad({ kind: 'altered', stream: r.s, id: r.by, detail: `Event ${r.n} of the stream differs from what a checkpoint recorded.` });
  }
  // the tail: checkpoints run every interval while a server runs, so the newest signed one is recent unless the end of
  // the log (with its checkpoints) was cut away
  if (!to && pub && streams.size && (!lastCheckpoint || Date.now() - Date.parse(lastCheckpoint) > grace)) {
    const newest = [...streams.values()].flatMap(m => [...m.values()]).reduce((a, x) => (x.at > a ? x.at : a), '');
    if (Date.now() - Date.parse(newest) > grace || lastCheckpoint) bad({ kind: 'unverified', detail: lastCheckpoint ? `The newest signed checkpoint is from ${lastCheckpoint}, older than the checkpoint interval allows: the end of the log may be cut off (or no server ran since).` : 'There is no signed checkpoint: nothing anchors the chain.' });
  }
  if (!events) bad({ kind: 'unverified', detail: 'The log is empty (in this window): there is nothing to prove.' });
  else if (!signedCheckpoints && pub) bad({ kind: 'unverified', detail: 'No signed checkpoint: nothing anchors the chain.' });
  return { events, unchained, streams: streams.size, checkpoints, signedCheckpoints, pending, lastCheckpoint, problems };
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
