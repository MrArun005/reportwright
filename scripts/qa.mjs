#!/usr/bin/env node
// The QA suite, from one command (docs/QA.md). Zero dependencies; talks to GitHub through the `gh` CLI.
//   npm run qa -- <suites|all> [--ref X] [--tier quick|full] [--no-wait]
//       dispatches .github/workflows/qa.yml, follows the run, prints every suite's table, exits 1 on any FAIL
// The workflows use the same file for their checks (the contract in docs/QA.md):
//   node scripts/qa.mjs check <suite> <check> <expected> <command> [--warn]   run a shell command, record PASS/FAIL (WARN with --warn)
//   node scripts/qa.mjs skip|fail <suite> <check> <reason>                    record a SKIP (or a FAIL: a job step outside the checks failed)
//   node scripts/qa.mjs summarize <suite> [dir] [--no-fail]                   qa-out/*.jsonl (and dir's) -> results.json, summary.md, step summary
//   node scripts/qa.mjs aggregate <dir> <outDir>                              every results.json under dir -> one report (summary.md, results.json, report.html)
//   node scripts/qa.mjs sample-server <port>                                  the app's /api/sample/* data, for rendering the repository's reports without the app
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const SUITES = ['correctness', 'conformance', 'compat', 'pdf-libs', 'engines', 'rival-best', 'stress', 'load', 'security'];
const OUT = process.env.QA_OUT || 'qa-out';
const [cmd, ...rest] = process.argv.slice(2);
const flag = (k) => { const i = rest.indexOf(k); if (i < 0) return undefined; const v = rest[i + 1]; rest.splice(i, 2); return v; };
const bool = (k) => { const i = rest.indexOf(k); if (i < 0) return false; rest.splice(i, 1); return true; };
const trim = (s, n = 160) => { const t = String(s || '').replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').filter(Boolean).slice(-3).join(' / '); return t.length > n ? '…' + t.slice(-n) : t; };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function record(r) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.appendFileSync(path.join(OUT, `${r.suite}-${process.env.QA_SHARD || 'main'}.jsonl`), JSON.stringify(r) + '\n');
  console.log(`${r.result} ${r.suite} / ${r.check}${r.ms != null ? ` (${r.ms} ms)` : ''}`);
}

function table(suite, rows) {
  const n = (k) => rows.filter(r => r.result === k).length;
  return [`### ${suite}`, '', '| Check | Command | Expected | Actual (trimmed) | Result |', '|---|---|---|---|---|',
    ...rows.map(r => `| ${cell(r.check)} | \`${cell(r.command).slice(0, 120)}\` | ${cell(r.expected)} | ${cell(r.actual)} | ${r.result} |`), '',
    `SUITE ${suite}: ${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('WARN')} WARN, ${n('SKIP')} SKIP`, ''].join('\n');
}

function readJsonl(dirs) {
  const rows = [];
  for (const d of dirs) if (fs.existsSync(d)) for (const f of fs.readdirSync(d, { recursive: true })) {
    if (String(f).endsWith('.jsonl')) for (const l of fs.readFileSync(path.join(d, String(f)), 'utf8').split('\n')) if (l.trim()) rows.push(JSON.parse(l));
  }
  return rows;
}

const stepSummary = (md) => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); };

