// GET /api/auth/me — { email, role } of the signed-in user, or 401.
import { currentUser } from '@/server/session.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  return Response.json({ email: user.email, role: user.role });
}
