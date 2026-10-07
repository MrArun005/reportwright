// POST /api/auth/login { email, password } — sign in (PW_AUTH=users). Sets the pw_session cookie, or, when the account
// needs a second factor, answers { mfa: 'totp' | 'enrol' } and sets pw_mfa: POST /api/auth/mfa finishes the sign-in.
// The password goes through limits.checkCredential: caps per network and per account (429), and a device cookie set
// on a complete sign-in so an attack cannot lock out a browser that signed in before (docs/GOVERNANCE.md).
import { authenticate, ensureAdmin, normEmail, secondFactor } from '@/server/users.js';
import { accountsOn, sessionSecret, sessionCookie, mfaCookie, issueDevice } from '@/server/session.js';
import { checkCredential } from '@/server/limits.js';
import { readBody } from '@/server/reports.js';
import { getSettings } from '@/server/settings.js';
import { issueEnrolCode, updateUser } from '@/server/users.js';
import { mailOn, sendMail } from '@/server/mail.js';
import { audit } from '@/server/audit.js';
import { passwordLoginOn } from '@/server/sso.js';
import { errorResponse } from '@/server/errors.js';
import { logWarn } from '@/server/errors.js';

export const runtime = 'nodejs';

const WRONG = 'The email or password is wrong.';

export async function POST(req) {
  if (!accountsOn()) return Response.json({ error: 'Accounts are off on this server (PW_AUTH is not "users").' }, { status: 404 });
  if (!passwordLoginOn()) return Response.json({ error: 'Password sign-in is off on this server. Use single sign-on.' }, { status: 403 });
  try {
    sessionSecret(); // refuse to sign anyone in without a usable secret
    let body;
    try { body = JSON.parse(new TextDecoder().decode(await readBody(req, 10000))); } catch { body = null; } // at most 10 kB read
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return Response.json({ error: 'Send { email, password }.' }, { status: 400 });
    let email;
    try { email = normEmail(body.email); } catch { await audit('auth.login_failed', { req, detail: { reason: 'bad email' } }); return Response.json({ error: WRONG }, { status: 401 }); }
    await ensureAdmin();
    const user = await checkCredential({ kind: 'password', account: email, req }, () => authenticate(email, body.password));
    if (!user) { await audit('auth.login_failed', { req, detail: { email, reason: 'wrong email or password' } }); return Response.json({ error: WRONG }, { status: 401 }); }
    const need = secondFactor(user, await getSettings({ fresh: true }));
    if (need === 'enrol' && mailOn()) {
      // a first enrolment needs the password and the mailbox: a code goes to the account's address
      const code = await issueEnrolCode(user.email);
      if (code) {
        try {
          await sendMail({ to: [user.email], subject: 'Your ReportWright enrolment code', text: `Your code to set up two-factor sign-in: ${code}\n\nIt works for 15 minutes. If you did not just sign in, tell an admin: someone has your password.\n` });
        } catch (e) {
          console.error(`[reportwright] enrolment code mail: ${e.message}`);
          await audit('auth.mfa_failed', { req, actor: `user:${user.email}`, status: 'failed', detail: { reason: 'enrol mail failed' } });
          await updateUser(user.email, { clearEnrolCode: true }).catch(logWarn('clear enrolment code'));
          return Response.json({ error: 'The enrolment code could not be mailed. Try again later, or ask an admin.' }, { status: 503 });
        }
      }
      return Response.json({ mfa: need, emailed: true }, { headers: { 'set-cookie': mfaCookie(req, user, true), 'cache-control': 'no-store' } });
    }
    if (need) return Response.json({ mfa: need }, { headers: { 'set-cookie': mfaCookie(req, user, need === 'enrol'), 'cache-control': 'no-store' } });
    await audit('auth.login', { req, actor: `user:${user.email}`, detail: { method: 'password' } });
    const h = new Headers();
    h.append('set-cookie', sessionCookie(req, user));
    const dev = await issueDevice(req, user); if (dev) h.append('set-cookie', dev); // a known device of this account from now on (limits.checkCredential)
    return Response.json({ email: user.email, role: user.role }, { headers: h });
  } catch (e) {
    return errorResponse(e);
  }
}
