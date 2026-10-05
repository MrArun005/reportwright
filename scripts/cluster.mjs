#!/usr/bin/env node
// Run several Pagewright server processes on one machine, sharing one port (node:cluster), for throughput: one Next.js
// request thread per process instead of one in all. Build first (npm run build), then:
//   node scripts/cluster.mjs [-p 3000] [-H 0.0.0.0]
// PW_CLUSTER_PROCESSES   processes (default: a quarter of the cores, at least 2)
// PW_RENDER_WORKERS      render threads per process; default: each process gets its share of the cores (PW_CPUS) and
//                        of the memory (PW_MEMORY_LIMIT_MB: the cgroup limit or the RAM), and src/server/pool.js sizes
//                        its workers from those, so processes + render threads ≈ cores and their heaps fit the memory
// Everything else is the same environment as `next start`. The processes share the storage (PW_STORAGE: files on this
// database; file storage only with one process) and so the queue, the scheduler (one leader), locks, sessions and the audit log (one chained
// stream each). The primary only forks and restarts processes; the kernel spreads connections across them.
// PW_AUTH=users needs one PW_SESSION_SECRET for all of them: outside production a random one is made here and shared.
import cluster from 'node:cluster';
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const ROOT = path.join(import.meta.dirname, '..');
const { values } = parseArgs({ options: { port: { type: 'string', short: 'p' }, hostname: { type: 'string', short: 'H' } }, allowPositionals: true });
const port = Number(values.port || process.env.PORT || 3000);
const host = values.hostname || process.env.HOSTNAME || undefined;
process.env.NODE_ENV ||= 'production';

if (cluster.isPrimary) {
  const cores = os.availableParallelism?.() || os.cpus().length;
  const n = Math.max(1, Number(process.env.PW_CLUSTER_PROCESSES) || Math.max(2, Math.round(cores / 4)));
  // file storage keeps users, grants and settings in whole-file JSON arrays with an in-process lock: several processes
  // would lose each other's writes. A database (or one process) only.
  if (n > 1 && (!process.env.PW_STORAGE || process.env.PW_STORAGE === 'file')) {
    console.error('[pagewright] cluster: several processes need a database for storage (PW_STORAGE=sqlite:/path/pw.db, postgres://…, mysql://… or mssql://…); file storage is safe for one process only. Move the data with: node bin/pw.mjs migrate-storage --to <url>. Or set PW_CLUSTER_PROCESSES=1.');
    process.exit(1);
  }
  let memMB = Number(process.env.PW_MEMORY_LIMIT_MB) || os.totalmem() / 1048576;
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) { // cgroup v2, v1
    try { const n = Number(fs.readFileSync(f, 'utf8').trim()); if (n > 0 && n < 2 ** 60) { memMB = Math.min(memMB, n / 1048576); break; } } catch { /* not there */ }
  }
  if (process.env.PW_AUTH === 'users' && !process.env.PW_SESSION_SECRET && process.env.NODE_ENV !== 'production') process.env.PW_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  const env = { PW_CPUS: String(Math.max(2, Math.floor(cores / n))), PW_MEMORY_LIMIT_MB: String(Math.floor(memMB / n)), PW_CLUSTER: '1' };
  console.log(`[pagewright] cluster: ${n} processes, each with ${env.PW_CPUS} cores and ${env.PW_MEMORY_LIMIT_MB} MB for its render threads${process.env.PW_RENDER_WORKERS ? ` (${process.env.PW_RENDER_WORKERS} each)` : ''}, port ${port}`);
  let stopping = false;
  const starts = [];
  const fork = () => { starts.push(Date.now()); cluster.fork(env); };
  for (let i = 0; i < n; i++) fork();
  cluster.on('exit', (w, code, signal) => {
    if (stopping) return;
    // a process that died is replaced; ten deaths in a minute is a crash loop: stop rather than spin
    const recent = starts.filter(t => t > Date.now() - 60000);
    if (recent.length >= n + 10) { console.error('[pagewright] cluster: processes keep dying; stopping.'); process.exit(1); }
    console.warn(`[pagewright] cluster: process ${w.process.pid} exited (${signal || code}); starting another`);
    setTimeout(fork, 500);
  });
  const stop = (sig) => { stopping = true; for (const w of Object.values(cluster.workers || {})) w?.process.kill(sig); setTimeout(() => process.exit(0), 10000).unref(); };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  // the primary leaves when every process has
  cluster.on('exit', () => { if (stopping && !Object.keys(cluster.workers || {}).length) process.exit(0); });
} else {
  const next = (await import('next')).default;
  const app = next({ dev: false, dir: ROOT, hostname: host || 'localhost', port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const server = http.createServer((req, res) => handle(req, res));
  server.keepAliveTimeout = 65000;
  server.listen(port, host);
}
