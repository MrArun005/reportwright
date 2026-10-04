// GET /api/auth/saml/login?next=/path — off to the SAML identity provider (src/server/sso.js).
import { accountsOn } from '@/server/session.js';
import { samlOn, samlStart } from '@/server/sso.js';

export const runtime = 'nodejs';

export async function GET(req) {
  if (!accountsOn() || !samlOn()) return Response.json({ error: 'SAML sign-in is not set up on this server.' }, { status: 404 });
  try {
    const { url, cookie } = await samlStart(req, new URL(req.url).searchParams.get('next') || '/');
    return new Response(null, { status: 302, headers: { location: url, 'set-cookie': cookie, 'cache-control': 'no-store' } });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 502 }); }
}
