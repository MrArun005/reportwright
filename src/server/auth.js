// API keys for /api/v1. Set PW_API_KEYS="key1,key2" and send "Authorization: Bearer <key>".
// A key is a service key (it may do everything, as before), or with "email|key" it acts as that user: with
// accounts on (PW_AUTH=users) it sees and renders only what that user may (src/server/perms.js).
// Without keys the API answers only in development (next dev) or with PW_ALLOW_KEYLESS=1; keyless in production is
// read-only (render a saved template, list them): no definitions or data in the request, no signing, no batches or
// schedules. A keyless write from a browser must come from this site's pages (a no-key request carries no secret).
// (A Host-header check is not safe: any client can send "Host: localhost".)
import { errorResponse } from './errors.js';
import crypto from 'node:crypto';
import { accountsOn, sameOrigin } from './session.js';
import { userPrincipal, OPEN, PUBLIC } from './perms.js';
import { audit } from './audit.js';
import { devMode } from './config.js';

/** [{ key, email|null }] */
const keys = () => (process.env.PW_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean).map((s) => {
  const i = s.indexOf('|');
  return i > 0 && s.slice(0, i).includes('@') ? { key: s.slice(i + 1).trim(), email: s.slice(0, i).trim().toLowerCase() } : { key: s, email: null };
}).filter(k => k.key);
// Compare digests: equal length always, so no early exit and no throw on multi-byte characters.
const digest = (s) => crypto.createHash('sha256').update(s).digest();
const eq = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
/** A short, non-secret name for a key in the audit log: the first 8 hex of its SHA-256. */
export const keyId = (k) => digest(k).toString('hex').slice(0, 8);

const denied = (error) => Response.json({ error }, { status: 401 });

/**
 * Who calls /api/v1: { principal } or { res } (401). Every key is compared, so the time does not say which matched.
 * A successful call writes api.call, unless quiet: a render, whose report.render event names the same caller (one
 * event per render, not two). Refused calls are always written (identical ones from nobody signed in are counted).
 * @param {Request} req @param {{ quiet?: boolean }} [o] @returns {Promise<{ principal: import('./perms.js').Principal, res?: undefined } | { res: Response, principal?: undefined }>}
 */
export async function apiPrincipal(req, { quiet = false } = {}) {
  const list = keys();
  if (!list.length) {
    // with accounts on there is no keyless API: it would let anyone render every report
    if (!accountsOn() && (devMode() || process.env.PW_ALLOW_KEYLESS === '1')) {
      const { pathname } = new URL(req.url);
      const write = !['GET', 'HEAD'].includes(req.method.toUpperCase());
      // another site's page may post here (a form, or fetch with text/plain): it must not use the keyless API
      if (write && req.headers.get('origin') && !sameOrigin(req)) return { res: Response.json({ error: 'A keyless API call from another site is refused (Origin check). Set PW_API_KEYS.' }, { status: 403 }) };
      if (devMode()) return { principal: OPEN };
      if (write && pathname !== '/api/v1/render') return { res: Response.json({ error: 'The keyless API is read-only in production: set PW_API_KEYS to make batches and schedules.' }, { status: 401 }) };
      return { principal: PUBLIC };
    }
    return { res: Response.json({ error: 'The API is off: set PW_API_KEYS on the server' }, { status: 401 }) };
  }
  const h = req.headers.get('authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7).trim() : req.headers.get('x-api-key') || '';
  // every key compared (no early exit), through the one credential check (limits.checkCredential)
  const find = () => { let h = null; for (const k of list) if (eq(k.key, given) && !h) h = k; return h; };
  let hit = null;
  try { hit = given ? await (await import('./limits.js')).checkCredential({ kind: 'apikey', req }, find) : null; }
  catch (e) { if (/** @type {any} */ (e).status === 429) return { res: Response.json({ error: /** @type {any} */ (e).message }, { status: 429, headers: { 'retry-after': String(/** @type {any} */ (e).retryAfter) } }) }; throw e; }
  const where = { method: req.method, path: new URL(req.url).pathname };
  if (!hit) {
    await audit('api.call', { req, status: 'denied', detail: { ...where, reason: given ? 'unknown key' : 'no key' } });
    return { res: denied('Give a valid API key: Authorization: Bearer <key>') };
  }
  const key = keyId(hit.key);
  /** @type {import('./perms.js').Principal} */
  let principal;
  if (!hit.email || !accountsOn()) principal = { kind: 'service', key }; // with accounts off a user's key has no user to act as
  else {
    const p = await userPrincipal(hit.email);
    if (p.kind !== 'user') {
      await audit('api.call', { req, actor: `user:${hit.email}`, status: 'denied', detail: { ...where, key, reason: 'user missing or disabled' } });
      return { res: denied('This API key belongs to a user who no longer exists or is disabled.') };
    }
    principal = { ...p, viaKey: key };
  }
  if (!quiet) await audit('api.call', { req, principal, detail: { ...where, key } });
  return { principal };
}

/** @deprecated kept for callers that only need yes/no: null when the key is good. */
export async function authorize(req) { return (await apiPrincipal(req)).res || null; }

/** Retry-After on a 429 or 503 from the render pool (src/server/pool.js). @param {any} e */
export const busyHeaders = (e) => (e?.retryAfter ? { 'retry-after': String(e.retryAfter) } : undefined);

export function fail(e) {
  return errorResponse(e, { status: e.status || (e.missingParameters ? 400 : 500), headers: busyHeaders(e), extra: { missingParameters: e.missingParameters } });
}
