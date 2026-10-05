#!/usr/bin/env node
// pw: render, test and diff Pagewright reports from the command line. No server needed.
// The same engine and exporters as the app; fonts come from public/fonts.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { render, FontStore } from '../src/engine/index.js';
import { pdfEncryptOptions } from '../src/exporters/encrypt.js';
import { exportPdf } from '../src/exporters/pdf.js';
import { createSubsetter } from '../src/exporters/subset.js';
import { exportHtml } from '../src/exporters/html.js';
import { exportCsv } from '../src/exporters/csv.js';
import { exportXlsx } from '../src/exporters/xlsx.js';
import { exportDocx } from '../src/exporters/docx.js';
import { exportPptx } from '../src/exporters/pptx.js';
import { textRows } from '../src/exporters/regions.js';

const ROOT = path.join(import.meta.dirname, '..');
const HELP = `pw render <report.pw.json> [-p name=value]… [-d source=data.json]… [-f pdf|xlsx|docx|pptx|html|csv|json|txt] [-o file|-] [--base URL] [--pdfa] [--ua]
          [--values] [--static]
          [--password PW] [--owner-password PW] [--deny print|modify|copy|annotate|fillForms|accessibility|assemble|printHighQuality]…
pw test [folder] [--update]        render every <folder>/__tests__/*.test.json case and compare it with its snapshot
pw diff <old.pw.json> <new.pw.json> [-p name=value]… [-d source=data.json]… [--base URL]
pw audit verify [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json] [--public-key file.pem]
                                   check the server's audit log (hash chain, signed checkpoints); run it in the app
                                   folder with the server's PW_STORAGE and PW_AUDIT_KEY / PW_SESSION_SECRET
pw audit checkpoint                write a signed checkpoint now

  -p  a report parameter            -d  replace a data source with a JSON file
  -f  output format (default pdf)   -o  output file, or - for stdout
  --base  where relative data URLs go (e.g. http://localhost:3000)
  --password, --owner-password, --deny  a password-protected PDF (AES-256); --deny takes away a permission
  --ua  an accessible PDF (PDF/UA-1; with --pdfa, PDF/A-2a)   --values  Excel totals as values, not formulas
  --static  an HTML file without its Tables view (sort, groups, filter)
Exit codes: 0 ok, 1 a test failed, the pages differ or the audit log does not check, 2 bad usage.`;

const fontStore = new FontStore((k) => fs.readFileSync(path.join(ROOT, 'public', 'fonts', `${k}.ttf`)));
// PDFs embed only the glyphs they use, as the server's do
const subset = createSubsetter(() => fs.promises.readFile(path.join(ROOT, 'public', 'harfbuzz-subset.wasm')));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const pairs = (list = []) => Object.fromEntries(list.map((s) => { const i = s.indexOf('='); if (i < 1) usage(`"${s}" should be name=value`); return [s.slice(0, i), s.slice(i + 1)]; }));
function usage(msg) { if (msg) console.error(`pw: ${msg}\n`); console.error(HELP); process.exit(2); }
const fail = (msg) => { console.error(`pw: ${msg}`); process.exit(1); };

/** A definition with some data sources replaced by JSON (pushed data, like the render API). */
function withData(def, data) {
  if (!data || !Object.keys(data).length) return def;
  const missing = Object.keys(data).filter(n => !(def.dataSources || []).some(s => s.name === n));
  if (missing.length) fail(`the report has no data source named ${missing.map(n => `"${n}"`).join(', ')}`);
  return { ...def, dataSources: def.dataSources.map(s => (s.name in data ? { name: s.name, type: 'json', data: data[s.name] } : s)) };
}

/** Subreports, masters, part libraries, stylesheets and themes: the report's sibling <id>.pw.json files. */
const siblingLoader = (file) => async (id) => {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Report "${id}" not found`);
  try { return readJson(path.join(path.dirname(path.resolve(file)), `${id}.pw.json`)); } catch { throw new Error(`Report "${id}" not found`); }
};

async function renderModel(def, { parameters = {}, data, base, now, state, file, exportData = true } = {}) {
  try {
    return await render(withData(def, data), { fontStore, parameters, ...(exportData ? {} : { exportData: false }), baseUrl: base, now: now ? new Date(now) : undefined, ...(state ? { state } : {}), ...(file ? { loadReport: siblingLoader(file) } : {}) });
  } catch (e) {
    const relative = /fetch|URL|Invalid URL/i.test(e.message) && !base;
    fail(`${e.message}${relative ? '\n    A data source needs a server: pass --base http://localhost:3000, or push the data with -d source=file.json.' : ''}`);
  }
}

/** The text of every page, one line per visual line: what a snapshot and a diff compare. */
function pageTexts(model) {
  return model.pages.map(p => textRows(p.items.flatMap(i => (i.t === 'field' ? i.draw : [i])))); // whole lines: a justified line is one run per word, rich text one item per styled piece
}
const snapshotText = (title, model) => [`# ${title} · ${model.pages.length} pages`, ...pageTexts(model).flatMap((lines, i) => [`--- page ${i + 1}`, ...lines]), ...(model.warnings.length ? ['--- warnings', ...model.warnings] : [])].join('\n') + '\n';

/** Line diff (LCS), "- " removed and "+ " added, with a little context. */
function diffLines(a, b, context = 2) {
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; }
    else if (j < m && (i === n || lcs[i][j + 1] > lcs[i + 1][j])) ops.push(['+', b[j++]]); // ties: removed line first
    else ops.push(['-', a[i++]]);
  }
  const keep = ops.map((o, k) => o[0] !== ' ' || ops.slice(Math.max(0, k - context), k + context + 1).some(x => x[0] !== ' '));
  return ops.filter((_, k) => keep[k]).map(([op, line]) => `${op} ${line}`);
}

