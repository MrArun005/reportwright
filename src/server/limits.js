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
 * not in PW_TRUSTED_PROXIES, and the request carries X-Forwarded-For. Every client then looks like the proxy, so the
 * cap per source for all emails would let one person lock everyone out: loginAttempt skips that one (the caps per source
 * and email, and the per-account turn, still hold; a LAN client's made-up header gains nothing more).
 * Says so in the log once. @param {Request} [req]
 */
export function unknownProxy(req) {
  if (!req?.headers || !g.__pwPeers) return false;
  const peer = norm(req.headers.get(PEER));
  const yes = !!peer && PRIVATE.test(peer) && !isTrusted(peer) && !!req.headers.get('x-forwarded-for');
  if (yes && !g.__pwWarnedProxy) { g.__pwWarnedProxy = true; console.error(`[pagewright] requests come through a proxy at ${peer} that PW_TRUSTED_PROXIES does not name: every client looks like it, so the sign-in cap per address for all accounts is off. Set PW_TRUSTED_PROXIES.`); }
  return yes;
}

/** An address as limits count it: an IPv6 address by its /64 (one host gets a whole /64), IPv4 as it is. @param {string} a */
export function netKey(a) {
  const net = /** @type {typeof import('node:net')} */ (process.getBuiltinModule('node:net'));
  if (!net.isIPv6(a)) return a;
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = a.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map(x => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
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

/* ---------------- password sign-in ---------------- */

const WINDOW = 15 * 60 * 1000;
const hotDelay = () => { const n = Number(process.env.PW_LOGIN_SLOW_MS); return Number.isFinite(n) && n >= 0 && process.env.PW_LOGIN_SLOW_MS !== '' && process.env.PW_LOGIN_SLOW_MS !== undefined ? n : 2000; };
const emailKey = (email) => limitHash(['account', normAccount(email)]);

/** The account's unlock epoch: an admin unlock starts every count for it afresh. @param {string} email */
async function epoch(email) {
  const { getRecord } = await import('./settings.js');
  return (await getRecord(`login-unlock:${emailKey(email)}`).catch(() => null))?.at || 0;
}
/** Admin unlock: forget every sign-in failure counted for this account (all sources). @param {string} email */
export async function unlockLogin(email) {
  const { putRecord } = await import('./settings.js');
  await putRecord(`login-unlock:${emailKey(email)}`, { at: Date.now() });
}

/**
 * Password sign-in limits, across servers. Take them before checking the password; give them back when it was right.
 * - Per source (the client address, see clientAddress): 10 failures in 15 minutes for one email → 429 for that source
 *   only; 100 for all emails (a spray from one source) → 429; after 5 for one email each try waits 1 s first (backoff).
 * - Per account (all sources): past 50 failures in 15 minutes, one try per PW_LOGIN_SLOW_MS (2 s) across every source
 *   and server; others at the same moment get 429 with Retry-After. The right password still signs in on its turn
 *   (and a second factor is still asked for), so others' failures slow the owner down but never lock them out.
 * - Names are hashes of [kind, account, network] tuples (limitHash), the account normalised (normAccount).
 * - IPv6 sources count by /64. Behind a proxy PW_TRUSTED_PROXIES does not name (unknownProxy), the cap per source for
 *   all emails is off (every client would share it). Set PW_TRUSTED_PROXIES: until then one person can still slow
 *   a named account behind that proxy (10 tries per source and email).
 * - An admin can start an account's counts afresh (unlockLogin, PATCH /api/users/<email> { unlockSignIn: true }).
 * @param {string} address @param {string} email
 * @returns {Promise<{ ok: boolean, retryAfter: number, delayMs: number, release: () => Promise<void> }>}
 */
export async function loginAttempt(address, email, { perSource = true, knownDevice = false } = {}) {
  const acct = normAccount(`${email}`);
  const era = await epoch(acct);
  const net = netKey(address);
  const one = await attempt(['login', acct, era, net], 10, WINDOW);
  if (!one.ok) return { ...one, delayMs: 0 };
  const none = { ok: true, retryAfter: 0, release: async () => {} };
  const src = perSource ? await attempt(['login-src', net], 100, WINDOW) : none;
  if (!src.ok) { await one.release(); return { ...src, delayMs: 0 }; }
  const soft = await attempt(['login-soft', acct, era, net], 5, WINDOW);
  const all = await attempt(['login-all', acct, era], 50, WINDOW);
  const release = async () => { await Promise.all([one.release(), src.release(), soft.release(), all.release()]); };
  if (!all.ok && hotDelay() && !knownDevice) {
    // a hot account: one try at a time across all sources and servers, one per PW_LOGIN_SLOW_MS (a lease left to run
    // out). Parallel tries get 429 and wait their turn. A browser that signed in to this account before (its device
    // cookie) skips this: however many tries others make, the owner's right password and second factor get in.
    const ms = hotDelay();
    if (!(await store().lease(`login-turn:${limitHash(['turn', acct, era])}`, crypto.randomBytes(6).toString('hex'), ms))) {
      await release();
      return { ok: false, retryAfter: Math.max(1, Math.ceil(ms / 1000)), delayMs: 0, release: async () => {} };
    }
  }
  return { ok: true, retryAfter: 0, delayMs: soft.ok ? 0 : 1000, release };
}
