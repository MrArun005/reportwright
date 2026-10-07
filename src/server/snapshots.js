// @ts-check
// Report snapshots: rendered output kept for reuse (Settings: snapshotTtl seconds, 0 = off; snapshotMaxMb). A snapshot
// is reused only for exactly the same:
//   - report definition (the hash of the definition as stored now, so a save never serves an old rendering),
//   - parameters, format and render options,
//   - principal (who asked) and their access as it is now (perms.accessStamp: every grant, folder and their own record,
//     each with a rev that every change renews), so nobody is ever served a rendering made for someone else, and a
//     revoke or a role change is never answered from an older one,
//   - generation: any report save, restore or delete (a subreport, master or theme may change) starts a new one.
// Live data inside the TTL is the point: an admin picks how stale a rendering may be. Schedules may ask to "render from
// snapshot" (fromSnapshot). Bytes live in the blob store (src/server/blobs.js: files, database or S3), so every server
// shares them; the cache is bounded by snapshotMaxMb, least recently used first (oldest written first on S3).
import crypto from 'node:crypto';
import { blobs, removePrefix } from './blobs.js';
import { getSettings, getRecord, putRecord } from './settings.js';
import { accessStamp, principalId } from './perms.js';
import { canonical } from './audit.js';
import { logWarn } from './errors.js';
import { formulasOn } from './config.js';

const PREFIX = 'snap/';
const g = /** @type {any} */ (globalThis);
g.__pwSnap ||= { evicting: null, lastEvict: 0, hits: 0, misses: 0 };

/** The current generation (bumped by report writes and by clearing). */
async function generation() { return (await getRecord('snapgen'))?.gen || 0; }
/** A report was saved, restored or deleted: every snapshot so far is stale. */
export async function bumpGeneration() { await putRecord('snapgen', { gen: crypto.randomBytes(8).toString('hex'), at: new Date().toISOString() }); }

/**
 * The cache key, or null when this render may not be cached (pushed data, signing, passwords).
 * @param {{ def: any, opt: any, principal: any }} r
 */
export async function snapshotKey({ def, opt, principal }) {
  if (!def || opt.data || opt.sign || opt.encrypt) return null;
  const parts = {
    def: crypto.createHash('sha256').update(JSON.stringify(def)).digest('hex'),
    params: opt.parameters || {}, format: opt.format || 'pdf',
    opts: { tz: opt.timeZone || null, pdfa: !!opt.pdfa, ua: !!opt.ua, formulas: formulasOn(opt.formulas), static: !!opt.static, csv: opt.csv === 'layout', state: opt.state || null, base: opt.baseUrl || null, self: opt.self || null },
    who: principalId(principal), access: await accessStamp(principal), gen: await generation(),
  };
  return crypto.createHash('sha256').update(canonical(parts)).digest('hex');
}

/** One stored snapshot: a JSON header line, then the bytes. */
const pack = (meta, bytes) => Buffer.concat([Buffer.from(`${JSON.stringify(meta)}\n`), Buffer.from(bytes)]);
function unpack(buf) {
  const i = buf.indexOf(10);
  if (i < 0) return null;
  try { return { meta: JSON.parse(buf.subarray(0, i).toString()), bytes: buf.subarray(i + 1) }; } catch { return null; }
}

/**
 * Render through the cache: a fresh snapshot (younger than maxAge seconds, default the TTL setting) when there is one,
 * else render() and keep the result. Off (TTL 0 and no maxAge) or uncacheable: render() alone.
 * @template {{ bytes: Uint8Array, contentType: string, ext: string, name?: string|null, pages: number }} R
 * @param {{ def: any, opt: any, principal: any, maxAge?: number }} r @param {() => Promise<R>} render
 * @returns {Promise<R & { snapshot: 'hit'|'miss'|'off' }>}
 */
export async function throughSnapshot(r, render) {
  const s = await getSettings();
  const ttl = r.maxAge ?? s.snapshotTtl;
  const key = ttl > 0 ? await snapshotKey(r) : null;
  if (!key) return { ...(await render()), snapshot: 'off' };
  const name = `${PREFIX}${key}`;
  const hit = await blobs().get(name).then(b => (b ? unpack(b) : null), () => null);
  if (hit && Date.now() - Date.parse(hit.meta.at) < ttl * 1000) {
    g.__pwSnap.hits++;
    blobs().touch(name).catch(logWarn('snapshot touch'));
    return /** @type {any} */ ({ ...hit.meta, bytes: new Uint8Array(hit.bytes), snapshot: 'hit' });
  }
  g.__pwSnap.misses++;
  const out = await render();
  const meta = { contentType: out.contentType, ext: out.ext, name: out.name ?? null, pages: out.pages, ms: /** @type {any} */ (out).ms ?? null, warnings: /** @type {any} */ (out).warnings ?? 0, at: new Date().toISOString() };
  if (out.bytes.length <= s.snapshotMaxMb * 1024 * 1024 / 4) { // one rendering never takes more than a quarter of the cache
    await blobs().put(name, pack(meta, out.bytes)).catch((e) => console.error(`[reportwright] snapshot: ${e.message}`));
    evictSoon(s.snapshotMaxMb);
  }
  return { ...out, snapshot: 'miss' };
}

/** Keep the cache under its bound: drop the least recently used (expired first). */
function evictSoon(maxMb) {
  if (g.__pwSnap.evicting || Date.now() - g.__pwSnap.lastEvict < 5000) return;
  g.__pwSnap.evicting = evict(maxMb).catch(logWarn('snapshot evict')).finally(() => { g.__pwSnap.evicting = null; g.__pwSnap.lastEvict = Date.now(); });
}
/** @param {number} maxMb */
export async function evict(maxMb) {
  const list = (await blobs().list(PREFIX)).sort((a, b) => a.at.localeCompare(b.at));
  let total = list.reduce((n, b) => n + b.size, 0);
  const max = maxMb * 1024 * 1024;
  for (const b of list) { if (total <= max) break; await blobs().remove(b.key); total -= b.size; }
  return total;
}
/** { entries, bytes, hits, misses } of this cache (hits and misses: this process). */
export async function snapshotStats() {
  const list = /** @type {{ size: number }[]} */ (await blobs().list(PREFIX).catch(() => []));
  return { entries: list.length, bytes: list.reduce((n, b) => n + Number(b.size || 0), /** @type {number} */ (0)), hits: g.__pwSnap.hits, misses: g.__pwSnap.misses };
}
/** Drop every snapshot. */
export async function clearSnapshots() { await bumpGeneration(); await removePrefix(PREFIX); }
