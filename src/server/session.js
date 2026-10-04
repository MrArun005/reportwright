// @ts-check
// Sessions for user accounts (PW_AUTH=users). The cookie pw_session holds { e, r, iat, exp, v } and an
// HMAC-SHA256 over it with PW_SESSION_SECRET. Every request reads the user again (role, disabled,
// sessionVersion), so a demoted, disabled or deleted user loses access at once.
import crypto from 'node:crypto';
import { cachedUser } from './users.js';

export const ROLE_RANK = Object.freeze({ viewer: 1, designer: 2, admin: 3 });
export const COOKIE = 'pw_session';
const MAX_AGE = 12 * 60 * 60; // seconds
const INTERNAL_AGE = 120;

export const accountsOn = () => process.env.PW_AUTH === 'users';

/**
 * With accounts off: whether the server trusts whoever reaches it (saves reports, runs SQL). Outside production
 * (next dev) yes; in production only behind PW_BASIC_AUTH, or with PW_AUTH=proxy (a reverse proxy in front of the app
 * signs everyone in). Production with none of them fails closed: see openGate in proxy.js.
 */
export const openTrusted = () => !accountsOn() && (process.env.NODE_ENV !== 'production' || basicOn() || proxyOn());
/**
 * PW_AUTH=proxy as a sign-in: in production only with PW_PROXY_SECRET (16+ characters), which the reverse proxy sends
 * and proxySecretOk checks, so a request that reaches the app port around the proxy proves nothing. Pagewright reads no
 * identity header in this mode: whoever comes through the proxy is the one trusted operator (as PW_BASIC_AUTH).
 */
export const proxyOn = () => process.env.PW_AUTH === 'proxy' && (process.env.NODE_ENV !== 'production' || (process.env.PW_PROXY_SECRET || '').length >= 16);
/** PW_BASIC_AUTH as "user:password", both parts non-empty. Anything else ("x", ":", "u:") is not a sign-in. */
export const basicOn = () => /^[^:]+:.+$/.test(process.env.PW_BASIC_AUTH || '');
/** Development with nobody signing in: trusted only because it is next dev (see devHostOk). */
export const devOpen = () => !accountsOn() && process.env.NODE_ENV !== 'production' && !basicOn() && !proxyOn();
/**
 * next dev with nobody signing in answers only to a local host name: a page that re-points its own name at 127.0.0.1
 * (DNS rebinding) sends its own name as Host. localhost, 127.0.0.1, ::1, the PW_BASE_URL host and PW_DEV_HOSTS.
 * ponytail: a Host header is the client's word, so this stops browsers, not a LAN client: run next dev -H 127.0.0.1.
 * @param {Request} req
 */
export function devHostOk(req) {
  let host;
  try { host = new URL(`http://${req.headers.get('host') || new URL(req.url).host}`).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return false; }
  const ok = ['localhost', '127.0.0.1', '::1', ...(process.env.PW_DEV_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)];
  try { if (process.env.PW_BASE_URL) ok.push(new URL(process.env.PW_BASE_URL).hostname.toLowerCase()); } catch { /* ignore */ }
  return ok.includes(host);
}
/**
 * PW_AUTH=proxy with PW_PROXY_SECRET: the reverse proxy sends it as x-pagewright-proxy-secret, so a request that
 * reaches the app port directly (around the proxy) is refused. Without PW_PROXY_SECRET: true (and a warning at start).
 * @param {Request} req
 */
export function proxySecretOk(req) {
  const want = process.env.PW_PROXY_SECRET;
  if (process.env.PW_AUTH !== 'proxy' || !want) return true;
  const d = (s) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(d(req.headers.get('x-pagewright-proxy-secret') || ''), d(want));
}
/** Production with nobody signing in, and PW_PUBLIC_READONLY=1: anyone may open and render the saved reports, nothing more. */
export const publicReadonly = () => !accountsOn() && !openTrusted() && process.env.PW_PUBLIC_READONLY === '1';
/** What a production server with no sign-in answers (and logs when it starts). */
export const NO_AUTH_HELP = 'This Pagewright server runs in production with no sign-in, so it refuses changes and server-side data. Set PW_AUTH=users (accounts, SSO), or PW_BASIC_AUTH="user:password", or PW_AUTH=proxy with PW_PROXY_SECRET (16+ characters, sent by the signing-in reverse proxy as x-pagewright-proxy-secret). PW_PUBLIC_READONLY=1 lets anyone open and render the saved reports (and their saved queries), read-only.';

/** PW_SESSION_SECRET; in development a random one per process (sessions end on restart). */
export function sessionSecret() {
  const s = process.env.PW_SESSION_SECRET;
  if (s) {
    if (s.length < 32) throw new Error('PW_SESSION_SECRET is too short: use at least 32 random characters (openssl rand -hex 32).');
    return s;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('PW_AUTH=users needs PW_SESSION_SECRET (at least 32 random characters, e.g. openssl rand -hex 32). The server will not serve requests without it.');
  const g = /** @type {any} */ (globalThis);
  if (!g.__pwDevSecret) {
    g.__pwDevSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[pagewright] PW_SESSION_SECRET is not set: using a random secret for this process, so sessions end when it restarts.');
  }
  return g.__pwDevSecret;
}

const mac = (body) => crypto.createHmac('sha256', sessionSecret()).update(`pw_session.${body}`).digest();

/** A signed token "<payload>.<mac>" (base64url). iat and exp are added when missing. @param {Record<string, any>} payload */
export function signSession(payload) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ iat: now, exp: now + MAX_AGE, ...payload })).toString('base64url');
  return `${body}.${mac(body).toString('base64url')}`;
}

