// @ts-check
// Permissions per report and per folder (enterprise item 2).
//
// Folders ('folders' storage kind): { id, name, parent, inherit, grants }. The record "root" holds the grants at the
// top (no name, no parent). Report placement and grants ('reportacl' kind): { id, folder, inherit, grants }, kept
// apart from the definition, so saving a definition can never change who may see it.
// A grant: { to: 'user:<email>' | 'group:<name>', level: 'view' | 'edit' | 'manage' }. Built-in groups: "everyone"
// (every signed-in user) and "public" (also anonymous embed readers, PW_EMBED_ORIGINS).
//
// A principal's level on a report: the highest grant on the report, then on its folder, its parent and so on while
// "inherit" holds, ending at the root grants (default: everyone manage, i.e. what every signed-in user could do
// before permissions existed). The role is a ceiling: a viewer views at most; admins manage everything.
// view: open, render, export, run its saved SQL. edit: save, restore, version history. manage: delete, move, share.
import crypto from 'node:crypto';
import { store } from './storage/index.js';
import { accountsOn, currentUser, openTrusted, publicReadonly, NO_AUTH_HELP } from './session.js';
import { internalHosts } from './safeFetch.js';
import { normEmail, GROUP, getUser } from './users.js';
import { readReport } from './reports.js';

export const LEVELS = /** @type {const} */ (['view', 'edit', 'manage']);
const RANK = { none: 0, view: 1, edit: 2, manage: 3 };
/** @typedef {'none'|'view'|'edit'|'manage'} Level */
/**
 * @typedef {{ kind: 'open' } | { kind: 'service', key?: string } | { kind: 'nobody' } | { kind: 'anon' } | { kind: 'public' } |
 *   { kind: 'user', email: string, role: 'viewer'|'designer'|'admin', groups: string[], viaKey?: string }} Principal
 * open: accounts are off and the server trusts whoever reaches it (openTrusted: next dev, PW_BASIC_AUTH, PW_AUTH=proxy);
 * nothing is enforced. Never in production without one of those: there it is nobody (vet).
 * public: accounts are off, production, nobody signs in, PW_PUBLIC_READONLY=1: views every report, changes nothing.
 * service: an API key that is not tied to a user.
 * nobody: no access at all (the server's own internal pass, or a caller that forgot to say who it is).
 * anon: not signed in (only embed reads reach a route this way).
 */
export const OPEN = Object.freeze({ kind: 'open' });
export const PUBLIC = Object.freeze({ kind: 'public' });
export const NOBODY = Object.freeze({ kind: 'nobody' });
export const DEFAULT_ROOT = Object.freeze([{ to: 'group:everyone', level: 'manage' }]);
const fail = (msg, status) => Object.assign(new Error(msg), { status });

/** A stable name for a principal (job and schedule owners, cache keys, the audit log). @param {Principal} p */
export const principalId = (p) => (!p ? 'nobody' : p.kind === 'user' ? `user:${p.email}` : p.kind === 'service' ? `service${p.key ? `:${p.key}` : ''}` : p.kind);

/** The principal of a request to a page or a route (not /api/v1: see auth.js). @param {Request} req @returns {Promise<Principal>} */
export async function principalOf(req) {
  if (!accountsOn()) return openTrusted() ? OPEN : publicReadonly() ? PUBLIC : NOBODY; // production with no sign-in: fail closed
  const u = await currentUser(req);
  if (!u) return { kind: 'anon' };
  if (u.internal) return NOBODY; // a report must never read another report's definition through a data source URL
  return { kind: 'user', email: u.email, role: u.role, groups: u.groups || [] };
}

/** For server pages: the principal of the request whose Cookie header this is. @param {string} cookie */
export const principalFromCookie = (cookie) => principalOf(new Request('http://pagewright.local/', { headers: { cookie: cookie || '' } }));

