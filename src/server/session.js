// @ts-check
// Sessions for user accounts (PW_AUTH=users). The cookie pw_session holds { e, r, iat, exp, v, m?, s? } and an
// HMAC-SHA256 over it with PW_SESSION_SECRET. Every request reads the user again (role, disabled,
// sessionVersion), so a demoted, disabled or deleted user loses access at once.
// m: the session was opened with a second factor (src/server/totp.js); s: by single sign-on ('oidc' | 'saml'). A role
// that must use two-factor sign-in (Settings, require2fa) has no session without m, unless it came from SSO (the
// identity provider owns the factors) or the account has no password.
// Between the password and the code, the browser holds pw_mfa (5 minutes, its own MAC purpose: never a session).
import crypto from 'node:crypto';
import { cachedUser, getUser } from './users.js';
import { getSettings } from './settings.js';
import { devMode } from './config.js';

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
export const openTrusted = () => !accountsOn() && (devMode() || basicOn() || proxyOn());
/**
 * PW_AUTH=proxy as a sign-in: in production only with PW_PROXY_SECRET (16+ characters), which the reverse proxy sends
 * and proxySecretOk checks, so a request that reaches the app port around the proxy proves nothing. Pagewright reads no
 * identity header in this mode: whoever comes through the proxy is the one trusted operator (as PW_BASIC_AUTH).
 */
export const proxyOn = () => process.env.PW_AUTH === 'proxy' && (devMode() || (process.env.PW_PROXY_SECRET || '').length >= 16);
/** PW_BASIC_AUTH as "user:password", both parts non-empty. Anything else ("x", ":", "u:") is not a sign-in. */
export const basicOn = () => /^[^:]+:.+$/.test(process.env.PW_BASIC_AUTH || '');
/** Development with nobody signing in: trusted only because it is next dev (see devHostOk). */
export const devOpen = () => !accountsOn() && devMode() && !basicOn() && !(process.env.PW_AUTH === 'proxy' && process.env.PW_PROXY_SECRET);
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
  if (!devMode()) throw new Error('PW_AUTH=users needs PW_SESSION_SECRET (at least 32 random characters, e.g. openssl rand -hex 32). The server will not serve requests without it.');
  const g = /** @type {any} */ (globalThis);
  if (!g.__pwDevSecret) {
    g.__pwDevSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[pagewright] PW_SESSION_SECRET is not set: using a random secret for this process, so sessions end when it restarts.');
  }
  return g.__pwDevSecret;
}

// purpose: a token made for one use (a session, the pending second factor) never reads as another
const mac = (body, purpose = 'pw_session') => crypto.createHmac('sha256', sessionSecret()).update(`${purpose}.${body}`).digest();

/**
 * A signed token "<payload>.<mac>" (base64url). iat and exp are added when missing.
 * @param {Record<string, any>} payload @param {string} [purpose]
 */
export function signSession(payload, purpose) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ iat: now, exp: now + MAX_AGE, ...payload })).toString('base64url');
  return `${body}.${mac(body, purpose).toString('base64url')}`;
}

/** The payload of a token with a good signature that has not expired, else null. @param {string} token @param {string} [purpose] */
export function readToken(token, purpose) {
  const [body, sig, extra] = String(token || '').split('.');
  if (!body || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, 'base64url');
  const want = mac(body, purpose);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  return p && typeof p.exp === 'number' && p.exp > Date.now() / 1000 ? p : null;
}

/** @param {Request} req @param {string} name */
export function cookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * The signed-in user, read again from storage: { email, role, groups }, or null. Null also when accounts are off.
 * A server-to-itself pass (internalCookie) gives { role: 'viewer', internal: true } for its one GET only.
 * sv: the session's version, so a write can check, just before it commits, that this session still stands (perms.asNow).
 * @param {Request} req @returns {Promise<{ email: string, role: 'viewer'|'designer'|'admin', groups: string[], sv?: number, internal?: boolean } | null>}
 */