if (cmd === 'check') {
  const warn = bool('--warn');
  const [suite, check, expected, command] = rest;
  const t = Date.now();
  const r = spawnSync(process.env.QA_BASH || 'bash', ['-o', 'pipefail', '-c', command], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  const ok = r.status === 0;
  record({ suite, check, command, expected, actual: ok ? trim(out) || 'exit 0' : `exit ${r.status ?? r.signal}: ${trim(out)}`, result: ok ? 'PASS' : warn ? 'WARN' : 'FAIL', ms: Date.now() - t });
} else if (cmd === 'skip' || cmd === 'fail') {
  const [suite, check, reason] = rest;
  record({ suite, check, command: '', expected: cmd === 'fail' ? 'the job runs its checks' : '', actual: reason, result: cmd.toUpperCase() });
} else if (cmd === 'summarize') {
  const noFail = bool('--no-fail');
  const [suite, dir] = rest;
  const rows = readJsonl([OUT, dir].filter(Boolean)).filter(r => r.suite === suite);
  const md = table(suite, rows);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(rows, null, 1));
  fs.writeFileSync(path.join(OUT, 'summary.md'), md);
  stepSummary(md);
  console.log(md);
  process.exit(!noFail && (rows.some(r => r.result === 'FAIL') || !rows.length) ? 1 : 0);
} else if (cmd === 'aggregate') {
  const [dir, outDir] = rest;
  const rows = [];
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []) if (path.basename(String(f)) === 'results.json') rows.push(...JSON.parse(fs.readFileSync(path.join(dir, String(f)), 'utf8')));
  const suites = [...new Set(rows.map(r => r.suite))];
  const count = (rs, k) => rs.filter(r => r.result === k).length;
  const board = ['## QA scoreboard', '', '| Suite | PASS | FAIL | WARN | SKIP |', '|---|---|---|---|---|',
    ...suites.map(s => { const rs = rows.filter(r => r.suite === s); return `| ${s} | ${count(rs, 'PASS')} | ${count(rs, 'FAIL')} | ${count(rs, 'WARN')} | ${count(rs, 'SKIP')} |`; }),
    `| **all** | ${count(rows, 'PASS')} | ${count(rows, 'FAIL')} | ${count(rows, 'WARN')} | ${count(rows, 'SKIP')} |`, ''].join('\n');
  const md = [board, ...suites.map(s => table(s, rows.filter(r => r.suite === s)))].join('\n');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(rows, null, 1));
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  fs.writeFileSync(path.join(outDir, 'report.html'), html(rows, suites));
  stepSummary(md);
  console.log(md);
} else if (cmd === 'sample-server') {
  const http = await import('node:http');
  const S = { ...(await import('../src/sample/loans.js')), ...(await import('../src/sample/sales.js')), ...(await import('../src/sample/stress.js')), ...(await import('../src/sample/hard.js')), ...(await import('../src/sample/torture.js')) };
  // ponytail: same routing as scripts/writer-parity.mjs sampleFetch (stress capped at 2,000 rows)
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname.split('/').slice(3), q = u.searchParams, cap = (v) => Math.min(2000, Number(v) || 2000);
    const data = p[0] === 'loans' ? (p[1] ? S.sampleLoan(decodeURIComponent(p[1])) : S.listSampleAccounts()) : p[0] === 'sales' ? S.sampleSales(p[1])
      : p[0] === 'stress' ? S.sampleStress(cap(p[1])) : p[0] === 'torture' ? S.sampleTorture()
        : p[0] === 'hard' ? (q.get('account') ? S.hardForAccount(S.sampleHard(cap(q.get('rows'))), q.get('account')) : S.sampleHard(cap(q.get('rows')))) : null;
    res.writeHead(data ? 200 : 404, { 'content-type': 'application/json' }).end(data ? JSON.stringify(data) : '{}');
  }).listen(Number(rest[0] || 3999), '127.0.0.1');
} else {
  if (cmd) rest.unshift(cmd);
  await dispatch();
}

