// GET /api/auth/saml/finish?h=handle — the browser that began the sign-in signs in (src/server/sso.js).
import { accountsOn } from '@/server/session.js';
import { samlOn, samlFinish, finishSignIn } from '@/server/sso.js';

export const runtime = 'nodejs';

export async function GET(req) {
  if (!accountsOn() || !samlOn()) return Response.json({ error: 'SAML sign-in is not set up on this server.' }, { status: 404 });
  return finishSignIn(req, () => samlFinish(req), 'saml');
}
