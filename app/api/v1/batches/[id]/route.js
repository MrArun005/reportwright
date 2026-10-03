import { authorize } from '@/server/auth.js';
import { getJob } from '@/server/jobs.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const denied = authorize(req);
  if (denied) return denied;
  const { id } = await params;
  const job = await getJob(id);
  return job ? Response.json(job) : Response.json({ error: 'Batch not found' }, { status: 404 });
}
