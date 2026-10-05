// GET /api/v1/health — the render pool's state: workers (alive, ready, busy), queue depth by class, the estimated wait,
// and totals (done, failed, rejected with 429/503, timed out, crashed, recycled). Needs a service key (or an admin's key
// with accounts on): queue depth tells a caller when the server is loaded.
import { apiPrincipal } from '@/server/auth.js';
import { vet } from '@/server/perms.js';
import { poolStats } from '@/server/pool.js';

export const runtime = 'nodejs';

export async function GET(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  const p = vet(principal);
  if (!(p.kind === 'service' || p.kind === 'open' || (p.kind === 'user' && p.role === 'admin'))) return Response.json({ error: 'Only a service key or an admin may read the server\'s health.' }, { status: 403 });
  const stats = poolStats();
  return Response.json({ ok: !stats.workers.size || stats.workers.ready > 0 || !!stats.workers.inline, uptimeS: Math.round(process.uptime()), rssMB: Math.round(process.memoryUsage().rss / 1048576), render: stats }, { headers: { 'cache-control': 'no-store' } });
}
