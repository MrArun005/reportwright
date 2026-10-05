// @ts-check
// Binary files that every server must reach: batch output (items while a batch runs, the zip or merged PDF after) and
// report snapshots (src/server/snapshots.js). Keys are paths like "jobs/b_x/output.zip" (segments of letters, digits,
// . _ @ -). Where they live:
//   PW_BLOBS=s3://bucket[/prefix]?region=eu-west-1[&endpoint=https://minio.local:9000]   S3 or S3-compatible object
//       storage (SigV4; PW_S3_ACCESS_KEY_ID, PW_S3_SECRET_ACCESS_KEY, optional PW_S3_SESSION_TOKEN; with endpoint,
//       path-style addressing as MinIO and most compatible stores want)
//   otherwise the configured storage (PW_STORAGE): data/blobs/ on files (and beside a sqlite: database); in a server database, the pw_blobs table in 1 MB
//       base64 parts behind a small manifest record, so several servers share them with nothing else to run.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { store } from './storage/index.js';

/** @typedef {{ key: string, size: number, at: string }} BlobInfo */
/**
 * @typedef {object} Blobs
 * @property {(key: string, bytes: Uint8Array) => Promise<void>} put
 * @property {(key: string) => Promise<Buffer|null>} get
 * @property {(key: string) => Promise<void>} remove
 * @property {(prefix: string) => Promise<BlobInfo[]>} list every blob whose key starts with prefix
 * @property {(key: string) => Promise<void>} touch mark as used now (LRU); a no-op where it would cost a copy (S3)
 */

const SEG = /^[\w@][\w.@-]{0,127}$/;
/** A key is a path of safe segments: never "..", never absolute. @param {string} key */
export function checkKey(key) {
  const k = String(key);
  if (k.length > 240 || !k.split('/').every(s => SEG.test(s))) throw Object.assign(new Error(`Bad blob key "${k.slice(0, 60)}"`), { status: 400 });
  return k;
}
const missing = (e) => e?.code === 'ENOENT';

/** Files under data/blobs (PW_STORAGE=file). @param {string} root @returns {Blobs} */
function fileBlobs(root) {
  const dir = path.join(root, 'data', 'blobs');
  const file = (k) => path.join(dir, ...checkKey(k).split('/'));
  async function walk(d, rel, out) {
    let names = [];
    try { names = await fs.readdir(d, { withFileTypes: true }); } catch (e) { if (missing(e)) return; throw e; }
    for (const n of names) {
      if (n.name.endsWith('.tmp')) continue;
      const r = rel ? `${rel}/${n.name}` : n.name;
      if (n.isDirectory()) await walk(path.join(d, n.name), r, out);
      else { try { const st = await fs.stat(path.join(d, n.name)); out.push({ key: r, size: st.size, at: st.mtime.toISOString() }); } catch { /* gone */ } }
    }
  }
  return {
    async put(k, bytes) {
      const f = file(k);
      await fs.mkdir(path.dirname(f), { recursive: true });
      const tmp = `${f}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, bytes, { mode: 0o600 });
      await fs.rename(tmp, f);
    },
    async get(k) { try { return await fs.readFile(file(k)); } catch (e) { if (missing(e)) return null; throw e; } },
    async remove(k) { await fs.rm(file(k), { force: true }); },
    async list(prefix) {
      // walk only the folder the prefix names (its whole segments), then filter
      const segs = String(prefix).split('/');
      const whole = segs.slice(0, -1).filter(Boolean);
      for (const s of whole) checkKey(s);
      const out = [];
      await walk(path.join(dir, ...whole), whole.join('/'), out);
      return out.filter(b => b.key.startsWith(prefix));
    },
    async touch(k) { const now = new Date(); await fs.utimes(file(k), now, now).catch(() => {}); },
  };
}

/** The configured storage's 'blobs' kind, in 1 MB parts. @returns {Blobs} */
function storeBlobs() {
  const PART = 1024 * 1024;
  const manifest = async (k) => { const t = await store().get('blobs', k); return t ? JSON.parse(t) : null; };
  return {
    async put(k, bytes) {
      checkKey(k);
      const old = await manifest(k);
      const buf = Buffer.from(bytes);
      const parts = Math.max(1, Math.ceil(buf.length / PART));
      const v = crypto.randomBytes(4).toString('hex'); // parts of a new version never mix with the old one's
      for (let i = 0; i < parts; i++) await store().put('blobs', `${k}#${v}.${i}`, JSON.stringify({ id: `${k}#${v}.${i}`, b: buf.subarray(i * PART, (i + 1) * PART).toString('base64') }));
      await store().put('blobs', k, JSON.stringify({ id: k, size: buf.length, parts, v, at: new Date().toISOString() }));
      if (old) for (let i = 0; i < old.parts; i++) await store().remove('blobs', `${k}#${old.v}.${i}`);
    },
    async get(k) {
      const m = await manifest(checkKey(k));
      if (!m) return null;
      const out = [];
      for (let i = 0; i < m.parts; i++) {
        const t = await store().get('blobs', `${k}#${m.v}.${i}`);
        if (!t) return null; // replaced meanwhile
        out.push(Buffer.from(JSON.parse(t).b, 'base64'));
      }
      return Buffer.concat(out);
    },
    async remove(k) {
      const m = await manifest(checkKey(k));
      if (!m) return;
      await store().remove('blobs', k);
      for (let i = 0; i < m.parts; i++) await store().remove('blobs', `${k}#${m.v}.${i}`);
    },
    async list(prefix) {
      const out = [];
      const s = /** @type {any} */ (store());
      for (const id of await (s.idsFrom ? s.idsFrom('blobs', prefix) : s.ids('blobs'))) { // the prefix's range, where the storage has one
        if (!id.startsWith(prefix) || id.includes('#')) continue;
        const m = await manifest(id).catch(() => null);
        if (m) out.push({ key: id, size: m.size, at: m.lastUsed || m.at });
      }
      return out;
    },
    async touch(k) { const m = await manifest(checkKey(k)); if (m) await store().put('blobs', k, JSON.stringify({ ...m, lastUsed: new Date().toISOString() })); },
  };
}