/** Compare two renders page by page; prints the changes and returns true when they differ. */
function compare(label, before, after) {
  const pa = pageTexts(before), pb = pageTexts(after);
  let changed = false;
  if (pa.length !== pb.length) { console.log(`${label}: ${pa.length} pages → ${pb.length} pages`); changed = true; }
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
    const d = diffLines(pa[k] || [], pb[k] || []);
    if (!d.some(l => l[0] !== ' ')) continue;
    changed = true;
    console.log(`${label}: page ${k + 1} changed`);
    for (const l of d.slice(0, 60)) console.log(l);
    if (d.length > 60) console.log(`  … ${d.length - 60} more lines`);
  }
  return changed;
}

async function cmdRender(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { p: { type: 'string', multiple: true }, d: { type: 'string', multiple: true }, f: { type: 'string', default: 'pdf' }, o: { type: 'string' }, base: { type: 'string' }, pdfa: { type: 'boolean' }, ua: { type: 'boolean' }, values: { type: 'boolean' }, static: { type: 'boolean' }, password: { type: 'string' }, 'owner-password': { type: 'string' }, deny: { type: 'string', multiple: true } } });
  if (positionals.length !== 1) usage('give one report file');
  const def = readJson(positionals[0]);
  const data = Object.fromEntries(Object.entries(pairs(values.d)).map(([k, f]) => [k, readJson(f)]));
  const fmt = values.f;
  // a plain PDF needs no table data (Excel, Word, the accessible PDF do)
  const model = await renderModel(def, { parameters: pairs(values.p), data, base: values.base, file: positionals[0], exportData: !(fmt === 'pdf' && !values.ua) });
  let bytes;
  let encrypt;
  try {
    encrypt = pdfEncryptOptions({ userPassword: values.password, ownerPassword: values['owner-password'], permissions: Object.fromEntries((values.deny || []).map(k => [k, false])) });
  } catch (e) { usage(e.message); }
  if (encrypt && fmt !== 'pdf') usage('--password, --owner-password and --deny apply to -f pdf only');
  if (encrypt && values.pdfa) usage('a PDF/A file cannot have a password');
  if (values.ua && fmt !== 'pdf') usage('--ua applies to -f pdf only');
  if (fmt === 'pdf') bytes = await exportPdf(model, fontStore, { title: def.name, subset, encrypt, pdfa: values.pdfa ? { icc: fs.readFileSync(path.join(ROOT, 'public', 'icc', 'sRGB-v2-magic.icc')) } : undefined, tagged: values.ua ? { lang: def.locale || 'en' } : undefined });
  else if (fmt === 'html') bytes = await exportHtml(model, fontStore, { title: def.name, static: !!values.static, locale: def.locale, currency: def.currency });
  else if (fmt === 'csv') bytes = exportCsv(model, { locale: def.locale, currency: def.currency });
  else if (fmt === 'xlsx') bytes = await exportXlsx(model, (await import('exceljs')).default, { currency: def.currency, title: def.name, formulas: !values.values, fontStore });
  else if (fmt === 'docx') bytes = await exportDocx(model, { title: def.name, lang: def.locale, fontStore });
  else if (fmt === 'pptx') bytes = await exportPptx(model, { title: def.name, lang: def.locale, fontStore });
  else if (fmt === 'json') bytes = JSON.stringify(model);
  else if (fmt === 'txt') bytes = snapshotText(def.name || positionals[0], model);
  else usage(`unknown format "${fmt}"`);
  const out = values.o ?? `${path.basename(positionals[0]).replace(/\.pw\.json$|\.json$/, '')}.${fmt}`;
  if (out === '-') process.stdout.write(typeof bytes === 'string' ? bytes : Buffer.from(bytes));
  else { fs.writeFileSync(out, typeof bytes === 'string' ? bytes : Buffer.from(bytes)); console.error(`pw: wrote ${out} (${model.pages.length} pages${model.warnings.length ? `, ${model.warnings.length} warnings` : ''})`); }
}

