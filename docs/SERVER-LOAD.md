# Server under load: the render pool

5 Oct 2026. What changed in the server (`src/server/pool.js`) and what the pw-load harness (`~/pw-load`, `node load.mjs --part=server`) measured before and after.

## What changed

- **Every server render runs in a pool of worker threads** (`PW_RENDER_WORKERS`, default cores − 1, at most 16: cores and memory come from the container's cgroup limits when there are any (else the machine), or `PW_CPUS` / `PW_MEMORY_LIMIT_MB`). *Updated 8 Oct 2026 (docs/research/STREAMING-1M.md §8):* the pool used to reserve a 1 GB heap for every worker, so memory, not cores, set the worker count (4 workers on 8 cores / 8 GB). Now the cores set it, and memory sets what runs at once: only as many workers as 70% of the memory (less 512 MB for the request thread) holds big heaps for get the big heap `PW_RENDER_WORKER_HEAP_MB` (default **1024**, doubled up to 2048 after a render ran out of it, at most half the memory); the others get `PW_RENDER_SMALL_HEAP_MB` (default 192). Each render is admitted by a memory estimate, never taken from the request: a render bound for a small worker (a stream, a thumbnail, or a template this principal rendered small before) is charged the small heap, the most it can hold; any other render its template's measured peak for this principal (biased up, clamped to [32 MB, the big heap]), else the whole big heap. Estimates are kept per principal and template, so one user's renders cannot lower or raise another's. A render waits while the running renders' estimates leave no room for it. Streams and renders known to be small run in the small heaps; one that runs out of a small heap runs again, once, in a big one. While resident memory is above 85% of the limit a new render waits for a running one (never all of them). Sharing the fonts (SharedArrayBuffer) and the compiled HarfBuzz modules between workers was tried and measured: no saving (6 idle workers +461–475 MB either way, ~78 MB each); a worker's fixed cost is its own copy of the engine's code and of fontkit's parsed tables, not the font bytes, so it was left out. `UV_THREADPOOL_SIZE` (the Dockerfile and `scripts/cluster.mjs` set it to the cores) keeps the workers' PDF compression from queueing on libuv's default 4 threads. `poolStats().memory` and `/api/v1/metrics` show the plan: `POST /api/v1/render`, `GET /api/reports/<id>/pdf`, batch items (and so schedules), thumbnails. The request thread authorises, queues and answers; the bytes come back from the worker by transfer, not by copy. Each worker loads fonts and HarfBuzz once.
- **The template is read and checked in the worker** as the caller's principal, with the same code (`loadTemplate`, `readRunnable`); `renderTo` runs unchanged there, so every data-fetch guard (`serverFetch`, `strictUrl`, fixed hosts, internal hosts, the saved-SQL stamp) applies as before. The routes also run the cheap checks on the request thread first (view access, inline definitions and pushed data need a designer), so a refused render never takes a place in the queue.
- **Hard deadline**: `PW_RENDER_TIMEOUT_MS` now covers template read, data fetch, layout and export. At the limit the worker is terminated (504) and replaced. A crashed or out-of-memory worker (`PW_RENDER_WORKER_HEAP_MB`) fails only its own render. Workers are recycled after `PW_RENDER_WORKER_MAX_RENDERS` renders or above `PW_RENDER_WORKER_RECYCLE_MB` of heap.
- **Admission control**: a bounded queue (503), a per-principal share (429), an estimated-wait limit (503), all with `Retry-After`, answered before the request body is read. Interactive renders go before batch items and thumbnails. Users take turns (round robin), and a user with nothing queued or running is always let in, so one user's backlog cannot shut others out.
- `GET /api/v1/health`: workers, queue depth, estimated wait, totals.
- Audit lines are appended in groups (one write per file per group), and service keys and admins skip reading every grant in `checkReport`. Both were measurable on the request thread.
- Build: `scripts/build-worker.mjs` bundles the worker into `pw-worker/`. Production (`next start`, the standalone output in Docker) runs that bundle; `next dev` and the tests run the sources. The worker is started from an eval bootstrap, so Turbopack does not trace it.

## Results

Same harness, same templates (data inline), same client (closed loop, 30 s stages, retries at once after an error, ignores `Retry-After`). Apple M2, 8 GB. **Neither run had a quiet machine**: other agents ran builds, e2e and test suites alongside, with 1-minute load averages of 7 to 105 (⚠ on every row of `~/pw-load/load-results.md`). Read differences under 1.5× as noise. Jasper was measured in the same run as the "after" column, right after ReportWright.

| workload | VUs | before (834e31f) req/s | after (fc62422) req/s | Jasper, same run as after |
|---|---:|---:|---:|---:|
| invoice | 1 | 69 | 194 | 153 |
| invoice | 10 | 94 | 348 | 1,731 |
| invoice | 50 | 109 | 282 | 1,895 |
| invoice | 200 | 109 (1,002 resets) | 178 (8,270 × 429, 153 resets) | 1,215 |
| grouped 2,000 rows | 1 | 4.6 | 15.4 | 8.3 |
| grouped 2,000 rows | 10 | 4.7 | 39.1 | 26.2 |
| grouped 2,000 rows | 50 | 4.1 | 50.6 | 23.5 |
| grouped 2,000 rows | 200 | 2.9 (38,181 resets) | 33.6 (9,545 × 429, 114 resets) | 18.6 |

The server's CPU went from at most 1.5 cores to 4.7 to 6.2 cores.

Stall test (a probe renders the invoice every 100 ms, beside background renders):

| phase | probe p50 before | p50 after | probe max before | max after |
|---|---:|---:|---:|---:|
| alone | 15.6 | 13.5 | 32 | 36 |
| 1 user, 2,000-row PDF | 107 | 6.8 | 339 | 33 |
| 4 users, 2,000-row PDF | 741 | 15.7 | 1,050 | 160 |
| 1 user, 25,000-row PDF | 2,593 | 8.9 | 2,910 | 60 |

Event-loop delay with the 25,000-row export running: at most 2,775 ms before, 18.5 ms after.

Soak (300 s mixed load): 0 failures. The request thread's live heap after a full GC was 59.8 MB before the soak and 60.8 MB after, and RSS held at 856 to 897 MB per minute. No leak in 5 minutes. The probe sees only the request thread's heap. Workers are bounded by recycling and their heap limit.

## Reading it

- **The grouped report is above Jasper** at every concurrency (39 vs 26 req/s at 10 users, 51 vs 24 at 50). Big renders no longer stall anyone: the probe stays at single-digit milliseconds beside a 25,000-row export.
- **Overload is answered, not reset.** At 200 users of one API key, the renders over that key's share get 429 with `Retry-After`. The harness retries at once, so the 429 count is a retry storm, not 8,270 clients. The remaining connection resets (about 150 per stage) all come at the stage's first instant, when 200 connections open at once. macOS caps the listen backlog at 128 (`kern.ipc.somaxconn`), and a plain Node `http` server with a 20 ms handler resets 170 of 300 such connects on this machine too. Linux's default backlog of 4,096 does not do this.
- **The one-page invoice is still 4 to 6 times behind Jasper.** It is now limited by the request thread, not by rendering. A profile at about 485 req/s showed the thread 88% busy, about 1.8 ms per request, most of it Next.js routing, middleware and response handling. The workers had cores to spare. The next step is more than one server process: Node cluster, or several `next start` instances behind the proxy. Batches and schedules already coordinate across replicas with leases. With it, small-document throughput would scale with processes.
- A single API key used by a busy front end may need a larger `PW_RENDER_QUEUE_PER_PRINCIPAL` than the default 8 per worker.
- Saved SQL from `/api/data/sql` stays on the request thread: it waits on the database, it does not compute. SQL inside a render runs in the worker.
- Streaming: the PDF goes out as one buffer moved from the worker without a copy, as soon as it is made. Writing it page by page needs the exporter changes in `docs/PDF-STREAMING-PLAN.md`.

## Batch 5: cluster mode (`scripts/cluster.mjs`)

The same harness (`~/pw-load/load.mjs`, server part, invoice and grouped only, 30 s stages, API key in one principal),
on the same 8-core M2 with 8 GB, which was busy with other work throughout (load average 6 to 65, every row flagged).
"Before" is the copy at `085fd69` with `next start`; "after" is `4f5be54` (the batch 5 code: two-factor, the audit
chain and its write queue, snapshots off by default) with `next start`, then with `scripts/cluster.mjs` at 2 and 4
processes (render threads per process: the default, 3 and 1). Server CPU counts the whole process tree.

| workload | VUs | before req/s | after, 1 process | after, cluster 2 | after, cluster 4 |
|---|---:|---:|---:|---:|---:|
| invoice | 1 | 140 | 203 | 157 | 120 |
| invoice | 10 | 372 | 478 | 473 | 252 |
| invoice | 50 | 411 | 393 | 465 | 301 |
| invoice | 200 | 301 (65% × 429) | 314 (1% neterr) | 428 (30% × 429) | 235 (82% × 429) |
| grouped 2,000 rows | 1 | 20.5 | 19.0 | 20.3 | 19.6 |
| grouped 2,000 rows | 10 | 36.2 | 44.0 | 49.7 | 44.6 |
| grouped 2,000 rows | 50 | 25.8 | 49.0 | 48.5 | 40.2 |
| grouped 2,000 rows | 200 | 23.3 | 40.2 | 32.7 | 21.7 |

p50 at 50 VUs, invoice: 123 ms (1 process), 98 ms (cluster 2). Server CPU in those stages: about 5 cores for one process,
6.5 for cluster 2 (of 8, with the load generator on the same machine).

Reading it:
- **Two processes** give the invoice 13 to 18% more at 50 users (465 against 411 before and 393 with one process) and 36
  to 42% more at 200, with lower latency; the grouped report is unchanged (it is render-bound, and the render threads
  were already busy). That is the default for 8 cores. The noise on this machine is about ±15% between runs, so read
  these as direction, not as exact gains.
- **Four processes are worse here:** one render thread each, and the machine had no idle cores left (the load generator,
  the other processes and the noise above use them). On a dedicated server with more cores, raise
  `PW_CLUSTER_PROCESSES` and keep processes + render threads ≈ cores.
- The invoice is no longer bound by one request thread but by the machine: about 6.5 of 8 cores were in use. Jasper's
  1,700 to 1,900 req/s for this one-page PDF were measured on the same machine when it was quieter; closing that gap
  needs cheaper rendering of small documents (or the snapshot cache, when a TTL is acceptable), not more processes.
- The 429s at 200 users are the one API key's fair share per process (`PW_RENDER_QUEUE_PER_PRINCIPAL`), as before.
