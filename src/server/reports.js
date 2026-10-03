// Server-only helpers for report files in /reports.
import fs from 'node:fs/promises';
import path from 'node:path';

export const REPORTS_DIR = path.join(process.cwd(), 'reports');
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
      out.push({ id, name: def.name || id, updatedAt: stat.mtime.toISOString(), items: Object.values(def.sections || {}).reduce((s, x) => s + (x.items?.length || 0), 0) });
    } catch { /* skip unreadable files */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readReport(id) {
  try { return JSON.parse(await fs.readFile(file(id), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

export async function writeReport(id, def) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const tmp = file(id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(def, null, 2));
  await fs.rename(tmp, file(id));
}

export async function deleteReport(id) { await fs.rm(file(id), { force: true }); }

export async function newId(name) {
  const base = (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report').slice(0, 48);
  const existing = new Set((await listReports()).map(r => r.id));
  let id = base, i = 2;
  while (existing.has(id)) id = `${base}-${i++}`;
  return id;
}
