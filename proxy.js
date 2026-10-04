// Runs before every request (Node runtime).
// PW_AUTH=users: user accounts and roles (src/server/access.js has the table of who may do what).
// PW_AUTH unset: the optional shared PW_BASIC_AUTH password (src/server/basicAuth.js), exactly as before.
import { basicAuth } from './src/server/basicAuth.js';
import { accountsOn, sameOrigin } from './src/server/session.js';
import { guard, UNSAFE, CROSS_SITE_WRITES } from './src/server/access.js';

export async function proxy(request) {
  if (accountsOn()) return (await guard(request)) ?? undefined;
  // a typo must not leave the app open: refuse to serve
  if (process.env.PW_AUTH) return new Response('PW_AUTH must be "users" (or not set at all).', { status: 500 });
  // the browser sends a cached Basic password with a cross-site form POST too: writes must come from this site
  const { pathname } = new URL(request.url);
  if (process.env.PW_BASIC_AUTH && UNSAFE.has(request.method.toUpperCase()) && !pathname.startsWith('/api/v1/') && !CROSS_SITE_WRITES.includes(pathname) && !sameOrigin(request)) {
    return Response.json({ error: 'This request did not come from a Pagewright page (Origin check).' }, { status: 403 });
  }
  return basicAuth(request) ?? undefined;
}
