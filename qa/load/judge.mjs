// node qa/load/judge.mjs <name> <summary.json> '<json rules>'   Turns a k6 --summary-export into result rows.
// rules: { p95?: ms, p95warn?: ms, unexpected?: max, noretry?: max, minOk?: n, minRejected?: n, maxRejectedRate?: x }
import fs from 'node:fs';
import { record } from '../stress/lib.mjs';
const [name, file, rulesJson = '{}', command = 'k6 run qa/load/render.js'] = process.argv.slice(2);
const rules = JSON.parse(rulesJson);
let s;
try { s = JSON.parse(fs.readFileSync(file, 'utf8')).metrics; }
catch (e) { record({ check: name, command, expected: 'a k6 summary', actual: `no summary: ${e.message}`, result: 'FAIL' }); process.exit(0); }
const v = (m, k = 'count') => s[m]?.[k] ?? s[m]?.values?.[k] ?? 0;
const ok = v('ok_duration', 'count'), rej = v('rejected'), unexp = v('unexpected'), noret = v('noretry'), x5 = v('status_5xx');
const reqs = v('http_reqs'), rate = v('http_reqs', 'rate');
const p = (k) => Math.round(v('ok_duration', k));
const line = `${reqs} req (${rate.toFixed(1)}/s), ${ok} ok, ${rej} 429/503, ${unexp} unexpected (${x5} other 5xx), ${noret} without Retry-After; ok p50/p95/p99 ${p('med')}/${p('p(95)')}/${p('p(99)')} ms`;
const fails = [];
if (rules.unexpected != null && unexp > rules.unexpected) fails.push(`unexpected ${unexp} > ${rules.unexpected}`);
if (rules.noretry != null && noret > rules.noretry) fails.push(`no Retry-After ${noret}`);
if (rules.p95 != null && p('p(95)') >= rules.p95) fails.push(`p95 ${p('p(95)')} ≥ ${rules.p95}`);
if (rules.minOk != null && ok < rules.minOk) fails.push(`ok ${ok} < ${rules.minOk}`);
if (rules.minRejected != null && rej < rules.minRejected) fails.push(`rejected ${rej} < ${rules.minRejected}`);
if (rules.maxRejectedRate != null && reqs && rej / reqs > rules.maxRejectedRate) fails.push(`rejected rate ${(rej / reqs).toFixed(3)} > ${rules.maxRejectedRate}`);
const warn = rules.p95warn != null && p('p(95)') >= rules.p95warn;
const expected = Object.entries(rules).map(([k, x]) => `${k}${/^min/.test(k) ? '≥' : k === 'p95warn' ? '<(warn)' : '≤'}${x}`).join(', ');
record({ check: name, command, expected, actual: fails.length ? `${line} — ${fails.join('; ')}` : line, result: fails.length ? 'FAIL' : warn ? 'WARN' : 'PASS', ms: p('p(95)') });
