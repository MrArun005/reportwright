// POST /api/data/sql — rows for a SQL data source, for renders in the browser.
// { report, source, params } runs the query saved in that report. The browser never sends SQL in this
// mode: a "query" or "connection" next to "report" is ignored.
// { connection, query, params } runs SQL from the request (a preview of unsaved work): with accounts on
// (PW_AUTH=users) for designers and admins only; with accounts off, outside production only.
import { runSql, runSavedSql } from '@/server/sql.js';
import { accountsOn } from '@/server/session.js';
import { requireRole } from '@/server/access.js';

export const runtime = 'nodejs';

const bad = (error, status = 400) => Response.json({ error }, { status });

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return bad('Send a JSON body: { report, source, params }');
  const params = body.params ?? {};
  if (typeof params !== 'object' || Array.isArray(params)) return bad('"params" must be an object');
  try {
    if (body.report != null) {
      if (typeof body.report !== 'string' || typeof body.source !== 'string') return bad('Give the report id and the source name');
      return Response.json({ rows: await runSavedSql(body.report, body.source, params) });
    }
    if (body.query == null) return bad('Give the report id and the source name');
    if (accountsOn()) { // with accounts on: designers and admins may preview SQL, in production too; nobody else
      const { res } = await requireRole(req, 'designer');
      if (res) return bad('Only designers can run SQL from the request. Save the report: its saved query runs instead.', 403);
    } else if (process.env.NODE_ENV === 'production') return bad('SQL from the request is off in production. Save the report: its saved query runs instead.', 403);
    return Response.json({ rows: await runSql({ connection: body.connection, query: body.query }, params) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 500 });
  }
}
