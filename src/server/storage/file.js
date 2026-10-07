// @ts-check
// File storage: exactly the files ReportWright has always written, under one root folder (the working folder).
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

// Audit events are appended in groups: while one write runs, the events that arrive wait and go in the next write, one
// per file. Each caller still resolves only once its own line is written. One open/write/close per group, not per event.
/** @type {{ dir: string, file: string, line: string, resolve: () => void, reject: (e: any) => void }[]} */
const auditQ = [];
const auditDirs = new Set();
let auditBusy = false;
async function flushAudit() {
  if (auditBusy) return;
  auditBusy = true;
  try {
    while (auditQ.length) {
      const batch = auditQ.splice(0);
      const files = new Map();
      for (const e of batch) files.set(e.file, [...(files.get(e.file) || []), e]);
      for (const [file, es] of files) {
        try {
          const text = es.map(e => e.line).join('');
          const mk = async () => { await fs.mkdir(es[0].dir, { recursive: true, mode: 0o700 }); auditDirs.add(es[0].dir); };
          if (!auditDirs.has(es[0].dir)) await mk();
          // the folder was removed since (cleanup, a test): make it again
          await fs.appendFile(file, text, { mode: 0o600 }).catch(async (e) => { if (!missing(e)) throw e; await mk(); await fs.appendFile(file, text, { mode: 0o600 }); });
          for (const e of es) e.resolve();
        } catch (err) { auditDirs.delete(es[0].dir); for (const e of es) e.reject(err); }
      }
    }
  } finally { auditBusy = false; }
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
    reportmeta: { file: (id) => path.join(data, 'report-meta', `${safe(id)}.json`), ids: async () => (await fs.readdir(path.join(data, 'report-meta'))).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)) },
  };
  /** One JSON array for the whole kind; `key` is the id field of each record. Users are owner-only (password hashes). */
  const arrays = {
    schedules: { file: path.join(data, 'schedules.json'), key: 'id', mode: 0o644 },
    users: { file: path.join(data, 'users.json'), key: 'email', mode: 0o600 },
    folders: { file: path.join(data, 'folders.json'), key: 'id', mode: 0o644 },
    reportacl: { file: path.join(data, 'report-access.json'), key: 'id', mode: 0o644 },
    tokens: { file: path.join(data, 'tokens.json'), key: 'id', mode: 0o600 }, // short-lived sign-in state (SAML request ids)
    settings: { file: path.join(data, 'settings.json'), key: 'id', mode: 0o600 }, // server settings (src/server/settings.js)
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
    async removeVersions(id) { await fs.rm(path.join(history, safe(id)), { recursive: true, force: true }); },
    async addVersion(id, version, text, keep) {
      const dir = path.join(history, safe(id));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${safe(version)}.pw.json`), text);
      const old = (await fs.readdir(dir)).filter(n => n.endsWith('.pw.json')).sort();
      for (const n of old.slice(0, Math.max(0, old.length - keep))) await fs.rm(path.join(dir, n), { force: true });
    },

    // Audit log: one JSON line per event, one file per UTC day (data/audit/2026-10-04.jsonl, owner only). Appending
    // never rewrites what is there; retention removes whole days.
    appendAudit(entry) {
      const dir = path.join(data, 'audit');
      return new Promise((resolve, reject) => { auditQ.push({ dir, file: path.join(dir, `${entry.at.slice(0, 10)}.jsonl`), line: `${JSON.stringify(entry)}\n`, resolve, reject }); flushAudit(); });
    },
    async queryAudit(q) {
      const dir = path.join(data, 'audit');
      let days = [];
      try { days = (await fs.readdir(dir)).filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().reverse(); } catch (e) { if (!missing(e)) throw e; }
      const out = [];
      for (const d of days) {
        const day = d.slice(0, 10);
        if ((q.from && day < q.from.slice(0, 10)) || (q.to && day > q.to.slice(0, 10))) continue;
        const lines = (await fs.readFile(path.join(dir, d), 'utf8')).split('\n').filter(Boolean).reverse();
        for (const l of lines) {
          let e;
          try { e = JSON.parse(l); } catch { if (q.raw) { out.push({ __unreadable: l.slice(0, 200), __file: d }); if (out.length >= q.limit) return out; } continue; } // raw: the verifier sees broken lines
          if (auditMatch(e, q)) { out.push(e); if (out.length >= q.limit) return out; }
        }
      }
      return out;
    },
    async pruneAudit(before) {
      const dir = path.join(data, 'audit');
      let n = 0;
      try { for (const d of await fs.readdir(dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(d) && d.slice(0, 10) < before.slice(0, 10)) { await fs.rm(path.join(dir, d), { force: true }); n++; } } catch (e) { if (!missing(e)) throw e; }
      return n;
    },

    // Leases are files, so two processes on one folder (a dev server and a test server, say) see each other's.
    // ponytail: file storage is still one machine; servers on several machines use PW_STORAGE=sqlite|postgres|mysql.
    async lease(name, owner, ttl) {
      const file = leaseFile(data, name);
      return withFileLock(file, async () => {
        const cur = await readLease(file);
        if (cur && cur.owner !== owner && cur.expires > Date.now()) return false;
        await writeAtomic(file, JSON.stringify({ owner, expires: Date.now() + ttl }));
        return true;
      });
    },
    /** Remove lease files that ran out before this time (ms); the number removed. */
    async sweepLeases(before) {
      const dir = path.join(data, 'leases');
      let n = 0, names = [];
      try { names = (await fs.readdir(dir)).filter(f => f.endsWith('.json')); } catch (e) { if (missing(e)) return 0; throw e; }
      for (const f of names) {
        const file = path.join(dir, f);
        await withFileLock(file, async () => { const cur = await readLease(file); if (cur && cur.expires < before) { await fs.rm(file, { force: true }); n++; } }).catch(() => {});
      }
      return n;
    },
    async release(name, owner) {
      const file = leaseFile(data, name);
      await withFileLock(file, async () => { if ((await readLease(file))?.owner === owner) await fs.rm(file, { force: true }); });
    },
  };
}

/** One audit event against a query: time range [from, to), type (exact or "prefix."), actor, report, before (id). */
export function auditMatch(e, q) {
  if (q.from && e.at < q.from) return false;
  if (q.to && e.at >= q.to) return false;
  if (q.before && e.id >= q.before) return false;
  if (q.type && !(q.type.endsWith('.') ? String(e.type).startsWith(q.type) : e.type === q.type)) return false;
  if (q.actor && e.actor !== q.actor) return false;
  if (q.report && e.report !== q.report) return false;
  return true;
}

const leaseFile = (data, name) => path.join(data, 'leases', `${String(name).replace(/[^\w.-]/g, '_')}.json`);
async function readLease(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (missing(e) || e instanceof SyntaxError) return null; throw e; }
}
/** Read-modify-write of one lease across processes: mkdir is atomic, so only one process holds `<file>.lock`. */
async function withFileLock(file, fn) {
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (let tries = 0; ; tries++) {
    try { await fs.mkdir(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // a lock this old was left by a process that died between mkdir and rm
      try { if (Date.now() - (await fs.stat(lock)).mtimeMs > 10000) { await fs.rm(lock, { recursive: true, force: true }); continue; } } catch { /* gone already */ }
      if (tries > 400) throw new Error(`Lease lock ${path.basename(lock)} is stuck`);
      await new Promise(r => setTimeout(r, 5));
    }
  }
  try { return await fn(); } finally { await fs.rm(lock, { recursive: true, force: true }); }
}
