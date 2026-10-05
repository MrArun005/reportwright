// GET /api/admin/settings — the server settings (src/server/settings.js) and what is configured by environment
// (mail, SIEM shipping, single logout). PATCH { require2fa?, snapshotTtl?, snapshotMaxMb? } — change them. Admins only.
import { requireRole } from '@/server/access.js';
import { getSettings, updateSettings } from '@/server/settings.js';
import { audit } from '@/server/audit.js';
import { serverStatus } from '@/server/status.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { res } = await requireRole(req, 'admin');
  if (res) return res;
  return Response.json({ settings: await getSettings({ fresh: true }), status: await serverStatus() }, { headers: { 'cache-control': 'no-store' } });
}

export async function PATCH(req) {
  const { user: me, res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const body = await req.json().catch(() => ({}));
    const before = await getSettings({ fresh: true });
    const after = await updateSettings(body, { by: me.email });
    const changed = Object.fromEntries(['require2fa', 'snapshotTtl', 'snapshotMaxMb'].filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(k => [k, after[k]]));
    await audit('settings.update', { req, actor: `user:${me.email}`, detail: changed });
    return Response.json({ settings: after, status: await serverStatus() });
  } catch (e) { return errorResponse(e); }
}
