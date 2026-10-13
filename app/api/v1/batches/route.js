// POST /api/v1/batches — render many; GET — recent batches (a user's key: its own only).
import { apiPrincipal, fail } from '@/server/auth.js';
import { createBatch, listJobs, listJobPage } from '@/server/jobs.js';
import { audit } from '@/server/audit.js';
import { readJson, pushedDataBytes } from '@/server/body.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  try {
    const body = await readJson(req, pushedDataBytes());
    const job = await createBatch(body, req, principal);
    await audit('batch.create', { req, principal, report: typeof body.template === 'string' ? body.template : null, format: job.format, detail: { batch: job.id, items: job.total, output: job.output?.type } });
    return Response.json(job, { status: 202, headers: { location: `/api/v1/batches/${job.id}` } });
  } catch (e) { return fail(e); }
}

export async function GET(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  // ?limit=&before=: a page, with the cursor of the next in X-Next-Before (the body stays a plain list)
  const sp = new URL(req.url).searchParams;
  if (!sp.has('limit') && !sp.has('before')) return Response.json(await listJobs(principal));
  const { jobs, next } = await listJobPage(principal, { before: sp.get('before'), limit: Number(sp.get('limit')) || 50 });
  return Response.json(jobs, { headers: next ? { 'x-next-before': next } : {} });
}