async function cmdTest(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { update: { type: 'boolean' } } });
  const dir = positionals[0] || 'reports';
  const testsDir = path.join(dir, '__tests__');
  let files = [];
  try { files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.json')).sort(); } catch { fail(`no tests: add ${path.join(testsDir, '<report>.test.json')}`); }
  let passed = 0, failed = 0, written = 0;
  for (const f of files) {
    const spec = readJson(path.join(testsDir, f));
    const id = f.replace(/\.test\.json$/, '');
    const def = readJson(path.resolve(testsDir, spec.report));
    for (const c of spec.cases || [{ name: 'default' }]) {
      const data = Object.fromEntries(Object.entries(c.data || {}).map(([k, v]) => [k, typeof v === 'string' ? readJson(path.resolve(testsDir, v)) : v]));
      const model = await renderModel(def, { parameters: c.parameters, data, now: c.now || '2026-01-01T09:00:00', state: c.state, file: path.resolve(testsDir, spec.report) }); // state: drill-down toggles, e.g. {"toggles": {"Pivot|r0|/North": false}}
      const label = `${id} › ${c.name}`;
      const snapFile = path.join(testsDir, `${id}.${c.name}.snap.txt`);
      const text = snapshotText(label, model);
      if (values.update || !fs.existsSync(snapFile)) { fs.writeFileSync(snapFile, text); written++; passed++; continue; }
      const old = fs.readFileSync(snapFile, 'utf8');
      if (old === text) { passed++; continue; }
      failed++;
      const pages = old.split(/\n--- page \d+\n/).slice(1).map(s => s.split('\n--- warnings\n')[0].replace(/\n$/, '').split('\n'));
      if (!compare(label, { pages: pages.map(lines => ({ items: [{ t: 'text', lines: lines.map((text, y) => ({ text, x: 0, y })) }] })) }, model)) console.log(`${label}: the warnings changed`);
    }
  }
  console.log(`${passed} passed, ${failed} failed${written ? `, ${written} snapshot${written > 1 ? 's' : ''} written` : ''}`);
  if (failed) { console.log('Run pw test --update to accept the new pages.'); process.exit(1); }
}

async function cmdDiff(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { p: { type: 'string', multiple: true }, d: { type: 'string', multiple: true }, base: { type: 'string' } } });
  if (positionals.length !== 2) usage('give two report files');
  const data = Object.fromEntries(Object.entries(pairs(values.d)).map(([k, f]) => [k, readJson(f)]));
  const opts = { parameters: pairs(values.p), data, base: values.base, now: '2026-01-01T09:00:00' };
  const [a, b] = await Promise.all(positionals.map(f => renderModel(readJson(f), { ...opts, file: f })));
  if (!compare(path.basename(positionals[1]), a, b)) { console.log('No differences.'); return; }
  process.exit(1);
}

async function cmdAudit(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' }, json: { type: 'boolean' }, 'public-key': { type: 'string' } } });
  const audit = await import('../src/server/audit.js');
  if (positionals[0] === 'checkpoint') {
    const e = await audit.checkpoint({ actor: 'cli' });
    console.log(e ? `checkpoint ${e.id}: ${Object.keys(e.detail.heads).length} stream(s)` : 'nothing to checkpoint yet');
    return;
  }
  if (positionals[0] !== 'verify') usage('pw audit verify | pw audit checkpoint');
  for (const k of ['from', 'to']) if (values[k] && !/^\d{4}-\d{2}-\d{2}$/.test(values[k])) usage(`--${k} is a date, YYYY-MM-DD`);
  if (values['public-key']) process.env.PW_AUDIT_PUBLIC_KEY = fs.readFileSync(values['public-key'], 'utf8');
  const r = await audit.verifyAudit({ from: values.from, to: values.to, onProgress: values.json ? undefined : (n) => process.stderr.write(`\r${n} events checked`) });
  if (values.json) console.log(JSON.stringify(r, null, 2));
  else {
    process.stderr.write('\n');
    console.log(`${r.events} events (${r.unchained} from before the chain), ${r.streams} streams, ${r.checkpoints} checkpoints${r.lastCheckpoint ? `, the last signed at ${r.lastCheckpoint}` : ''}; key ${r.key.fingerprint} (${r.key.source})`);
    for (const p of r.problems) console.log(`  ${p.kind}: ${p.detail}${p.id ? ` [${p.id}]` : ''}${p.stream ? ` stream ${p.stream}` : ''}`);
    const say = { ok: 'OK: every checkpointed event is proven unchanged; none removed or added.', unverified: 'UNVERIFIED: nothing shows a change, but the log is not proven (see above).', tampered: 'TAMPERED: the audit log was changed (see above).', error: 'ERROR: the check could not finish (see above).' };
    console.log(say[r.status] || `UNKNOWN verdict "${r.status}"`);
    if (r.status === 'ok' && r.pending) console.log(`${r.pending} newer event(s) are not yet checkpointed.`);
  }
  if (r.status !== 'ok') process.exit(1); // anything but an explicit ok is a failure
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { render: cmdRender, test: cmdTest, diff: cmdDiff, audit: cmdAudit };
if (!commands[cmd]) usage(cmd && cmd !== 'help' && cmd !== '--help' ? `unknown command "${cmd}"` : '');
try { await commands[cmd](rest); } catch (e) { fail(e.message); }
