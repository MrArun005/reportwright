// PATCH /api/users/<email> { role?, password?, disabled? } — change a user. DELETE — remove one. Admins only.
// The last admin cannot be demoted, disabled or deleted (409).
import { updateUser, deleteUser, getUser } from '@/server/users.js';
import { requireRole } from '@/server/access.js';
import { sessionCookie } from '@/server/session.js';

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
    for (const k of ['role', 'password', 'disabled']) if (body[k] !== undefined) patch[k] = body[k];
    const u = await updateUser(email, patch);
    // a new password ends the user's sessions; an admin who changed their own stays signed in
    const headers = u.email === me.email && patch.password !== undefined ? { 'set-cookie': sessionCookie(req, await getUser(u.email)) } : undefined;
    return Response.json(u, { headers });
  } catch (e) { return fail(e); }
}

export async function DELETE(req, { params }) {
  const { res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    return (await deleteUser(await target(params))) ? Response.json({ ok: true }) : Response.json({ error: 'No such user.' }, { status: 404 });
  } catch (e) { return fail(e); }
}
