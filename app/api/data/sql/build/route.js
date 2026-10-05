// POST /api/data/sql/build { connection, tables, joins?, columns, filters?, sort?, limit? } → { sql, parameters, dialect }
// Designers only. Turns the visual builder's query into one SELECT for the connection's dialect, with every value a
// parameter (src/server/sql/schema.js buildSql; payload shape in docs/COORDINATION.md). It runs nothing.
import { principalOf, canDesign } from '@/server/perms.js';
import { buildSql } from '@/server/sql/schema.js';
import { connectionKind } from '@/server/sql.js';
import { readBody } from '@/server/reports.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

export async function POST(req) {
  if (!canDesign(await principalOf(req))) return Response.json({ error: 'Only designers can build SQL.' }, { status: 403 });
  try {
    let spec;
    try { spec = JSON.parse(new TextDecoder().decode(await readBody(req, 256 * 1024))); } catch (e) { if (e.status) throw e; return Response.json({ error: 'Send JSON.' }, { status: 400 }); }
    const dialect = connectionKind(String(spec?.connection ?? ''));
    return Response.json({ ...buildSql(spec, dialect), dialect });
  } catch (e) { return errorResponse(e); }
}
