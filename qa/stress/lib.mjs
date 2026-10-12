// Shared by the qa-stress, qa-load and qa-security suites: one result row per check, appended as a JSON line to
// $QA_DIR/results.jsonl (summarize.mjs turns the rows into results.json, summary.md and the step-summary table).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const QA_DIR = process.env.QA_DIR || path.resolve('qa-out');
fs.mkdirSync(QA_DIR, { recursive: true });
export const SUITE = process.env.QA_SUITE || 'stress';
export const TIER = process.env.QA_TIER === 'full' ? 'full' : 'quick';

/** @param {{check:string,command:string,expected:string,actual:any,result:'PASS'|'FAIL'|'WARN'|'SKIP',ms?:number,mb?:number}} r */
export function record(r) {
  const row = { suite: SUITE, ...r, actual: String(r.actual) };
  fs.appendFileSync(path.join(QA_DIR, 'results.jsonl'), JSON.stringify(row) + '\n');
  console.log(`${row.result.padEnd(4)} ${row.check}: ${row.actual}`);
  return row;
}
/** Run fn; a throw becomes a FAIL row with the error (a crash is a result, not a lost check). */
export async function check(name, command, expected, fn) {
  const t0 = performance.now();
  try { return await fn(); }
  catch (e) { return record({ check: name, command, expected, actual: `threw: ${String(e?.stack || e).slice(0, 400)}`, result: 'FAIL', ms: Math.round(performance.now() - t0) }); }
}
export const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
/** Peak RSS sampler for this process (MB). */
export function rssSampler(ms = 20) {
  const now = () => process.memoryUsage.rss() / 1048576;
  let peak = now();
  const t = setInterval(() => { peak = Math.max(peak, now()); }, ms);
  return { now, stop: () => { clearInterval(t); peak = Math.max(peak, now()); return Math.round(peak); } };
}
