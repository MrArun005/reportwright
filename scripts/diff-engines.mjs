#!/usr/bin/env node
// Differential testing against the real engines (docs/DIFF-TESTING.md).
//
//   node scripts/diff-engines.mjs --capture            run JasperReports and BIRT on every generated case and record
//                                                      the text of their PDFs as ground truth (tests/diff/truth/*.json)
//   node scripts/diff-engines.mjs                      compare Pagewright's import + render with the recorded truth;
//                                                      writes the mismatch corpus (tests/diff/mismatches/*.json)
//   options: --engines=jrxml,birt  --only=<family>  --pdf (also export Pagewright's PDF and read it back with pdftotext)
//            --bench=<dir> (default ~/pw-bench: jvm/jasper/lib, jvm/birt/runtime, Java 23)  --quiet
//
// The ground truth needs Java and the engines; the comparison needs neither (tests/diff/diff.test.js replays it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { cases } from '../tests/diff/gen.mjs';
import { pagewright, modelPages, pdfPages, printPages, htmlLines, withExactValues, compare, fontStore, TRUTH_DIR, readTruth } from '../tests/diff/harness.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const { values: o } = parseArgs({ options: { capture: { type: 'boolean' }, engines: { type: 'string', default: 'jrxml,birt' }, only: { type: 'string' }, pdf: { type: 'boolean' }, bench: { type: 'string', default: path.join(os.homedir(), 'pw-bench') }, quiet: { type: 'boolean' } } });
const engines = o.engines.split(',');
const WORK = path.join(os.tmpdir(), 'pw-diff');
const JAVA_HOME = process.env.JAVA_HOME || '/Library/Java/JavaVirtualMachines/jdk-23.jdk/Contents/Home';
const JVM = { jrxml: { main: 'DiffJasper', cp: ['jvm/jasper/res', 'jvm/jasper/lib/*'], ext: 'jrxml' }, birt: { main: 'DiffBirt', cp: ['jvm/birt/res', 'jvm/birt/runtime/ReportEngine/lib/*'], ext: 'rptdesign' } };
const famOf = (c) => c.family;

