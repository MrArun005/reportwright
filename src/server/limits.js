// @ts-check
// Attempt limits that hold across servers (and the processes of scripts/cluster.mjs): a limit of N tries in a window is
// N storage leases ("slots") named after the key. A try takes a free slot for the window; when every slot is held, the
// try is refused. A try that succeeds may give its slot back (release). Leases are atomic in every storage (a file lock,
// one SQL statement), so N tries at once still get at most N slots: no check-then-count race.
// ponytail: a refused try costs N lease reads; fine for the small limits used here (5 codes, 3 reset mails).
import crypto from 'node:crypto';
import { store } from './storage/index.js';

/** An account name as limits count it: NFKC, trimmed, lower case, without a trailing dot on the domain. @param {any} s */
export const normAccount = (s) => String(s ?? '').normalize('NFKC').trim().toLowerCase().replace(/\.+$/, '');
/**
 * The name of a limit: a hash of a JSON tuple [kind, ...parts], so no two different tuples share one (string joins
 * with a separator can: an email holding the separator, an IPv6 address holding ':'). Parts named "account" and
 * "net" in the callers go through normAccount and netKey first.
 * @param {string | any[]} key
 */
export function limitHash(key) {
  return crypto.createHash('sha256').update(Array.isArray(key) ? JSON.stringify(key) : `s:${key}`).digest('hex').slice(0, 32);
}

/**
 * Take one try for `key` (at most `limit` per `windowMs`). { ok: false } when the limit is reached.
 * key: a tuple [kind, ...parts] (limitHash). @param {string | any[]} key @param {number} limit @param {number} windowMs
 * @returns {Promise<{ ok: boolean, retryAfter: number, release: () => Promise<void> }>}
 */
export async function attempt(key, limit, windowMs) {
  sweepSoon();
  const name = `rl:${limitHash(key)}`;
  // a key found full is refused from memory for 5 s: a flood of refused tries does not each cost `limit` lease reads
  const full = fullKeys.get(name);
  if (full && full > Date.now()) return { ok: false, retryAfter: Math.ceil(windowMs / 1000), release: async () => {} };
  const owner = crypto.randomBytes(8).toString('hex');
  const start = crypto.randomInt(limit);
  for (let k = 0; k < limit; k++) {
    const slot = `${name}:${(start + k) % limit}`;
    if (await store().lease(slot, owner, windowMs)) return { ok: true, retryAfter: 0, release: async () => { fullKeys.delete(name); await store().release(slot, owner); } };
  }
  if (fullKeys.size > 10000) fullKeys.clear();
  fullKeys.set(name, Date.now() + 5000);
  return { ok: false, retryAfter: Math.ceil(windowMs / 1000), release: async () => {} };
}
/** @type {Map<string, number>} */
const fullKeys = (/** @type {any} */ (globalThis).__pwFullKeys ||= new Map());

/* ---------------- the client address ---------------- */

// Next.js keeps an X-Forwarded-For the client sent (it only adds the socket address when there is none), so the header
// alone can be made up by anyone who reaches the port. trackPeers() (instrumentation.js, at boot) stamps every request
// with the socket's own address in x-pw-peer, overwriting any copy the client sent; clientAddress() then believes
// X-Forwarded-For only when that peer is one of PW_TRUSTED_PROXIES (IPs or CIDRs, comma-separated, e.g.
// "10.0.0.0/8,127.0.0.1"), walking it from the right past the trusted hops.
const g = /** @type {any} */ (globalThis);
const PEER = 'x-pw-peer';

/** Stamp each request with its socket address (once per process). */
export function trackPeers() {
  if (g.__pwPeers) return;
  g.__pwPeers = true;
  const http = /** @type {typeof import('node:http')} */ (process.getBuiltinModule('node:http'));
  const https = /** @type {typeof import('node:https')} */ (process.getBuiltinModule('node:https'));
  for (const S of [http.Server, https.Server]) {
    const emit = S.prototype.emit;
    S.prototype.emit = function (ev, req, ...rest) {
      if (ev === 'request' && req?.headers) req.headers[PEER] = req.socket?.remoteAddress || '';
      return emit.call(this, ev, req, ...rest);
    };
  }
}

