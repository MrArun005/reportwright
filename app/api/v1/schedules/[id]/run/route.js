import { apiPrincipal, fail } from '@/server/auth.js';
import { getSchedule, runSchedule } from '@/server/schedules.js';

export const runtime = 'nodejs';

export async function POST(req, { params }) {
  const { principal, res } = await apiPrincipal(req); if (res) return res;
  try {
    const s = await getSchedule((await params).id, principal);
    if (!s) return Response.json({ error: 'Schedule not found' }, { status: 404 });
    return Response.json(await runSchedule(s, 'manual'), { status: 202 });
  } catch (e) { return fail(e); }
}
