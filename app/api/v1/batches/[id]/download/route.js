import fs from 'node:fs/promises';
import { authorize } from '@/server/auth.js';
import { jobFile } from '@/server/jobs.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const denied = authorize(req);
  if (denied) return denied;
  const { id } = await params;
  const f = await jobFile(id);
  if (!f) return Response.json({ error: 'Nothing to download yet' }, { status: 404 });
  return new Response(await fs.readFile(f.path), { headers: { 'content-type': f.type, 'content-disposition': `attachment; filename="${f.name}"` } });
}
