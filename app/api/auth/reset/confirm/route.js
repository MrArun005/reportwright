// POST /api/auth/reset/confirm { token, password } — set a new password with a reset link's token: single use, 30
// minutes, every session of the account ends. The token goes through limits.checkCredential.
import { accountsOn, issueDevice } from '@/server/session.js';
import { useReset, getUser } from '@/server/users.js';
import { checkCredential } from '@/server/limits.js';
import { audit } from '@/server/audit.js';
import { notifyAccount } from '@/server/mail.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

export async function POST(req) {
  if (!accountsOn()) return Response.json({ error: 'Accounts are off on this server (PW_AUTH is not "users").' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const email = await checkCredential({ kind: 'reset', req }, () => useReset(body?.token, body?.password));
    await audit('auth.reset', { req, actor: `user:${email}`, detail: { sessions: 'ended' } });
    notifyAccount(email, 'Your password was reset with a link from a reset email, and every session was signed out.');
    // the mailbox is proven: this browser becomes a known device, so a sign-in cap others filled does not keep it out
    const u = await getUser(email);
    const device = u ? await issueDevice(req, u) : null; // null: no device cookie (never the text "null")
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store', ...(device ? { 'set-cookie': device } : {}) } });
  } catch (e) {
    if (e.status === 400 && /link/.test(e.message)) await audit('auth.reset_failed', { req, status: 'failed', detail: { reason: 'bad or spent token' } });
    return errorResponse(e);
  }
}
