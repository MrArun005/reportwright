// The shared inputs on the Node side: the spec, fixture paths, the ledger rows, money formatting, grouping.
import fs from 'node:fs';
import path from 'node:path';

const FX = process.env.BENCH_FIXTURES;
export const spec = JSON.parse(fs.readFileSync(process.env.BENCH_SPEC || path.join(FX, 'spec.json'), 'utf8'));
export const fx = (p) => path.join(FX, p);

const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => nf.format(n);

export function readRows(n) {
  const lines = fs.readFileSync(fx(`rows-${n}.csv`), 'utf8').split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split(',');
    rows.push({ id: +c[0], account: c[1], region: c[2], type: c[3], date: c[4], amount: +c[5], reference: c[6] });
  }
  return rows;
}
/** groups and sums for libraries that have no grouping: computed once, the same way for every one of them */
export function groupsOf(rows) {
  const out = [];
  for (const r of rows) {
    let g = out[out.length - 1];
    if (!g || g.region !== r.region) out.push((g = { region: r.region, rows: [], count: 0, sum: 0 }));
    g.rows.push(r); g.count++; g.sum += r.amount;
  }
  return out;
}

