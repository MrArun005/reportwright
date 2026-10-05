// POST /api/auth/mfa { code } or { recoveryCode } — the second step of a password sign-in (the pw_mfa cookie from
// /api/auth/login). When the role requires two-factor sign-in and the user is enrolling (after /api/auth/mfa/setup), the
// code confirms the new authenticator and the answer carries the recovery codes, shown once.
// Codes go through limits.checkCredential (caps per network and account, 429; a known device has its own budget).
import { accountsOn, readMfa, clearMfa, sessionCookie, issueDevice } from '@/server/session.js';
import { getUser, checkSecondFactor, enableTwoFactor, secondFactor } from '@/server/users.js';
import { getSettings } from '@/server/settings.js';
import { checkCredential } from '@/server/limits.js';
import { audit } from '@/server/audit.js';
import { notifyAccount } from '@/server/mail.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

export async function POST(req) {
  if (!accountsOn()) return Response.json({ error: 'Accounts are off on this server (PW_AUTH is not "users").' }, { status: 404 });
  try {
    const st = await checkCredential({ kind: 'mfa-pending', req }, () => readMfa(req)); // the signed pending step
    const u = st ? await getUser(st.e) : null;
    // the password step is still this account's: not disabled, no password change or sign-out since
    if (!st || !u || u.disabled || (u.sessionVersion || 0) !== st.v) return Response.json({ error: 'The sign-in took too long. Sign in again.' }, { status: 401, headers: { 'set-cookie': clearMfa(req) } });
    const body = await req.json().catch(() => ({}));
    const need = secondFactor(u, await getSettings({ fresh: true }));
    let user = u, codes = null;
    const via = await checkCredential({ kind: 'mfa', account: u.email, req }, async () => {
      if (need === 'enrol') {
        try { ({ codes, user } = await enableTwoFactor(u.email, String(body.code ?? ''))); return 'enrol'; }
        catch (e) { if (e.status === 400) return null; throw e; }
      }
      if (need === 'totp') return checkSecondFactor(u.email, { code: body.code, recoveryCode: body.recoveryCode });
      return 'none'; // turned off since the password step (an admin's reset): the password was enough
    });
    if (!via) {
      await audit('auth.mfa_failed', { req, actor: `user:${u.email}`, status: 'failed', detail: { reason: 'wrong code' } });
      return Response.json({ error: 'That code is not right.' }, { status: 401 });
    }
    if (via === 'enrol') { await audit('auth.mfa_enabled', { req, actor: `user:${u.email}`, detail: { at: 'sign-in' } }); notifyAccount(u.email, 'Two-factor sign-in was turned on for your account.'); }
    await audit('auth.login', { req, actor: `user:${u.email}`, detail: { method: via === 'none' ? 'password' : `password+${via === 'recovery' ? 'recovery code' : 'totp'}` } });
    const h = new Headers({ 'cache-control': 'no-store' });
    h.append('set-cookie', sessionCookie(req, user, via === 'none' ? {} : { m: 1 }));
    h.append('set-cookie', clearMfa(req));
    const dev = await issueDevice(req, user); if (dev) h.append('set-cookie', dev); // password and second factor done: a known device of this account
    return Response.json({ email: user.email, role: user.role, ...(codes ? { recoveryCodes: codes } : {}) }, { headers: h });
  } catch (e) { return errorResponse(e); }
}
