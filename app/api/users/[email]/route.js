// PATCH /api/users/<email> { role?, password?, disabled?, groups? } — change a user. DELETE — remove one. Admins only.
// The last admin cannot be demoted, disabled or deleted (409).
import { updateUser, deleteUser, getUser } from '@/server/users.js';
import { requireRole } from '@/server/access.js';
import { sessionCookie } from '@/server/session.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

const fail = (e) => Response.json({ error: e.message }, { status: e.status || 500 });
// an email always has "@": without one the segment is still percent-encoded (a%40b.c)
const target = async (params) => { const e = String((await params).email); try { return e.includes('@') ? e : decodeURIComponent(e); } catch { return e; } };

export async function PATCH(req, { params }) {
  const { user: me, res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const email = await target(params);
    const body = await req.json().catch(() => ({}));
    const patch = {};
    for (const k of ['role', 'password', 'disabled', 'groups', 'allowSso']) if (body[k] !== undefined) patch[k] = body[k];
    const u = await updateUser(email, patch);
    await audit('user.update', { req, actor: `user:${me.email}`, detail: { user: u.email, ...('role' in patch && { role: u.role }), ...('groups' in patch && { groups: u.groups }), ...('disabled' in patch && { disabled: u.disabled }), ...('password' in patch && { password: 'changed' }) } });
    // a new password ends the user's sessions; an admin who changed their own stays signed in
    const headers = u.email === me.email && patch.password !== undefined ? { 'set-cookie': sessionCookie(req, await getUser(u.email)) } : undefined;
    return Response.json(u, { headers });
  } catch (e) { return fail(e); }
}

export async function DELETE(req, { params }) {
  const { user: me, res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const email = await target(params);
    if (!(await deleteUser(email))) return Response.json({ error: 'No such user.' }, { status: 404 });
    await audit('user.delete', { req, actor: `user:${me.email}`, detail: { user: String(email).toLowerCase() } });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
