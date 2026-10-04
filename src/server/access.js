// @ts-check
// Who may call what when accounts are on (PW_AUTH=users). proxy.js runs guard() before every request.
// The whole role policy is the OPEN list and the RULES table below: read them, not the code. Which reports and
// folders a user may see or change is decided per report by src/server/perms.js, in the routes and pages.
import { accountsOn, currentUser, sameOrigin, sessionSecret, ROLE_RANK } from './session.js';

/** Open to everyone: sign-in, static files, the embed script, and /api/v1 (it has its own API keys). */
const OPEN_PREFIX = ['/_next/', '/fonts/', '/icc/', '/embed/', '/api/v1/', '/favicon'];
const OPEN_EXACT = ['/login', '/api/auth/login', '/api/auth/logout', '/harfbuzz-subset.wasm',
  '/api/auth/oidc/start', '/api/auth/oidc/callback', '/api/auth/saml/login', '/api/auth/saml/acs', '/api/auth/saml/finish', '/api/auth/saml/metadata'];
/** Writes that come from another site by design: the SAML IdP posts the response (its signature protects it). */
export const CROSS_SITE_WRITES = ['/api/auth/saml/acs'];

/**
 * [method, path, least role]. The first row that matches wins; a path no row matches is for admins only.
 * GET rows also cover HEAD. '*' is any method.
 * @type {[string, RegExp, 'viewer'|'designer'|'admin'][]}
 */
export const RULES = [
  ['GET', /^\/$/, 'viewer'],                                              // home: the report list
  ['GET', /^\/viewer\/[^/]+$/, 'viewer'],
  ['GET', /^\/api\/reports$/, 'viewer'],
  ['GET', /^\/api\/reports\/[^/]+(\/(pdf|versions|thumb))?$/, 'viewer'], // read, server render, history
  ['POST', /^\/api\/data\/sql$/, 'viewer'],                               // saved queries; the route allows ad-hoc SQL to designers only
  ['GET', /^\/api\/data\/sql\/connections$/, 'designer'],                 // names and kinds, for the data panel
  ['POST', /^\/api\/data\/sql\/test$/, 'designer'],
  ['GET', /^\/api\/data\/proxy$/, 'viewer'],
  ['GET', /^\/api\/sample\/.+$/, 'viewer'],
  ['GET', /^\/api\/auth\/me$/, 'viewer'],
  ['GET', /^\/api\/fonts$/, 'viewer'],                                  // the uploaded fonts (the files are under /fonts/, open)
  ['GET', /^\/api\/folders$/, 'viewer'],                                 // folders the user may see
  ['POST', /^\/api\/audit\/export$/, 'viewer'],                          // the viewer says it exported (the log itself: admins)
  ['GET', /^\/designer\/[^/]+$/, 'designer'],
  ['*', /^\/api\/folders(\/[^/]+)?$/, 'designer'],                        // create, rename, move, share (perms.js checks each folder)
  ['*', /^\/api\/reports(\/.*)?$/, 'designer'],                           // save, create, delete, restore, import
  ['*', /^\/api\/fonts(\/[^/]+)?$/, 'designer'],                           // upload, delete
  ['POST', /^\/api\/ai(\/.*)?$/, 'designer'],
  ['*', /^\/(admin|api\/users)(\/.*)?$/, 'admin'],
];

/**
 * The path as the router sees it, or null for a path that tries to step out of its folder:
 * "." or ".." segments (also encoded), encoded slashes or backslashes, empty segments, control characters,
 * broken percent-encoding. A trailing slash is dropped.
 * @param {string} raw
 */
export function canonical(raw) {
  let segs;
  try { segs = raw.split('/').map(decodeURIComponent); } catch { return null; }
  if (segs[0] !== '') return null;
  const inner = segs.slice(1, segs.length > 2 && segs.at(-1) === '' ? -1 : undefined);
  if (inner.some((s, i) => s === '.' || s === '..' || /[/\\\x00-\x1f\x7f]/.test(s) || (s === '' && !(i === 0 && inner.length === 1)))) return null;
  return '/' + inner.join('/');
}

/**
 * What happens to a request: 'open' (no sign-in needed), 'allow', 'signin' (no session), 'deny' (the role is
 * too low) or 'bad' (a path trick).
 * @param {string} method @param {string} rawPath @param {string|null|undefined} role
 */
export function decide(method, rawPath, role) {
  const path = canonical(rawPath);
  if (path === null) return 'bad';
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  if (OPEN_EXACT.includes(path) || OPEN_PREFIX.some(p => path.startsWith(p))) return 'open';
  // with PW_EMBED_ORIGINS, embedded viewers on that site read report definitions, sample data and the font list (as without accounts)
  if (process.env.PW_EMBED_ORIGINS && m === 'GET' && (/^\/api\/reports\/[^/]+$/.test(path) || path.startsWith('/api/sample/') || path === '/api/fonts')) return 'open';
  if (!role) return 'signin';
  const row = RULES.find(([rm, re]) => (rm === '*' || rm === m) && re.test(path));
  const need = row ? row[2] : 'admin';
  return (ROLE_RANK[role] || 0) >= ROLE_RANK[need] ? 'allow' : 'deny';
}

const json = (error, status) => Response.json({ error }, { status });
export const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** null when the request may go on; otherwise the answer (redirect to /login, 401, 403, 400). @param {Request} req */
export async function guard(req) {
  const url = new URL(req.url);
  const api = url.pathname.startsWith('/api/');
  try { sessionSecret(); } catch (e) { return new Response(e.message, { status: 500 }); }
  // CSRF: every write must come from this site's pages (API keys on /api/v1 are not cookies, so they are exempt)
  if (UNSAFE.has(req.method.toUpperCase()) && !url.pathname.startsWith('/api/v1/') && !CROSS_SITE_WRITES.includes(url.pathname) && !sameOrigin(req)) {
    return json('This request did not come from a Pagewright page (Origin check).', 403);
  }
  let d = decide(req.method, url.pathname, null);
  if (d === 'bad') return json('Bad path', 400);
  if (d === 'open') return null;
  const user = await currentUser(req);
  d = decide(req.method, url.pathname, user?.role);
  if (d === 'allow') return null;
  if (d === 'signin') {
    if (api) return json('Sign in first.', 401);
    return Response.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, url), 307); // Next wants an absolute URL here
  }
  if (api) return json(`Your role (${user?.role}) cannot do this.`, 403);
  return new Response(`<!doctype html><meta charset="utf-8"><title>No access · Pagewright</title><h1>No access</h1><p>Your role (${user?.role}) cannot open this page.</p><p><a href="/">Back to the reports</a></p>`,
    { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/**
 * For routes, a second check behind the proxy: { user } when the signed-in user has at least `role`,
 * else { res } to send back. With accounts off: { res: 404 }.
 * @param {Request} req @param {'viewer'|'designer'|'admin'} role
 */
export async function requireRole(req, role) {
  if (!accountsOn()) return { res: json('Accounts are off on this server (PW_AUTH is not "users").', 404) };
  const user = await currentUser(req);
  if (!user || user.internal || ROLE_RANK[user.role] < ROLE_RANK[role]) return { res: json(`Only a signed-in ${role} can do this.`, 403) };
  return { user };
}