export async function currentUser(req) {
  if (!accountsOn()) return null;
  const p = readToken(cookie(req, COOKIE) || '');
  if (!p) return null;
  if (p.srv) {
    const u = new URL(req.url);
    return (req.method === 'GET' || req.method === 'HEAD') && p.path === u.pathname + u.search ? { email: '', role: 'viewer', groups: [], internal: true, anon: !!p.an } : null;
  }
  // a request that changes something reads the user from storage (never the cache): a revoke on any server counts
  // at once. Reads use the cache (at most 5 s, ~1 s after a revoke elsewhere: users.js); a cached record older than
  // the cookie (a sign-out and a new sign-in on another server) is read again rather than refused
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase());
  let user = typeof p.e !== 'string' ? null : write ? await getUser(p.e) : await cachedUser(p.e);
  if (user && !write && (user.sessionVersion || 0) !== p.v) user = await getUser(p.e);
  if (!user || user.disabled || (user.sessionVersion || 0) !== p.v || !(user.role in ROLE_RANK)) return null;
  // a role an admin made require two-factor sign-in: a password session without it ends (sign in again, enrol)
  if (!p.m && !p.s && user.passwordHash && (await getSettings()).require2fa.includes(user.role)) return null;
  return { email: user.email, role: user.role, groups: user.groups || [], sv: p.v };
}

/** The pw_session payload of a request (signature and expiry checked; the user is not read), or null. @param {Request} req */
export const sessionClaims = (req) => readToken(cookie(req, COOKIE) || '');

