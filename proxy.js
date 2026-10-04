// Runs before every request (Node runtime).
// PW_AUTH=users: user accounts and roles (src/server/access.js has the table of who may do what).
// PW_AUTH unset or "proxy": no accounts; the optional shared PW_BASIC_AUTH password (src/server/basicAuth.js).
// In production that is open to whoever reaches it only with PW_BASIC_AUTH or PW_AUTH=proxy (a reverse proxy in front
// signs people in). With neither it fails closed: static files and /api/v1 (its own keys) only, and with
// PW_PUBLIC_READONLY=1 what a viewer may do (open and render the saved reports). See openTrusted in session.js.
import { basicAuth } from './src/server/basicAuth.js';
import { accountsOn, sameOrigin, openTrusted, publicReadonly, devOpen, devHostOk, proxySecretOk, NO_AUTH_HELP } from './src/server/session.js';
import { guard, decide, canonical, UNSAFE, CROSS_SITE_WRITES } from './src/server/access.js';

export async function proxy(request) {
  if (accountsOn()) return (await guard(request)) ?? undefined;
  // a typo must not leave the app open: refuse to serve
  if (process.env.PW_AUTH && process.env.PW_AUTH !== 'proxy') return new Response('PW_AUTH must be "users" or "proxy" (or not set at all).', { status: 500 });
  // every check below reads the path as the router does; a path trick (encoded dot segments or slashes) is refused
  const pathname = canonical(new URL(request.url).pathname);
  if (pathname === null) return Response.json({ error: 'Bad path' }, { status: 400 });
  const method = request.method.toUpperCase();
  if (devOpen() && !devHostOk(request)) {
    return Response.json({ error: 'This development server answers only on localhost (DNS rebinding). Add the host name to PW_DEV_HOSTS, or set PW_BASIC_AUTH.' }, { status: 403 });
  }
  // CSRF in every mode: the browser sends a cached Basic password, or reaches a server on localhost, from any site's page
  if (UNSAFE.has(method) && !pathname.startsWith('/api/v1/') && !CROSS_SITE_WRITES.includes(pathname) && !sameOrigin(request)) {
    return Response.json({ error: 'This request did not come from a Pagewright page (Origin check).' }, { status: 403 });
  }
  if (!proxySecretOk(request) && decide(method, pathname, 'viewer') !== 'open') {
    return Response.json({ error: 'This request did not come through the signing-in reverse proxy (PW_PROXY_SECRET).' }, { status: 401 });
  }
  if (!openTrusted()) {
    const d = decide(method, pathname, 'viewer');
    if (d === 'bad') return Response.json({ error: 'Bad path' }, { status: 400 });
    if (d !== 'open' && !(d === 'allow' && publicReadonly())) {
      return pathname.startsWith('/api/') ? Response.json({ error: NO_AUTH_HELP }, { status: 401 })
        : new Response(`<!doctype html><meta charset="utf-8"><title>Sign-in is not set up · Pagewright</title><h1>Sign-in is not set up</h1><p>${NO_AUTH_HELP}</p>`,
          { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  }
  return basicAuth(request) ?? undefined;
}
