// POST /api/v1/batches — render many; GET — recent batches (a user's key: its own only).
import { apiPrincipal, fail } from '@/server/auth.js';
import { createBatch, listJobs } from '@/server/jobs.js';
import { audit } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  try {
    const body = await req.json();
    const job = await createBatch(body, req, principal);
    await audit('batch.create', { req, principal, report: typeof body.template === 'string' ? body.template : null, format: job.format, detail: { batch: job.id, items: job.total, output: job.output?.type } });
    return Response.json(job, { status: 202, headers: { location: `/api/v1/batches/${job.id}` } });
  } catch (e) { return fail(e); }
}

export async function GET(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  return Response.json(await listJobs(principal));
}
