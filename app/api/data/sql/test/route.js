// POST /api/data/sql/test { connection } → { ok, ms, error? }: a read-only "select 1".
import { testConnection } from '@/server/sql.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.connection !== 'string') return Response.json({ error: 'Give the connection name' }, { status: 400 });
  return Response.json(await testConnection(body.connection));
}