/* ---------------- S3 (SigV4, no SDK) ---------------- */

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
/** RFC 3986 encoding, as SigV4 wants (slashes kept in paths). @param {string} s @param {boolean} [slash] */
export const uriEncode = (s, slash = false) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(slash ? /%2F/g : /$^/, '/');

/**
 * SigV4 headers for one S3 request. Exported for its test (the AWS documentation's example).
 * @param {{ method: string, url: URL, headers?: Record<string, string>, body?: Uint8Array|string, region: string, accessKey: string, secretKey: string, sessionToken?: string, date?: Date }} r
 */
export function signS3(r) {
  const amzDate = (r.date || new Date()).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payload = r.headers?.['x-amz-content-sha256'] || sha256(r.body || '');
  const headers = { ...r.headers, host: r.url.host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate, ...(r.sessionToken ? { 'x-amz-security-token': r.sessionToken } : {}) };
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const query = [...r.url.searchParams].map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [r.method, uriEncode(decodeURIComponent(r.url.pathname), true), query, ...names.map(h => `${h}:${lower[h]}`), '', names.join(';'), payload].join('\n');
  const scope = `${day}/${r.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${r.secretKey}`, day), r.region), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${r.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
}

/** @param {string} spec s3://bucket/prefix?region=…&endpoint=… @returns {Blobs} */
function s3Blobs(spec) {
  const u = new URL(spec);
  const bucket = u.hostname, base = u.pathname.replace(/^\/|\/$/g, '');
  const region = u.searchParams.get('region') || process.env.AWS_REGION || 'us-east-1';
  const endpoint = u.searchParams.get('endpoint');
  const accessKey = process.env.PW_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
  const secretKey = process.env.PW_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
  const sessionToken = process.env.PW_S3_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || undefined;
  if (!accessKey || !secretKey) throw new Error('PW_BLOBS=s3://… needs PW_S3_ACCESS_KEY_ID and PW_S3_SECRET_ACCESS_KEY.');
  const objectUrl = (k = '') => {
    const keyPath = [base, k].filter(Boolean).join('/');
    return endpoint ? new URL(`${endpoint.replace(/\/$/, '')}/${bucket}/${uriEncode(keyPath, true)}`) : new URL(`https://${bucket}.s3.${region}.amazonaws.com/${uriEncode(keyPath, true)}`);
  };
  const call = async (method, url, body) => {
    const headers = signS3({ method, url, body, region, accessKey, secretKey, sessionToken, headers: body ? { 'content-length': String(body.length) } : {} });
    delete headers.host;
    return fetch(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(60000) });
  };
  return {
    async put(k, bytes) { const r = await call('PUT', objectUrl(checkKey(k)), Buffer.from(bytes)); if (!r.ok) throw new Error(`S3 PUT ${k}: HTTP ${r.status}`); },
    async get(k) { const r = await call('GET', objectUrl(checkKey(k))); if (r.status === 404) return null; if (!r.ok) throw new Error(`S3 GET ${k}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
    async remove(k) { const r = await call('DELETE', objectUrl(checkKey(k))); if (!r.ok && r.status !== 404) throw new Error(`S3 DELETE ${k}: HTTP ${r.status}`); },
    async list(prefix) {
      const out = [];
      let token = null;
      do {
        const lu = new URL(endpoint ? `${endpoint.replace(/\/$/, '')}/${bucket}/` : `https://${bucket}.s3.${region}.amazonaws.com/`);
        lu.searchParams.set('list-type', '2');
        lu.searchParams.set('prefix', [base, prefix].filter(Boolean).join('/'));
        if (token) lu.searchParams.set('continuation-token', token);
        const r = await call('GET', lu);
        if (!r.ok) throw new Error(`S3 LIST: HTTP ${r.status}`);
        const xml = await r.text();
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = /<Key>([^<]*)<\/Key>/.exec(m[1])?.[1]?.replace(/&amp;/g, '&') || '';
          out.push({ key: base ? key.slice(base.length + 1) : key, size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] || 0), at: /<LastModified>([^<]*)<\/LastModified>/.exec(m[1])?.[1] || '' });
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] || null : null;
      } while (token);
      return out;
    },
    async touch() { /* ponytail: S3 has no cheap "used now"; the snapshot LRU falls back to oldest-written-first there */ },
  };
}

