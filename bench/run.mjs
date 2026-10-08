#!/usr/bin/env node
// The timing benchmark. Every run is its own process (child.mjs); the first run of each cell is a warmup and is dropped.
//   node run.mjs                      the full benchmark (CI): 5 libraries, invoice, warm invoice, table at 1k/10k/100k
//   node run.mjs --smoke --out=F      a quick check of the harness: 100 rows, no browser, 3 runs
// Options: --libs=a,b  --sizes=1000,10000  --runs=N (100k rows: min(N, 3))  --timeout=SECONDS (a run; default 900)
// Writes results.json (default out/results.json), merging out/install.json and out/verapdf.json when they exist.
import { spawn, execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const here = import.meta.dirname;
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const smoke = process.argv.includes('--smoke');
const ALL = ['reportwright', 'pdfmake', 'react-pdf', 'pdfkit', 'puppeteer'];
const libs = arg('libs', smoke ? ALL.filter(l => l !== 'puppeteer').join() : ALL.join()).split(',');
const sizes = arg('sizes', smoke ? '100' : '1000,10000,100000').split(',').map(Number);
const RUNS = Number(arg('runs', smoke ? 3 : 5));
const TIMEOUT = Number(arg('timeout', 900)) * 1000;
const outFile = path.resolve(arg('out', path.join(here, 'out/results.json')));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-bench-'));
const run$ = promisify(execFile);

/** the summed RSS (MB) of pid and its descendants, from one `ps` */
async function treeRss(pid) {
  const { stdout } = await run$('ps', ['-A', '-o', 'pid=,ppid=,rss=']);
  const kids = new Map(), rss = new Map();
  for (const line of stdout.trim().split('\n')) {
    const [p, pp, r] = line.trim().split(/\s+/).map(Number);
    rss.set(p, r);
    if (!kids.has(pp)) kids.set(pp, []);
    kids.get(pp).push(p);
  }
  let kb = 0;
  for (const stack = [pid]; stack.length;) { const p = stack.pop(); kb += rss.get(p) || 0; stack.push(...(kids.get(p) || [])); }
  return kb / 1024;
}

/** one run in a new process: { wallMs, loadMs, renderMs, pages, bytes, peakRssMB } or { error } */
function once(lib, workload, rows, flags = []) {
  return new Promise((resolve) => {
    const out = path.join(tmp, `${lib}-${workload}-${rows}.pdf`);
    const t0 = process.hrtime.bigint();
    const child = spawn(process.execPath, [path.join(here, 'child.mjs'), lib, workload, String(rows), out, ...flags], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); // its own process group, so a timeout kills a browser too
    let stdout = '', stderr = '', treePeak = 0, busy = false, timedOut = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    // ponytail: 100 ms `ps` sampling; a spike shorter than that in a child process (Chrome) can be missed
    const sampler = setInterval(async () => {
      if (busy) return; busy = true;
      try { treePeak = Math.max(treePeak, await treeRss(child.pid)); } catch { /* the process just ended */ }
      busy = false;
    }, 100);
    const killer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid); } catch {} child.kill('SIGKILL'); }, TIMEOUT);
    child.on('close', (code) => {
      clearInterval(sampler); clearTimeout(killer);
      const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
      fs.rmSync(out, { force: true });
      if (timedOut) return resolve({ error: `did not finish in ${TIMEOUT / 1000} s`, timeout: true });
      if (code !== 0) return resolve({ error: `exit ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}` });
      const r = JSON.parse(stdout.trim().split('\n').pop());
      resolve({ wallMs, loadMs: r.loadMs, renderMs: r.renderMs, pages: r.pages, bytes: r.bytes, peakRssMB: Math.max(r.maxRssMB, treePeak) });
    });
  });
}

const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const stat = (a) => ({ median: +median(a).toFixed(1), min: +Math.min(...a).toFixed(1), max: +Math.max(...a).toFixed(1) });