const isHttps = (req) => new URL(req.url).protocol === 'https:' || (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https' || /^https:/.test(process.env.PW_BASE_URL || '');

/**
 * Set-Cookie for a new session of this user. how: { m: 1 } after a second factor, { s: 'oidc'|'saml' } from SSO.
 * @param {Request} req @param {{ email: string, role: string, sessionVersion?: number }} user @param {{ m?: 1, s?: 'oidc'|'saml', exp?: number }} [how]
 */
export function sessionCookie(req, user, how = {}) {
  // exp: keep a session's end when it is re-issued (enrolling must not lengthen a session that may be someone else's)
  const now = Math.floor(Date.now() / 1000);
  const exp = how.exp && how.exp > now ? Math.min(how.exp, now + MAX_AGE) : now + MAX_AGE;
  const token = signSession({ e: user.email, r: user.role, v: user.sessionVersion || 0, exp, ...(how.m ? { m: 1 } : {}), ...(how.s ? { s: how.s } : {}) });
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${exp - now}${isHttps(req) ? '; Secure' : ''}`;
}

/* ---------------- device cookies (OWASP): a browser that completed a sign-in for an account ---------------- */

export const DEVICE_COOKIE = 'pw_device';
const DEVICE_AGE = 90 * 86400;
/**
 * A device cookie names a registered device: HMAC-signed { e: email, d: device id, v: the account's credential version
 * (deviceEpoch), iat, exp }. The device list lives on the user record (users.js touchDevice, listed and removable on
 * the Account page). It never signs anyone in; it only exempts tries from this browser from the cap on untrusted tries
 * for the account (limits.checkCredential), within its own small budget. Issued only after a complete sign-in
 * (password and any second factor) or a password reset (issueDevice); a sign-out only re-signs a valid one
 * (rotateDevice). It stops counting when its device is removed or deviceEpoch moves (password change or reset,
 * two-factor reset, disabling, demotion, sign-out everywhere), or after 90 days.
 * @param {Request} req @param {{ email: string, deviceEpoch?: number }} user @param {string} id
 */
function deviceCookie(req, user, id) {
  const now = Math.floor(Date.now() / 1000);
  const token = signSession({ dev: 1, e: user.email, d: id, v: user.deviceEpoch || 0, n: crypto.randomBytes(6).toString('base64url'), iat: now, exp: now + DEVICE_AGE }, DEVICE_COOKIE);
  return `${DEVICE_COOKIE}=${token}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=${DEVICE_AGE}${isHttps(req) ? '; Secure' : ''}`;
}
/**
 * The device id of a valid device cookie for this account as it is now (signature, expiry, the account's current
 * credential version, a registered device), or null. Read against the stored record on every check.
 * @param {Request} req @param {{ email: string, deviceEpoch?: number, devices?: { id: string }[] } | null} user
 */
export function knownDevice(req, user) {
  if (!user || !req?.headers) return null;
  const p = readToken(cookie(req, DEVICE_COOKIE) || '', DEVICE_COOKIE); // signature and expiry
  const ok = p?.dev === 1 && p.e === user.email && p.v === (user.deviceEpoch || 0) && typeof p.d === 'string' && (user.devices || []).some(d => d.id === p.d);
  return ok ? p.d : null;
}
/**
 * Set-Cookie after a complete sign-in or a password reset: this browser's registered device (the same id when it
 * already holds a valid cookie for this account, else a new one, registered now).
 * @param {Request} req @param {{ email: string }} user
 */
export async function issueDevice(req, user) {
  const { touchDevice, getUser } = await import('./users.js');
  const now = await getUser(user.email);
  const id = knownDevice(req, now) || crypto.randomBytes(12).toString('base64url');
  const after = await touchDevice(user.email, id, req.headers.get('user-agent') || '');
  return after ? deviceCookie(req, after, id) : null;
}
/**
 * Set-Cookie at sign-out: a valid device cookie of this (signed-in) account re-signed, same device id, new expiry.
 * Nothing for a browser without one, or with another account's: a sign-out never makes a device known.
 * @param {Request} req @param {{ email: string, deviceEpoch?: number, devices?: { id: string }[] }} user the stored record
 */
export function rotateDevice(req, user) {
  const id = knownDevice(req, user);
  return id ? deviceCookie(req, user, id) : null;
}

/* ---------------- the step between the password and the second factor ---------------- */

export const MFA_COOKIE = 'pw_mfa';
const MFA_AGE = 300;
/**
 * Set-Cookie for a sign-in whose password was right and that still needs a code (enrol: the role requires two-factor
 * sign-in and the user has none yet). SameSite=Strict: only this site's pages send it.
 * @param {Request} req @param {{ email: string, sessionVersion?: number }} user @param {boolean} enrol
 */
export function mfaCookie(req, user, enrol) {
  const now = Math.floor(Date.now() / 1000);
  const token = signSession({ mfa: 1, e: user.email, v: user.sessionVersion || 0, enrol: !!enrol, iat: now, exp: now + MFA_AGE }, MFA_COOKIE);
  return `${MFA_COOKIE}=${token}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=${MFA_AGE}${isHttps(req) ? '; Secure' : ''}`;
}
/** @param {Request} req @returns {{ e: string, v: number, enrol: boolean } | null} */
export function readMfa(req) {
  const p = readToken(cookie(req, MFA_COOKIE) || '', MFA_COOKIE);
  return p?.mfa === 1 && typeof p.e === 'string' ? { e: p.e, v: p.v, enrol: !!p.enrol } : null;
}
/** @param {Request} req */
export const clearMfa = (req) => `${MFA_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
/** @param {Request} req */
export const clearCookie = (req) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;

/**
 * For the server's calls to itself (relative data URLs in server renders, batches, schedules): a viewer pass
 * that is good for 2 minutes and for this one GET only. If it leaks it opens nothing the render did not show.
 * @param {string} url the URL being fetched
 */
export function internalCookie(url, { anon = false } = {}) {
  const u = new URL(url);
  const now = Math.floor(Date.now() / 1000);
  return `${COOKIE}=${signSession({ srv: 1, ...(anon ? { an: 1 } : {}), path: u.pathname + u.search, iat: now, exp: now + INTERNAL_AGE })}`;
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

