// GET /api/data/sql/connections → [{ name, kind }]: the PW_DB_<NAME> connections, never their URLs.
import { listConnections } from '@/server/sql.js';

export const runtime = 'nodejs';

export function GET() {
  return Response.json(listConnections());
}
