// POST /api/schedules/<id>/run — run an own schedule now (the Schedules page).
import { getSchedule, runSchedule } from '@/server/schedules.js';
import { designer } from '@/server/schedulePage.js';

export const runtime = 'nodejs';

export async function POST(req, { params }) {
  const { p, res } = await designer(req);
  if (res) return res;
  try {
    const { id } = await params;
    const s = await getSchedule(id, p);
    if (!s) return Response.json({ error: 'No such schedule.' }, { status: 404 });
    const job = await runSchedule(s, 'manual');
    return Response.json({ batch: job.id, status: job.status }, { status: 202 });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
