# Server under load: the render pool

5 Oct 2026. What changed in the server (`src/server/pool.js`) and what the pw-load harness (`~/pw-load`, `node load.mjs --part=server`) measured before and after.

## What changed

- **Every server render runs in a pool of worker threads** (`PW_RENDER_WORKERS`, default cores − 1, at most 8): `POST /api/v1/render`, `GET /api/reports/<id>/pdf`, batch items (and so schedules), thumbnails. The request thread authorises, queues and answers; the bytes come back from the worker by transfer, not by copy. Each worker loads fonts and HarfBuzz once.
- **The template is read and checked in the worker** as the caller's principal, with the same code (`loadTemplate`, `readRunnable`); `renderTo` runs unchanged there, so every data-fetch guard (`serverFetch`, `strictUrl`, fixed hosts, internal hosts, the saved-SQL stamp) applies as before. The routes also run the cheap checks on the request thread first (view access, inline definitions and pushed data need a designer), so a refused render never takes a place in the queue.
- **Hard deadline**: `PW_RENDER_TIMEOUT_MS` now covers template read, data fetch, layout and export. At the limit the worker is terminated (504) and replaced. A crashed or out-of-memory worker (`PW_RENDER_WORKER_HEAP_MB`) fails only its own render. Workers are recycled after `PW_RENDER_WORKER_MAX_RENDERS` renders or above `PW_RENDER_WORKER_RECYCLE_MB` of heap.
- **Admission control**: a bounded queue (503), a per-principal share (429), an estimated-wait limit (503), all with `Retry-After`, answered before the request body is read. Interactive renders go before batch items and thumbnails. Users take turns (round robin), and a user with nothing queued or running is always let in, so one user's backlog cannot shut others out.
- `GET /api/v1/health`: workers, queue depth, estimated wait, totals.
- Audit lines are appended in groups (one write per file per group), and service keys and admins skip reading every grant in `checkReport`. Both were measurable on the request thread.
- Build: `scripts/build-worker.mjs` bundles the worker into `pw-worker/`. Production (`next start`, the standalone output in Docker) runs that bundle; `next dev` and the tests run the sources. The worker is started from an eval bootstrap, so Turbopack does not trace it.

## Results

Same harness, same templates (data inline), same client (closed loop, 30 s stages, retries at once after an error, ignores `Retry-After`). Apple M2, 8 GB. **Neither run had a quiet machine**: other agents ran builds, e2e and test suites alongside, with 1-minute load averages of 7 to 105 (⚠ on every row of `~/pw-load/load-results.md`). Read differences under 1.5× as noise. Jasper was measured in the same run as the "after" column, right after Pagewright.

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
