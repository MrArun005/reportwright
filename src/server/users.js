// @ts-check
// User accounts (PW_AUTH=users). Records live in src/server/storage, keyed by lower-case email:
// { email, role, passwordHash, createdAt, updatedAt, disabled?, sessionVersion, groups?, sso? }.
// groups: names for report and folder permissions (src/server/perms.js). sso: 'oidc' | 'saml' for accounts made at
// single sign-on; they have no password (passwordHash null), so password sign-in can never open them.
// Passwords: scrypt with a random 16-byte salt; the parameters are stored with the hash, so they can change later.
// sessionVersion goes up on sign-out, a password change and disabling: every older session cookie stops working.
// Two-factor sign-in (src/server/totp.js): totp { secret (sealed), enabledAt }, recovery [hashes], totpPending while
// enrolling. Enabling, turning off and an admin's reset each end every session of the user.
import crypto from 'node:crypto';
import { store, withLock } from './storage/index.js';
import { newSecret, seal, unseal, useCode, otpauthUri, qrSvg, newRecoveryCodes, hashRecovery } from './totp.js';

export const ROLES = /** @type {const} */ (['viewer', 'designer', 'admin']);
const SCRYPT = { N: 32768, r: 8, p: 1 }; // ~50 ms, 32 MB
const MIN_PASSWORD = 10, MAX_PASSWORD = 1024;

/** @param {string} msg @param {number} status */
const fail = (msg, status) => Object.assign(new Error(msg), { status });

/** @returns {Promise<Buffer>} */
const scrypt = (pw, salt, len, o) => new Promise((resolve, reject) => crypto.scrypt(pw, salt, len, { ...o, maxmem: 256 * o.N * o.r }, (e, k) => (e ? reject(e) : resolve(k))));

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw fail(`A password needs at least ${MIN_PASSWORD} characters.`, 400);
  if (pw.length > MAX_PASSWORD) throw fail(`A password can have at most ${MAX_PASSWORD} characters.`, 400);
}

/** "scrypt$N$r$p$salt$hash" (base64). @param {string} pw */
export async function hashPassword(pw) {
  checkPassword(pw);
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, 32, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** @param {string} pw @param {string} stored */
export async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$');
  const want = Buffer.from(hash || '', 'base64');
  if (alg !== 'scrypt' || want.length < 16 || typeof pw !== 'string' || pw.length > MAX_PASSWORD) return false;
  try {
    const got = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(got, want);
  } catch { return false; }
}

/** Lower-case, trimmed; no slashes (it is a URL path segment in /api/users/<email>). */
export function normEmail(email) {
  const raw = String(email ?? '').trim();
  const e = raw.toLowerCase();
  // ASCII only: toLowerCase() folds some other letters into ASCII ones (the Kelvin sign K → k), which would let two
  // different addresses name one account
  if (e.length > 254 || !/^[^\s@/\\]+@[^\s@/\\]+$/.test(e) || /[^\x21-\x7e]/.test(raw)) throw fail('Give a valid email address.', 400);
  return e;
}
const checkRole = (role) => { if (!ROLES.includes(role)) throw fail(`The role must be ${ROLES.join(', ')}.`, 400); return role; };

export const GROUP = /^[\w][\w .@-]{0,63}$/;
/** A list of group names: trimmed, unique, at most 50; "everyone" and "public" are built in and cannot be given. */
export function checkGroups(groups) {
  if (!Array.isArray(groups) || groups.length > 50) throw fail('Groups must be a list of at most 50 names.', 400);
  const out = [...new Set(groups.map(g => String(g ?? '').trim()))].filter(Boolean);
  for (const g of out) {
    if (!GROUP.test(g)) throw fail(`"${g.slice(0, 70)}" is not a group name (letters, digits, space . @ - _, at most 64).`, 400);
    if (['everyone', 'public'].includes(g.toLowerCase())) throw fail(`"${g}" is a built-in group.`, 400);
  }
  return out.sort();
}

/** What the API shows: never the hash. */
const publicUser = (u) => ({ email: u.email, role: u.role, disabled: !!u.disabled, groups: u.groups || [], sso: u.sso?.via || null, allowSso: !!u.allowSso, twoFactor: !!u.totp, password: !!u.passwordHash, createdAt: u.createdAt, updatedAt: u.updatedAt });

