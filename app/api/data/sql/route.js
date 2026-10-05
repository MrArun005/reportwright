// POST /api/data/sql — rows for a SQL data source, for renders in the browser.
// { report, source, params } runs the query saved in that report. The browser never sends SQL in this
// mode: a "query" or "connection" next to "report" is ignored.
//   Its SQL runs only as a designer saved it (readRunnable in perms.js).
// { connection, query | procedure + args, params } runs SQL from the request (a preview of unsaved work): designers and admins with
// accounts on (PW_AUTH=users); with accounts off, only where the server trusts whoever reaches it (next dev,
// PW_BASIC_AUTH, PW_AUTH=proxy), never in production with no sign-in. Every POST here is same-origin (proxy.js).
import { runSql, runSavedSql } from '@/server/sql.js';
import { principalOf, canDesign } from '@/server/perms.js';
import { errorResponse } from '@/server/errors.js';
import { audit, paramsHash } from '@/server/audit.js';

const paramsHashOf = (q) => paramsHash({ q: String(q ?? '') });

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
      const p = await principalOf(req);
      const rows = await runSavedSql(body.report, body.source, params, p);
      await audit('data.read', { req, principal: p, report: body.report, params, detail: { via: 'sql', source: body.source, rows: rows.length } });
      return Response.json({ rows });
    }
    if (body.query == null && body.procedure == null) return bad('Give the report id and the source name');
    // the same rule as saving a report with SQL (assertMayStore): whoever may do one may do the other
    const p = await principalOf(req);
    if (!canDesign(p)) return bad('Only designers can run SQL from the request (in production that needs a sign-in: PW_AUTH=users or PW_BASIC_AUTH). Save the report: its saved query runs instead.', 403);
    const rows = await runSql({ connection: body.connection, query: body.query, procedure: body.procedure, args: body.args }, params);
    // the query text itself is not kept (it may hold literals); its digest matches repeats
    await audit('data.read', { req, principal: p, params, detail: { via: 'sql', connection: body.connection, ...(body.procedure ? { procedure: body.procedure } : { query: paramsHashOf(body.query) }), rows: rows.length } });
    return Response.json({ rows });
  } catch (e) {
    return errorResponse(e);
  }
}