/**
 * On SQLite storage, blobs are files beside the database (<its folder>/data/blobs): node:sqlite is synchronous, so a
 * multi-MB snapshot or batch output read from the table stalled the event loop, and they made up 95% of the database
 * (synthetic-user run). SQLite storage is one host, so its processes share the folder. Blobs written to the table
 * before still read and are removed from there.
 * @param {string} dbFile @returns {Blobs}
 */
function sqliteBlobs(dbFile) {
  const files = fileBlobs(path.dirname(path.resolve(dbFile))), old = storeBlobs();
  return {
    put: (k, bytes) => files.put(k, bytes),
    async get(k) { return (await files.get(k)) ?? old.get(k).catch(() => null); },
    async remove(k) { await files.remove(k); await old.remove(k).catch(() => {}); },
    async list(prefix) {
      const a = await files.list(prefix), seen = new Set(a.map(b => b.key));
      return [...a, ...(await old.list(prefix).catch(() => [])).filter(b => !seen.has(b.key))];
    },
    async touch(k) { await files.touch(k).catch(() => {}); },
  };
}

/** @type {{ key: string, b: Blobs } | null} */
let current = null;
/** The blob store PW_BLOBS (or PW_STORAGE) names. @returns {Blobs} */
export function blobs() {
  const spec = process.env.PW_BLOBS || '';
  const key = spec || `${process.env.PW_STORAGE || 'file'}|${process.cwd()}`;
  if (current?.key === key) return current.b;
  let b;
  if (spec.startsWith('s3://')) b = s3Blobs(spec);
  else if (spec) throw new Error('PW_BLOBS must be s3://bucket[/prefix]?region=…[&endpoint=…], or unset (blobs go to PW_STORAGE).');
  else if (!process.env.PW_STORAGE || process.env.PW_STORAGE === 'file') b = fileBlobs(process.cwd());
  else if (/^sqlite:/.test(process.env.PW_STORAGE)) b = sqliteBlobs(process.env.PW_STORAGE.slice(7));
  else b = storeBlobs();
  current = { key, b };
  return b;
}
/** Remove every blob under a prefix. @param {string} prefix */
export async function removePrefix(prefix) { for (const b of await blobs().list(prefix)) await blobs().remove(b.key); }
