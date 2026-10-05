// POST /api/auth/mfa/setup — during a sign-in whose role requires two-factor sign-in (pw_mfa with enrol): a new
// authenticator secret, as { secret, uri, qr } (qr is SVG). POST /api/auth/mfa { code } confirms it.
import { accountsOn, readMfa } from '@/server/session.js';
import { getUser, startTwoFactor } from '@/server/users.js';

export const runtime = 'nodejs';

export async function POST(req) {
  if (!accountsOn()) return Response.json({ error: 'Accounts are off on this server (PW_AUTH is not "users").' }, { status: 404 });
  try {
    const st = readMfa(req);
    const u = st?.enrol ? await getUser(st.e) : null;
    if (!st?.enrol || !u || u.disabled || (u.sessionVersion || 0) !== st.v) return Response.json({ error: 'The sign-in took too long. Sign in again.' }, { status: 401 });
    return Response.json(await startTwoFactor(u.email), { headers: { 'cache-control': 'no-store' } });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
