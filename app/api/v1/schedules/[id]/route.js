import { authorize, fail } from '@/server/auth.js';
import { getSchedule, updateSchedule, deleteSchedule } from '@/server/schedules.js';

export const runtime = 'nodejs';
const nf = () => Response.json({ error: 'Schedule not found' }, { status: 404 });

export async function GET(req, { params }) {
  const denied = authorize(req); if (denied) return denied;
  const s = await getSchedule((await params).id);
  return s ? Response.json(s) : nf();
}
export async function PUT(req, { params }) {
  const denied = authorize(req); if (denied) return denied;
  try { const s = await updateSchedule((await params).id, await req.json()); return s ? Response.json(s) : nf(); }
  catch (e) { return fail(e); }
}
export async function DELETE(req, { params }) {
  const denied = authorize(req); if (denied) return denied;
  return (await deleteSchedule((await params).id)) ? Response.json({ ok: true }) : nf();
}
