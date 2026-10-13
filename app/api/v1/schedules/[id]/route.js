import { apiPrincipal, fail } from '@/server/auth.js';
import { getSchedule, updateSchedule, deleteSchedule } from '@/server/schedules.js';
import { audit } from '@/server/audit.js';
import { readJson, DEF_BYTES } from '@/server/body.js';

export const runtime = 'nodejs';
const nf = () => Response.json({ error: 'Schedule not found' }, { status: 404 });

export async function GET(req, { params }) {
  const { principal, res } = await apiPrincipal(req); if (res) return res;
  const s = await getSchedule((await params).id, principal);
  return s ? Response.json(s) : nf();
}
export async function PUT(req, { params }) {
  const { principal, res } = await apiPrincipal(req); if (res) return res;
  try {
    const s = await updateSchedule((await params).id, await readJson(req, DEF_BYTES), principal);
    if (!s) return nf();
    await audit('schedule.update', { req, principal, report: typeof s.template === 'string' ? s.template : null, detail: { schedule: s.id, cron: s.cron, enabled: s.enabled !== false } });
    return Response.json(s);
  }
  catch (e) { return fail(e); }
}
export async function DELETE(req, { params }) {
  const { principal, res } = await apiPrincipal(req); if (res) return res;
  const id = (await params).id;
  if (!(await deleteSchedule(id, principal))) return nf();
  await audit('schedule.delete', { req, principal, detail: { schedule: String(id).slice(0, 40) } });
  return Response.json({ ok: true });
}
