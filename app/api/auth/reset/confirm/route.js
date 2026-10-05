// POST /api/auth/reset/confirm { token, password } — set a new password with a reset link's token: single use, 30
// minutes, every session of the account ends. 20 tries an hour per client address, on every server.
import { accountsOn } from '@/server/session.js';
import { useReset } from '@/server/users.js';
import { attempt, clientAddress } from '@/server/limits.js';
import { audit } from '@/server/audit.js';
import { notifyAccount } from '@/server/mail.js';

export const runtime = 'nodejs';

export async function POST(req) {
  if (!accountsOn()) return Response.json({ error: 'Accounts are off on this server (PW_AUTH is not "users").' }, { status: 404 });
  const slot = await attempt(`reset-confirm:${clientAddress(req)}`, 20, 3600 * 1000);
  if (!slot.ok) { await audit('auth.reset_failed', { req, status: 'denied', detail: { reason: 'rate limited' } }); return Response.json({ error: 'Too many tries. Try again later.' }, { status: 429, headers: { 'retry-after': '3600' } }); }
  const body = await req.json().catch(() => ({}));
  try {
    const email = await useReset(body?.token, body?.password);
    await slot.release();
    await audit('auth.reset', { req, actor: `user:${email}`, detail: { sessions: 'ended' } });
    notifyAccount(email, 'Your password was reset with a link from a reset email, and every session was signed out.');
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e.status === 400 && /link/.test(e.message)) await audit('auth.reset_failed', { req, status: 'failed', detail: { reason: 'bad or spent token' } });
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
