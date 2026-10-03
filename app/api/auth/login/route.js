// POST /api/auth/login { email, password } — sign in (PW_AUTH=users). Sets the pw_session cookie.
// 10 failed tries in 15 minutes for one address and email → 429, even for the right password.
import { authenticate, ensureAdmin, normEmail } from '@/server/users.js';
import { accountsOn, sessionSecret, sessionCookie, loginKey, loginBlocked, loginFailed, loginSucceeded } from '@/server/session.js';

export const runtime = 'nodejs';

const WRONG = 'The email or password is wrong.';

export async function POST(req) {
  if (!accountsOn()) return Response.json({ error: 'Accounts are off on this server (PW_AUTH is not "users").' }, { status: 404 });
  try {
    sessionSecret(); // refuse to sign anyone in without a usable secret
    const text = await req.text();
    let body;
    try { body = text.length <= 10000 ? JSON.parse(text) : null; } catch { body = null; }
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') return Response.json({ error: 'Send { email, password }.' }, { status: 400 });
    let email;
    try { email = normEmail(body.email); } catch { return Response.json({ error: WRONG }, { status: 401 }); }
    await ensureAdmin();
    const key = loginKey(req, email);
    const wait = loginBlocked(key);
    if (wait) return Response.json({ error: 'Too many failed sign-ins. Try again later.' }, { status: 429, headers: { 'retry-after': String(wait) } });
    const user = await authenticate(email, body.password);
    if (!user) { loginFailed(key); return Response.json({ error: WRONG }, { status: 401 }); }
    loginSucceeded(key);
    return Response.json({ email: user.email, role: user.role }, { headers: { 'set-cookie': sessionCookie(req, user) } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
