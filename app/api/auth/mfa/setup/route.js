// POST /api/auth/mfa/setup — during a sign-in whose role requires two-factor sign-in (pw_mfa with enrol): a new
// authenticator secret, as { secret, uri, qr } (qr is SVG). POST /api/auth/mfa { code } confirms it.
// With mail set up the body must carry { emailCode }, the code mailed at the password step: the password alone does
// not bind an authenticator. Wrong codes count against the same per-user limit as sign-in codes.
import { accountsOn, readMfa } from '@/server/session.js';
import { getUser, startTwoFactor, enrolCodeOk } from '@/server/users.js';
import { mailOn } from '@/server/mail.js';
import { checkCredential } from '@/server/limits.js';
import { audit } from '@/server/audit.js';
import { errorResponse } from '@/server/errors.js';
import { readJsonOr } from '@/server/body.js';

export const runtime = 'nodejs';

export async function POST(req) {
  if (!accountsOn()) return Response.json({ error: 'Accounts are off on this server (PW_AUTH is not "users").' }, { status: 404 });
  try {
    const st = await checkCredential({ kind: 'mfa-pending', req }, () => readMfa(req)); // the signed pending step
    const u = st?.enrol ? await getUser(st.e) : null;
    if (!st?.enrol || !u || u.disabled || (u.sessionVersion || 0) !== st.v) return Response.json({ error: 'The sign-in took too long. Sign in again.' }, { status: 401 });
    if (mailOn()) {
      const body = await readJsonOr(req, {});
      if (!(await checkCredential({ kind: 'mfa', account: u.email, req }, () => enrolCodeOk(u, body?.emailCode)))) { await audit('auth.mfa_failed', { req, actor: `user:${u.email}`, status: 'failed', detail: { reason: 'wrong enrolment code' } }); return Response.json({ error: 'That emailed code is not right.' }, { status: 401 }); }
    }
    const out = await startTwoFactor(u.email);
    await audit('auth.mfa_setup', { req, actor: `user:${u.email}`, detail: { at: 'sign-in', emailCode: mailOn() } });
    return Response.json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
