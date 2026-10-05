// GET /api/v1/metrics — Prometheus text: renders by outcome, render durations (a histogram, seconds), queue depth,
// workers (alive, ready, busy, restarts), memory, SQLite query processes. Needs a service key (or an admin's key with
// accounts on), as /api/v1/health.
import { apiPrincipal } from '@/server/auth.js';
import { vet } from '@/server/perms.js';
import { poolStats } from '@/server/pool.js';
import { sqliteStats } from '@/server/sql/sqlite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { principal, res } = await apiPrincipal(req, { quiet: true }); // its own event (render) or none (a scrape)
  if (res) return res;
  const p = vet(principal);
  if (!(p.kind === 'service' || p.kind === 'open' || (p.kind === 'user' && p.role === 'admin'))) return Response.json({ error: 'Only a service key or an admin may read the server\'s metrics.' }, { status: 403 });
  return new Response(metricsText(), { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' } });
}

function metricsText() {
  const s = poolStats(), q = sqliteStats();
  const out = [];
  const metric = (name, type, help, rows) => { out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`); for (const [labels, v] of rows) out.push(`${name}${labels} ${Number(v) || 0}`); };
  metric('pagewright_renders_total', 'counter', 'Renders by outcome.', Object.entries({ done: s.totals.done, failed: s.totals.failed, rejected: s.totals.rejected, timed_out: s.totals.timedOut, crashed: s.totals.crashed, dropped: s.totals.dropped }).map(([k, v]) => [`{outcome="${k}"}`, v]));
  out.push('# HELP pagewright_render_duration_seconds Time a render held a worker.', '# TYPE pagewright_render_duration_seconds histogram');
  s.durations.buckets.forEach((b, i) => out.push(`pagewright_render_duration_seconds_bucket{le="${b}"} ${s.durations.counts[i]}`));
  out.push(`pagewright_render_duration_seconds_bucket{le="+Inf"} ${s.durations.count}`, `pagewright_render_duration_seconds_sum ${s.durations.sum}`, `pagewright_render_duration_seconds_count ${s.durations.count}`);
  metric('pagewright_render_queue', 'gauge', 'Renders waiting, by class.', [['{class="interactive"}', s.queue.interactive], ['{class="background"}', s.queue.background]]);
  metric('pagewright_render_workers', 'gauge', 'Render worker threads.', [['{state="size"}', s.workers.size], ['{state="alive"}', s.workers.alive], ['{state="ready"}', s.workers.ready], ['{state="busy"}', s.workers.busy]]);
  metric('pagewright_render_worker_restarts_total', 'counter', 'Render workers replaced (recycled, crashed, timed out).', [['', s.totals.restarts]]);
  metric('pagewright_render_held_for_memory_total', 'counter', 'Times a render waited because memory was near the limit.', [['', s.totals.heldForMemory]]);
  metric('pagewright_memory_bytes', 'gauge', 'Resident memory and the limit the pool plans for.', [['{kind="rss"}', process.memoryUsage.rss()], ['{kind="limit"}', s.memory.memMB * 1048576]]);
  metric('pagewright_sqlite_queries_total', 'counter', 'SQLite queries run in child processes, and those killed (deadline, memory) or crashed.', [['{outcome="all"}', q.queries], ['{outcome="killed"}', q.killed], ['{outcome="crashed"}', q.crashed]]);
  metric('pagewright_uptime_seconds', 'gauge', 'Process uptime.', [['', Math.round(process.uptime())]]);
  return out.join('\n') + '\n';
}