const norm = (a) => String(a || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '').replace(/^\[|\]$/g, '').slice(0, 64);
let trustedKey = null, trustedList = null;
/** PW_TRUSTED_PROXIES as a BlockList (re-read when it changes). */
function trusted() {
  const v = process.env.PW_TRUSTED_PROXIES || '';
  if (v !== trustedKey) {
    const net = /** @type {typeof import('node:net')} */ (process.getBuiltinModule('node:net'));
    const list = new net.BlockList();
    for (const part of v.split(',').map(x => x.trim()).filter(Boolean)) {
      const [ip, bits] = part.split('/');
      const type = net.isIPv6(ip) ? 'ipv6' : net.isIPv4(ip) ? 'ipv4' : null;
      if (!type) { console.warn(`[pagewright] PW_TRUSTED_PROXIES: "${part}" is not an IP or CIDR; ignored.`); continue; }
      if (bits !== undefined) list.addSubnet(ip, Number(bits), type); else list.addAddress(ip, type);
    }
    trustedKey = v; trustedList = list;
  }
  return trustedList;
}
const isTrusted = (a) => { const net = /** @type {typeof import('node:net')} */ (process.getBuiltinModule('node:net')); const t = net.isIPv6(a) ? 'ipv6' : net.isIPv4(a) ? 'ipv4' : null; return !!t && trusted().check(a, t); };

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:)/i;
/**
 * True when the request came through a proxy this server was not told about: the peer is a private or loopback address,
 * not in PW_TRUSTED_PROXIES, and the request carries X-Forwarded-For. Every client then looks like the proxy, so they
 * share one count in checkCredential. Says so in the log once. @param {Request} [req]
 */
export function unknownProxy(req) {
  if (!req?.headers || !g.__pwPeers) return false;
  const peer = norm(req.headers.get(PEER));
  const yes = !!peer && PRIVATE.test(peer) && !isTrusted(peer) && !!req.headers.get('x-forwarded-for');
  if (yes && !g.__pwWarnedProxy) { g.__pwWarnedProxy = true; console.error(`[pagewright] requests come through a proxy at ${peer} that PW_TRUSTED_PROXIES does not name: every client looks like it, so every client shares one sign-in count. Set PW_TRUSTED_PROXIES.`); }
  return yes;
}

