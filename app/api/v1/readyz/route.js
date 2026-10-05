// GET /api/v1/readyz — 200 when this server can take work: the storage answers (a read within 3 s) and a render worker
// is ready (or renders run on this thread). 503 otherwise. No key needed, and it tells nothing beyond { ok, checks }:
// for the Docker HEALTHCHECK and a load balancer's readiness probe. Details: /api/v1/health and /api/v1/metrics (keys).
import { store } from '@/server/storage/index.js';
import { poolStats, warmPool } from '@/server/pool.js';
import { logError } from '@/server/errors.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let storage = false;
  try {
    await Promise.race([store().get('settings', 'server'), new Promise((_, no) => setTimeout(() => no(new Error('the storage did not answer within 3 s')), 3000).unref())]);
    storage = true;
  } catch (e) { logError(e, 'readyz storage'); }
  warmPool();
  const w = poolStats().workers;
  const workers = !w.size || w.ready > 0 || !!w.inline;
  const ok = storage && workers;
  return Response.json({ ok, checks: { storage, workers } }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