/** The ids (first 8 hex of the SHA-256) of the service keys in PW_API_KEYS now. With accounts off a user's key
 *  ("email|key") is a service key too: there are no users to act as. */
function serviceKeyIds() {
  const isUserKey = (x) => x.indexOf('|') > 0 && x.slice(0, x.indexOf('|')).includes('@');
  return new Set((process.env.PW_API_KEYS || '').split(',').map(x => x.trim()).filter(x => x && (!accountsOn() || !isUserKey(x)))
    .map(k => crypto.createHash('sha256').update(isUserKey(k) ? k.slice(k.indexOf('|') + 1).trim() : k).digest('hex').slice(0, 8)));
}

/** A user principal by email, read from storage now (schedules and jobs run later as their owner). */
export async function userPrincipal(email) {
  const u = await getUser(email);
  if (!u || u.disabled) return NOBODY;
  return /** @type {Principal} */ ({ kind: 'user', email: u.email, role: u.role, groups: u.groups || [] });
}

/**
 * The principal as the resolver may trust it. Anything missing, malformed or not valid in this mode is nobody (fail
 * closed): with accounts off, the old all-or-nothing (open) is the only principal and a missing one is open; with
 * accounts on, "open" and a missing principal are nobody, a user needs an email, a known role and a list of groups,
 * and a service key must be in PW_API_KEYS now (a keyless service principal is the server's own code).
 * @param {any} p @returns {Principal}
 */
export function vet(p) {
  if (!p || typeof p !== 'object') return defaultPrincipal();
  if (p.kind === 'open') return openTrusted() ? OPEN : NOBODY;
  if (p.kind === 'public') return accountsOn() ? NOBODY : PUBLIC; // issued only by principalOf (PW_PUBLIC_READONLY) and the keyless API in production
  if (p.kind === 'nobody' || p.kind === 'anon') return p;
  if (p.kind === 'service') return p.key === undefined || (typeof p.key === 'string' && serviceKeyIds().has(p.key)) ? p : NOBODY;
  if (p.kind === 'user') return typeof p.email === 'string' && ['viewer', 'designer', 'admin'].includes(p.role) && Array.isArray(p.groups) && p.groups.every(g => typeof g === 'string') ? p : NOBODY;
  return NOBODY;
}

/**
 * A user principal as the user is now in storage (role, groups, disabled), not as a cached session saw it: checks that
 * guard a write run inside the "acl" lock, and a change made on another server while the request waited must count.
 * @param {Principal} p @returns {Promise<Principal>}
 */
async function asNow(p) {
  p = vet(p);
  if (p.kind !== 'user') return p;
  const q = await userPrincipal(p.email);
  return q.kind === 'user' && p.viaKey ? { ...q, viaKey: p.viaKey } : q;
}

/** The ids of the keys in PW_API_KEYS now that act as this user ("email|key"). @param {string} email */
function userKeyIds(email) {
  return new Set((process.env.PW_API_KEYS || '').split(',').map(x => x.trim()).filter(x => x.indexOf('|') > 0 && x.slice(0, x.indexOf('|')).trim().toLowerCase() === email)
    .map(x => crypto.createHash('sha256').update(x.slice(x.indexOf('|') + 1).trim()).digest('hex').slice(0, 8)));
}

/**
 * The principal named by principalId, as it is now. viaKey: the user's API key that made the record (a schedule or a
 * batch): once that key is out of PW_API_KEYS, the record is no one's; a user's record with no key is no one's.
 * session: the record was made by a signed-in user on the Schedules page (no key): it runs as that user as they are now,
 * only while they may still design (the page that manages it is a designer's) and only for the same account: since is
 * the account's createdAt when the record was made, so a deleted and re-made account with the email is someone else.
 * @param {string} id @param {string} [viaKey] @param {{ session?: boolean, since?: string|null }} [o] @returns {Promise<Principal>}
 */
