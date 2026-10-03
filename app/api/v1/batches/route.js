// POST /api/v1/batches — render many; GET — recent batches.
import { authorize, fail } from '@/server/auth.js';
import { createBatch, listJobs } from '@/server/jobs.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const denied = authorize(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const job = await createBatch(body, req);
    return Response.json(job, { status: 202, headers: { location: `/api/v1/batches/${job.id}` } });
  } catch (e) { return fail(e); }
}

export async function GET(req) {
  const denied = authorize(req);
  if (denied) return denied;
  return Response.json(await listJobs());
}
