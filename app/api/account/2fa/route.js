// POST /api/account/2fa { action, code?, recoveryCode? } — the signed-in user's own two-factor sign-in:
//   setup    a new authenticator secret: { secret, uri, qr } (qr is SVG), pending until enabled
//   enable   { code } from the new authenticator: on; answers { recoveryCodes } (shown once); other sessions end
//   recovery { code } now: new recovery codes (the old ones stop working)
//   disable  { code } or { recoveryCode }: off, unless the role requires it (409); other sessions end
// Codes are checked with the same per-user limit as sign-in (5 wrong in 15 minutes, every server).
import { requireRole } from '@/server/access.js';
import { getUser, startTwoFactor, enableTwoFactor, checkSecondFactor, newRecovery, disableTwoFactor } from '@/server/users.js';
import { sessionCookie } from '@/server/session.js';
import { getSettings } from '@/server/settings.js';
import { attempt } from '@/server/limits.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';
const fail = (msg, status) => Object.assign(new Error(msg), { status });
const noStore = { 'cache-control': 'no-store' };

export async function POST(req) {
  const { user: me, res } = await requireRole(req, 'viewer');
  if (res) return res;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    if (action === 'setup') return Response.json(await startTwoFactor(me.email), { headers: noStore });
    if (!['enable', 'recovery', 'disable'].includes(action)) throw fail('Send { action: "setup" | "enable" | "recovery" | "disable" }.', 400);
    if (action === 'disable' && (await getSettings({ fresh: true })).require2fa.includes((await getUser(me.email))?.role)) throw fail('Your role must use two-factor sign-in, so it cannot be turned off. An admin can reset it.', 409);
    const slot = await attempt(`mfa:${me.email}`, 5, 15 * 60 * 1000);
    if (!slot.ok) return Response.json({ error: 'Too many wrong codes. Try again later.' }, { status: 429, headers: { 'retry-after': String(slot.retryAfter) } });
    if (action === 'enable') {
      let out;
      try { out = await enableTwoFactor(me.email, String(body.code ?? '')); }
      catch (e) { if (e.status === 400) await audit('auth.mfa_failed', { req, actor: `user:${me.email}`, status: 'failed', detail: { reason: 'wrong code', at: 'enrol' } }); throw e; }
      await slot.release();
      await audit('auth.mfa_enabled', { req, actor: `user:${me.email}` });
      // every other session ended (sessionVersion went up): this browser gets a new one, opened with the factor
      return Response.json({ recoveryCodes: out.codes }, { headers: { ...noStore, 'set-cookie': sessionCookie(req, out.user, { m: 1 }) } });
    }
    const ok = await checkSecondFactor(me.email, { code: body.code, recoveryCode: body.recoveryCode });
    if (!ok) {
      await audit('auth.mfa_failed', { req, actor: `user:${me.email}`, status: 'failed', detail: { reason: 'wrong code', at: action } });
      throw fail('That code is not right.', 401);
    }
    await slot.release();
    if (action === 'recovery') {
      const codes = await newRecovery(me.email);
      await audit('auth.mfa_recovery', { req, actor: `user:${me.email}` });
      return Response.json({ recoveryCodes: codes }, { headers: noStore });
    }
    await disableTwoFactor(me.email);
    await audit('auth.mfa_disabled', { req, actor: `user:${me.email}` });
    return Response.json({ ok: true }, { headers: { ...noStore, 'set-cookie': sessionCookie(req, await getUser(me.email)) } });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