export async function principalFromId(id, viaKey, { session = false, since = null } = {}) {
  id = String(id);
  if (session && !viaKey) {
    if (id.startsWith('user:') && accountsOn()) {
      const u = await getUser(id.slice(5));
      if (!u || !since || u.createdAt !== since) return NOBODY;
      const p = await userPrincipal(u.email); // disabled: nobody
      return p.kind === 'user' && p.role !== 'viewer' ? p : NOBODY;
    }
    if (id === 'open') return vet(OPEN); // the trusted open server (next dev, basic auth, proxy) that made it; else nobody
    return NOBODY;
  }
  if (id.startsWith('user:') && accountsOn()) {
    // only API keys make schedules and batches: a user's record with no key id is from before keys were recorded
    if (!viaKey) return NOBODY;
    const p = await userPrincipal(id.slice(5));
    return p.kind === 'user' && userKeyIds(p.email).has(String(viaKey)) ? { ...p, viaKey: String(viaKey) } : NOBODY;
  }
  if (id.startsWith('service:')) return serviceKeyIds().has(id.slice(8)) ? { kind: 'service', key: id.slice(8) } : NOBODY; // a removed key's schedules stop
  if (id === 'service') return { kind: 'service' };
  if (id === 'public') return vet(PUBLIC);
  // records made without a key ("open") or by a user's key while accounts were on: the open server's, in development
  // only. In production nobody can say who made them (a keyless caller, before keyless became read-only): no one's.
  if (!accountsOn() && process.env.NODE_ENV !== 'production' && (id === 'open' || id.startsWith('user:'))) return vet(OPEN);
  return NOBODY;
}

/* ---------------- the data ---------------- */

/** @typedef {{ to: string, level: 'view'|'edit'|'manage' }} Grant */
/** @typedef {{ id: string, name?: string, parent?: string|null, inherit?: boolean, grants: Grant[], createdAt?: string, updatedAt?: string }} FolderRec */
/** @typedef {{ id: string, folder: string|null, inherit: boolean, grants: Grant[] }} ReportRec */
/** @typedef {{ folders: Map<string, FolderRec>, reports: Map<string, ReportRec>, root: Grant[] }} Snapshot */

/** Every folder and report record, read once for a request. @returns {Promise<Snapshot>} */
export async function snapshot() {
  const [fl, rl] = await Promise.all([store().list('folders'), store().list('reportacl')]);
  const folders = new Map(), reports = new Map();
  let root = DEFAULT_ROOT;
  for (const r of fl) { try { const f = JSON.parse(r.text); if (f.id === 'root') root = f.grants || []; else folders.set(f.id, f); } catch { /* skip */ } }
  for (const r of rl) { try { const x = JSON.parse(r.text); reports.set(x.id, x); } catch { /* skip */ } }
  return { folders, reports, root: /** @type {Grant[]} */ (root) };
}

/** Grant names that apply to a principal. @param {Principal} p */
function namesOf(p) {
  if (p.kind === 'anon') return new Set(['group:public']);
  if (p.kind !== 'user') return new Set();
  return new Set([`user:${p.email}`, 'group:everyone', 'group:public', ...p.groups.map(g => `group:${g.toLowerCase()}`)]);
}
/** @param {Grant[]} grants @param {Set<string>} names @returns {number} */
const best = (grants, names) => Math.max(0, ...(grants || []).filter(g => names.has(String(g.to).toLowerCase())).map(g => RANK[g.level] || 0));

/** The ceiling a principal's role allows. @param {Principal} p */
function ceiling(p) {
  if (p.kind === 'open' || p.kind === 'service') return RANK.manage;
  if (p.kind === 'user') return p.role === 'viewer' ? RANK.view : RANK.manage;
  if (p.kind === 'anon') return process.env.PW_EMBED_ORIGINS ? RANK.view : 0;
  return 0;
}
const isAll = (p) => p.kind === 'open' || p.kind === 'service' || (p.kind === 'user' && p.role === 'admin');
const levelName = (n) => /** @type {Level} */ (['none', 'view', 'edit', 'manage'][n]);

