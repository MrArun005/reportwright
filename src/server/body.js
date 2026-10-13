// @ts-check
// Every request body the API reads goes through here: nothing is read whole before its size is checked.
// A declared Content-Length over the cap is refused before a byte is read; a chunked body is counted as it arrives
// and the read is cancelled past the cap. Both answer 413. Route handlers never call req.json/formData/text/arrayBuffer
// (tests/engine/body-caps.test.js fails the build if one does).
import { num as cnum } from './config.js';
import { fetchMaxBytes } from './safeFetch.js';

/** JSON and form bodies of control routes (auth, settings, users, folders…): PW_MAX_BODY_KB, default 1024. */
export const maxBodyBytes = () => cnum('PW_MAX_BODY_KB', 1024, { min: 1 }) * 1024;
/** A report definition (save, import, schedules that carry one): 5 MB. */
export const DEF_BYTES = 5 * 1024 * 1024;
/** Render and batch requests may push data: capped like fetched data (PW_FETCH_MAX_MB). */
export const pushedDataBytes = () => Math.max(fetchMaxBytes(), maxBodyBytes());
/** The largest body any route accepts (assess: 50 MB; pushed data): proxy.js refuses a bigger Content-Length early. */
export const largestBodyBytes = () => Math.max(50 * 1024 * 1024, pushedDataBytes(), DEF_BYTES);

const tooBigFor = (max) => () => Object.assign(new Error(`The request is larger than ${max >= 1048576 ? `${Math.round(max / 1048576)} MB` : `${Math.round(max / 1024)} kB`}.`), { status: 413 });

/**
 * A request body (or a response), read only up to `max` bytes.
 *  @param {Request | Response} req @param {number} [max] @param {() => Error} [tooBig] @returns {Promise<Uint8Array>}
 */
export async function readBodyCapped(req, max = maxBodyBytes(), tooBig = tooBigFor(max)) {
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

/** The body as text, capped. @param {Request} req @param {number} [max] */
export async function readText(req, max) { return new TextDecoder().decode(await readBodyCapped(req, max)); }

/** The body as JSON, capped; bad JSON throws 400 (a 413 stays 413). @param {Request} req @param {number} [max] */
export async function readJson(req, max) {
  const text = await readText(req, max);
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Send a JSON body.'), { status: 400 }); }
}

/** The body as form data (urlencoded or multipart), capped. @param {Request} req @param {number} [max] */
export async function readForm(req, max) {
  const bytes = await readBodyCapped(req, max);
  return new Response(/** @type {any} */ (bytes), { headers: { 'content-type': req.headers.get('content-type') || '' } }).formData();
}

/** JSON, or `fallback` when the body is empty or not JSON; a body over the cap still throws 413. @param {Request} req @param {any} fallback @param {number} [max] */
export async function readJsonOr(req, fallback, max) {
  try { return await readJson(req, max); } catch (e) { if (e.status === 413) throw e; return fallback; }
}

/** The 413 (or other) error as an answer, for handlers with no catch of their own. @param {any} e */
export const bodyError = (e) => Response.json({ error: e.message }, { status: e.status || 400 });