/** @returns {Promise<any[]>} full records */
async function all() { return (await store().list('users')).map(r => JSON.parse(r.text)); }

/** Every full record. Server code only. */
export const allUsers = () => all();

/** The full record (with the hash), or null. Server code only. */
export async function getUser(email) {
  let e;
  try { e = normEmail(email); } catch { return null; }
  const t = await store().get('users', e);
  return t ? JSON.parse(t) : null;
}

// Sessions re-read the user on every request; a short cache keeps that cheap. Writes here clear it, so in
// this process a change counts at once; other servers see it within CACHE_MS.
const CACHE_MS = 10000;
/** @type {Map<string, { at: number, user: any }>} */
const cache = (/** @type {any} */ (globalThis).__pwUserCache ||= new Map());
/** @param {string} email */
export async function cachedUser(email) {
  const hit = cache.get(email);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
  const user = await getUser(email);
  if (cache.size > 10000) cache.clear();
  cache.set(email, { at: Date.now(), user });
  return user;
}

async function save(u) {
  cache.delete(u.email);
  await store().put('users', u.email, JSON.stringify({ ...u, rev: crypto.randomBytes(8).toString('hex') })); // a new rev on every change (perms.accessStamp)
}

export async function listUsers() { return (await all()).map(publicUser).sort((a, b) => a.email.localeCompare(b.email)); }
export async function countUsers() { return (await store().ids('users')).length; }

/**
 * A password account, or with `sso` an account made at single sign-on (no password).
 * @param {{ email: string, role: string, password?: string, groups?: string[], sso?: { via: 'oidc'|'saml', issuer: string, subject: string } }} u
 */
export async function createUser({ email, role, password, groups = [], sso }, { by } = {}) {
  const e = normEmail(email);
  checkRole(role);
  const g = checkGroups(groups);
  const passwordHash = sso ? null : await hashPassword(/** @type {string} */ (password));
  return withLock('acl', async () => { await stillAdmin(by); return createNow(e, role, g, passwordHash, sso); });
}
/** by (an admin's email, from a route): that admin as stored now, inside the lock, not a session cache. */
async function stillAdmin(by) {
  if (by === undefined) return;
  const a = await getUser(by);
  if (!a || a.disabled || a.role !== 'admin') throw fail('Only a signed-in admin can do this.', 403);
}
async function createNow(e, role, g, passwordHash, sso) {
  if (await getUser(e)) throw fail(`There is already a user ${e}.`, 409);
  const now = new Date().toISOString();
  // a new account's sessions start at a random version: a cookie of a deleted account with this email never works again
  const u = { email: e, role, passwordHash, createdAt: now, updatedAt: now, disabled: false, sessionVersion: crypto.randomInt(1, 2 ** 40), groups: g, ...(sso ? { sso } : {}) };
  await save(u);
  return publicUser(u);
}

const activeAdmin = (u) => u && u.role === 'admin' && !u.disabled;
// every user write runs under the 'acl' lock (withLock): two admins demoting each other are ordered, not both passed
async function keepAnAdmin(before, after) {
  if (!activeAdmin(before) || activeAdmin(after)) return;
  if (!(await all()).some(u => u.email !== before.email && activeAdmin(u))) throw fail('You cannot remove the last admin. Make another user an admin first.', 409);
}

/**
 * Change the role, the password, the groups or disabled. A new password or disabling ends the user's sessions.
 * resetTwoFactor (admins): two-factor sign-in off, the authenticator and recovery codes forgotten, sessions ended.
 * allowSso (admins): the next single sign-on with this email may bind to this password account.
 * sso (server code only, never from a request): the IdP identity this account is bound to.
 * @param {string} email @param {{ role?: string, password?: string, disabled?: boolean, groups?: string[], allowSso?: boolean, sso?: any, resetTwoFactor?: boolean }} patch
 */
