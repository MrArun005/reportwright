// GET /api/data/sql/connections → [{ name, kind }]: the PW_DB_<NAME> connections, never their URLs.
import { listConnections } from '@/server/sql.js';
import { principalOf, canDesign } from '@/server/perms.js';

export const runtime = 'nodejs';

export async function GET(req) {
  if (!canDesign(await principalOf(req))) return Response.json({ error: 'Only designers can list connections.' }, { status: 403 });
  return Response.json(listConnections());
}
