// GET /api/v1/metrics — Prometheus text: renders by outcome, render durations (a histogram, seconds), queue depth,
// workers (alive, ready, busy, restarts), memory, SQLite query processes, HTTP answers and their durations. Needs a service key (or an admin's key with
// accounts on), as /api/v1/health.
import { apiPrincipal } from '@/server/auth.js';
import { vet } from '@/server/perms.js';
import { poolStats } from '@/server/pool.js';
import { sqliteStats } from '@/server/sql/sqlite.js';
import { httpStats, promLabel as esc } from '@/server/limits.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { principal, res } = await apiPrincipal(req);
  if (res) return res;
  const p = vet(principal);
  if (!(p.kind === 'service' || p.kind === 'open' || (p.kind === 'user' && p.role === 'admin'))) return Response.json({ error: 'Only a service key or an admin may read the server\'s metrics.' }, { status: 403 });
  return new Response(metricsText(), { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' } });
}

function metricsText() {
  const s = poolStats(), q = sqliteStats();
  const out = [];
  const metric = (name, type, help, rows) => { out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`); for (const [labels, v] of rows) out.push(`${name}${labels} ${Number(v) || 0}`); };
  metric('reportwright_renders_total', 'counter', 'Renders by outcome.', Object.entries({ done: s.totals.done, failed: s.totals.failed, rejected: s.totals.rejected, timed_out: s.totals.timedOut, crashed: s.totals.crashed, dropped: s.totals.dropped }).map(([k, v]) => [`{outcome="${k}"}`, v]));
  out.push('# HELP reportwright_render_duration_seconds Time a render held a worker.', '# TYPE reportwright_render_duration_seconds histogram');
  s.durations.buckets.forEach((b, i) => out.push(`reportwright_render_duration_seconds_bucket{le="${b}"} ${s.durations.counts[i]}`));
  out.push(`reportwright_render_duration_seconds_bucket{le="+Inf"} ${s.durations.count}`, `reportwright_render_duration_seconds_sum ${s.durations.sum}`, `reportwright_render_duration_seconds_count ${s.durations.count}`);
  metric('reportwright_render_queue', 'gauge', 'Renders waiting, by class.', [['{class="interactive"}', s.queue.interactive], ['{class="background"}', s.queue.background]]);
  metric('reportwright_render_workers', 'gauge', 'Render worker threads.', [['{state="size"}', s.workers.size], ['{state="alive"}', s.workers.alive], ['{state="ready"}', s.workers.ready], ['{state="busy"}', s.workers.busy]]);
  metric('reportwright_render_worker_restarts_total', 'counter', 'Render workers replaced (recycled, crashed, timed out).', [['', s.totals.restarts]]);
  metric('reportwright_render_held_for_memory_total', 'counter', 'Times a render waited because memory was near the limit.', [['', s.totals.heldForMemory]]);
  metric('reportwright_memory_bytes', 'gauge', 'Resident memory and the limit the pool plans for.', [['{kind="rss"}', process.memoryUsage.rss()], ['{kind="limit"}', s.memory.memMB * 1048576]]);
  metric('reportwright_sqlite_queries_total', 'counter', 'SQLite queries run in child processes, and those killed (deadline, memory) or crashed.', [['{outcome="all"}', q.queries], ['{outcome="killed"}', q.killed], ['{outcome="crashed"}', q.crashed]]);
  const h = httpStats();
  metric('reportwright_http_requests_total', 'counter', 'HTTP answers by method, route family and status class.', h.counts.map(([k, v]) => { const [m, r, c] = k.split('|'); return [`{method="${esc(m)}",route="${esc(r)}",status="${esc(c)}"}`, v]; }));
  out.push('# HELP reportwright_http_request_duration_seconds Time to answer a request.', '# TYPE reportwright_http_request_duration_seconds histogram');
  h.buckets.forEach((b, i) => out.push(`reportwright_http_request_duration_seconds_bucket{le="${b}"} ${h.hist[i]}`));
  out.push(`reportwright_http_request_duration_seconds_bucket{le="+Inf"} ${h.n}`, `reportwright_http_request_duration_seconds_sum ${h.sum}`, `reportwright_http_request_duration_seconds_count ${h.n}`);
  metric('reportwright_uptime_seconds', 'gauge', 'Process uptime.', [['', Math.round(process.uptime())]]);
  // every family again under its old name pagewright_* (deprecated 0.13.2, gone in 1.0): dashboards and alerts keep working
  const old = out.map(l => l.replace(/^(# (?:HELP|TYPE) )?reportwright_/, '$1pagewright_'));
  return [...out, ...old].join('\n') + '\n';
}