export function updateUser(email, patch, { by } = {}) { return withLock('acl', async () => { await stillAdmin(by); return updateUserNow(email, patch); }); }
async function updateUserNow(email, patch) {
  const u = await getUser(email);
  if (!u) throw fail('No such user.', 404);
  const next = { ...u, updatedAt: new Date().toISOString() };
  if (patch.role !== undefined) next.role = checkRole(patch.role);
  if (patch.disabled !== undefined) next.disabled = !!patch.disabled;
  if (patch.groups !== undefined) next.groups = checkGroups(patch.groups);
  if (patch.allowSso !== undefined) next.allowSso = !!patch.allowSso;
  if (patch.sso !== undefined) { next.sso = patch.sso; delete next.allowSso; }
  if (patch.password !== undefined) { next.passwordHash = await hashPassword(patch.password); delete next.reset; }
  if (patch.resetTwoFactor) { delete next.totp; delete next.totpPending; delete next.recovery; }
  if (patch.password !== undefined || patch.resetTwoFactor || (next.disabled && !u.disabled)) next.sessionVersion = (u.sessionVersion || 0) + 1;
  await keepAnAdmin(u, next);
  await save(next);
  return publicUser(next);
}

/** @returns {Promise<boolean>} false when there was no such user */
export function deleteUser(email, { by } = {}) { return withLock('acl', async () => { await stillAdmin(by); return deleteUserNow(email); }); }
async function deleteUserNow(email) {
  const u = await getUser(email);
  if (!u) return false;
  await keepAnAdmin(u, null);
  cache.delete(u.email);
  return store().remove('users', u.email);
}

/** Sign-out: every session cookie this user holds stops working. */
export function endSessions(email) {
  // under the lock and re-read there: a sign-out must never write back a record an admin just changed
  return withLock('acl', async () => { const u = await getUser(email); if (u) await save({ ...u, sessionVersion: (u.sessionVersion || 0) + 1 }); });
}

/* ---------------- two-factor sign-in ---------------- */

const PENDING_MS = 15 * 60 * 1000;
/**
 * What a password sign-in still needs: 'totp' (the user has an authenticator), 'enrol' (their role requires one and they
 * have none yet) or null. Accounts without a password (single sign-on) never: the identity provider owns the factors.
 * @param {any} u the stored user @param {{ require2fa: string[] }} settings
 */
export function secondFactor(u, settings) {
  if (!u?.passwordHash) return null;
  if (u.totp) return 'totp';
  return settings.require2fa.includes(u.role) ? 'enrol' : null;
}

/** Start enrolling: a new secret, kept pending until a code from it is confirmed. { secret, uri, qr (SVG) } @param {string} email */
export function startTwoFactor(email) {
  return withLock('acl', async () => {
    const u = await getUser(email);
    if (!u || u.disabled) throw fail('No such user.', 404);
    if (!u.passwordHash) throw fail('This account signs in with single sign-on: its identity provider owns the second factor.', 409);
    if (u.totp) throw fail('Two-factor sign-in is on already. Turn it off first to enrol a new authenticator.', 409);
    const secret = newSecret();
    await save({ ...u, totpPending: { secret: seal(secret), at: Date.now() } });
    const uri = otpauthUri(u.email, secret);
    return { secret, uri, qr: await qrSvg(uri) };
  });
}

/**
 * Finish enrolling with a code from the new authenticator: two-factor sign-in is on, every other session ends.
 * Returns the recovery codes (shown once) and the user as stored now.
 * @param {string} email @param {string} code
 */
export function enableTwoFactor(email, code) {
  return withLock('acl', async () => {
    const u = await getUser(email);
    if (!u || u.disabled) throw fail('No such user.', 404);
    if (u.totp) throw fail('Two-factor sign-in is on already.', 409);
    const secret = u.totpPending && Date.now() - u.totpPending.at < PENDING_MS ? unseal(u.totpPending.secret) : null;
    if (!secret) throw fail('Start again: scan a new QR code.', 409);
    if (!(await useCode(u.email, secret, code))) throw fail('That code is not right. Check the time on your phone and try the next code.', 400);
    const { codes, hashes } = newRecoveryCodes();
    const next = { ...u, totp: { secret: u.totpPending.secret, enabledAt: new Date().toISOString() }, recovery: hashes, sessionVersion: (u.sessionVersion || 0) + 1, updatedAt: new Date().toISOString() };
    delete next.totpPending;
    await save(next);
    return { codes, user: next };
  });
}

/**
 * Check a second factor: a code from the authenticator (each time step once), or a recovery code (each once, removed).
 * @param {string} email @param {{ code?: string, recoveryCode?: string }} given @returns {Promise<'totp'|'recovery'|null>}
 */
