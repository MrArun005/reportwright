// PATCH /api/schedules/<id> (the same fields as POST /api/schedules) and DELETE — the Schedules page, own schedules only.
import { updateSchedule, deleteSchedule, getSchedule } from '@/server/schedules.js';
import { audit } from '@/server/audit.js';
import { designer, specOf } from '@/server/schedulePage.js';
import { errorResponse } from '@/server/errors.js';
import { readJson, DEF_BYTES } from '@/server/body.js';

export const runtime = 'nodejs';

export async function PATCH(req, { params }) {
  const { p, res } = await designer(req);
  if (res) return res;
  try {
    const { id } = await params;
    const body = await readJson(req, DEF_BYTES);
    const cur = await getSchedule(id, p);
    if (!cur) return Response.json({ error: 'No such schedule.' }, { status: 404 });
    // only "enabled" toggles alone; anything else replaces the whole spec
    const patch = Object.keys(body).length === 1 && 'enabled' in body ? { enabled: body.enabled !== false } : { ...specOf({ ...cur, parameters: cur.items?.[0]?.parameters, ...body }), ...(body.email === null ? { email: null } : {}) };
    const s = await updateSchedule(id, patch, p);
    if (!s) return Response.json({ error: 'No such schedule.' }, { status: 404 });
    await audit('schedule.update', { req, principal: p, report: s.template, detail: { schedule: s.id, enabled: s.enabled, via: 'page' } });
    return Response.json(s);
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(req, { params }) {
  const { p, res } = await designer(req);
  if (res) return res;
  const { id } = await params;
  if (!(await deleteSchedule(id, p))) return Response.json({ error: 'No such schedule.' }, { status: 404 });
  await audit('schedule.delete', { req, principal: p, detail: { schedule: id, via: 'page' } });
  return Response.json({ ok: true });
}