/** Grants up the folder chain from `folderId` (itself included), stopping where inherit is off; then the root. */
function chain(s, folderId, names) {
  let n = 0;
  const seen = new Set();
  for (let f = folderId; ; ) {
    if (!f) return Math.max(n, best(s.root, names));
    const rec = s.folders.get(f);
    if (!rec || seen.has(f) || seen.size > 64) return n; // a lost folder or a loop: nothing more (fail closed)
    seen.add(f);
    n = Math.max(n, best(rec.grants, names));
    if (rec.inherit === false) return n;
    f = rec.parent || null;
  }
}

/**
 * A fingerprint of everything that decides what a principal may view now: every folder and report grant (with its
 * rev), and the user record as stored now (its own rev). Equal stamps, equal access, and no change in between (for caches of rendered output that pulls in other reports).
 * @param {Principal} p
 */
export async function accessStamp(p) {
  p = vet(p);
  const [fl, rl, u] = await Promise.all([store().list('folders'), store().list('reportacl'), p.kind === 'user' ? store().get('users', p.email) : null]);
  const all = [...fl.map(r => `f${r.id}\n${r.text}`), ...rl.map(r => `r${r.id}\n${r.text}`)].sort().join('\0');
  return crypto.createHash('sha256').update(`${JSON.stringify(p)}\0${u}\0${all}`).digest('hex');
}
/** Every permission write gets a new rev: a change and its undo never give back an earlier stamp. */
const rev = () => crypto.randomBytes(8).toString('hex');

/** A principal's level on a report, from a snapshot. @param {Snapshot} s @param {Principal} p @param {string} id @returns {Level} */
export function reportLevel(s, p, id) {
  p = vet(p);
  if (isAll(p)) return 'manage';
  if (p.kind === 'public') return 'view';
  const names = namesOf(p);
  const r = s.reports.get(id);
  let n = best(r?.grants || [], names);
  if (!r || r.inherit !== false) n = Math.max(n, chain(s, r?.folder || null, names));
  return levelName(Math.min(n, ceiling(p)));
}

/** A principal's level on a folder ("root" or null is the top). @param {Snapshot} s @param {Principal} p @param {string|null} id @returns {Level} */
export function folderLevel(s, p, id) {
  p = vet(p);
  if (isAll(p)) return 'manage';
  if (p.kind === 'public') return 'view';
  const names = namesOf(p);
  const n = !id || id === 'root' ? best(s.root, names) : chain(s, id, names);
  return levelName(Math.min(n, ceiling(p)));
}

export const atLeast = (have, need) => RANK[have] >= RANK[need];

/* ---------------- checks for routes and pages ---------------- */

/**
 * The level a principal has on a report, or an error: 404 when it may not even view the report (the id does not
 * leak), 403 when it may view but not do `need`. Version refs ("id@version") need edit.
 * @param {Principal} p @param {string} ref "id" or "id@version" @param {'view'|'edit'|'manage'} [need]
 * @returns {Promise<Level>}
 */
export async function checkReport(p, ref, need = 'view') {
  const [id, version] = String(ref).split('@');
  if (version && need === 'view') need = 'edit';
  if (!(await store().get('reports', id))) throw fail('Report not found', 404); // an absent report is not "at the top"
  p = await asNow(p);
  if (isAll(p)) return 'manage'; // open, service keys and admins: reportLevel's answer, without reading every grant
  const lvl = reportLevel(await snapshot(), p, id);
  if (p.kind === 'nobody' && !accountsOn()) throw fail(NO_AUTH_HELP, 401); // production with no sign-in
  if (!atLeast(lvl, 'view')) throw fail('Report not found', 404);
  if (!atLeast(lvl, need)) throw fail(`You cannot ${need === 'edit' ? 'change' : 'manage'} this report.`, 403);
  return lvl;
}

