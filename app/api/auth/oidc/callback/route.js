// GET /api/auth/oidc/callback?code&state — the provider sends the browser back here (src/server/sso.js).
import { accountsOn } from '@/server/session.js';
import { oidcOn, oidcCallback, finishSignIn } from '@/server/sso.js';

export const runtime = 'nodejs';

export async function GET(req) {
  if (!accountsOn() || !oidcOn()) return Response.json({ error: 'OpenID Connect sign-in is not set up on this server.' }, { status: 404 });
  return finishSignIn(req, () => oidcCallback(req), 'oidc');
}
