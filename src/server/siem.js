// @ts-check
// Ship audit events to a SIEM as they are written (src/server/audit.js), so a copy exists out of this server's reach.
//   PW_AUDIT_SIEM=syslog+tls://host:6514   RFC 5424 messages over TLS (RFC 5425 octet-counted framing), facility local0;
//                                          PW_AUDIT_SIEM_CA: a PEM file of CAs to trust (default: the system's)
//   PW_AUDIT_SIEM=https://siem.example.com/hook   a JSON array of events per POST, signed with HMAC-SHA256 of the body
//                                          (PW_AUDIT_SIEM_SECRET) in X-Pagewright-Signature: sha256=<hex>
// Events wait in a queue in this process (PW_AUDIT_SIEM_QUEUE, default 10000; past it the oldest are dropped and
// counted) and are retried with exponential backoff (1 s doubling to 5 minutes) while the SIEM is down. The audit log in
// storage stays the record: a SIEM that missed events can be filled from the CSV export. ponytail: the queue is in
// memory, so events waiting when the process stops are not shipped (they are still in the log).
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { num as cnum } from './config.js';

const g = /** @type {any} */ (globalThis);
const S = g.__pwSiem ||= { queue: [], busy: false, backoff: 0, timer: null, sock: null, dropped: 0, sent: 0, lastError: null, lastOkAt: null };
const max = () => cnum('PW_AUDIT_SIEM_QUEUE', 10000, { min: 1 });
const BATCH = 200;

/** What PW_AUDIT_SIEM names: { kind: 'syslog'|'webhook', url } or null (also for anything unusable). */
export function siemTarget() {
  const v = process.env.PW_AUDIT_SIEM;
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol === 'syslog+tls:' && u.hostname) return { kind: 'syslog', url: u };
    if (u.protocol === 'https:' || (u.protocol === 'http:' && process.env.PW_AUDIT_SIEM_ALLOW_HTTP === '1')) return { kind: 'webhook', url: u };
  } catch { /* fall through */ }
  return null;
}

/** Queue one written event. @param {any} entry */
export function shipAudit(entry) {
  if (!siemTarget()) return;
  S.queue.push(entry);
  if (S.queue.length > max()) { S.dropped += S.queue.length - max(); S.queue.splice(0, S.queue.length - max()); }
  pump();
}

/** One RFC 5424 line: <PRI>1 TIMESTAMP HOST APP PROCID MSGID - MSG (MSG is the event as JSON). @param {any} e */
export function rfc5424(e) {
  const sev = e.status === 'ok' ? 6 : 4; // info, or warning for failed and denied
  const clean = (s, n) => String(s || '-').replace(/[^\x21-\x7e]/g, '_').slice(0, n) || '-';
  return `<${16 * 8 + sev}>1 ${e.at} ${clean(os.hostname(), 255)} reportwright ${process.pid} ${clean(e.type, 32)} - ${JSON.stringify(e)}`;
}

function pump() {
  if (S.busy || S.timer || !S.queue.length) return;
  S.busy = true;
  const batch = S.queue.slice(0, BATCH);
  send(batch).then(() => {
    S.queue.splice(0, batch.length);
    S.sent += batch.length; S.backoff = 0; S.lastOkAt = new Date().toISOString(); S.lastError = null;
  }, (e) => {
    S.lastError = String(e?.message || e).slice(0, 200);
    S.backoff = Math.min(300000, S.backoff ? S.backoff * 2 : 1000);
    S.timer = setTimeout(() => { S.timer = null; pump(); }, S.backoff);
    S.timer.unref?.();
  }).finally(() => { S.busy = false; if (!S.timer) pump(); });
}

/** @param {any[]} batch */
async function send(batch) {
  const t = siemTarget();
  if (!t) return;
  if (t.kind === 'webhook') {
    const body = JSON.stringify(batch);
    const headers = { 'content-type': 'application/json', 'user-agent': 'ReportWright' };
    if (process.env.PW_AUDIT_SIEM_SECRET) headers['x-pagewright-signature'] = `sha256=${crypto.createHmac('sha256', process.env.PW_AUDIT_SIEM_SECRET).update(body).digest('hex')}`;
    // through the SSRF guard (the address the operator set is trusted; no redirects anywhere else)
    const { safeFetch } = await import('./safeFetch.js');
    const res = await safeFetch(t.url, { method: 'POST', headers, body }, { allow: [new URL(t.url).origin], hops: 0, deadline: Date.now() + 15000 });
    res.body?.cancel?.();
    if (!res.ok) throw new Error(`the SIEM answered HTTP ${res.status}`);
    return;
  }
  const sock = await syslogSocket(t.url);
  const frames = batch.map(e => { const m = Buffer.from(rfc5424(e)); return Buffer.concat([Buffer.from(`${m.length} `), m]); });
  await new Promise((resolve, reject) => sock.write(Buffer.concat(frames), (err) => (err ? reject(err) : resolve(undefined))));
}

/** A TLS connection to the syslog receiver, kept open and made again when it drops. @param {URL} u */
function syslogSocket(u) {
  if (S.sock && !S.sock.destroyed && /** @type {any} */ (S.sock).pw === u.href) return Promise.resolve(S.sock);
  return new Promise((resolve, reject) => {
    const ca = process.env.PW_AUDIT_SIEM_CA ? fs.readFileSync(process.env.PW_AUDIT_SIEM_CA) : undefined;
    const sock = tls.connect({ host: u.hostname, port: Number(u.port) || 6514, servername: u.hostname, ca, rejectUnauthorized: true, timeout: 15000 }, () => { S.sock = sock; resolve(sock); });
    /** @type {any} */ (sock).pw = u.href;
    sock.setKeepAlive(true);
    sock.on('error', (e) => { if (S.sock === sock) S.sock = null; reject(e); });
    sock.on('close', () => { if (S.sock === sock) S.sock = null; });
    sock.on('timeout', () => sock.destroy(new Error('the SIEM did not answer')));
    sock.on('data', () => {}); // syslog receivers send nothing; drain anything
  });
}

/** For the Settings page and tests. */
export function siemStatus() {
  const t = siemTarget();
  return { on: !!t, kind: t?.kind || null, host: t ? t.url.host : null, configured: !!process.env.PW_AUDIT_SIEM, queued: S.queue.length, sent: S.sent, dropped: S.dropped, lastError: S.lastError, lastOkAt: S.lastOkAt };
}
/** Wait until the queue is empty (tests). */
export async function siemIdle(ms = 10000) { const t0 = Date.now(); while ((S.queue.length || S.busy) && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 20)); }
/** Forget the connection and the counters (tests). */
export function siemReset() { S.sock?.destroy(); Object.assign(S, { queue: [], busy: false, backoff: 0, sock: null, dropped: 0, sent: 0, lastError: null, lastOkAt: null }); if (S.timer) { clearTimeout(S.timer); S.timer = null; } }