/** The payload of a token with a good signature that has not expired, else null. @param {string} token */
export function readToken(token) {
  const [body, sig, extra] = String(token || '').split('.');
  if (!body || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, 'base64url');
  const want = mac(body);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  return p && typeof p.exp === 'number' && p.exp > Date.now() / 1000 ? p : null;
}

/** @param {Request} req @param {string} name */
function cookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * The signed-in user, read again from storage: { email, role, groups }, or null. Null also when accounts are off.
 * A server-to-itself pass (internalCookie) gives { role: 'viewer', internal: true } for its one GET only.
 * @param {Request} req @returns {Promise<{ email: string, role: 'viewer'|'designer'|'admin', groups: string[], internal?: boolean } | null>}
 */
export async function currentUser(req) {
  if (!accountsOn()) return null;
  const p = readToken(cookie(req, COOKIE) || '');
  if (!p) return null;
  if (p.srv) {
    const u = new URL(req.url);
    return (req.method === 'GET' || req.method === 'HEAD') && p.path === u.pathname + u.search ? { email: '', role: 'viewer', groups: [], internal: true } : null;
  }
  const user = typeof p.e === 'string' ? await cachedUser(p.e) : null;
  if (!user || user.disabled || (user.sessionVersion || 0) !== p.v || !(user.role in ROLE_RANK)) return null;
  return { email: user.email, role: user.role, groups: user.groups || [] };
}

const isHttps = (req) => new URL(req.url).protocol === 'https:' || (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https' || /^https:/.test(process.env.PW_BASE_URL || '');

/** Set-Cookie for a new session of this user. @param {Request} req @param {{ email: string, role: string, sessionVersion?: number }} user */
export function sessionCookie(req, user) {
  const token = signSession({ e: user.email, r: user.role, v: user.sessionVersion || 0 });
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${isHttps(req) ? '; Secure' : ''}`;
}
/** @param {Request} req */
export const clearCookie = (req) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;

/**
 * For the server's calls to itself (relative data URLs in server renders, batches, schedules): a viewer pass
 * that is good for 2 minutes and for this one GET only. If it leaks it opens nothing the render did not show.
 * @param {string} url the URL being fetched
 */
export function internalCookie(url) {
  const u = new URL(url);
  const now = Math.floor(Date.now() / 1000);
  return `${COOKIE}=${signSession({ srv: 1, path: u.pathname + u.search, iat: now, exp: now + INTERNAL_AGE })}`;
}

/**
 * CSRF: a write that carries the session cookie must come from a page of this site. Origin, or else Referer,
 * must name the request's host (the Host header, X-Forwarded-Host from a reverse proxy, or PW_BASE_URL).
 * @param {Request} req
 */
export function sameOrigin(req) {
  const src = req.headers.get('origin') || req.headers.get('referer');
  if (!src || src === 'null') return false;
  let host;
  try { host = new URL(src).host; } catch { return false; }
  const hosts = [req.headers.get('host'), (req.headers.get('x-forwarded-host') || '').split(',')[0].trim(), new URL(req.url).host];
  if (process.env.PW_BASE_URL) { try { hosts.push(new URL(process.env.PW_BASE_URL).host); } catch { /* ignore */ } }
  return hosts.some(h => h && h.toLowerCase() === host.toLowerCase());
}

/** "next" after sign-in: a path on this site only (no //host, no /\host, no control characters). */
export const safeNext = (n) => (typeof n === 'string' && /^\/(?![/\\])[^\x00-\x20\\]*$/.test(n) ? n : '/');

// Sign-in rate limit, in memory: 10 failures in 15 minutes per client address and email, and 50 per email from
// all addresses together. Next passes on an X-Forwarded-For the client sent (it only adds one when there is
// none), so without a reverse proxy the address can be made up: the per-email cap bounds what that buys.
// ponytail: per process; several servers each count on their own (a shared store such as Redis if that matters)
const WINDOW = 15 * 60 * 1000, PER_ADDRESS = 10, PER_EMAIL = 50;
/** @type {Map<string, number[]>} */
const failures = (/** @type {any} */ (globalThis).__pwLoginFails ||= new Map());

/**
 * Keys for one sign-in: [address+email, email]. The address is the last X-Forwarded-For hop (the one our own
 * reverse proxy appends, e.g. nginx proxy_add_x_forwarded_for), else the socket address Next puts there.
 * @param {Request} req @param {string} email
 */
export const loginKey = (req, email) => [`${(req.headers.get('x-forwarded-for') || '').split(',').pop()?.trim() || '-'}|${email}`, `*|${email}`];
const recent = (key) => (failures.get(key) || []).filter(t => t > Date.now() - WINDOW);

/** Seconds until another try is allowed, or 0. @param {string[]} keys from loginKey */
export function loginBlocked([one, all]) {
  const wait = (r, limit) => (r.length >= limit ? Math.ceil((r[r.length - limit] + WINDOW - Date.now()) / 1000) : 0);
  return Math.max(wait(recent(one), PER_ADDRESS), wait(recent(all), PER_EMAIL));
}
/** @param {string[]} keys */
export function loginFailed(keys) {
  if (failures.size > 10000) for (const k of failures.keys()) if (!recent(k).length) failures.delete(k);
  if (failures.size > 100000) failures.clear(); // bounded memory under a spray of made-up emails
  for (const k of keys) failures.set(k, [...recent(k), Date.now()].slice(-PER_EMAIL));
}
/** A good sign-in clears its address's count, not the per-email one (that would let an attacker reset it). @param {string[]} keys */
export function loginSucceeded([one]) { failures.delete(one); }
