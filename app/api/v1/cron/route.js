// GET /api/v1/cron — one scheduler tick plus the batch queue, for hosts without a long-lived process (Vercel Cron).
// Only with "Authorization: Bearer $CRON_SECRET" (Vercel sends it); without CRON_SECRET set it is off (404).
// Idempotent: the scheduler lease and each schedule's lastRunAt stop a double run, job leases stop a double render.
import { tickAs, cronHorizonMs } from '@/server/schedules.js';
import { ME, drainQueue, sweepJobs, cronSecretOk } from '@/server/jobs.js';
import { errorResponse } from '@/server/errors.js';
import { checkCredential } from '@/server/limits.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req) {
  if ((process.env.CRON_SECRET || '').length < 16) return Response.json({ error: 'Not found' }, { status: 404 });
  try {
    if (!(await checkCredential({ kind: 'cron', req }, () => cronSecretOk(req)))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // every schedule due before the next call (PW_CRON=daily: the rest of today), run here, inside the tick
    const schedules = await tickAs(ME, new Date(), { horizonMs: cronHorizonMs() });
    const batches = await drainQueue(Date.now() + 240000); // leave room before maxDuration
    const swept = await sweepJobs();
    return Response.json({ ok: true, schedules, batches, swept }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