function html(rows, suites) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const tone = { PASS: 'pass', FAIL: 'fail', WARN: 'warn', SKIP: 'skip' };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA report</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--pass:#1a7f37;--fail:#cf222e;--warn:#9a6700;--skip:#666}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--pass:#3fb950;--fail:#f85149;--warn:#d29922;--skip:#8b949e}}
body{margin:0;padding:16px 24px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}table{border-collapse:collapse;width:100%;margin:8px 0 24px}
td,th{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}code{font-size:12px;word-break:break-all}.pass{color:var(--pass)}.fail{color:var(--fail);font-weight:600}.warn{color:var(--warn)}.skip{color:var(--skip)}
</style></head><body><h1>QA report</h1><p>${new Date().toISOString()}</p><table><tr><th>Suite</th><th>PASS</th><th>FAIL</th><th>WARN</th><th>SKIP</th></tr>
${suites.map(s => { const rs = rows.filter(r => r.suite === s); return `<tr><td><a href="#${esc(s)}">${esc(s)}</a></td>${['PASS', 'FAIL', 'WARN', 'SKIP'].map(k => `<td class="${tone[k]}">${rs.filter(r => r.result === k).length}</td>`).join('')}</tr>`; }).join('')}</table>
${suites.map(s => `<h2 id="${esc(s)}">${esc(s)}</h2><table><tr><th>Check</th><th>Command</th><th>Expected</th><th>Actual</th><th>Result</th><th>ms</th></tr>${rows.filter(r => r.suite === s).map(r => `<tr><td>${esc(r.check)}</td><td><code>${esc(r.command)}</code></td><td>${esc(r.expected)}</td><td>${esc(r.actual)}</td><td class="${tone[r.result] || ''}">${esc(r.result)}</td><td>${r.ms ?? ''}</td></tr>`).join('')}</table>`).join('')}
</body></html>`;
}

async function dispatch() {
  const ref = flag('--ref') || '', tier = flag('--tier') || 'quick', noWait = bool('--no-wait');
  const suites = rest[0] || 'all';
  for (const s of suites === 'all' ? [] : suites.split(',')) if (!SUITES.includes(s)) { console.error(`unknown suite ${s}; one of ${SUITES.join(', ')} or all`); process.exit(2); }
  const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const branch = ref || gh('repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name').trim();
  const since = new Date(Date.now() - 5000).toISOString();
  // the workflow file runs from `branch` (qa.yml must exist there); `ref` is also what the suites check out
  gh('workflow', 'run', 'qa.yml', '--ref', branch, '-f', `suites=${suites}`, '-f', `ref=${ref}`, '-f', `tier=${tier}`);
  let id;
  for (let i = 0; i < 30 && !id; i++) {
    await sleep(3000);
    const runs = JSON.parse(gh('run', 'list', '--workflow', 'qa.yml', '--branch', branch, '--event', 'workflow_dispatch', '--limit', '5', '--json', 'databaseId,createdAt,url'));
    const r = runs.find(x => x.createdAt >= since);
    if (r) { id = r.databaseId; console.log(`run ${r.url}`); }
  }
  if (!id) { console.error('the run did not show up'); process.exit(1); }
  if (noWait) return;
  const TTY = process.stdout.isTTY, col = (s) => !TTY ? s : s.replace(/\b(PASS|FAIL|WARN|SKIP)\b/g, (m) => `\x1b[${{ PASS: 32, FAIL: 31, WARN: 33, SKIP: 90 }[m]}m${m}\x1b[0m`);
  for (;;) {
    const v = JSON.parse(gh('run', 'view', String(id), '--json', 'status,conclusion,jobs'));
    const by = {};
    for (const j of v.jobs) { const s = j.name.split(' / ')[0]; (by[s] ||= []).push(j); }
    console.log(`[${new Date().toLocaleTimeString()}] ${v.status}  ` + Object.entries(by).map(([s, js]) => `${s} ${js.filter(j => j.status === 'completed').length}/${js.length}${js.some(j => j.conclusion === 'failure') ? ' (failing)' : ''}`).join(' · '));
    if (v.status === 'completed') break;
    await sleep(30000);
  }
  const dir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'qa-report-'));
  try { gh('run', 'download', String(id), '-n', 'qa-report', '-D', dir); } catch { console.error('no qa-report artifact (the aggregate job did not run)'); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  for (const s of [...new Set(rows.map(r => r.suite))]) {
    const rs = rows.filter(r => r.suite === s), w = [Math.max(5, ...rs.map(r => r.check.length)), 6];
    console.log(`\n${s}\n${'Check'.padEnd(w[0])}  Result  Actual`);
    for (const r of rs) console.log(`${r.check.padEnd(w[0])}  ${col(r.result.padEnd(6))}  ${r.result === 'PASS' ? '' : String(r.actual).slice(0, 100)}`);
    console.log(col(`SUITE ${s}: ${rs.filter(r => r.result === 'PASS').length} PASS, ${rs.filter(r => r.result === 'FAIL').length} FAIL, ${rs.filter(r => r.result === 'WARN').length} WARN, ${rs.filter(r => r.result === 'SKIP').length} SKIP`));
  }
  console.log(`\nreport: ${path.join(dir, 'report.html')}`);
  process.exit(rows.some(r => r.result === 'FAIL') ? 1 : 0);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
