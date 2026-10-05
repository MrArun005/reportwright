// GET /api/account/devices — the signed-in user's known browsers (device cookies: src/server/session.js):
// { devices: [{ id, created, lastUsed, ua }] }. DELETE { id } removes one: its cookie stops counting at once.
// Any signed-in user, for themselves only.
import { requireRole } from '@/server/access.js';
import { listDevices, removeDevice } from '@/server/users.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { user: me, res } = await requireRole(req, 'viewer');
  if (res) return res;
  return Response.json({ devices: await listDevices(me.email) }, { headers: { 'cache-control': 'no-store' } });
}

export async function DELETE(req) {
  const { user: me, res } = await requireRole(req, 'viewer');
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  if (typeof body?.id !== 'string' || !body.id) return Response.json({ error: 'Give the device id.' }, { status: 400 });
  if (!(await removeDevice(me.email, body.id))) return Response.json({ error: 'No such device.' }, { status: 404 });
  await audit('user.update', { req, actor: `user:${me.email}`, detail: { user: me.email, devices: 'one removed' } });
  return Response.json({ ok: true });
}
