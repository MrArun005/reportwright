#!/usr/bin/env node
// Uptime and error-rate check (docs/OPS.md): /api/v1/readyz must answer 200 within 10 s (two tries), and with a
// service key (PW_MONITOR_KEY) the share of 5xx answers in /api/v1/metrics must stay under PW_MAX_5XX (default 0.05).
// Exits 1 with the reason on stdout. The GitHub Actions workflow .github/workflows/uptime.yml runs it on a schedule.
//   BASE=https://reports.example.com PW_MONITOR_KEY=… node scripts/uptime-check.mjs
const base = (process.env.BASE || '').replace(/\/$/, '');
if (!base) { console.log('set BASE'); process.exit(2); }
const problems = [];
const get = (p, headers = {}) => fetch(base + p, { headers, signal: AbortSignal.timeout(10000) });

let ready = null;
for (let i = 0; i < 2 && !ready?.ok; i++) ready = await get('/api/v1/readyz').catch((e) => ({ ok: false, status: e.message }));
if (!ready?.ok) problems.push(`${base}/api/v1/readyz: ${ready?.status}`);

if (process.env.PW_MONITOR_KEY) {
  // ponytail: the counters are per server process since it started (one serverless instance's view); a metrics
  // backend (Prometheus, Grafana Cloud free tier) is the upgrade for a rate over time across instances
  const r = await get('/api/v1/metrics', { authorization: `Bearer ${process.env.PW_MONITOR_KEY}` }).catch((e) => ({ ok: false, status: e.message }));
  if (!r.ok) problems.push(`${base}/api/v1/metrics: ${r.status}`);
  else {
    let all = 0, bad = 0;
    const text = await r.text(), name = /^reportwright_http/m.test(text) ? 'reportwright' : 'pagewright'; // a server before 0.13.2: the old name only
    for (const m of text.matchAll(new RegExp(String.raw`^${name}_http_requests_total\{[^}]*status="(\w+)"[^}]*\} (\d+)`, 'gm'))) { all += +m[2]; if (m[1].startsWith('5')) bad += +m[2]; }
    const max = Number(process.env.PW_MAX_5XX || 0.05);
    if (all >= 20 && bad / all > max) problems.push(`5xx answers: ${bad} of ${all} (${(100 * bad / all).toFixed(1)}%, limit ${100 * max}%)`);
  }
}
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`ok: ${base}`);
