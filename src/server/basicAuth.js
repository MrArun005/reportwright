// Optional password for the whole app: PW_BASIC_AUTH="user:password".
// The designer, report storage and server renders have no login of their own: turn this on (or put
// the app behind your SSO proxy) before anyone outside can reach it.
// Always open: /api/v1 (it has API keys), the embed script and static assets. With PW_EMBED_ORIGINS
// set, embedded viewers may also read report definitions and sample data (GET only).
import crypto from 'node:crypto';

const digest = (s) => crypto.createHash('sha256').update(s).digest();
const OPEN = ['/api/v1/', '/embed/', '/_next/', '/fonts/', '/harfbuzz-subset.wasm', '/favicon'];

/** @param {Request} req @returns {Promise<Response|null>} null when the request may go on */
export async function basicAuth(req) {
  const want = process.env.PW_BASIC_AUTH;
  if (!want) return null;
  const { pathname } = new URL(req.url);
  if (OPEN.some(p => pathname.startsWith(p))) return null;
  if (process.env.PW_EMBED_ORIGINS && req.method === 'GET' && (/^\/api\/reports\/[^/]+$/.test(pathname) || pathname.startsWith('/api/sample/'))) return null;
  const h = req.headers.get('authorization') || '';
  const given = h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64').toString() : '';
  // a request with no password is asked for one (not counted); one with a password goes through the credential check
  if (given && await (await import('./limits.js')).checkCredential({ kind: 'basic', req }, () => crypto.timingSafeEqual(digest(given), digest(want)))) return null;
  return new Response('Sign in to Pagewright', { status: 401, headers: { 'www-authenticate': 'Basic realm="Pagewright", charset="UTF-8"' } });
}
