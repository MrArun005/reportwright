// GET /api/auth/oidc/start?next=/path — off to the OpenID Connect provider (src/server/sso.js).
import { accountsOn } from '@/server/session.js';
import { oidcOn, oidcStart, tooManyStarts } from '@/server/sso.js';

export const runtime = 'nodejs';

export async function GET(req) {
  if (!accountsOn() || !oidcOn()) return Response.json({ error: 'OpenID Connect sign-in is not set up on this server.' }, { status: 404 });
  if (tooManyStarts(req)) return Response.json({ error: 'Too many sign-ins from this address. Try again in a minute.' }, { status: 429, headers: { 'retry-after': '60' } });
  try {
    const { url, cookie } = await oidcStart(req, new URL(req.url).searchParams.get('next') || '/');
    return new Response(null, { status: 302, headers: { location: url, 'set-cookie': cookie, 'cache-control': 'no-store' } });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 502 }); }
}
