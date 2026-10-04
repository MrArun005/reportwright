// POST /api/audit/export { report, format } — the viewer exports in the browser, so it tells the server, which records
// it (marked client: true: it is the browser's word). Only for a report the caller may view; nothing else is accepted.
import { principalOf, readReportFor } from '@/server/perms.js';
import { safeId } from '@/server/reports.js';
import { audit } from '@/server/audit.js';
import { accountsOn } from '@/server/session.js';

export const runtime = 'nodejs';
const FORMATS = new Set(['pdf', 'xlsx', 'docx', 'html', 'csv', 'svg', 'print']);

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.report !== 'string' || !FORMATS.has(body.format)) return Response.json({ error: 'Send { report, format }' }, { status: 400 });
    const p = await principalOf(req);
    if (accountsOn() && p.kind !== 'user') return Response.json({ error: 'Sign in first.' }, { status: 401 });
    await readReportFor(p, safeId(body.report), 'view'); // 404 for a report that is not there too
    await audit('report.export', { req, principal: p, report: body.report, format: body.format, params: body.parameters && typeof body.parameters === 'object' ? body.parameters : null, detail: { client: true } });
    return Response.json({ ok: true });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