/** An address as limits count it: an IPv6 address by its /64 (one host gets a whole /64), IPv4 as it is. @param {string} a */
export function netKey(a) {
  const net = /** @type {typeof import('node:net')} */ (process.getBuiltinModule('node:net'));
  a = String(a || '').trim().replace(/^\[([^\]]+)\](:\d+)?$/, '$1').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1'); // a port, as some proxies write it
  if (!net.isIPv6(a)) return a;
  const v4tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  let s = a.toLowerCase();
  if (v4tail) { const p = v4tail[1].split('.').map(Number); s = s.slice(0, -v4tail[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`; }
  const [head, tail = ''] = s.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = (s.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h).map(x => parseInt(x, 16) || 0);
  // IPv4-mapped (::ffff:0:0/96) in any spelling: the IPv4 address, counted as one
  if (full.slice(0, 5).every(x => x === 0) && full[5] === 0xffff) return [full[6] >> 8, full[6] & 255, full[7] >> 8, full[7] & 255].join('.');
  return `${full.slice(0, 4).map(x => x.toString(16)).join(':')}::/64`;
}

/**
 * The client address for limits and the audit log: the socket's address, or, when that is a trusted proxy, the last
 * X-Forwarded-For hop that is not one. '-' when this process does not stamp peers (a custom server without
 * instrumentation, tests): then nothing the client sent is believed.
 * @param {Request} [req]
 */
export function clientAddress(req) {
  if (!req?.headers || !g.__pwPeers) return '-';
  const peer = norm(req.headers.get(PEER));
  if (!peer) return '-';
  if (!isTrusted(peer)) return peer;
  const hops = (req.headers.get('x-forwarded-for') || '').split(',').map(norm).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!isTrusted(hops[i])) return hops[i];
  return hops[0] || peer;
}

// leases that ran out are removed hourly (a spray of made-up keys must not grow the storage without bound)
function sweepSoon() {
  if (Date.now() - (g.__pwLeaseSweep || 0) < 3600 * 1000) return;
  g.__pwLeaseSweep = Date.now();
  store().sweepLeases?.(Date.now() - 60000).catch((e) => console.error(`[pagewright] lease sweep: ${e.message}`));
}

/* ---------------- every credential check ---------------- */

const emailKey = (email) => limitHash(['account', normAccount(email)]);
/** The caps (docs/GOVERNANCE.md, "Sign-in limits"). */
export const CAPS = Object.freeze({
  source: { n: 20, ms: 10 * 60 * 1000 }, // failures from one network across every account: a spray
  account: { n: 10, ms: 15 * 60 * 1000 }, // failures on one account from browsers it does not know
  device: { n: 10, ms: 15 * 60 * 1000 }, // failures from one known device (its own budget)
});
/** Kinds whose secret belongs to an account (the per-account cap and device cookies apply). */
const PER_ACCOUNT = new Set(['password', 'mfa']);

/** The account's unlock epoch: an admin unlock starts every count for it afresh. @param {string} email */
async function epoch(email) {
  const { getRecord } = await import('./settings.js');
  return (await getRecord(`login-unlock:${emailKey(email)}`).catch(() => null))?.at || 0;
}
/** Admin unlock: forget every failure counted for this account (all sources). @param {string} email */
export async function unlockLogin(email) {
  const { putRecord } = await import('./settings.js');
  await putRecord(`login-unlock:${emailKey(email)}`, { at: Date.now() });
}

const tooMany = (retryAfter, msg) => Object.assign(new Error(msg), { status: 429, retryAfter });

/**
 * Every check of a secret someone presents goes through here: a password, an API key, PW_BASIC_AUTH, the proxy
 * secret, a TOTP or recovery code, an emailed enrolment code, the pending 2FA step, a reset token, a download link's
 * signature (tests/engine/r1a-credential.test.js fails when one does not). The OWASP device-cookie design:
 *   1. per network (the client address from trusted proxies only, IPv6 by /64): 20 failures in 10 minutes across all
 *      accounts, then 429 with Retry-After for that network: a spray is capped;
 *   2. per account (password, second factor): 10 failures in 15 minutes from browsers the account does not know, then
 *      429 for such browsers: a distributed brute force is capped;
 *   3. a browser with a valid device cookie for the account (session.knownDevice: set after a complete sign-in,
 *      rotating, ended by a password change or sign-out everywhere) is not under cap 2; it has its own 10 per 15
 *      minutes. So an attack cannot lock out an owner who has signed in from that browser before;
 *   4. a new browser on a capped account gets in by a password reset (mailed; its own limits) or an admin unlock.
 * A right secret gives its tries back (they do not count). Counts are storage leases: atomic, on every server.
 * Throws 429 (with retryAfter, seconds) when a cap is reached; otherwise returns what `verify` returned.
 * Residual: a credential without an account (API keys, basic auth, the proxy secret, links, reset tokens) has the
 * per-network cap only: those are long random values (basic auth: choose a long password).
 * @template T @param {{ kind: string, account?: string, req?: Request, address?: string }} who
 * @param {() => Promise<T> | T} verify returns a truthy value for a right secret @returns {Promise<T>}
 */
export async function checkCredential(who, verify) {
  sweepSoon();
  if (who.req) unknownProxy(who.req); // says once in the log when a proxy in front is not in PW_TRUSTED_PROXIES
  const acct = normAccount(who.account ?? '-');
  const net = netKey(who.address ?? clientAddress(who.req));
  const taken = [];
  const take = async (key, cap, msg) => {
    const t = await attempt(key, cap.n, cap.ms);
    if (!t.ok) { await Promise.all(taken.map(x => x.release())); throw tooMany(t.retryAfter, msg); }
    taken.push(t);
  };
  await take(['cred-src', who.kind, net], CAPS.source, 'Too many failed tries from this network. Try again later.');
  if (PER_ACCOUNT.has(who.kind) && acct !== '-') {
    const era = await epoch(acct);
    const { getUser } = await import('./users.js');
    const { knownDevice } = await import('./session.js');
    const device = knownDevice(who.req, await getUser(acct).catch(() => null));
    if (device) await take(['cred-dev', who.kind, acct, era, device], CAPS.device, 'Too many failed tries from this browser. Try again later.');
    else await take(['cred-acct', who.kind, acct, era], CAPS.account, 'Too many failed sign-ins for this account. Try again later, sign in from a browser you used before, or reset your password.');
  }
  let ok = null, err = null;
  try { ok = await verify(); } catch (e) { err = e; }
  const wrong = !ok && (!err || [400, 401, 403].includes(/** @type {any} */ (err).status)); // a refused secret, not a server error
  if (!wrong) await Promise.all(taken.map(x => x.release())); // a right secret (or a server error) does not count
  if (err) throw err;
  return ok;
}
