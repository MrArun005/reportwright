// A Socket-style scan of the npm packages, run on what npm would publish (npm pack of each packages/<name>).
// Fails (exit 1) on: install scripts; eval or new Function; child_process; a line over 1,000 characters
// (source maps and binaries aside: Socket reads code, and a map's "mappings" is one line by design); a dependency
// not pinned to an exact version; no repository, licence or README; and, outside engine/cli/viewer, any network
// or environment use (fonts-cjk may use the network: downloading the fonts is all it does).
// Prints a table per package. Usage: node scripts/scan-packages.mjs [name ...]   (run npm run build:packages first)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const ORDER = ['fonts', 'fonts-cjk', 'engine', 'cli', 'viewer', 'react', 'vue', 'svelte', 'angular'];
const NET_OK = new Set(['engine', 'cli', 'viewer', 'fonts-cjk']);
const ENV_OK = new Set(['engine', 'cli', 'viewer']);
const MAX_LINE = 1000;
const CODE = /\.(m|c)?js$/;
const BINARY = /\.(ttf|otf|woff2?|wasm|icc|png|jpe?g|gif|ico|gz)$/i;
const INSTALL = ['preinstall', 'install', 'postinstall'];
const NET = /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|['"](node:)?(http|https|net|tls|dgram|dns|http2)['"]/;

/** The signals in one unpacked package directory. */
export function scanDir(dir, name) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(path.relative(dir, f)); } };
  walk(dir);
  const r = { name, files: files.length, install: INSTALL.filter(s => pkg.scripts?.[s]), eval: [], childProcess: [], longLines: [], network: [], env: [], unpinned: [], meta: [] };
  for (const f of files) {
    if (BINARY.test(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!f.endsWith('.map')) src.split('\n').forEach((l, i) => { if (l.length > MAX_LINE) r.longLines.push(`${f}:${i + 1} (${l.length})`); });
    if (!CODE.test(f)) continue;
    const lines = src.split('\n');
    const find = (re, into) => lines.forEach((l, i) => { if (re.test(l)) into.push(`${f}:${i + 1}`); });
    find(/(^|[^\w$.])eval\s*\(|\bnew\s+Function\s*\(/, r.eval);
    find(/child_process/, r.childProcess);
    find(NET, r.network);
    find(/\bprocess\.env\b/, r.env);
  }
  for (const [n, v] of Object.entries(pkg.dependencies || {})) if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v)) r.unpinned.push(`${n}@${v}`);
  if (!pkg.repository?.url) r.meta.push('repository');
  if (!pkg.license) r.meta.push('license');
  if (!files.some(f => /^(LICEN[CS]E|COPYING)/i.test(path.basename(f)))) r.meta.push('licence file');
  if (!files.includes('README.md')) r.meta.push('README');
  r.problems = [
    ...r.install.map(s => `install script: ${s}`), ...r.eval.map(x => `eval/new Function: ${x}`), ...r.childProcess.map(x => `child_process: ${x}`),
    ...r.longLines.map(x => `line over ${MAX_LINE}: ${x}`), ...r.unpinned.map(x => `unpinned: ${x}`), ...r.meta.map(x => `missing: ${x}`),
    ...(NET_OK.has(name) ? [] : r.network.map(x => `network: ${x}`)), ...(ENV_OK.has(name) ? [] : r.env.map(x => `env: ${x}`)),
  ];
  return r;
}

/** npm pack packages/<name> into a temp dir, unpack it and scan it. */
export function scanPackage(name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-scan-'));
  try {
    const [p] = JSON.parse(execFileSync('npm', ['pack', path.join(root, 'packages', name), '--json', '--pack-destination', tmp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    execFileSync('tar', ['-xzf', path.join(tmp, p.filename), '-C', tmp]);
    return { ...scanDir(path.join(tmp, 'package'), name), version: p.version, size: p.size, unpackedSize: p.unpackedSize, deps: JSON.parse(fs.readFileSync(path.join(tmp, 'package/package.json'), 'utf8')).dependencies || {} };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.length > 2 ? process.argv.slice(2) : ORDER;
  const results = names.map(scanPackage);
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  const cell = (n, ok = true) => (n === 0 ? '0' : ok ? `${n} (ok)` : `${n} FAIL`);
  const rows = results.map(r => ({
    package: `@reportwright/${r.name}@${r.version}`, files: r.files, unpacked: mb(r.unpackedSize), install: cell(r.install.length, false),
    'eval/Function': cell(r.eval.length, false), child_process: cell(r.childProcess.length, false), 'lines>1000': cell(r.longLines.length, false),
    network: cell(r.network.length, NET_OK.has(r.name)), 'process.env': cell(r.env.length, ENV_OK.has(r.name)),
    unpinned: cell(r.unpinned.length, false), meta: r.meta.length ? r.meta.join('+') + ' FAIL' : 'ok', result: r.problems.length ? 'FAIL' : 'pass',
  }));
  console.table(rows);
  for (const r of results) {
    console.log(`@reportwright/${r.name} dependencies: ${Object.entries(r.deps).map(([n, v]) => `${n}@${v}`).join(', ') || '(none)'}`);
    for (const p of r.problems.slice(0, 20)) console.log(`  ${p}`);
    if (r.problems.length > 20) console.log(`  … and ${r.problems.length - 20} more`);
  }
  const bad = results.filter(r => r.problems.length);
  console.log(bad.length ? `scan: ${bad.length} package(s) failed` : 'scan: all packages pass');
  process.exit(bad.length ? 1 : 0);
}
