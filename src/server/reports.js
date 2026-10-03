// Server-only helpers for report files in /reports, with version history.
import fs from 'node:fs/promises';
import path from 'node:path';

export const REPORTS_DIR = path.join(process.cwd(), 'reports');
const HISTORY_DIR = path.join(REPORTS_DIR, '.history');
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
const file = (id) => path.join(REPORTS_DIR, `${safeId(id)}.pw.json`);

export async function listReports() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const names = (await fs.readdir(REPORTS_DIR)).filter(n => n.endsWith('.pw.json'));
  const out = [];
  for (const n of names) {
    const id = n.replace(/\.pw\.json$/, '');
    try {
      const stat = await fs.stat(path.join(REPORTS_DIR, n));
      const def = JSON.parse(await fs.readFile(path.join(REPORTS_DIR, n), 'utf8'));
      let items = 0;
      const count = (list) => (list || []).forEach(i => { items++; count(i.items); });
      for (const s of Object.values(def.sections || {})) count(s.items);
      out.push({ id, name: def.name || id, updatedAt: stat.mtime.toISOString(), items, parameters: (def.parameters || []).map(p => ({ name: p.name, type: p.type || 'string', required: !!p.required })) });
    } catch { /* skip unreadable files */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Read a report. "id@version" reads a saved version from the history. */
export async function readReport(ref) {
  const [id, version] = String(ref).split('@');
  try {
    if (version) return JSON.parse(await fs.readFile(path.join(HISTORY_DIR, safeId(id), `${safeVersion(version)}.pw.json`), 'utf8'));
    return JSON.parse(await fs.readFile(file(id), 'utf8'));
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
const safeVersion = (v) => { if (!/^\d{8}T\d{6}\d{3}Z?$/.test(v)) throw Object.assign(new Error('Bad version'), { status: 400 }); return v; };

export async function writeReport(id, def) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  // keep the previous version
  try {
    const prev = await fs.readFile(file(id), 'utf8');
    if (prev.trim() !== JSON.stringify(def, null, 2).trim()) {
      const dir = path.join(HISTORY_DIR, safeId(id));
      await fs.mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', '');
      await fs.writeFile(path.join(dir, `${stamp}.pw.json`), prev);
      const old = (await fs.readdir(dir)).filter(n => n.endsWith('.pw.json')).sort();
      for (const n of old.slice(0, Math.max(0, old.length - KEEP_VERSIONS))) await fs.rm(path.join(dir, n), { force: true });
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const tmp = file(id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(def, null, 2));
  await fs.rename(tmp, file(id));
}

export async function listVersions(id) {
  const dir = path.join(HISTORY_DIR, safeId(id));
  let names = [];
  try { names = (await fs.readdir(dir)).filter(n => n.endsWith('.pw.json')); } catch { return []; }
  const out = [];
  for (const n of names.sort().reverse()) {
    const v = n.replace('.pw.json', '');
    const stat = await fs.stat(path.join(dir, n));
    const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}.${v.slice(15, 18)}Z`;
    out.push({ version: v, savedAt: iso, bytes: stat.size });
  }
  return out;
}

export async function deleteReport(id) { await fs.rm(file(id), { force: true }); }

export async function newId(name) {
  const base = (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report').slice(0, 48);
  const existing = new Set((await listReports()).map(r => r.id));
  let id = base, i = 2;
  while (existing.has(id)) id = `${base}-${i++}`;
  return id;
}
