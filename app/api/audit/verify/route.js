// GET /api/audit/verify?from=YYYY-MM-DD&to=YYYY-MM-DD — check the audit log's hash chain and signed checkpoints
// (src/server/audit.js verifyAudit): { status: 'ok'|'unverified'|'tampered'|'error', … }; only "ok" is a pass. Admins only. The same check runs from the command line: pw audit verify.
import { requireRole } from '@/server/access.js';
import { verifyAudit, publicKeyInfo } from '@/server/audit.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const sp = new URL(req.url).searchParams;
    const day = (v) => { if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw Object.assign(new Error(`"${v.slice(0, 20)}" is not a date (YYYY-MM-DD).`), { status: 400 }); return v || undefined; };
    const r = await verifyAudit({ from: day(sp.get('from')), to: day(sp.get('to')) });
    return Response.json({ ...r, publicKey: publicKeyInfo().pem }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) { return Response.json({ status: 'error', ok: false, error: e.message }, { status: e.status || 500 }); }
}
