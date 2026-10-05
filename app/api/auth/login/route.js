// POST /api/auth/login { email, password } — sign in (PW_AUTH=users). Sets the pw_session cookie, or, when the account
// needs a second factor, answers { mfa: 'totp' | 'enrol' } and sets pw_mfa: POST /api/auth/mfa finishes the sign-in.
// Limits across servers (src/server/limits.js loginAttempt): too many failures from one source → 429 for that source;
// failures for one account from everywhere only slow its tries down, so nobody can lock its owner out.
import { authenticate, ensureAdmin, normEmail, secondFactor } from '@/server/users.js';
import { accountsOn, sessionSecret, sessionCookie, mfaCookie } from '@/server/session.js';
import { loginAttempt, clientAddress, unknownProxy } from '@/server/limits.js';
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
    const text = await req.text();
    let body;
    try { body = text.length <= 10000 ? JSON.parse(text) : null; } catch { body = null; }
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return Response.json({ error: 'Send { email, password }.' }, { status: 400 });
    let email;
    try { email = normEmail(body.email); } catch { await audit('auth.login_failed', { req, detail: { reason: 'bad email' } }); return Response.json({ error: WRONG }, { status: 401 }); }
    await ensureAdmin();
    const slot = await loginAttempt(clientAddress(req), email, { perSource: !unknownProxy(req) });
    if (!slot.ok) {
      await audit('auth.login_failed', { req, detail: { email, reason: 'rate limited' } });
      return Response.json({ error: 'Too many failed sign-ins. Try again later.' }, { status: 429, headers: { 'retry-after': String(slot.retryAfter) } });
    }
    if (slot.delayMs) await new Promise(r => setTimeout(r, slot.delayMs));
    const user = await authenticate(email, body.password);
    if (!user) { await audit('auth.login_failed', { req, detail: { email, reason: 'wrong email or password' } }); return Response.json({ error: WRONG }, { status: 401 }); }
    await slot.release(); // a right password does not count
    const need = secondFactor(user, await getSettings({ fresh: true }));
    if (need === 'enrol' && mailOn()) {
      // a first enrolment needs the password and the mailbox: a code goes to the account's address
      const code = await issueEnrolCode(user.email);
      if (code) {
        try {
          await sendMail({ to: [user.email], subject: 'Your Pagewright enrolment code', text: `Your code to set up two-factor sign-in: ${code}\n\nIt works for 15 minutes. If you did not just sign in, tell an admin: someone has your password.\n` });
        } catch (e) {
          console.error(`[pagewright] enrolment code mail: ${e.message}`);
          await audit('auth.mfa_failed', { req, actor: `user:${user.email}`, status: 'failed', detail: { reason: 'enrol mail failed' } });
          await updateUser(user.email, { clearEnrolCode: true }).catch(logWarn('clear enrolment code'));
          return Response.json({ error: 'The enrolment code could not be mailed. Try again later, or ask an admin.' }, { status: 503 });
        }
      }
      return Response.json({ mfa: need, emailed: true }, { headers: { 'set-cookie': mfaCookie(req, user, true), 'cache-control': 'no-store' } });
    }
    if (need) return Response.json({ mfa: need }, { headers: { 'set-cookie': mfaCookie(req, user, need === 'enrol'), 'cache-control': 'no-store' } });
    await audit('auth.login', { req, actor: `user:${user.email}`, detail: { method: 'password' } });
    return Response.json({ email: user.email, role: user.role }, { headers: { 'set-cookie': sessionCookie(req, user) } });
  } catch (e) {
    return errorResponse(e);
  }
}
