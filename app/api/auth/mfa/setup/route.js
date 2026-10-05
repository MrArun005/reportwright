// POST /api/auth/mfa/setup — during a sign-in whose role requires two-factor sign-in (pw_mfa with enrol): a new
// authenticator secret, as { secret, uri, qr } (qr is SVG). POST /api/auth/mfa { code } confirms it.
// With mail set up the body must carry { emailCode }, the code mailed at the password step: the password alone does
// not bind an authenticator. Wrong codes count against the same per-user limit as sign-in codes.
import { accountsOn, readMfa } from '@/server/session.js';
import { getUser, startTwoFactor, enrolCodeOk } from '@/server/users.js';
import { mailOn } from '@/server/mail.js';
import { attempt } from '@/server/limits.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function POST(req) {
  if (!accountsOn()) return Response.json({ error: 'Accounts are off on this server (PW_AUTH is not "users").' }, { status: 404 });
  try {
    const st = readMfa(req);
    const u = st?.enrol ? await getUser(st.e) : null;
    if (!st?.enrol || !u || u.disabled || (u.sessionVersion || 0) !== st.v) return Response.json({ error: 'The sign-in took too long. Sign in again.' }, { status: 401 });
    if (mailOn()) {
      const slot = await attempt(`mfa:${u.email}`, 5, 15 * 60 * 1000);
      if (!slot.ok) { await audit('auth.mfa_failed', { req, actor: `user:${u.email}`, status: 'denied', detail: { reason: 'rate limited', at: 'enrol code' } }); return Response.json({ error: 'Too many wrong codes. Try again later.' }, { status: 429, headers: { 'retry-after': String(slot.retryAfter) } }); }
      const body = await req.json().catch(() => ({}));
      if (!enrolCodeOk(u, body?.emailCode)) { await audit('auth.mfa_failed', { req, actor: `user:${u.email}`, status: 'failed', detail: { reason: 'wrong enrolment code' } }); return Response.json({ error: 'That emailed code is not right.' }, { status: 401 }); }
      await slot.release();
    }
    const out = await startTwoFactor(u.email);
    await audit('auth.mfa_setup', { req, actor: `user:${u.email}`, detail: { at: 'sign-in', emailCode: mailOn() } });
    return Response.json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
