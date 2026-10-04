import fs from 'node:fs/promises';
import { apiPrincipal } from '@/server/auth.js';
import { jobFile } from '@/server/jobs.js';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  const { id } = await params;
  const f = await jobFile(id, principal);
  if (!f) return Response.json({ error: 'Nothing to download yet' }, { status: 404 });
  return new Response(await fs.readFile(f.path), { headers: { 'content-type': f.type, 'content-disposition': `attachment; filename="${f.name}"` } });
}
