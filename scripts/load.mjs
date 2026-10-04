// Load stress for the render API: concurrent POST /api/v1/render at rising concurrency.
//   BASE=http://localhost:3200 KEY=test-key node scripts/load.mjs [template=sales-explorer] [format=pdf] [levels=1,8,32,64] [perLevel=64]
import { execFileSync } from 'node:child_process';
const BASE = process.env.BASE || 'http://localhost:3200';
const KEY = process.env.KEY || 'test-key';
const [template = 'sales-explorer', format = 'pdf', levels = '1,8,32,64', perLevel = '64'] = process.argv.slice(2);
const params = { 'sales-explorer': { year: 2026 }, 'sales-city': { city: 'Pune' }, 'loan-statement': { accountId: 'LN-2026-004417' } }[template] || {};

// the server's memory: the next-server process listening on the port
const port = new URL(BASE).port;
const serverRss = () => { try { const pid = execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN']).toString().trim().split('\n')[0]; return Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', pid]).toString().trim()) / 1024); } catch { return NaN; } };

async function one() {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/api/v1/render`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ template, format, parameters: params }) });
    const body = await res.arrayBuffer();
    return { ms: performance.now() - t0, ok: res.ok, status: res.status, bytes: body.byteLength, err: res.ok ? null : new TextDecoder().decode(body).slice(0, 200) };
  } catch (e) { return { ms: performance.now() - t0, ok: false, status: 0, err: e.message }; }
}
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

console.log(`${template} → ${format}, ${perLevel} requests per level`);
console.log('conc   ok  fail   req/s    p50    p95    max   server MB');
for (const c of levels.split(',').map(Number)) {
  const n = Number(perLevel);
  let next = 0;
  const results = [];
  const t0 = performance.now();
  let peak = serverRss();
  const watch = setInterval(() => { peak = Math.max(peak, serverRss()); }, 250);
  await Promise.all(Array.from({ length: c }, async () => { while (next < n) { next++; results.push(await one()); } }));
  clearInterval(watch);
  const secs = (performance.now() - t0) / 1000;
  const ms = results.filter(r => r.ok).map(r => r.ms).sort((a, b) => a - b);
  const fails = results.filter(r => !r.ok);
  const f = (v) => String(Math.round(v ?? 0)).padStart(6);
  console.log(`${String(c).padStart(4)} ${String(ms.length).padStart(4)} ${String(fails.length).padStart(5)} ${(ms.length / secs).toFixed(1).padStart(7)} ${f(pct(ms, 50))} ${f(pct(ms, 95))} ${f(ms.at(-1))}   ${String(peak).padStart(6)}`);
  if (fails.length) console.log('       first failure:', fails[0].status, fails[0].err);
}
