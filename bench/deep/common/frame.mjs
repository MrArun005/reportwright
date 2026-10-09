// The Node side of the harness contract: node harness.mjs <lib> <job> <size> <outdir>  ->  one JSON line on stdout.
// Inputs (rows, text, file lists) are read before the clock starts; `ms` is the job's own time in this process. With
// REPS=n the job runs n times in one process: `ms` is the first, `warm_ms` the median of the last 40 (or last 80%).
// An adapter is an object of job functions; a job it does not have is "n/a" (the driver never asks for it).
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as generic from './canvas-jobs.mjs';

import { spec, fx, readRows } from './data.mjs';

function inputs(job, size) {
  const e = spec.edit;
  switch (job) {
    case 'report': return { rows: readRows(size) };
    case 'plain': return { pool: fs.readFileSync(fx(spec.plain.pool), 'utf8').split('\n').filter(Boolean), pages: size };
    case 'read-big': return { files: [fx(spec.read.big)] };
    case 'read-mixed': return { files: fs.readdirSync(fx(spec.read.mixedDir)).filter(f => f.endsWith('.pdf')).sort().map(f => fx(path.join(spec.read.mixedDir, f))) };
    case 'merge': return { files: fs.readdirSync(fx(e.mergeDir)).sort().slice(0, size).map(f => fx(path.join(e.mergeDir, f))) };
    case 'split': case 'encrypt': case 'metadata': return { file: fx(e.doc) };
    case 'form': return { file: fx(e.form) };
    case 'sign': return { file: fx(e.signDoc) };
    case 'parse': return { file: process.env.BENCH_INPUT };
    default: return {};
  }
}

async function runJob(a, job, ctx, out) {
  const pdf = path.join(out, 'out.pdf');
  if (['plain', 'report', 'invoice', 'invoice-warm', 'unicode', 'images', 'pdfa'].includes(job)) {
    const j = job === 'invoice-warm' ? 'invoice' : job;
    if (a[j]) return a[j](ctx, pdf);
    return generic[j](a.canvas, ctx, pdf);
  }
  switch (job) {
    case 'read-big': fs.writeFileSync(path.join(out, 'out.txt'), await a.extract(ctx.files[0])); return;
    case 'read-mixed':
      for (const f of ctx.files) fs.writeFileSync(path.join(out, path.basename(f, '.pdf') + '.txt'), await a.extract(f));
      return;
    case 'parse': return a.parse ? a.parse(ctx.file) : a.extract(ctx.file);
    case 'merge': return a.merge(ctx.files, pdf);
    case 'split': return a.split(ctx.file, out);
    case 'encrypt': return a.encrypt(ctx.file, pdf, spec.edit.passwords);
    case 'metadata': return a.metadata(ctx.file, pdf, spec.edit.title);
    case 'form': return a.form(ctx.file, pdf, spec.edit.formValues);
    case 'sign': {
      const c = spec.edit.cert;
      return a.sign(ctx.file, pdf, { key: fx(c.key), cert: fx(c.cert), p12: fx(c.p12), pass: c.p12pass });
    }
  }
  throw new Error(`unknown job ${job}`);
}

export async function main(adapters) {
  const [lib, job, size, out] = process.argv.slice(2);
  const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  try {
    const a = await adapters[lib]();
    if (job === 'version') { say({ ok: true, version: typeof a.version === 'function' ? await a.version() : a.version }); process.exit(0); }
    fs.mkdirSync(out, { recursive: true });
    const ctx = inputs(job, Number(size));
    const reps = Number(process.env.REPS || 1);
    const times = [];
    let note;
    for (let i = 0; i < reps; i++) {
      const t = performance.now();
      const r = await runJob(a, job, ctx, out);
      times.push(performance.now() - t);
      note = r?.note;
    }
    const warm = times.slice(reps >= 50 ? reps - 40 : Math.floor(reps * 0.2)).sort((x, y) => x - y);
    say({ ok: true, ms: times[0], ...(reps > 1 ? { warm_ms: warm[warm.length >> 1] } : {}), ...(note ? { note } : {}) });
    if (a.close) await a.close();
  } catch (e) {
    say({ ok: false, error: String(e?.stack ?? e).slice(0, 600) });
  }
  process.exit(0);
}