export async function checkSecondFactor(email, { code, recoveryCode } = {}) {
  const u = await getUser(email);
  if (!u?.totp || u.disabled) return null;
  if (typeof code === 'string' && code.trim()) {
    const secret = unseal(u.totp.secret);
    return secret && (await useCode(u.email, secret, code)) ? 'totp' : null;
  }
  if (typeof recoveryCode !== 'string' || !recoveryCode.trim() || recoveryCode.length > 64) return null;
  const h = hashRecovery(recoveryCode);
  return withLock('acl', async () => {
    const cur = await getUser(email); // read again under the lock: a code is good once, on every server
    const list = Array.isArray(cur?.recovery) ? cur.recovery : [];
    const i = list.findIndex(x => typeof x === 'string' && x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)));
    if (!cur?.totp || i < 0) return null;
    await save({ ...cur, recovery: list.filter((_, k) => k !== i) });
    return 'recovery';
  });
}

/** New recovery codes (the old ones stop working). @param {string} email */
export function newRecovery(email) {
  return withLock('acl', async () => {
    const u = await getUser(email);
    if (!u?.totp) throw fail('Two-factor sign-in is off.', 409);
    const { codes, hashes } = newRecoveryCodes();
    await save({ ...u, recovery: hashes });
    return codes;
  });
}

/** Turn two-factor sign-in off (the user, after a code; an admin uses resetTwoFactor). Every session ends. @param {string} email */
export function disableTwoFactor(email) { return updateUser(email, { resetTwoFactor: true }); }

/* ---------------- password reset by email ---------------- */

export const RESET_MS = 30 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
/**
 * A one-time reset token for a password account that is on, or null (no such account, single sign-on only, disabled).
 * The token is "<email, base64url>.<32 random bytes>"; only its SHA-256 is stored, with an expiry (30 minutes). A new
 * token replaces the one before. @param {string} email
 */
export function issueReset(email) {
  return withLock('acl', async () => {
    const u = await getUser(email);
    if (!u || u.disabled || !u.passwordHash) return null;
    const secret = crypto.randomBytes(32).toString('base64url');
    await save({ ...u, reset: { hash: sha(secret), expires: Date.now() + RESET_MS } });
    return `${Buffer.from(u.email).toString('base64url')}.${secret}`;
  });
}
/**
 * Use a reset token: the new password is set, the token is spent and every session ends (updateUser). The email of the
 * account, or a 400 for a bad, spent or expired token (one message for all).
 * @param {string} token @param {string} password
 */
export async function useReset(token, password) {
  const bad = () => fail('This link does not work any more. Ask for a new one.', 400);
  const [e, secret, extra] = String(token ?? '').split('.');
  if (!e || !secret || extra !== undefined || secret.length !== 43) throw bad();
  let email;
  try { email = normEmail(Buffer.from(e, 'base64url').toString()); } catch { throw bad(); }
  const passwordHash = await hashPassword(password); // a bad password is a 400 before the token is spent
  return withLock('acl', async () => {
    const u = await getUser(email);
    const r = u?.reset;
    if (!u || u.disabled || !r || typeof r.hash !== 'string' || !(r.expires > Date.now()) || !crypto.timingSafeEqual(Buffer.from(sha(secret)), Buffer.from(r.hash.padEnd(64).slice(0, 64)))) throw bad();
    const next = { ...u, passwordHash, sessionVersion: (u.sessionVersion || 0) + 1, updatedAt: new Date().toISOString() };
    delete next.reset;
    await save(next);
    return u.email;
  });
}

let dummy;
/** The user when the password is right and the account is on; null otherwise (in about the same time). */
export async function authenticate(email, password) {
  const u = await getUser(email);
  dummy ||= hashPassword(crypto.randomBytes(16).toString('hex'));
  const ok = await verifyPassword(password, u?.passwordHash || await dummy);
  return ok && u && !u.disabled ? u : null;
}

let boot = null;
/** The first admin, from PW_ADMIN_EMAIL / PW_ADMIN_PASSWORD, when there are no users yet. */
export async function ensureAdmin() {
  const email = process.env.PW_ADMIN_EMAIL, password = process.env.PW_ADMIN_PASSWORD;
  if (!email || !password) return;
  boot ||= (async () => {
    if (await countUsers()) return;
    await createUser({ email, role: 'admin', password });
    console.warn(`[pagewright] created the first admin, ${normEmail(email)}, from PW_ADMIN_EMAIL`);
  })().finally(() => { boot = null; });
  await boot;
}
