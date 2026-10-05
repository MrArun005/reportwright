// The Overview's numbers, read from what the server already records (read-only; nothing here is made up):
//  - renders and exports: the audit log (report.render: server renders by API, server link, batch and schedule, with
//    their page count; report.export: files a viewer exported in the browser). Admins see everyone's, others their own.
//  - render times, outcomes and the queue: the render pool's counters (src/server/pool.js), since this server started.
//  - schedules: src/server/schedules.js, as the Schedules page lists them.
//  - health: the same checks as /api/v1/readyz, plus the scheduler and batch worker timers.
import { queryAudit } from '@/server/audit.js';
import { poolStats, warmPool } from '@/server/pool.js';
import { store } from '@/server/storage/index.js';
import { blobs } from '@/server/blobs.js';
import { principalId } from '@/server/perms.js';

const DAY = 86400000;
const LIMIT = 10000;
export const RANGES = [7, 30, 90];
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms).unref?.())]);

/** Monday of a YYYY-MM-DD day (UTC). */
const weekOf = (d) => { const t = Date.parse(`${d}T00:00:00Z`); return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY); };

/**
 * @param {{ p: any, all: boolean, days: number, by: 'day'|'week' }} o
 * all: every user's events (admins); else the principal's own.
 */
export async function activity({ p, all, days, by }) {
  const today = Date.parse(`${iso(Date.now())}T00:00:00Z`);
  const start = iso(today - (days - 1) * DAY), prevStart = iso(today - (2 * days - 1) * DAY);
  const q = { from: prevStart, to: iso(today), limit: LIMIT, ...(all ? {} : { actor: principalId(p) }) };
  const [renders, exports] = await Promise.all([queryAudit({ ...q, type: 'report.render' }), queryAudit({ ...q, type: 'report.export' })]);
  const truncated = renders.length >= LIMIT || exports.length >= LIMIT;
  const dayKeys = Array.from({ length: days }, (_, i) => iso(today - (days - 1 - i) * DAY));
  const keys = by === 'week' ? [...new Set(dayKeys.map(weekOf))] : dayKeys;
  const keyOf = by === 'week' ? weekOf : (d) => d;
  const blank = () => Object.fromEntries(keys.map(k => [k, 0]));
  const series = { generated: blank(), pages: blank() }, daily = { generated: {}, pages: {}, scheduled: {} };
  const cur = { generated: 0, pages: 0, scheduled: 0, failed: 0 }, prev = { generated: 0, pages: 0, scheduled: 0 };
  const recent = [];
  for (const e of [...renders, ...exports]) {
    const d = e.at.slice(0, 10), now = d >= start;
    const pages = e.type === 'report.render' && e.format === 'pdf' ? Number(e.detail?.pages) || 0 : 0;
    const sched = e.detail?.via === 'schedule';
    const t = now ? cur : prev;
    t.generated++; t.pages += pages; if (sched) t.scheduled++;
    if (!now) continue;
    if (e.status && e.status !== 'ok') cur.failed++;
    series.generated[keyOf(d)]++; series.pages[keyOf(d)] += pages;
    for (const [k, v] of [['generated', 1], ['pages', pages], ['scheduled', sched ? 1 : 0]]) daily[k][d] = (daily[k][d] || 0) + v;
    recent.push(e);
  }
  recent.sort((a, b) => (a.at < b.at ? 1 : -1));
  const spark = (k) => dayKeys.map(d => daily[k][d] || 0);
  return {
    start, end: iso(today), keys, truncated, cur, prev,
    series: { generated: keys.map(k => series.generated[k]), pages: keys.map(k => series.pages[k]) },
    spark: { generated: spark('generated'), pages: spark('pages'), scheduled: spark('scheduled') },
    recent: recent.slice(0, 8),
  };
}

/** Render pool counters since this server started. */
export function renderStats() {
  const s = poolStats();
  const failed = (s.totals.failed || 0) + (s.totals.timedOut || 0) + (s.totals.crashed || 0);
  // the histogram is cumulative (le buckets): per-bucket counts for the small distribution chart
  const per = s.durations.counts.map((c, i) => c - (s.durations.counts[i - 1] || 0));
  return {
    avgMs: s.durations.count ? (s.durations.sum / s.durations.count) * 1000 : null, timed: s.durations.count,
    buckets: s.durations.buckets, per, done: s.totals.done || 0, failed,
  };
}

/** Real checks, as /api/v1/readyz makes them, and whether this process runs the scheduler and the batch worker. */
export async function health() {
  const g = /** @type {any} */ (globalThis);
  let storage = true, storageNote = '';
  try { await within(store().get('settings', 'server'), 3000); } catch (e) { storage = false; storageNote = e.message; }
  warmPool(); // as readyz: a server that has not rendered yet starts its workers
  const s = poolStats(), w = s.workers;
  const waiting = s.queue.interactive + s.queue.background;
  const kind = (process.env.PW_STORAGE || 'file').split(':')[0];
  // PW_CRON: how often an outside cron calls this server (e.g. Vercel's daily /api/v1/cron) when its own timers are off
  const cron = process.env.PW_CRON ? `cron:${process.env.PW_CRON}` : '';
  return {
    checks: [
      // no worker pool (PW_RENDER_WORKERS=0, or threads cannot run here): renders run in the request, a neutral state
      (w.inline || !w.size) ? { id: 'engine', state: 'off', label: 'inline', note: 'inline' } : { id: 'engine', state: w.ready > 0 ? 'ok' : 'down', note: `${w.ready}/${w.size}` },
      { id: 'queue', state: waiting >= s.queue.max * 0.8 ? 'warn' : 'ok', note: String(waiting) },
      { id: 'storage', state: storage ? 'ok' : 'down', note: storage ? kind : storageNote },
      { id: 'scheduler', state: process.env.PW_SCHEDULER === 'off' ? 'off' : g.__pwSched?.timer ? 'ok' : 'down', note: process.env.PW_SCHEDULER === 'off' ? cron : '' },
      { id: 'worker', state: process.env.PW_WORKER === 'off' ? 'off' : g.__pwQueue?.started ? 'ok' : 'down', note: process.env.PW_WORKER === 'off' ? cron : '' },
    ],
  };
}

/** What the outputs store holds (batch and schedule files); null when it does not answer within 2 s. */
export async function storageUse() {
  try {
    const list = await within(blobs().list(''), 2000);
    return { bytes: list.reduce((n, b) => n + (Number(b.size) || 0), 0), files: list.length, kind: (process.env.PW_STORAGE || 'file').split(':')[0] };
  } catch { return null; }
}
