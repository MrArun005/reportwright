// GET /api/users — every user (never a password hash). POST { email, role, password } — add one. Admins only.
import { listUsers, createUser } from '@/server/users.js';
import { requireRole } from '@/server/access.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { res } = await requireRole(req, 'admin');
  return res || Response.json(await listUsers());
}

export async function POST(req) {
  const { res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await createUser({ email: body.email, role: body.role, password: body.password }), { status: 201 });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
