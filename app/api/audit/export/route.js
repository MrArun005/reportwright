// POST /api/audit/export { report, format } — the viewer exports in the browser, so it tells the server, which records
// it (marked client: true: it is the browser's word). Only for a report the caller may view; nothing else is accepted.
// So that the browser's word is not the only source, the event names the server's own record behind it: serverView is
// the id of the newest report.view the server logged for this user and report in the last 12 hours (the viewer page
// load, which the server renders and logs itself), or "none"; an export with no server-seen view is worth a look.
// Exports the server makes itself (/api/reports/<id>/pdf, /api/v1/render, batches) are logged by the server as
// report.render, with the format.
import { principalOf, readReportFor } from '@/server/perms.js';
import { safeId } from '@/server/reports.js';
import { audit, queryAudit } from '@/server/audit.js';
import { principalId } from '@/server/perms.js';
import { accountsOn } from '@/server/session.js';
import { errorResponse } from '@/server/errors.js';
import { readJsonOr } from '@/server/body.js';

export const runtime = 'nodejs';
const FORMATS = new Set(['pdf', 'xlsx', 'docx', 'html', 'csv', 'json', 'svg', 'print']);

export async function POST(req) {
  try {
    const body = await readJsonOr(req, null);
    if (!body || typeof body.report !== 'string' || !FORMATS.has(body.format)) return Response.json({ error: 'Send { report, format }' }, { status: 400 });
    const p = await principalOf(req);
    if (accountsOn() && p.kind !== 'user') return Response.json({ error: 'Sign in first.' }, { status: 401 });
    if (p.kind === 'public') return Response.json({ error: 'Anonymous exports are not logged (PW_PUBLIC_READONLY): nobody can fill the audit log.' }, { status: 403 });
    await readReportFor(p, safeId(body.report), 'view'); // 404 for a report that is not there too
    const seen = (await queryAudit({ type: 'report.view', actor: principalId(p), report: body.report, from: new Date(Date.now() - 12 * 3600 * 1000).toISOString(), limit: 1 }).catch(() => []))[0];
    await audit('report.export', { req, principal: p, report: body.report, format: body.format, params: body.parameters && typeof body.parameters === 'object' ? body.parameters : null, detail: { client: true, serverView: seen ? seen.id : 'none' } });
    return Response.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
