// Server-only helpers for reports, with version history. Where they live: src/server/storage (PW_STORAGE).
import path from 'node:path';
import { store } from './storage/index.js';

/** Where file storage keeps reports (PW_STORAGE=file, the default). */
export const REPORTS_DIR = path.join(process.cwd(), 'reports');
const KEEP_VERSIONS = 50;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DEF_BYTES = 5 * 1024 * 1024; // a real report is under 200 KB

/** A request body as JSON, refusing anything over 5 MB. */
export async function readDefinition(req) {
  const tooBig = () => Object.assign(new Error('A report can be at most 5 MB'), { status: 413 });
  if (Number(req.headers.get('content-length')) > MAX_DEF_BYTES) throw tooBig();
  const text = await req.text(); // ponytail: a chunked body without a length is read before the check; cap at the reverse proxy if that matters
  if (text.length > MAX_DEF_BYTES) throw tooBig();
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Send the report as JSON'), { status: 400 }); }
}

export function safeId(id) {
  if (!ID.test(String(id))) throw Object.assign(new Error('Bad report id'), { status: 400 });
  return id;
}
export async function listReports() {
  const out = [];
  for (const { id, text, updatedAt } of await store().list('reports')) {
    try {
      const def = JSON.parse(text);
      let items = 0;
      const count = (list) => (list || []).forEach(i => { items++; count(i.items); });
      for (const s of Object.values(def.sections || {})) for (const b of Array.isArray(s) ? s : [s]) count(b?.items); // body may be a list of sections
      out.push({ id, name: def.name || id, updatedAt, items, parameters: (def.parameters || []).map(p => ({ name: p.name, type: p.type || 'string', required: !!p.required })) });
    } catch { /* skip unreadable reports */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Read a report. "id@version" reads a saved version from the history. */
export async function readReport(ref) {
  const [id, version] = String(ref).split('@');
  const text = version ? await store().getVersion(safeId(id), safeVersion(version)) : await store().get('reports', safeId(id));
  return text == null ? null : JSON.parse(text);
}
const safeVersion = (v) => { if (!/^\d{8}T\d{6}\d{3}Z?$/.test(v)) throw Object.assign(new Error('Bad version'), { status: 400 }); return v; };

export async function writeReport(id, def) {
  const next = JSON.stringify(def, null, 2);
  // keep the previous version
  const prev = await store().get('reports', safeId(id));
  if (prev != null && prev.trim() !== next.trim()) {
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', '');
    await store().addVersion(id, stamp, prev, KEEP_VERSIONS);
  }
  await store().put('reports', id, next);
}

export async function listVersions(id) {
  return (await store().versions(safeId(id))).map(({ version: v, bytes }) => {
    const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}.${v.slice(15, 18)}Z`;
    return { version: v, savedAt: iso, bytes };
  });
}

/** A report and its version history (a new report with this id must not inherit old versions). */
export async function deleteReport(id) { await store().removeVersions(safeId(id)); await store().remove('reports', id); } // history first: a half-done delete leaves no orphans

export async function newId(name) {
  const base = (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report').slice(0, 48);
  const existing = new Set((await listReports()).map(r => r.id));
  let id = base, i = 2;
  while (existing.has(id)) id = `${base}-${i++}`;
  return id;
}
