// Two servers, one shared storage (ROADMAP week 10 proof): a batch survives the server running it, and a schedule
// runs once per minute with one scheduler for both, which moves when its server stops. Takes about 3 minutes.
// Needs a production build (npm run build). It starts and stops its own servers on ports 3401 and 3402.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';

const root = path.join(import.meta.dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-replicas-'));
const env = { ...process.env, NODE_ENV: 'production', PW_STORAGE: `sqlite:${path.join(tmp, 'store.db')}`, PW_API_KEYS: 'test-key', PW_JOB_LEASE_MS: '4000', PW_QUEUE_POLL_MS: '500', PW_SCHEDULER_TICK_MS: '2000', PW_SCHEDULER_LEASE_MS: '6000' };
const H = { authorization: 'Bearer test-key', 'content-type': 'application/json' };
const step = (s) => console.log('·', s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const servers = {};
const start = async (port) => {
  const p = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)], { cwd: root, env, stdio: 'ignore' });
  servers[port] = p;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://localhost:${port}/api/v1/templates`, { headers: H })).ok) return; } catch { /* starting */ } await sleep(250); }
  throw new Error(`server ${port} did not start`);
};
const stop = (port) => { servers[port]?.kill('SIGKILL'); delete servers[port]; };
const job = async (port, id) => (await fetch(`http://localhost:${port}/api/v1/batches/${id}`, { headers: H })).json();
process.on('exit', () => { for (const p of Object.values(servers)) p.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); });

try {
  await Promise.all([start(3401), start(3402)]);
  const N = 96; // enough that A cannot finish between two polls (24 did, once renders got faster)
  step(`a ${N}-item batch starts on server A; A is killed half-way; B finishes it`);
  const { sampleLoan } = await import(path.join(root, 'src/sample/loans.js'));
  const loans = sampleLoan('LN-2026-004417');
  // a fresh shared store has no saved reports: send the definition with the batch
  const template = JSON.parse(fs.readFileSync(path.join(root, 'reports/loan-statement.pw.json'), 'utf8'));
  const items = Array.from({ length: N }, (_, i) => ({ name: `statement-${i + 1}`, parameters: { accountId: 'LN-2026-004417' }, data: { loans } }));
  const created = await (await fetch('http://localhost:3401/api/v1/batches', { method: 'POST', headers: H, body: JSON.stringify({ template, format: 'pdf', items }) })).json();
  assert.ok(created.id, JSON.stringify(created));
  let j;
  for (let i = 0; i < 400; i++) { j = await job(3402, created.id); if (j.done >= 4) break; await sleep(100); }
  assert.ok(j.done >= 4 && j.done < N, `A should be part-way, got ${j.done}`);
  stop(3401);
  const doneByA = j.done;
  for (let i = 0; i < 600; i++) { j = await job(3402, created.id); if (j.status !== 'running' && j.status !== 'queued') break; await sleep(200); }
  assert.equal(j.status, 'completed', JSON.stringify(j.errors));
  assert.equal(j.done, N);
  const by = new Set(j.results.map(r => r.by.split(':').slice(0, 2).join(':')));
  assert.equal(by.size, 2, 'both servers rendered items');
  assert.equal(new Set(j.results.map(r => r.index)).size, N, 'no item twice');
  const zip = unzipSync(new Uint8Array(await (await fetch(`http://localhost:3402/api/v1/batches/${created.id}/download`, { headers: H })).arrayBuffer()));
  assert.equal(Object.keys(zip).length, N);
  console.log(`  A rendered ${doneByA} before it was killed; B rendered the other ${N - doneByA}; the zip has ${N} PDFs`);

  step('a schedule every minute, two servers: one run per minute, and the scheduler moves when its server stops');
  await start(3401);
  const s = await (await fetch('http://localhost:3401/api/v1/schedules', { method: 'POST', headers: H, body: JSON.stringify({ template, cron: '* * * * *', format: 'json', items: [{ parameters: { accountId: 'LN-2026-004417' }, data: { loans } }] }) })).json();
  const runs = async () => (await (await fetch('http://localhost:3402/api/v1/batches', { headers: H })).json()).filter(b => b.schedule?.id === s.id);
  const waitRuns = async (n) => { for (let i = 0; i < 90; i++) { if ((await runs()).length >= n) return; await sleep(1000); } };
  await waitRuns(1);
  await sleep(5000); // both servers ticked several times in that minute
  assert.equal((await runs()).length, 1, 'one run, not one per server');
  // stop whichever server leads now; the other must take over and run the next minute
  stop(3401); stop(3402);
  await start(3402);
  await waitRuns(2);
  const r = await runs();
  assert.equal(r.length, 2, 'the next minute ran on the remaining server');
  assert.ok(new Set(r.map(x => x.createdAt.slice(0, 16))).size === 2, 'one run per minute');
  console.log('PASS replicas');
} finally {
  for (const p of Object.keys(servers)) stop(p);
}
