import { apiPrincipal, fail } from '@/server/auth.js';
import { listSchedules, createSchedule } from '@/server/schedules.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  return Response.json(await listSchedules(principal));
}

export async function POST(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  try {
    const s = await createSchedule(await req.json(), principal);
    await audit('schedule.create', { req, principal, report: typeof s.template === 'string' ? s.template : null, detail: { schedule: s.id, cron: s.cron, timezone: s.timezone } });
    return Response.json(s, { status: 201 });
  }
  catch (e) { return fail(e); }
}