function capture(engine) {
  const j = JVM[engine];
  const dir = path.join(WORK, engine);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const list = cases(engine).filter(c => !o.only || c.family.endsWith(o.only));
  for (const c of list) {
    fs.writeFileSync(path.join(dir, `${c.id}.${j.ext}`), c.xml);
    fs.writeFileSync(path.join(dir, `${c.id}.json`), JSON.stringify(engine === 'jrxml' ? c.rows : c.rows));
    fs.writeFileSync(path.join(dir, `${c.id}.locale`), c.locale);
  }
  const cls = path.join(WORK, 'classes', engine);
  fs.mkdirSync(cls, { recursive: true });
  const cp = j.cp.map(p => path.join(o.bench, p)).join(':');
  execFileSync(path.join(JAVA_HOME, 'bin/javac'), ['-nowarn', '-cp', cp, '-d', cls, path.join(ROOT, 'tests/diff/jvm', `${j.main}.java`)], { stdio: 'inherit' });
  const t0 = Date.now();
  // java.io.tmpdir inside the work folder: the PDF libraries leave font copies (+~JF….tmp) there, deleted with it
  const out = execFileSync(path.join(JAVA_HOME, 'bin/java'), ['-Xmx768m', '-Djava.awt.headless=true', `-Djava.io.tmpdir=${dir}`, '-cp', `${cls}:${cp}`, j.main, dir], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`${engine}: ${out.trim().split('\n').pop()} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const prev = readTruth(engine)?.cases || {};
  const truth = { engine, tool: engine === 'jrxml' ? 'JasperReports 7.0.8' : 'BIRT 4.25.0', captured: new Date().toISOString().slice(0, 10), cases: o.only ? prev : {} };
  for (const c of list) {
    const pdf = path.join(dir, `${c.id}.${engine === 'jrxml' ? 'jasper' : 'birt'}.pdf`);
    const err = pdf.replace(/\.pdf$/, '.err');
    if (fs.existsSync(pdf)) {
      // values: the engine's exact strings (Jasper's filled print objects, BIRT's HTML of the same run), which do not
      // depend on the PDF font having the glyphs; pages and order: the PDF. pdfText: whether pdftotext alone agrees.
      const viaPdf = pdfPages(pdf);
      const pages = engine === 'jrxml' ? printPages(fs.readFileSync(pdf.replace(/\.pdf$/, '.txt'), 'utf8')) : withExactValues(viaPdf, htmlLines(fs.readFileSync(pdf.replace(/\.pdf$/, '.html'), 'utf8')));
      truth.cases[c.id] = { hash: c.hash, family: c.family, pages, pdfText: JSON.stringify(viaPdf) === JSON.stringify(pages) };
    }
    else truth.cases[c.id] = { hash: c.hash, family: c.family, error: (fs.existsSync(err) ? fs.readFileSync(err, 'utf8') : 'no output').split('\n').slice(0, 3).join(' ').slice(0, 400) };
  }
  const pdfOk = Object.values(truth.cases).filter(x => x.pages && x.pdfText).length, all = Object.values(truth.cases).filter(x => x.pages).length;
  console.log(`${engine}: pdftotext of the engine's PDF reads the same text as its exact strings in ${pdfOk}/${all} cases (the rest: glyphs the PDF font lacks)`);
  fs.mkdirSync(TRUTH_DIR, { recursive: true });
  fs.writeFileSync(path.join(TRUTH_DIR, `${engine}.json`), JSON.stringify(truth, null, 0).replace(/\},"/g, '},\n"'));
  fs.rmSync(dir, { recursive: true, force: true }); // the PDFs are read: free the disk
}

async function diff(engine) {
  const truth = readTruth(engine);
  if (!truth) { console.log(`${engine}: no ground truth; run with --capture first`); return null; }
  const store = fontStore();
  const list = cases(engine).filter(c => !o.only || c.family.endsWith(o.only));
  const fams = {};
  const corpus = [];
  let pdfDisagree = 0;
  for (const c of list) {
    const t = truth.cases[c.id];
    const f = (fams[famOf(c)] ||= { cases: 0, bad: 0, cells: 0, badCells: 0, stale: 0, engineError: 0, pagination: 0 });
    if (!t || t.hash !== c.hash) { f.stale++; continue; }
    if (t.error) { f.engineError++; continue; }
    f.cases++;
    let got, warnings = [];
    try {
      const r = await pagewright(c, store);
      got = modelPages(r.model); warnings = r.warnings;
      if (o.pdf) {
        const { exportPdf } = await import('../src/exporters/pdf.js');
        const file = path.join(WORK, `${c.id}.pw.pdf`);
        fs.writeFileSync(file, await exportPdf(r.model, store, {}));
        const viaPdf = pdfPages(file);
        if (JSON.stringify(viaPdf) !== JSON.stringify(got)) pdfDisagree++;
        fs.rmSync(file, { force: true });
        got = viaPdf;
      }
    } catch (e) { got = [[`@ERROR ${e.message}`]]; }
    const cmp = compare(t.pages, got);
    f.cells += cmp.cells; f.badCells += cmp.bad.filter(b => b.want !== undefined).length;
    if (!cmp.pages && !cmp.bad.length) f.pagination++;
    if (!cmp.ok) { f.bad++; corpus.push({ id: c.id, family: c.family, locale: c.locale, pagesOk: cmp.pages, nBad: cmp.bad.length, bad: cmp.bad.slice(0, 40), warnings: warnings.slice(0, 8), truthPages: t.pages.length, gotPages: got.length }); }
  }
  const dir = path.join(import.meta.dirname, '..', 'tests', 'diff', 'mismatches');
  fs.mkdirSync(dir, { recursive: true });
  if (!o.only) fs.writeFileSync(path.join(dir, `${engine}.json`), `[\n${corpus.map(m => JSON.stringify(m)).join(',\n')}\n]\n`);
  const tot = Object.values(fams).reduce((a, f) => ({ cases: a.cases + f.cases, bad: a.bad + f.bad, cells: a.cells + f.cells, badCells: a.badCells + f.badCells }), { cases: 0, bad: 0, cells: 0, badCells: 0 });
  console.log(`\n${truth.tool} (truth ${truth.captured}) vs Pagewright: ${tot.bad}/${tot.cases} cases differ (${pct(tot.bad, tot.cases)}), ${tot.badCells}/${tot.cells} cells (${pct(tot.badCells, tot.cells)})${o.pdf ? `; PDF text ≠ model text in ${pdfDisagree} cases` : ''}`);
  console.log('family        cases  differ  cells  wrong  pages-only  engine-error  stale');
  for (const [k, f] of Object.entries(fams)) console.log(`${k.padEnd(13)} ${String(f.cases).padStart(5)}  ${String(f.bad).padStart(6)}  ${String(f.cells).padStart(5)}  ${String(f.badCells).padStart(5)}  ${String(f.pagination).padStart(10)}  ${String(f.engineError).padStart(12)}  ${String(f.stale).padStart(5)}`);
  if (!o.quiet) for (const m of corpus.slice(0, 12)) console.log(`  ${m.id} [${m.locale}]${m.pagesOk ? '' : ` pages ${m.truthPages}→${m.gotPages}`}: ${m.bad.slice(0, 3).map(b => `${b.cell} want ${JSON.stringify(b.want)} got ${JSON.stringify(b.got)}`).join('; ')}`);
  return tot;
}
const pct = (a, b) => `${b ? ((100 * a) / b).toFixed(1) : '0.0'}%`;

for (const e of engines) {
  if (o.capture) capture(e);
  await diff(e);
}
