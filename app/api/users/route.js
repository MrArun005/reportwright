// GET /api/users — every user (never a password hash). POST { email, role, password } — add one. Admins only.
import { listUsers, createUser } from '@/server/users.js';
import { requireRole } from '@/server/access.js';
import { audit } from '@/server/audit.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { res } = await requireRole(req, 'admin');
  return res || Response.json(await listUsers());
}

export async function POST(req) {
  const { user: me, res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const body = await req.json().catch(() => ({}));
    const u = await createUser({ email: body.email, role: body.role, password: body.password, groups: body.groups ?? [] }, { by: me });
    await audit('user.create', { req, actor: `user:${me.email}`, detail: { user: u.email, role: u.role, groups: u.groups } });
    return Response.json(u, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
