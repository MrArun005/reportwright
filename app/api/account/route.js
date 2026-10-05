// GET /api/account — the signed-in user's own account: { email, role, sso, password, twoFactor: { enabled, required,
// recoveryLeft } }. Any signed-in user, for themselves only.
import { requireRole } from '@/server/access.js';
import { getUser } from '@/server/users.js';
import { getSettings } from '@/server/settings.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { user: me, res } = await requireRole(req, 'viewer');
  if (res) return res;
  const u = await getUser(me.email);
  if (!u) return Response.json({ error: 'No such user.' }, { status: 404 });
  const s = await getSettings();
  return Response.json({
    email: u.email, role: u.role, sso: u.sso?.via || null, password: !!u.passwordHash,
    twoFactor: { enabled: !!u.totp, required: !!u.passwordHash && s.require2fa.includes(u.role), recoveryLeft: Array.isArray(u.recovery) ? u.recovery.length : 0, enabledAt: u.totp?.enabledAt || null },
  }, { headers: { 'cache-control': 'no-store' } });
}
