// API keys for /api/v1. Set PW_API_KEYS="key1,key2" and send "Authorization: Bearer <key>".
// A key is a service key (it may do everything, as before), or with "email|key" it acts as that user: with
// accounts on (PW_AUTH=users) it sees and renders only what that user may (src/server/perms.js).
// Without keys the API answers only in development (next dev) or with PW_ALLOW_KEYLESS=1.
// (A Host-header check is not safe: any client can send "Host: localhost".)
import crypto from 'node:crypto';
import { accountsOn } from './session.js';
import { userPrincipal, OPEN } from './perms.js';
import { audit } from './audit.js';

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
 * @param {Request} req @returns {Promise<{ principal: import('./perms.js').Principal, res?: undefined } | { res: Response, principal?: undefined }>}
 */
export async function apiPrincipal(req) {
  const list = keys();
  if (!list.length) {
    // with accounts on there is no keyless API: it would let anyone render every report
    if (!accountsOn() && (process.env.NODE_ENV !== 'production' || process.env.PW_ALLOW_KEYLESS === '1')) return { principal: OPEN };
    return { res: Response.json({ error: 'The API is off: set PW_API_KEYS on the server' }, { status: 401 }) };
  }
  const h = req.headers.get('authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7).trim() : req.headers.get('x-api-key') || '';
  let hit = null;
  for (const k of list) if (given && eq(k.key, given) && !hit) hit = k;
  const where = { method: req.method, path: new URL(req.url).pathname };
  if (!hit) {
    await audit('api.call', { req, status: 'denied', detail: { ...where, reason: given ? 'unknown key' : 'no key' } });
    return { res: denied('Give a valid API key: Authorization: Bearer <key>') };
  }
  const key = keyId(hit.key);
  /** @type {import('./perms.js').Principal} */
  let principal;
  if (!hit.email) principal = { kind: 'service', key };
  else if (!accountsOn()) principal = OPEN;
  else {
    const p = await userPrincipal(hit.email);
    if (p.kind !== 'user') {
      await audit('api.call', { req, actor: `user:${hit.email}`, status: 'denied', detail: { ...where, key, reason: 'user missing or disabled' } });
      return { res: denied('This API key belongs to a user who no longer exists or is disabled.') };
    }
    principal = { ...p, viaKey: key };
  }
  await audit('api.call', { req, principal, detail: { ...where, key } });
  return { principal };
}

/** @deprecated kept for callers that only need yes/no: null when the key is good. */
export async function authorize(req) { return (await apiPrincipal(req)).res || null; }

export function fail(e) {
  return Response.json({ error: e.message, missingParameters: e.missingParameters }, { status: e.status || (e.missingParameters ? 400 : 500) });
}
