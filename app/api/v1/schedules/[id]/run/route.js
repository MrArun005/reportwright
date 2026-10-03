import { authorize, fail } from '@/server/auth.js';
import { getSchedule, runSchedule } from '@/server/schedules.js';

export const runtime = 'nodejs';

export async function POST(req, { params }) {
  const denied = authorize(req); if (denied) return denied;
  try {
    const s = await getSchedule((await params).id);
    if (!s) return Response.json({ error: 'Schedule not found' }, { status: 404 });
    return Response.json(await runSchedule(s, 'manual'), { status: 202 });
  } catch (e) { return fail(e); }
}
