// Server-only helpers for reports, with version history. Where they live: src/server/storage (PW_STORAGE).
import crypto from 'node:crypto';
import path from 'node:path';
import { store } from './storage/index.js';
import { upgrade } from '../engine/schema/upgrade.js';

/** Where file storage keeps reports (PW_STORAGE=file, the default). */
export const REPORTS_DIR = path.join(process.cwd(), 'reports');
const KEEP_VERSIONS = 50;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DEF_BYTES = 5 * 1024 * 1024; // a real report is under 200 KB

/** A request body as JSON, refusing anything over 5 MB. */
export async function readDefinition(req) {
  const tooBig = () => Object.assign(new Error('A report can be at most 5 MB'), { status: 413 });
  if (Number(req.headers.get('content-length')) > MAX_DEF_BYTES) throw tooBig();
  const text = new TextDecoder().decode(await readBody(req, MAX_DEF_BYTES, tooBig)); // counted as it arrives, chunked too
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Send the report as JSON'), { status: 400 }); }
}

/**
 * A request body, read only up to `max` bytes: past it the read stops and `tooBig()` is thrown, with or without a
 * Content-Length (a chunked body is counted as it arrives). @param {Request} req @param {number} max @param {() => Error} [tooBig]
 */
export async function readBody(req, max, tooBig = () => Object.assign(new Error(`The request is larger than ${Math.round(max / 1048576)} MB`), { status: 413 })) {
  if (Number(req.headers.get('content-length')) > max) throw tooBig();
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { await reader.cancel().catch(() => {}); throw tooBig(); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function safeId(id) {
  if (!ID.test(String(id))) throw Object.assign(new Error('Bad report id'), { status: 400 });
  return id;
}
/** What the report list shows of a definition. @param {string} id @param {any} def @param {string} updatedAt */
function metaOf(id, def, updatedAt) {
  let items = 0;
  const count = (list) => (list || []).forEach(i => { items++; count(i.items); });
  // body may be a list of sections, each with its own page header and footer
  for (const s of Object.values(def.sections || {})) for (const b of Array.isArray(s) ? s : [s]) { count(b?.items); count(b?.pageHeader?.items); count(b?.pageFooter?.items); }
  return { id, name: def.name || id, updatedAt, items, parameters: (def.parameters || []).map(p => ({ name: p.name, type: p.type || 'string', required: !!p.required })) };
}

/**
 * Every report: { id, name, updatedAt, items, parameters }, newest first. From the "reportmeta" index that writeReport
 * keeps, not from every definition; a report the index lacks (an older install, a file copied in) is read once and
 * added. ponytail: a definition changed outside Pagewright keeps its old name here until it is saved.
 */
export async function listReports() {
  const [ids, metas] = await Promise.all([store().ids('reports'), store().list('reportmeta')]);
  const byId = new Map();
  for (const r of metas) { try { byId.set(r.id, JSON.parse(r.text)); } catch { /* rebuilt below */ } }
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) {
    const want = new Set(missing);
    for (const { id, text, updatedAt } of await store().list('reports')) {
      if (!want.has(id)) continue;
      try { const m = metaOf(id, JSON.parse(text), updatedAt); byId.set(id, m); await store().put('reportmeta', id, JSON.stringify(m)); } catch { /* skip unreadable reports */ }
    }
  }
  return ids.map(id => byId.get(id)).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Read a report. "id@version" reads a saved version from the history. */
export async function readReport(ref) {
  const [id, version] = String(ref).split('@');
  const text = version ? await store().getVersion(safeId(id), safeVersion(version)) : await store().get('reports', safeId(id));
  return text == null ? null : parseReport(text);
}
/**
 * A stored definition as this version reads it: parsed and upgraded (engine/schema/upgrade.js: a pure transform of
 * this one definition; it reads nothing else). Callers check access before this, so its errors tell nothing to
 * someone who may not open the report. @param {string} text
 */
export function parseReport(text) {
  try { return upgrade(JSON.parse(text)); }
  catch (e) { throw /** @type {any} */ (e).status ? e : Object.assign(new Error('The stored report is not valid JSON.'), { status: 500 }); }
}
const safeVersion = (v) => { if (!/^\d{8}T\d{6}\d{3}Z?$/.test(v)) throw Object.assign(new Error('Bad version'), { status: 400 }); return v; };

/**
 * A saved report's revision: the first 16 hex of the SHA-256 of its stored text. GET answers it as the ETag; a save
 * of an existing report must send it back as If-Match (PUT /api/reports/<id>), so two editors never overwrite each
 * other silently. Derived from the text, so it needs no field of its own and changes with every save.
 * @param {string|null} text
 */
export const revOf = (text) => (text == null ? null : crypto.createHash('sha256').update(String(text).trim()).digest('hex').slice(0, 16));

/** @returns {Promise<string>} the new revision */
export async function writeReport(id, def) {
  const next = JSON.stringify(def, null, 2);
  // keep the previous version
  const prev = await store().get('reports', safeId(id));
  if (prev != null && prev.trim() !== next.trim()) {
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', '');
    await store().addVersion(id, stamp, prev, KEEP_VERSIONS);
  }
  await store().put('reports', id, next);
  await store().put('reportmeta', id, JSON.stringify(metaOf(id, def, new Date().toISOString())));
  await (await import('./snapshots.js')).bumpGeneration(); // a saved report (maybe another's subreport): snapshots so far are stale
  return /** @type {string} */ (revOf(next));
}

export async function listVersions(id) {
  return (await store().versions(safeId(id))).map(({ version: v, bytes }) => {
    const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}.${v.slice(15, 18)}Z`;
    return { version: v, savedAt: iso, bytes };
  });
}

/** A report and its version history (a new report with this id must not inherit old versions). */
export async function deleteReport(id) {
  await store().removeVersions(safeId(id)); await store().remove('reports', id); // history first: a half-done delete leaves no orphans
  await store().remove('reportmeta', id);
  await (await import('./snapshots.js')).bumpGeneration();
}

export async function newId(name) {
  const base = (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report').slice(0, 48);
  const existing = new Set(await store().ids('reports'));
  let id = base, i = 2;
  while (existing.has(id)) id = `${base}-${i++}`;
  return id;
}
