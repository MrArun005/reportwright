// POST /api/auth/logout — sign out: clears the cookie and ends every session of this user.
import { endSessions } from '@/server/users.js';
import { currentUser, clearCookie } from '@/server/session.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const user = await currentUser(req).catch(() => null);
  if (user && !user.internal) await endSessions(user.email);
  return Response.json({ ok: true }, { headers: { 'set-cookie': clearCookie(req) } });
}