/**
 * A report's definition, when the principal may do `need` with it (checkReport's errors otherwise).
 * @param {Principal} p @param {string} ref @param {'view'|'edit'|'manage'} [need]
 */
export async function readReportFor(p, ref, need = 'view') {
  await checkReport(p, ref, need);
  const def = await readReport(ref);
  if (!def) throw fail('Report not found', 404);
  return def;
}

/** The principal a server-side render runs as when the caller did not say: nobody with accounts on, or in production
 *  with no sign-in (fail closed). */
export const defaultPrincipal = () => vet(OPEN);

/**
 * Whether a principal may do what a designer does: store a definition with server-side data (SQL on a server connection,
 * a fetch to an internal host), send a definition or data with a render, run SQL from the request, change fonts.
 * Designers and admins, service keys, and the open server where it is trusted. Never a viewer, anonymous or public.
 * @param {Principal} p
 */
export function canDesign(p) {
  p = vet(p);
  return p.kind === 'open' || p.kind === 'service' || (p.kind === 'user' && p.role !== 'viewer');
}

/* ---------------- server-side data in stored definitions ---------------- */

const FETCHED = ['rest', 'csv', 'graphql', 'xml', 'soap', 'odata']; // engine/data FETCHED_TYPES
/**
 * The host of a data source URL as it is written: '' for a path on this server, null when an expression or a parameter
 * builds it (it could be any host), else the host name (lower case, no brackets).
 * @param {any} url
 */
