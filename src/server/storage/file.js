// @ts-check
// File storage: exactly the files Pagewright has always written, under one root folder (the working folder).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** An id is never a path: no slashes, no leading dot. The callers check their own, stricter formats first. */
const safe = (id) => {
  if (typeof id !== 'string' || !/^[\w@+-][\w.@+-]*$/.test(id)) throw Object.assign(new Error('Bad id'), { status: 400 });
  return id;
};
const missing = (e) => e.code === 'ENOENT';

/** Write through a temp file, so a crash never leaves half a file. */
async function writeAtomic(file, text, mode = 0o644) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, text, { mode });
  await fs.rename(tmp, file);
}

// Read-modify-write of a whole-array file runs one at a time (per file, in this process).
/** @type {Map<string, Promise<any>>} */
const locks = (/** @type {any} */ (globalThis).__pwFileLocks ||= new Map());
function locked(file, fn) {
  const run = (locks.get(file) || Promise.resolve()).then(fn, fn);
  locks.set(file, run.catch(() => {}));
  return run;
}

/** @param {string} root @returns {import('./index.js').Store} */
export function fileStore(root) {
  const reports = path.join(root, 'reports');
  const history = path.join(reports, '.history');
  const data = path.join(root, 'data');

  /** One file per record. */
  const files = {
    reports: { file: (id) => path.join(reports, `${safe(id)}.pw.json`), ids: async () => (await fs.readdir(reports)).filter(n => n.endsWith('.pw.json')).map(n => n.slice(0, -8)) },
    jobs: { file: (id) => path.join(data, 'jobs', safe(id), 'job.json'), ids: () => fs.readdir(path.join(data, 'jobs')) },
    fonts: { file: (id) => path.join(data, 'fonts', `${safe(id)}.json`), ids: async () => (await fs.readdir(path.join(data, 'fonts'))).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)) },
  };
  /** One JSON array for the whole kind; `key` is the id field of each record. Users are owner-only (password hashes). */
  const arrays = {
    schedules: { file: path.join(data, 'schedules.json'), key: 'id', mode: 0o644 },
    users: { file: path.join(data, 'users.json'), key: 'email', mode: 0o600 },
  };
  const readArray = async (a) => {
    try { return JSON.parse(await fs.readFile(a.file, 'utf8')); } catch (e) { if (missing(e)) return []; throw e; }
  };
  const writeArray = (a, list) => writeAtomic(a.file, JSON.stringify(list, null, 2), a.mode);
  const kind = (k) => {
    if (files[k]) return { f: files[k], a: null };
    if (arrays[k]) return { f: null, a: arrays[k] };
    throw new Error(`Unknown storage kind "${k}"`);
  };

  return {
    async get(k, id) {
      const { f, a } = kind(k);
      if (a) { const x = (await readArray(a)).find(r => r[a.key] === id); return x ? JSON.stringify(x) : null; }
      try { return await fs.readFile(f.file(id), 'utf8'); } catch (e) { if (missing(e)) return null; throw e; }
    },
    async put(k, id, text) {
      const { f, a } = kind(k);
      if (!a) return writeAtomic(f.file(id), text);
      const rec = JSON.parse(text);
      return locked(a.file, async () => {
        const list = await readArray(a);
        const i = list.findIndex(r => r[a.key] === id);
        if (i >= 0) list[i] = rec; else list.push(rec);
        await writeArray(a, list);
      });
    },
    async remove(k, id) {
      const { f, a } = kind(k);
      if (a) {
        return locked(a.file, async () => {
          const list = await readArray(a);
          const left = list.filter(r => r[a.key] !== id);
          if (left.length !== list.length) await writeArray(a, left);
          return left.length !== list.length;
        });
      }
      try { await fs.unlink(f.file(id)); return true; } catch (e) { if (missing(e)) return false; throw e; }
    },
    async ids(k) {
      const { f, a } = kind(k);
      if (a) return (await readArray(a)).map(r => r[a.key]);
      try { return await f.ids(); } catch (e) { if (missing(e)) return []; throw e; }
    },
    async list(k) {
      const { f, a } = kind(k);
      if (a) return (await readArray(a)).map(r => ({ id: r[a.key], text: JSON.stringify(r), updatedAt: r.updatedAt || r.createdAt || '' }));
      const out = [];
      for (const id of await this.ids(k)) {
        try {
          const file = f.file(id);
          const [stat, text] = await Promise.all([fs.stat(file), fs.readFile(file, 'utf8')]);
          out.push({ id, text, updatedAt: stat.mtime.toISOString() });
        } catch { /* skip unreadable files */ }
      }
      return out;
    },

    async versions(id) {
      const dir = path.join(history, safe(id));
      let names = [];
      try { names = (await fs.readdir(dir)).filter(n => n.endsWith('.pw.json')); } catch { return []; }
      const out = [];
      for (const n of names.sort().reverse()) out.push({ version: n.slice(0, -8), bytes: (await fs.stat(path.join(dir, n))).size });
      return out;
    },
    async getVersion(id, version) {
      try { return await fs.readFile(path.join(history, safe(id), `${safe(version)}.pw.json`), 'utf8'); } catch (e) { if (missing(e)) return null; throw e; }
    },
    async addVersion(id, version, text, keep) {
      const dir = path.join(history, safe(id));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${safe(version)}.pw.json`), text);
      const old = (await fs.readdir(dir)).filter(n => n.endsWith('.pw.json')).sort();
      for (const n of old.slice(0, Math.max(0, old.length - keep))) await fs.rm(path.join(dir, n), { force: true });
    },

    // ponytail: leases in memory: file storage is for one server. Several servers use PW_STORAGE=sqlite|postgres|mysql.
    async lease(name, owner, ttl) {
      const cur = leases.get(name);
      if (cur && cur.owner !== owner && cur.expires > Date.now()) return false;
      leases.set(name, { owner, expires: Date.now() + ttl });
      return true;
    },
    async release(name, owner) { if (leases.get(name)?.owner === owner) leases.delete(name); },
  };
}

/** @type {Map<string, { owner: string, expires: number }>} */
const leases = (/** @type {any} */ (globalThis).__pwLeases ||= new Map());
