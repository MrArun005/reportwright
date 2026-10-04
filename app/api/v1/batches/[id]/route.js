import { apiPrincipal } from '@/server/auth.js';
import { getJob } from '@/server/jobs.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  const { id } = await params;
  const job = await getJob(id, principal);
  return job ? Response.json(job) : Response.json({ error: 'Batch not found' }, { status: 404 });
}
