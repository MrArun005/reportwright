// @ts-check
// Copy one storage into another (pw migrate-storage): every kind, report versions, the audit log in order. The
// target's records are replaced where ids meet. Run with the server stopped (nothing is locked while it copies).
import { fileStore } from './file.js';
import { sqlStore } from './sql.js';

const KINDS = /** @type {const} */ (['reports', 'reportmeta', 'schedules', 'jobs', 'users', 'fonts', 'folders', 'reportacl', 'tokens', 'settings', 'blobs']);
/** @param {string} spec */
const open = (spec) => (spec === 'file' ? fileStore(process.cwd()) : /^(sqlite:|postgres(ql)?:\/\/|mysql:\/\/|mssql:\/\/)/.test(spec) ? sqlStore(spec) : (() => { throw new Error('a storage is "file" or a sqlite:, postgres://, mysql:// or mssql:// URL'); })());

/** @param {string} from @param {string} to @param {(msg: string) => void} [say] */
export async function copyStorage(from, to, say = () => {}) {
  if (from === to) throw new Error('--from and --to are the same storage');
  const a = open(from), b = open(to);
  const n = { records: 0, versions: 0, audit: 0, blobs: 0 };
  for (const k of KINDS) {
    let rows = [];
    try { rows = await a.list(k); } catch (e) { if (!/Unknown storage kind/.test(String(/** @type {any} */ (e).message))) throw e; } // file storage keeps blobs elsewhere
    for (const r of rows) { await b.put(k, r.id, r.text); n.records++; }
    if (k === 'reports') {
      for (const r of rows) {
        for (const v of [...await a.versions(r.id)].reverse()) { const t = await a.getVersion(r.id, v.version); if (t != null) { await b.addVersion(r.id, v.version, t, 1000); n.versions++; } }
      }
    }
    say(`${k}: ${rows.length}`);
  }
  // blobs: in their own folder on file storage (between databases they are records, copied above); PW_BLOBS=s3:// stays
  if (from === 'file' && !process.env.PW_BLOBS) {
    const { blobs } = await import('../blobs.js');
    const keep = process.env.PW_STORAGE;
    const use = (spec) => { process.env.PW_STORAGE = spec; return blobs(); };
    try {
      for (const x of await use(from).list('')) { const bytes = await use(from).get(x.key); if (bytes) { await use(to).put(x.key, bytes); n.blobs++; } }
    } finally { if (keep === undefined) delete process.env.PW_STORAGE; else process.env.PW_STORAGE = keep; }
    say(`blob files: ${n.blobs}`);
  }
  // the audit log, oldest first (each event keeps its id, chain hash and signature)
  const all = [];
  for (let before; ;) {
    const page = await a.queryAudit({ limit: 1000, ...(before ? { before } : {}) });
    all.push(...page);
    if (page.length < 1000) break;
    before = page.at(-1).id;
  }
  for (const e of all.reverse()) { await b.appendAudit(e); n.audit++; }
  say(`audit: ${n.audit}`);
  return n;
}
