// API keys for /api/v1. Set PW_API_KEYS="key1,key2" and send "Authorization: Bearer <key>".
// Without keys the API answers only in development (next dev) or with PW_ALLOW_KEYLESS=1.
// (A Host-header check is not safe: any client can send "Host: localhost".)
import crypto from 'node:crypto';

const keys = () => (process.env.PW_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function authorize(req) {
  const list = keys();
  if (!list.length) {
    if (process.env.NODE_ENV !== 'production' || process.env.PW_ALLOW_KEYLESS === '1') return null;
    return Response.json({ error: 'The API is off: set PW_API_KEYS on the server' }, { status: 401 });
  }
  const h = req.headers.get('authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7).trim() : req.headers.get('x-api-key') || '';
  if (given && list.some(k => eq(k, given))) return null;
  return Response.json({ error: 'Give a valid API key: Authorization: Bearer <key>' }, { status: 401 });
}

export function fail(e) {
  return Response.json({ error: e.message, missingParameters: e.missingParameters }, { status: e.status || (e.missingParameters ? 400 : 500) });
}
