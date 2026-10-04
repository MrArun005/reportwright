// @ts-check
// User accounts (PW_AUTH=users). Records live in src/server/storage, keyed by lower-case email:
// { email, role, passwordHash, createdAt, updatedAt, disabled?, sessionVersion, groups?, sso? }.
// groups: names for report and folder permissions (src/server/perms.js). sso: 'oidc' | 'saml' for accounts made at
// single sign-on; they have no password (passwordHash null), so password sign-in can never open them.
// Passwords: scrypt with a random 16-byte salt; the parameters are stored with the hash, so they can change later.
// sessionVersion goes up on sign-out, a password change and disabling: every older session cookie stops working.
import crypto from 'node:crypto';
import { store, withLock } from './storage/index.js';

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
const publicUser = (u) => ({ email: u.email, role: u.role, disabled: !!u.disabled, groups: u.groups || [], sso: u.sso?.via || null, allowSso: !!u.allowSso, createdAt: u.createdAt, updatedAt: u.updatedAt });

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
export async function createUser({ email, role, password, groups = [], sso }) {
  const e = normEmail(email);
  checkRole(role);
  const g = checkGroups(groups);
  const passwordHash = sso ? null : await hashPassword(/** @type {string} */ (password));
  if (await getUser(e)) throw fail(`There is already a user ${e}.`, 409);
  const now = new Date().toISOString();
  // a new account's sessions start at a random version: a cookie of a deleted account with this email never works again
  const u = { email: e, role, passwordHash, createdAt: now, updatedAt: now, disabled: false, sessionVersion: crypto.randomInt(1, 2 ** 40), groups: g, ...(sso ? { sso } : {}) };
  await save(u);
  return publicUser(u);
}

const activeAdmin = (u) => u && u.role === 'admin' && !u.disabled;
// ponytail: check-then-write, so two admins demoting each other at the same moment could both pass; a DB transaction if that ever matters
async function keepAnAdmin(before, after) {
  if (!activeAdmin(before) || activeAdmin(after)) return;
  if (!(await all()).some(u => u.email !== before.email && activeAdmin(u))) throw fail('You cannot remove the last admin. Make another user an admin first.', 409);
}

/**
 * Change the role, the password, the groups or disabled. A new password or disabling ends the user's sessions.
 * allowSso (admins): the next single sign-on with this email may bind to this password account.
 * sso (server code only, never from a request): the IdP identity this account is bound to.
 * @param {string} email @param {{ role?: string, password?: string, disabled?: boolean, groups?: string[], allowSso?: boolean, sso?: any }} patch
 */
export function updateUser(email, patch) { return withLock('acl', () => updateUserNow(email, patch)); }
async function updateUserNow(email, patch) {
  const u = await getUser(email);
  if (!u) throw fail('No such user.', 404);
  const next = { ...u, updatedAt: new Date().toISOString() };
  if (patch.role !== undefined) next.role = checkRole(patch.role);
  if (patch.disabled !== undefined) next.disabled = !!patch.disabled;
  if (patch.groups !== undefined) next.groups = checkGroups(patch.groups);
  if (patch.allowSso !== undefined) next.allowSso = !!patch.allowSso;
  if (patch.sso !== undefined) { next.sso = patch.sso; delete next.allowSso; }
  if (patch.password !== undefined) next.passwordHash = await hashPassword(patch.password);
  if (patch.password !== undefined || (next.disabled && !u.disabled)) next.sessionVersion = (u.sessionVersion || 0) + 1;
  await keepAnAdmin(u, next);
  await save(next);
  return publicUser(next);
}

/** @returns {Promise<boolean>} false when there was no such user */
export function deleteUser(email) { return withLock('acl', () => deleteUserNow(email)); }
async function deleteUserNow(email) {
  const u = await getUser(email);
  if (!u) return false;
  await keepAnAdmin(u, null);
  cache.delete(u.email);
  return store().remove('users', u.email);
}

/** Sign-out: every session cookie this user holds stops working. */
export async function endSessions(email) {
  const u = await getUser(email);
  if (u) await save({ ...u, sessionVersion: (u.sessionVersion || 0) + 1 });
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
