// GET /api/audit?from=YYYY-MM-DD&to=YYYY-MM-DD&type=report.render|report.&actor=user:a@b.c&report=id&limit=200&before=<id>[&format=csv]
// The audit log, newest first. Admins only (proxy.js, and again here).
import { requireRole } from '@/server/access.js';
import { queryAudit, auditCsv } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const sp = new URL(req.url).searchParams;
    const q = Object.fromEntries(['from', 'to', 'type', 'actor', 'report', 'before', 'limit'].map(k => [k, sp.get(k) || undefined]));
    if (sp.get('format') === 'csv') {
      const events = await queryAudit({ ...q, limit: Math.min(Number(q.limit) || 10000, 10000) });
      return new Response(auditCsv(events), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="pagewright-audit-${new Date().toISOString().slice(0, 10)}.csv"` } });
    }
    return Response.json(await queryAudit(q));
  } catch (e) { return Response.json({ error: e.message }, { status: e.status || 500 }); }
}
