#!/usr/bin/env node
// The type check CI runs (npm run typecheck): tsc over the files with // @ts-check (tsconfig.check.json).
// src/server, proxy.js and instrumentation.js must have no errors at all. The engine and the exporters have a
// baseline (scripts/typecheck-baseline.json, errors per file) that may only go down: a file with more errors than
// its baseline, or a new file with errors, fails. `--update` writes the baseline from the current errors.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const BASE = path.join(ROOT, 'scripts', 'typecheck-baseline.json');
let out = '';
try { execFileSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.check.json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); if (!/error TS/.test(out)) { console.error(out); process.exit(2); } }
const lines = out.split('\n').filter(l => /error TS\d+/.test(l));
const count = {};
for (const l of lines) { const f = l.slice(0, l.indexOf('(')); count[f] = (count[f] || 0) + 1; }
if (process.argv.includes('--update')) { fs.writeFileSync(BASE, `${JSON.stringify(Object.fromEntries(Object.entries(count).filter(([f]) => !/^(src\/server|proxy|instrumentation)/.test(f)).sort()), null, 2)}\n`); console.log(`baseline: ${lines.length} errors`); process.exit(0); }
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const bad = [];
for (const [f, n] of Object.entries(count)) {
  if (/^(src\/server|proxy|instrumentation)/.test(f)) bad.push(`${f}: ${n} error(s) (the server must have none)`);
  else if (n > (base[f] || 0)) bad.push(`${f}: ${n} error(s), baseline ${base[f] || 0}`);
}
if (bad.length) { console.error(lines.filter(l => bad.some(b => l.startsWith(b.split(':')[0]))).join('\n')); console.error(`\ntypecheck failed:\n  ${bad.join('\n  ')}`); process.exit(1); }
const total = Object.values(base).reduce((a, b) => a + b, 0);
console.log(`typecheck: the server has no errors; the engine and exporters ${lines.length} (baseline ${total})${lines.length < total ? ': lower the baseline with --update' : ''}`);
