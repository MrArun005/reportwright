// @ts-check
// Server settings an admin changes on the Settings page (/admin/settings), shared by every server through the storage
// ('settings' kind: data/settings.json on files, pw_settings in a database). Every write takes the "settings" lock, so
// two servers (or the processes of scripts/cluster.mjs) never lose each other's changes.
//   require2fa   roles whose password accounts must sign in with a second factor (src/server/totp.js)
//   snapshotTtl  seconds a rendered report snapshot is reused (src/server/snapshots.js); 0 = off
//   snapshotMaxMb the snapshot cache's size bound
//   htmlExport   { html, drillLinks }: how the viewer makes HTML files unless a report says otherwise (src/engine/htmlExport.js);
//                unset: env PW_HTML_EXPORT / PW_HTML_DRILL_LINKS, then interactive / inline
// Other records here (named by id) are small server state: audit chain heads, the snapshot generation.
import { store, withLock } from './storage/index.js';
import { HTML_MODES, DRILL_LINKS, resolveHtmlExport, envHtmlExport } from '../engine/htmlExport.js';

export const SETTINGS_ROLES = ['viewer', 'designer', 'admin'];
const DEFAULTS = Object.freeze({ require2fa: [], snapshotTtl: 0, snapshotMaxMb: 512, htmlExport: {} });
const CACHE_MS = 3000;
const g = /** @type {any} */ (globalThis);
g.__pwSettings ||= { at: 0, value: null };

const fail = (msg) => Object.assign(new Error(msg), { status: 400 });

/** One record by id, or null. @param {string} id */
export async function getRecord(id) {
  const t = await store().get('settings', id);
  return t ? JSON.parse(t) : null;
}
/** Insert or replace one record (under the settings lock). @param {string} id @param {any} rec */
export function putRecord(id, rec) { return withLock('settings', () => store().put('settings', id, JSON.stringify({ ...rec, id }))); }

/**
 * The settings, with defaults. Cached for 3 s in this process (sessions read them on every request); fresh: read now.
 * @returns {Promise<{ require2fa: string[], snapshotTtl: number, snapshotMaxMb: number, htmlExport: { html?: string, drillLinks?: string }, updatedAt?: string, updatedBy?: string }>}
 */
export async function getSettings({ fresh = false } = {}) {
  if (!fresh && g.__pwSettings.value && Date.now() - g.__pwSettings.at < CACHE_MS) return g.__pwSettings.value;
  const { id: _id, ...rec } = (await getRecord('server')) || {};
  const value = { ...DEFAULTS, ...rec };
  g.__pwSettings = { at: Date.now(), value };
  return value;
}

/** @param {any} patch */
function check(patch) {
  const out = {};
  if (patch.require2fa !== undefined) {
    if (!Array.isArray(patch.require2fa) || patch.require2fa.some(r => !SETTINGS_ROLES.includes(r))) throw fail(`require2fa must list roles: ${SETTINGS_ROLES.join(', ')}.`);
    out.require2fa = [...new Set(patch.require2fa)].sort();
  }
  if (patch.snapshotTtl !== undefined) {
    const n = Number(patch.snapshotTtl);
    if (!Number.isInteger(n) || n < 0 || n > 7 * 86400) throw fail('snapshotTtl is whole seconds, 0 to 604800 (a week).');
    out.snapshotTtl = n;
  }
  if (patch.snapshotMaxMb !== undefined) {
    const n = Number(patch.snapshotMaxMb);
    if (!Number.isInteger(n) || n < 1 || n > 1000000) throw fail('snapshotMaxMb is whole megabytes, 1 to 1000000.');
    out.snapshotMaxMb = n;
  }
  if (patch.htmlExport !== undefined) {
    const h = patch.htmlExport;
    if (!h || typeof h !== 'object' || Array.isArray(h)) throw fail('htmlExport is { html?, drillLinks? }.');
    const v = {};
    // an empty value means "not set here": the environment, then the default, decide
    if (h.html) { if (!HTML_MODES.includes(h.html)) throw fail(`htmlExport.html is one of ${HTML_MODES.join(', ')}.`); v.html = h.html; }
    if (h.drillLinks) { if (!DRILL_LINKS.includes(h.drillLinks)) throw fail(`htmlExport.drillLinks is one of ${DRILL_LINKS.join(', ')}.`); v.drillLinks = h.drillLinks; }
    out.htmlExport = v;
  }
  return out;
}

/** The server's HTML export default: the admin setting, then env, then interactive / inline. */
export async function serverHtmlExport() {
  return resolveHtmlExport((await getSettings()).htmlExport, envHtmlExport());
}

/** Change settings (an admin, from the Settings page). @param {any} patch @param {{ by?: string | { email: string, sv?: number } }} [o] */
export async function updateSettings(patch, { by } = {}) {
  const changes = check(patch || {});
  return withLock('settings', async () => {
    if (by && typeof by === 'object') await (await import('./users.js')).stillAdmin(by); // still that admin's session, now
    const cur = await getSettings({ fresh: true });
    const who = typeof by === 'object' ? by?.email : by;
    const next = { ...cur, ...changes, updatedAt: new Date().toISOString(), ...(who ? { updatedBy: who } : {}) };
    await store().put('settings', 'server', JSON.stringify({ ...next, id: 'server' }));
    g.__pwSettings = { at: Date.now(), value: next };
    return next;
  });
}
