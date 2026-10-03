import { authorize, fail } from '@/server/auth.js';
import { listSchedules, createSchedule } from '@/server/schedules.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const denied = authorize(req);
  if (denied) return denied;
  return Response.json(await listSchedules());
}

export async function POST(req) {
  const denied = authorize(req);
  if (denied) return denied;
  try { return Response.json(await createSchedule(await req.json()), { status: 201 }); }
  catch (e) { return fail(e); }
}
