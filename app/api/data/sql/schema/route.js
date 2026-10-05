// GET /api/data/sql/schema?connection=<name> → { dialect, tables: [{ name, columns: [{ name, type, key }] }],
// relations: [{ from: { table, column }, to: { table, column } }], truncated }. Designers only. Read through the
// connection's read-only login, under the SQL deadline and caps (src/server/sql/schema.js).
import { principalOf, canDesign } from '@/server/perms.js';
import { schemaOf } from '@/server/sql/schema.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

export async function GET(req) {
  if (!canDesign(await principalOf(req))) return Response.json({ error: 'Only designers can read a connection\'s tables.' }, { status: 403 });
  try {
    const name = new URL(req.url).searchParams.get('connection') || '';
    return Response.json(await schemaOf(name), { headers: { 'cache-control': 'private, max-age=60' } });
  } catch (e) { return errorResponse(e); }
}