export function writtenHost(url) {
  const u = String(url ?? '').trim();
  if (u.startsWith('=')) return null;
  if (/^\/(?![/\\])/.test(u)) return '';
  const m = /^(?:https?:)?\/\/([^/?#\\]*)/i.exec(u);
  if (!m || m[1].includes('{')) return null;
  try { return new URL(`http://${m[1]}`).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return null; }
}
/**
 * The data sources of a definition that the server runs with its own reach: SQL on a server connection, and fetches
 * that may reach a host in PW_INTERNAL_HOSTS (an absolute URL to one, or a URL built by an expression: it could be
 * anything). A relative URL is this server (its own checks apply); useProxy goes through /api/data/proxy, which
 * reaches public PW_PROXY_ALLOW hosts only. Inline json and csv data are not server data.
 * @param {any} def @returns {any[]}
 */
export function serverSources(def) {
  const internal = internalHosts();
  const reaches = (src) => {
    if (!internal.length || src.useProxy || ((src.type === 'csv' || src.type === 'xml') && src.data)) return false;
    const h = writtenHost(src.url);
    return h === null || (h !== '' && internal.includes(h)); // '': a path on this server (GET only, serverFetch)
  };
  return (Array.isArray(def?.dataSources) ? def.dataSources : []).filter(s => s && typeof s === 'object' && (s.type === 'sql' || (FETCHED.includes(s.type) && reaches(s))));
}
const sourcesHash = (list) => crypto.createHash('sha256').update(JSON.stringify(list)).digest('hex');
const KEEP_STAMPS = 60; // a little over the versions a report keeps (reports.js): an old version keeps running

/** Refuses (403) a definition with server-side data from a principal who may not store one. @param {Principal} p @param {any} def */
export function assertMayStore(p, def) {
  const n = serverSources(def).length;
  if (n && !canDesign(p)) throw fail(vet(p).kind === 'nobody' && !accountsOn() ? NO_AUTH_HELP
    : 'Only a designer can save a report with SQL, or with data from an internal host (PW_INTERNAL_HOSTS).', 403);
}

/**
 * After the permission checks, before the write: record that `p` (who may) stored this definition's server-side data.
 * The record is the hash of those sources in the report's access record (kept apart from the definition, so a
 * definition cannot vouch for itself); readRunnable runs server-side data only when its hash is recorded.
 * @param {Principal} p @param {string} id @param {any} def
 */
export async function stampDefinition(p, id, def) {
  assertMayStore(p, def);
  const src = serverSources(def);
  if (!src.length) return;
  const text = await store().get('reportacl', id);
  const rec = text ? JSON.parse(text) : { id, folder: null, inherit: true, grants: [] };
  const h = sourcesHash(src);
  const data = Array.isArray(rec.data) ? rec.data : [];
  if (data[0] === h) return;
  await store().put('reportacl', id, JSON.stringify({ ...rec, data: [h, ...data.filter(x => x !== h)].slice(0, KEEP_STAMPS), rev: rev() }));
}

/**
 * A report's definition for running it on the server (render, saved SQL, thumbnail), when the principal may view it:
 * its server-side data must be as someone allowed stored it (stampDefinition). A definition stored any other way
 * (changed outside Pagewright, or saved while an open production server let anyone save) does not run its SQL or
 * internal fetches until a designer saves it again: the stored definition cannot raise what its author could do.
 * @param {Principal} p @param {string} ref "id" or "id@version"
 */
export async function readRunnable(p, ref) {
  const def = await readReportFor(p, ref, 'view');
  const src = serverSources(def);
  if (!src.length) return def;
  const [id] = String(ref).split('@');
  const text = await store().get('reportacl', id);
  const data = text ? JSON.parse(text).data : null;
  if (!Array.isArray(data) || !data.includes(sourcesHash(src))) {
    throw fail(`The report "${id}" has SQL or internal data sources that no designer saved on this server. A designer must open it and save it again.`, 403);
  }
  return def;
}

/**
 * Reports a principal may view, each with its level and folder (the list from reports.js, filtered).
 * @template {{ id: string }} T @param {Principal} p @param {T[]} list
 * @returns {Promise<(T & { access: Level, folder: string|null })[]>}
 */
export async function visibleReports(p, list) {
  p = await asNow(p);
  const s = await snapshot();
  return list.map(r => ({ ...r, access: reportLevel(s, p, r.id), folder: s.reports.get(r.id)?.folder || null }))
    .filter(r => atLeast(r.access, 'view'));
}

/**
 * Folders a principal may see: those it can view, and the ones above them and above its reports (so the path to what
 * it may open is shown; the name of a folder on that path is all it learns).
 * @param {Principal} p @param {{ folder: string|null }[]} reports from visibleReports
 */
export async function visibleFolders(p, reports) {
  p = await asNow(p);
  const s = await snapshot();
  const keep = new Set();
  const up = (f) => { for (let i = 0; f && !keep.has(f) && i < 64; i++) { keep.add(f); f = s.folders.get(f)?.parent || null; } };
  for (const f of s.folders.values()) if (atLeast(folderLevel(s, p, f.id), 'view')) up(f.id);
  for (const r of reports) up(r.folder);
  return [...keep].map(id => s.folders.get(id)).filter(Boolean).map(f => ({
    id: f.id, name: f.name, parent: f.parent || null, inherit: f.inherit !== false, access: folderLevel(s, p, f.id),
  })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/* ---------------- changes ---------------- */

/** Clean grants: known principals and levels only, users by their normalised email. @returns {Grant[]} */
export function checkGrants(grants) {
  if (!Array.isArray(grants) || grants.length > 200) throw fail('"grants" must be a list of at most 200 grants.', 400);
  const out = new Map();
  for (const g of grants) {
    if (!g || typeof g !== 'object' || !LEVELS.includes(g.level)) throw fail('Each grant needs "to" and a "level" (view, edit or manage).', 400);
    const to = String(g.to ?? '');
    let name;
    if (to.startsWith('user:')) name = `user:${normEmail(to.slice(5))}`;
    else if (to.startsWith('group:') && GROUP.test(to.slice(6).trim())) name = `group:${to.slice(6).trim().toLowerCase()}`;
    else throw fail(`"${to.slice(0, 80)}" is not a user:<email> or group:<name>.`, 400);
    if (RANK[g.level] > RANK[out.get(name)?.level || 'none']) out.set(name, { to: name, level: g.level });
  }
  return [...out.values()];
}

const FOLDER_ID = /^f_[a-z0-9]{6,20}$/;
const cleanName = (n) => {
  const s = String(n ?? '').trim().replace(/[\x00-\x1f\x7f]/g, '');
  if (!s || s.length > 120) throw fail('A folder needs a name of at most 120 characters.', 400);
  return s;
};

/** @param {Principal} p @param {{ name: string, parent?: string|null }} body */
export async function createFolder(p, { name, parent = null }) {
  p = await asNow(p);
  const s = await snapshot();
  if (parent && !s.folders.has(parent)) throw fail('No such parent folder.', 404);
  if (s.folders.size >= 5000) throw fail('There are 5,000 folders already.', 400);
  if (!atLeast(folderLevel(s, p, parent), 'manage')) throw fail('You cannot add a folder here.', 403);
  const now = new Date().toISOString();
  const f = { id: `f_${crypto.randomBytes(6).toString('hex')}`, name: cleanName(name), parent: parent || null, inherit: true, grants: [], createdAt: now, updatedAt: now };
  await store().put('folders', f.id, JSON.stringify({ ...f, rev: rev() }));
  return f;
}

/**
 * Rename, move, change inheritance or grants. "root" takes grants only (admins: the root decides for everything).
 * @param {Principal} p @param {string} id @param {{ name?: string, parent?: string|null, inherit?: boolean, grants?: any[] }} patch
 */
export async function updateFolder(p, id, patch) {
  p = await asNow(p);
  const s = await snapshot();
  if (id === 'root') {
    if (!isAll(p) || p.kind === 'service') throw fail('Only an admin can change the top-level permissions.', 403);
    const rec = { id: 'root', grants: checkGrants(patch.grants ?? s.root), updatedAt: new Date().toISOString() };
    await store().put('folders', 'root', JSON.stringify({ ...rec, rev: rev() }));
    return { before: { grants: s.root }, after: rec };
  }
  const f = s.folders.get(id);
  if (!f || !atLeast(folderLevel(s, p, id), 'view')) throw fail('No such folder.', 404);
  if (!atLeast(folderLevel(s, p, id), 'manage')) throw fail('You cannot change this folder.', 403);
  const next = { ...f, updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) next.name = cleanName(patch.name);
  if (patch.inherit !== undefined) next.inherit = !!patch.inherit;
  if (patch.grants !== undefined) next.grants = checkGrants(patch.grants);
  if (patch.parent !== undefined && (patch.parent || null) !== (f.parent || null)) {
    const to = patch.parent || null;
    if (to && !s.folders.has(to)) throw fail('No such parent folder.', 404);
    for (let x = to, i = 0; x && i < 64; i++, x = s.folders.get(x)?.parent || null) if (x === id) throw fail('A folder cannot go inside itself.', 400);
    if (!atLeast(folderLevel(s, p, to), 'manage') || !atLeast(folderLevel(s, p, f.parent || null), 'manage')) throw fail('Moving a folder needs manage on the folder it is in and on the folder it goes to.', 403);
    next.parent = to;
  }
  await store().put('folders', id, JSON.stringify({ ...next, rev: rev() }));
  return { before: f, after: next };
}

/** Only an empty folder goes. @param {Principal} p @param {string} id */
export async function deleteFolder(p, id) {
  p = await asNow(p);
  const s = await snapshot();
  const f = s.folders.get(id);
  if (!f || !atLeast(folderLevel(s, p, id), 'view')) throw fail('No such folder.', 404);
  if (!atLeast(folderLevel(s, p, id), 'manage')) throw fail('You cannot delete this folder.', 403);
  const live = new Set(await store().ids('reports'));
  if ([...s.folders.values()].some(x => x.parent === id) || [...s.reports.values()].some(r => r.folder === id && live.has(r.id))) throw fail('The folder is not empty. Move or delete what is in it first.', 409);
  await store().remove('folders', id);
  return f;
}

/** The access record of a report, for people who manage it. @param {Principal} p @param {string} id */
export async function reportAccessInfo(p, id) {
  const lvl = await checkReport(p, id, 'manage');
  const s = await snapshot();
  const r = s.reports.get(id) || { id, folder: null, inherit: true, grants: [] };
  return { id, folder: r.folder || null, inherit: r.inherit !== false, grants: r.grants || [], access: lvl };
}

/**
 * Move a report, change its inheritance or its grants: manage on the report; a move also manage on both folders.
 * @param {Principal} p @param {string} id @param {{ folder?: string|null, inherit?: boolean, grants?: any[] }} patch
 */
export async function setReportAccess(p, id, patch) {
  p = await asNow(p);
  await checkReport(p, id, 'manage');
  const s = await snapshot();
  const before = s.reports.get(id) || { id, folder: null, inherit: true, grants: [] };
  const next = { ...before, id };
  if (patch.folder !== undefined && (patch.folder || null) !== (before.folder || null)) {
    const to = patch.folder || null;
    if (to && !s.folders.has(to)) throw fail('No such folder.', 404);
    // a move changes who inherits access on both sides: manage on the folder it leaves and the one it goes to
    if (p.kind !== 'open' && (!atLeast(folderLevel(s, p, before.folder || null), 'manage') || !atLeast(folderLevel(s, p, to), 'manage'))) throw fail('Moving a report needs manage on the folder it is in and on the folder it goes to.', 403);
    next.folder = to;
  }
  if (patch.inherit !== undefined) next.inherit = !!patch.inherit;
  if (patch.grants !== undefined) next.grants = checkGrants(patch.grants);
  await store().put('reportacl', id, JSON.stringify({ ...next, rev: rev() }));
  return { before, after: next };
}

/**
 * A new report: it goes in `folder` (edit there needed) and its creator manages it. With `def`: it may hold server-side
 * data only when `p` may store it (assertMayStore).
 * @param {Principal} p @param {string|null} folder @param {any} [def]
 */
export async function canCreateIn(p, folder, def) {
  p = await asNow(p);
  if (p.kind === 'nobody' && !accountsOn()) throw fail(NO_AUTH_HELP, 401); // production with no sign-in
  assertMayStore(p, def);
  if (p.kind === 'open') return;
  const s = await snapshot();
  if (folder && !s.folders.has(folder)) throw fail('No such folder.', 404);
  if (!atLeast(folderLevel(s, p, folder || null), 'edit')) throw fail('You cannot add reports here.', 403);
}
/** Its access record (and the stamp of its server-side data, stampDefinition). @param {Principal} p @param {string} id @param {string|null} folder @param {any} [def] */
export async function recordNewReport(p, id, folder, def) {
  await store().removeVersions(id); // a new report starts with no history, whatever an older one with this id left
  const grants = p.kind === 'user' ? [{ to: `user:${p.email}`, level: 'manage' }] : [];
  await store().remove('reportacl', id); // a stale record of an older report with this id
  if (folder || grants.length) await store().put('reportacl', id, JSON.stringify({ id, folder: folder || null, inherit: true, grants, rev: rev() }));
  if (def) await stampDefinition(p, id, def);
}
/** @param {string} id */
export const forgetReport = (id) => store().remove('reportacl', id);

/**
 * A folder id from a request, or null for the top. Unknown ids are refused by the callers above.
 * @param {any} v
 */
export function folderParam(v) {
  if (v == null || v === '' || v === 'root') return null;
  if (typeof v !== 'string' || !FOLDER_ID.test(v)) throw fail('Bad folder id', 400);
  return v;
}
