// GET /api/admin/snapshots — { entries, bytes, hits, misses } of the report snapshot cache. DELETE — clear it. Admins only.
import { requireRole } from '@/server/access.js';
import { snapshotStats, clearSnapshots } from '@/server/snapshots.js';
import { audit } from '@/server/audit.js';
import { errorResponse } from '@/server/errors.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { res } = await requireRole(req, 'admin');
  return res || Response.json(await snapshotStats(), { headers: { 'cache-control': 'no-store' } });
}
export async function DELETE(req) {
  const { user: me, res } = await requireRole(req, 'admin');
  if (res) return res;
  try {
    const before = await snapshotStats();
    await audit('snapshot.clear', { req, actor: `user:${me.email}`, detail: { entries: before.entries } });
    await clearSnapshots();
    return Response.json(await snapshotStats());
  } catch (e) { return errorResponse(e); }
}