async function cell(lib, workload, rows) {
  const n = rows >= 100000 ? Math.min(RUNS, 3) : RUNS;
  const warm = await once(lib, workload, rows);
  if (warm.error) return { lib, workload, rows, status: warm.timeout ? 'timeout' : 'error', note: warm.error, runs: 0 };
  const runs = [];
  for (let i = 0; i < n; i++) {
    const r = await once(lib, workload, rows);
    if (r.error) return { lib, workload, rows, status: r.timeout ? 'timeout' : 'error', note: r.error, runs: runs.length };
    runs.push(r);
  }
  const last = runs[runs.length - 1];
  return { lib, workload, rows, status: 'ok', runs: n, renderMs: stat(runs.map(r => r.renderMs)), wallMs: stat(runs.map(r => r.wallMs)),
    loadMs: stat(runs.map(r => r.loadMs)), peakRssMB: stat(runs.map(r => r.peakRssMB)), bytes: last.bytes, pages: last.pages };
}

const versionOf = (pkg) => JSON.parse(fs.readFileSync(path.join(here, 'node_modules', pkg, 'package.json'), 'utf8')).version;
const PKG = { reportwright: '@reportwright/engine', pdfmake: 'pdfmake', 'react-pdf': '@react-pdf/renderer', pdfkit: 'pdfkit', puppeteer: 'puppeteer' };
const versions = Object.fromEntries(libs.map(l => [l, versionOf(PKG[l])]));
if (libs.includes('react-pdf')) versions.react = versionOf('react');
if (libs.includes('puppeteer')) {
  try { versions.chrome = execFileSync(process.execPath, ['--input-type=module', '-e', "import p from 'puppeteer'; const b = await p.launch({ args: process.platform === 'linux' ? ['--no-sandbox'] : [] }); console.log(await b.version()); await b.close();"], { cwd: here, encoding: 'utf8' }).trim(); }
  catch (e) { versions.chrome = `unknown (${String(e.message).split('\n')[0]})`; }
}

const cpus = os.cpus();
const results = {
  kind: smoke ? 'smoke' : 'benchmark',
  label: smoke ? `smoke run, laptop, ${sizes.join('/')} rows: not the benchmark` : 'benchmark run',
  date: new Date().toISOString(),
  hardware: { cpu: cpus[0]?.model, cores: cpus.length, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), os: `${os.type()} ${os.release()} ${os.arch()}`, node: process.version,
    runner: process.env.RUNNER_NAME ? `GitHub Actions ${process.env.ImageOS || ''} ${process.env.ImageVersion || ''}`.trim() : 'local' },
  method: { runs: RUNS, runsAt100k: Math.min(RUNS, 3), warmup: 1, timeoutS: TIMEOUT / 1000, sizes },
  versions,
  cells: [],
};

for (const lib of libs) {
  for (const workload of ['invoice', 'invoice-warm']) {
    const c = await cell(lib, workload, 0);
    results.cells.push(c); console.error(`${lib} ${workload}: ${c.status === 'ok' ? `${c.renderMs.median} ms, ${c.peakRssMB.median} MB` : c.note}`);
  }
  let stop = null;
  for (const rows of sizes) {
    const c = stop ? { lib, workload: 'table', rows, status: 'skipped', note: stop, runs: 0 } : await cell(lib, 'table', rows);
    if (c.status === 'timeout' || c.status === 'error') stop = `not run: ${rows.toLocaleString('en-US')} rows did not finish (${c.status})`;
    results.cells.push(c); console.error(`${lib} table ${rows}: ${c.status === 'ok' ? `${c.renderMs.median} ms, ${c.peakRssMB.median} MB, ${c.pages} pages` : c.note}`);
  }
}

for (const part of ['install', 'verapdf']) {
  const f = path.join(here, 'out', `${part}.json`);
  if (fs.existsSync(f)) results[part] = JSON.parse(fs.readFileSync(f, 'utf8'));
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(results, null, 1) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.error(`wrote ${outFile}`);
