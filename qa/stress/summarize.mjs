// node qa/stress/summarize.mjs <dir> <suite> [--fail-on-fail]
// Gathers every results.jsonl under <dir> into <dir>/results.json and <dir>/summary.md, appends the table to
// $GITHUB_STEP_SUMMARY, and with --fail-on-fail exits 1 when a check FAILed (the run shows red; the artifact still uploads).
import fs from 'node:fs';
import path from 'node:path';
const [dir = 'qa-out', suite = 'stress'] = process.argv.slice(2);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'results.jsonl' ? [path.join(d, e.name)] : []);
const rows = fs.existsSync(dir) ? walk(dir).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))) : [];
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 220);
const n = (k) => rows.filter(r => r.result === k).length;
const md = [`### qa-${suite}`, '', '| Check | Command | Expected | Actual (trimmed) | Result |', '|---|---|---|---|---|',
  ...rows.map(r => `| ${cell(r.check)} | \`${cell(r.command)}\` | ${cell(r.expected)} | ${cell(r.actual)} | ${r.result} |`),
  '', `SUITE ${suite}: ${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('WARN')} WARN, ${n('SKIP')} SKIP`].join('\n') + '\n';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(rows, null, 2));
fs.writeFileSync(path.join(dir, 'summary.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
if (process.argv.includes('--fail-on-fail') && n('FAIL')) process.exit(1);
