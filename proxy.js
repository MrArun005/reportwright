// Runs before every request (Node runtime).
// PW_AUTH=users: user accounts and roles (src/server/access.js has the table of who may do what).
// PW_AUTH unset: the optional shared PW_BASIC_AUTH password (src/server/basicAuth.js), exactly as before.
import { basicAuth } from './src/server/basicAuth.js';
import { accountsOn } from './src/server/session.js';
import { guard } from './src/server/access.js';

export async function proxy(request) {
  if (accountsOn()) return (await guard(request)) ?? undefined;
  // a typo must not leave the app open: refuse to serve
  if (process.env.PW_AUTH) return new Response('PW_AUTH must be "users" (or not set at all).', { status: 500 });
  return basicAuth(request) ?? undefined;
}
