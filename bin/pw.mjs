#!/usr/bin/env node
// pw: render, test and diff ReportWright reports from the command line. No server needed.
// The same engine and exporters as the app; fonts come from public/fonts.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
import { pdfEncryptOptions } from '../src/exporters/encrypt.js';
import { exportPdf } from '../src/exporters/pdf.js';
import { exportPdfStream } from '../src/exporters/pdfstream.js';
import { spillSorter, canSpill } from '../src/exporters/spill.js';
import { createSubsetter } from '../src/exporters/subset.js';
import { exportHtml } from '../src/exporters/html.js';
import { exportCsv } from '../src/exporters/csv.js';
import { exportXlsx } from '../src/exporters/xlsx.js';
import { exportDocx } from '../src/exporters/docx.js';
import { exportPptx } from '../src/exporters/pptx.js';
import { textRows } from '../src/exporters/regions.js';
import enginePkg from '../package.json' with { type: 'json' }; // bundled into the npm CLI: the version of the engine it carries

const ROOT = path.join(import.meta.dirname, '..');
// fonts, harfbuzz-subset.wasm and the colour profile: the repo's public/, or the @reportwright/fonts package (the npm CLI)
const PUB = fs.existsSync(path.join(ROOT, 'public', 'fonts')) ? path.join(ROOT, 'public')
  : path.join(path.dirname(createRequire(import.meta.url).resolve('@reportwright/fonts/package.json')), 'public');
const HELP = `pw render <report.pw.json> [-p name=value]… [-d source=data.json]… [-f pdf|xlsx|docx|pptx|html|csv|json|txt] [-o file|-] [--base URL [--allow-internal]] [--pdfa] [--ua]
          [--values] [--static] [--layout]
          [--password PW] [--owner-password PW] [--deny print|modify|copy|annotate|fillForms|accessibility|assemble|printHighQuality]…
pw import <report.jrxml|.rdl|.rptdesign> [-o out.pw.json]
                                   convert a JasperReports, SSRS or BIRT report to a ReportWright definition
pw import <folder> -o <outDir> [--recursive] [--force] [--verify] [--report path] [--max-files N] [--max-bytes N]
                                   bulk import (.rdl, .rdlc, .rds, .jrxml, .jrtx, .rptdesign, .rdlx-json and images) into
                                   outDir with import-report.json and .html; never overwrites an output edited since the
                                   last import (--force does); exit 0 all imported, 2 some failed, 1 none (see the CLI README)
pw --version, pw -v                the CLI and engine versions
pw test [folder] [--update] [--layout]
                                   render every <folder>/__tests__/*.test.json case and compare it with its snapshot
                                   (the words; --layout: the layout, see the CLI README)
pw diff <old.pw.json> <new.pw.json> [-p name=value]… [-d source=data.json]… [--base URL]
SERVER ONLY (the self-hosted app, run in its folder; the npm CLI does not include these):
pw audit verify [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json] [--public-key file.pem]
                                   check the server's audit log (hash chain, signed checkpoints); run it in the app
                                   folder with the server's PW_STORAGE and PW_AUDIT_KEY / PW_SESSION_SECRET
pw audit checkpoint                write a signed checkpoint now
pw audit rekey --old-secret S | --old-key file.pem
                                   after changing PW_AUDIT_KEY / PW_AUDIT_SIGNING_KEY: hand the old key over, so the
                                   checkpoints it signed still check (a record signed by both keys)

  -p  a report parameter            -d  replace a data source with a JSON file
  -f  output format (default pdf)   -o  output file, or - for stdout
  --base  where relative data URLs go (e.g. http://localhost:3000)
  --allow-internal  the --base host may be a local or private address (data fetches refuse those otherwise)
  --password, --owner-password, --deny  a password-protected PDF (AES-256); --deny takes away a permission
  --ua  an accessible PDF (PDF/UA-1; with --pdfa, PDF/A-2a)   --values  Excel totals as values, not formulas
  --layout  CSV of the printed layout (every table, group lines, totals), not just the data
  --static  an HTML file without its Tables view (sort, groups, filter)
pw migrate-storage --to <url> [--from file|<url>]   (SERVER ONLY, as above)
                                   copy everything (reports and their versions, users, grants, folders, schedules,
                                   jobs, fonts, settings, blobs, the audit log) from one storage to another, e.g. the
                                   files in this folder to sqlite:/srv/pw.db or postgres://…; stop the server first
Exit codes: 0 ok, 1 a test failed, the pages differ or the audit log does not check, 2 bad usage.`;

// fontFile(k), not `${k}.ttf`: the shaper key is "harfbuzz" → harfbuzz.wasm (without it Arabic and Indic text is not shaped)
const fontStore = new FontStore((k) => fs.readFileSync(path.join(PUB, 'fonts', fontFile(k))));
// PDFs embed only the glyphs they use, as the server's do
const subset = createSubsetter(() => fs.promises.readFile(path.join(PUB, 'harfbuzz-subset.wasm')));
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

/** --allow-internal: the --base host may be a local or private address (the engine's fetch guard refuses one otherwise). */
const baseHost = (base, internal) => { try { return base && internal ? [new URL(base).hostname.replace(/^\[|\]$/g, '')] : []; } catch { return []; } };

async function renderModel(def, { parameters = {}, data, base, internal = false, now, state, file, exportData = true, dataOnly = false } = {}) {
  try {
    const m = await render(withData(def, data), { fontStore, parameters, exportData, dataOnly, baseUrl: base, allowHosts: baseHost(base, internal), now: now ? new Date(now) : undefined, ...(state ? { state } : {}), ...(file ? { loadReport: siblingLoader(file) } : {}) });
    // one line per warning: validate() and the render can name the same problem with different labels ("textbox:", "TextBox:")
    return { ...m, warnings: uniq(m.warnings) };
  } catch (e) { renderFailed(e, base); }
}
const uniq = (warnings) => { const seen = new Set(); return warnings.filter(w => !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase())); };
/** A render's error as the CLI says it. @param {any} e @param {string} [base] */
function renderFailed(e, base) {
  const relative = /fetch|URL|Invalid URL/i.test(e.message) && !base;
  // the engine names its option (allowHosts); a CLI user has the flag
  if (e.code === 'EPRIVATE' || /pass allowHosts:/.test(e.message)) e.message = e.message.replace(/\(pass allowHosts: \[[^\]]*\] to render to allow it\)/, '(pass --allow-internal with --base to allow it)');
  fail(`${e.message}${relative ? '\n    A data source needs a server: pass --base http://localhost:3000, or push the data with -d source=file.json.' : ''}`);
}

/**
 * -f pdf into a file: exportPdfStream writes a flowing table as it is laid out (its memory stays flat), else renders the
 * whole model and writes exportPdf's file (encrypted files, reports that cannot stream). Into a temporary file renamed
 * when the export succeeded, so a failed run leaves no damaged PDF (and an older file at the path as it was).
 */
async function writePdf(def, { parameters = {}, data, base, internal = false, file, exportData = false }, pdfOpts, out) {
  const d = withData(def, data);
  const tmp = `${out}.${process.pid}.part`;
  const sink = fs.createWriteStream(tmp);
  // N45: stopped by Ctrl+C, SIGTERM (Docker, Kubernetes, CI) or a closed terminal: remove the temporary file, exit 128+n
  const stop = (sig, n) => () => { sink.destroy(); fs.rmSync(tmp, { force: true }); process.exit(128 + n); };
  const sigs = [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]].map(([s, n]) => [s, stop(s, n)]);
  for (const [s, f] of sigs) process.once(s, f);
  try {
    const r = await exportPdfStream(d, { fontStore, subset, parameters, exportData, baseUrl: base, allowHosts: baseHost(base, internal), ...(file ? { loadReport: siblingLoader(file) } : {}),
      sorter: canSpill() ? spillSorter() : undefined, ...pdfOpts }, sink); // a sort's rows spill to temporary files
    await new Promise((ok, no) => { sink.once('error', no); sink.end(ok); });
    fs.renameSync(tmp, out);
    return { pages: r.pages, streamed: r.streamed, warnings: uniq(r.streamed ? r.warnings : r.warnings.slice(1)) }; // not "was not streamed": the CLI chose
  } catch (e) {
    sink.destroy();
    fs.rmSync(tmp, { force: true });
    renderFailed(e, base);
  } finally {
    for (const [s, f] of sigs) process.off(s, f);
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
function compare(label, before, after, out = console.log) {
  const pa = pageTexts(before), pb = pageTexts(after);
  let changed = false;
  if (pa.length !== pb.length) { out(`${label}: ${pa.length} pages → ${pb.length} pages`); changed = true; }
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
    const d = diffLines(pa[k] || [], pb[k] || []);
    if (!d.some(l => l[0] !== ' ')) continue;
    changed = true;
    out(`${label}: page ${k + 1} changed`);
    for (const l of d.slice(0, 60)) out(l);
    if (d.length > 60) out(`  … ${d.length - 60} more lines`);
  }
  return changed;
}

async function cmdRender(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { p: { type: 'string', multiple: true }, d: { type: 'string', multiple: true }, f: { type: 'string', default: 'pdf' }, o: { type: 'string' }, base: { type: 'string' }, 'allow-internal': { type: 'boolean' }, pdfa: { type: 'boolean' }, ua: { type: 'boolean' }, values: { type: 'boolean' }, layout: { type: 'boolean' }, static: { type: 'boolean' }, password: { type: 'string' }, 'owner-password': { type: 'string' }, deny: { type: 'string', multiple: true } } });
  if (positionals.length !== 1) usage('give one report file');
  const def = readJson(positionals[0]);
  const data = Object.fromEntries(Object.entries(pairs(values.d)).map(([k, f]) => [k, readJson(f)]));
  const fmt = values.f;
  // a plain PDF needs no table data (Excel, Word, the accessible PDF do)
  const ro = { parameters: pairs(values.p), data, base: values.base, internal: !!values['allow-internal'], file: positionals[0], exportData: !(fmt === 'pdf' && !values.ua) };
  let encrypt;
  try {
    encrypt = pdfEncryptOptions({ userPassword: values.password, ownerPassword: values['owner-password'], permissions: Object.fromEntries((values.deny || []).map(k => [k, false])) });
  } catch (e) { usage(e.message); }
  if (encrypt && fmt !== 'pdf') usage('--password, --owner-password and --deny apply to -f pdf only');
  if (encrypt && values.pdfa) usage('a PDF/A file cannot have a password');
  if (values.ua && fmt !== 'pdf') usage('--ua applies to -f pdf only');
  const out = values.o ?? `${path.basename(positionals[0]).replace(/\.pw\.json$|\.json$/, '')}.${fmt}`;
  const pdfOpts = () => ({ title: def.name, subset, encrypt, drillBase: values.base, pdfa: values.pdfa ? { icc: fs.readFileSync(path.join(PUB, 'icc', 'sRGB-v2-magic.icc')) } : undefined, tagged: values.ua ? { lang: def.locale || 'en' } : undefined });
  if (fmt === 'pdf' && out !== '-') {
    const r = await writePdf(def, ro, pdfOpts(), out);
    console.error(`pw: wrote ${out} (${r.pages} pages${r.streamed ? ', streamed' : ''}${r.warnings.length ? `, ${r.warnings.length} warnings` : ''})`);
    return;
  }
  // the data CSV skips the page layout; a report without a table falls back to its page text
  let model = fmt === 'csv' && !values.layout ? await renderModel(def, { ...ro, dataOnly: true }) : null;
  if (!model?.regions?.length) model = await renderModel(def, ro);
  let bytes;
  if (fmt === 'pdf') bytes = await exportPdf(model, fontStore, pdfOpts()); // -o -: the whole model, nothing half-written to stdout
  else if (fmt === 'html') bytes = await exportHtml(model, { fonts: fontStore, title: def.name, subset, static: !!values.static, locale: def.locale, currency: def.currency });
  else if (fmt === 'csv') bytes = exportCsv(model, { locale: def.locale, currency: def.currency, layout: !!values.layout });
  else if (fmt === 'xlsx') bytes = await exportXlsx(model, { currency: def.currency, title: def.name, formulas: !values.values, fontStore });
  else if (fmt === 'docx') bytes = await exportDocx(model, { title: def.name, lang: def.locale, fontStore });
  else if (fmt === 'pptx') bytes = await exportPptx(model, { title: def.name, lang: def.locale, fontStore });
  else if (fmt === 'json') bytes = JSON.stringify(model);
  else if (fmt === 'txt') bytes = snapshotText(def.name || positionals[0], model);
  else usage(`unknown format "${fmt}"`);
  if (out === '-') process.stdout.write(typeof bytes === 'string' ? bytes : Buffer.from(bytes));
  else { fs.writeFileSync(out, typeof bytes === 'string' ? bytes : Buffer.from(bytes)); console.error(`pw: wrote ${out} (${model.pages.length} pages${model.warnings.length ? `, ${model.warnings.length} warnings` : ''})`); }
}

/** The layout of every page, one line per item: its box (points, rounded to 0.5), size and colour; then each table's column widths. What pw test --layout compares. */
function layoutLines(model) {
  const r = (v) => Math.round(v * 2) / 2;
  const box = (b) => ['x', 'y', 'w', 'h'].filter(k => typeof b[k] === 'number').map(k => `${k}=${r(b[k])}`).join(' ');
  const out = [];
  model.pages.forEach((pg, i) => {
    out.push(`--- page ${i + 1}`);
    const tables = new Map();
    for (const it of pg.items.flatMap(x => (x.t === 'field' ? x.draw || [] : [x]))) {
      if (it.cell && !tables.has(it.cell.table)) tables.set(it.cell.table, it.cell.cols);
      if (it.t === 'text') {
        const first = it.lines?.[0] || {};
        out.push(`text ${box(it.clip || { x: first.x, y: first.y, w: first.w, h: it.size })} size=${it.size} color=${it.color} "${String(first.text ?? '').slice(0, 40)}"`);
      } else out.push(`${it.t} ${box(it)}${it.fill ? ` fill=${it.fill}` : ''}`.trimEnd());
    }
    for (const [name, cols] of tables) out.push(`table ${name} columns ${(cols || []).map(r).join(' ')}`);
  });
  return out;
}

async function cmdTest(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { update: { type: 'boolean' }, layout: { type: 'boolean' } } });
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
      // --layout (or the case's "layout": true) compares the layout; otherwise the words of each page
      const layout = !!values.layout || c.layout === true;
      const snapFile = path.join(testsDir, `${id}.${c.name}.${layout ? 'layout.' : ''}snap.txt`);
      const text = layout ? layoutLines(model).join('\n') + '\n' : snapshotText(label, model);
      if (values.update || !fs.existsSync(snapFile)) { fs.writeFileSync(snapFile, text); written++; passed++; continue; }
      const old = fs.readFileSync(snapFile, 'utf8');
      if (old === text) { passed++; continue; }
      failed++;
      if (layout) {
        const d = diffLines(old.split('\n'), text.split('\n'));
        console.log(`${label}: the layout changed`);
        for (const l of d.slice(0, 60)) console.log(l);
        if (d.length > 60) console.log(`  … ${d.length - 60} more lines`);
        continue;
      }
      const pages = old.split(/\n--- page \d+\n/).slice(1).map(s => s.split('\n--- warnings\n')[0].replace(/\n$/, '').split('\n'));
      if (!compare(label, { pages: pages.map(lines => ({ items: [{ t: 'text', lines: lines.map((text, y) => ({ text, x: 0, y })) }] })) }, model)) console.log(`${label}: the warnings changed`);
    }
  }
  console.log(`${passed} passed, ${failed} failed${written ? `, ${written} snapshot${written > 1 ? 's' : ''} written` : ''}`);
  if (failed) { console.log('Run pw test --update to accept the new pages.'); process.exit(1); }
}

async function cmdDiff(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { p: { type: 'string', multiple: true }, d: { type: 'string', multiple: true }, base: { type: 'string' }, 'allow-internal': { type: 'boolean' } } });
  if (positionals.length !== 2) usage('give two report files');
  const data = Object.fromEntries(Object.entries(pairs(values.d)).map(([k, f]) => [k, readJson(f)]));
  const opts = { parameters: pairs(values.p), data, base: values.base, internal: !!values['allow-internal'], now: '2026-01-01T09:00:00' };
  const [a, b] = await Promise.all(positionals.map(f => renderModel(readJson(f), { ...opts, file: f })));
  if (!compare(path.basename(positionals[1]), a, b)) { console.log('No differences.'); return; }
  process.exit(1);
}

async function cmdAudit(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' }, json: { type: 'boolean' }, 'public-key': { type: 'string' }, 'old-secret': { type: 'string' }, 'old-key': { type: 'string' } } });
  const audit = await import('../src/server/audit.js');
  if (positionals[0] === 'rekey') {
    const { createPrivateKey } = await import('node:crypto');
    const old = values['old-key'] ? createPrivateKey(fs.readFileSync(values['old-key'], 'utf8')) : values['old-secret'] ? audit.keyFromSecret(values['old-secret']) : usage('give --old-secret or --old-key');
    const e = await audit.rekey(old);
    console.log(`re-keyed: ${e.detail.oldFingerprint} -> ${e.detail.newFingerprint} (${e.id})`);
    return;
  }
  if (positionals[0] === 'checkpoint') {
    const e = await audit.checkpoint({ actor: 'cli' });
    console.log(e ? `checkpoint ${e.id}: ${Object.keys(e.detail.heads).length} stream(s)` : 'nothing to checkpoint yet');
    return;
  }
  if (positionals[0] !== 'verify') usage('pw audit verify | pw audit checkpoint | pw audit rekey');
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
  if (!audit.auditProven(r)) process.exit(1); // anything but an explicit status "ok" is a failure
}

const [cmd, ...rest] = process.argv.slice(2);
async function cmdMigrateStorage(args) {
  const { values } = parseArgs({ args, options: { from: { type: 'string' }, to: { type: 'string' } } });
  if (!values.to) usage('migrate-storage needs --to <url>');
  const { copyStorage } = await import('../src/server/storage/copy.js');
  const n = await copyStorage(values.from || 'file', values.to, (msg) => process.stderr.write(`${msg}\n`));
  console.log(`copied ${n.records} records, ${n.versions} versions and ${n.audit} audit events to ${values.to.replace(/\/\/[^@/]*@/, '//***@')}`);
}

async function cmdImport(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { o: { type: 'string' }, recursive: { type: 'boolean' }, force: { type: 'boolean' }, verify: { type: 'boolean' }, report: { type: 'string' }, 'max-files': { type: 'string' }, 'max-bytes': { type: 'string' } } });
  if (positionals.length !== 1) usage('give one .jrxml, .rdl or .rptdesign file, or a folder');
  const file = positionals[0];
  if (fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()) return importFolderCmd(file, values);
  if (values.recursive || values.force || values.verify || values.report) usage('--recursive, --force, --verify and --report are for a folder');
  const { importXmlReport, decodeXml } = await import('../src/importers/index.js');
  const r = importXmlReport(decodeXml(fs.readFileSync(file)), { name: path.basename(file).replace(/\.[^.]+$/, '') });
  // the error is one of the warnings too (with what it means for the report): print it once
  for (const w of r.warnings) console.error(`pw: ${w}`);
  if (r.error) { if (r.warnings.some(w => w.startsWith(r.error))) process.exit(1); fail(r.error); }
  const out = values.o || file.replace(/\.[^.]+$/, '.pw.json');
  const json = JSON.stringify(r.definition, null, 2) + '\n';
  if (out === '-') process.stdout.write(json); else fs.writeFileSync(out, json);
  if (out !== '-') console.error(`${out}: ${r.stats.items} items (${r.stats.mapped} mapped, ${r.stats.approximated} approximated, ${r.stats.dropped} dropped)`);
}

/** pw import <folder>: see src/importers/batch.js. */
async function importFolderCmd(dir, values) {
  if (!values.o || values.o === '-') usage('pw import <folder> needs -o <outDir>');
  const num = (k) => { const v = values[k]; if (v == null) return undefined; if (!/^\d+$/.test(v) || !(Number(v) > 0)) usage(`--${k} is a positive whole number`); return Number(v); };
  const { importFolder, reportHtml, exitCode } = await import('../src/importers/batch.js');
  const report = await importFolder(dir, values.o, { recursive: !!values.recursive, force: !!values.force, maxFiles: num('max-files'), maxBytes: num('max-bytes'),
    verify: values.verify ? verifyImported : undefined, log: (m) => console.error(`pw: ${m}`) });
  const json = values.report && /\.json$/i.test(values.report) ? values.report : path.join(values.report || values.o, 'import-report.json');
  const html = json.replace(/\.json$/i, '.html');
  fs.mkdirSync(path.dirname(json), { recursive: true });
  fs.writeFileSync(json, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(html, reportHtml(report));
  const s = report.summary;
  console.error(`pw: ${s.imported} of ${s.reports} reports imported${s.failed ? `, ${s.failed} failed` : ''}${s.skippedEdited ? `, ${s.skippedEdited} edited outputs kept` : ''}${s.unresolved ? `, ${s.unresolved} unresolved references` : ''}${s.refused ? `, ${s.refused} files refused` : ''}; report: ${html}`);
  process.exitCode = exitCode(report);
}

/**
 * pw import --verify: render an imported report with its embedded data, or <id>.data.json beside it ({ source: rows }),
 * and compare it with the output it replaced (pw diff's comparison), if any. No network requests.
 */
async function verifyImported({ file, definition, baseline }) {
  const sample = file.replace(/\.pw\.json$/, '.data.json');
  let data = {};
  if (fs.existsSync(sample)) data = readJson(sample);
  const embedded = (s) => (s.type === 'json' && s.data != null) || ((s.type === 'csv' || s.type === 'xml') && !!s.data);
  const missing = (definition.dataSources || []).filter(s => !embedded(s) && !Object.hasOwn(data, s.name)).map(s => `"${s.name}"`);
  if (missing.length) return { status: 'skipped', note: `no data for ${missing.join(', ')}: it is not embedded, and there is no ${path.basename(sample)}` };
  const go = (def) => render({ ...def, dataSources: (def.dataSources || []).map(s => (Object.hasOwn(data, s.name) ? { name: s.name, type: 'json', data: data[s.name] } : s)) },
    { fontStore, parameters: {}, now: new Date('2026-01-01T09:00:00'), loadReport: siblingLoader(file), fetch: () => Promise.reject(new Error('pw import --verify makes no network requests')) });
  const model = await go(definition);
  if (!baseline) return { status: 'ok', pages: model.pages.length, warnings: model.warnings.length, note: 'renders (no earlier output to compare with)' };
  const diff = [];
  const changed = compare(path.basename(file), await go(baseline), model, (l) => diff.push(l));
  return { status: changed ? 'changed' : 'ok', pages: model.pages.length, warnings: model.warnings.length, note: changed ? 'renders differently from the output it replaced' : 'renders the same as the output it replaced', diff };
}

const commands = { render: cmdRender, import: cmdImport, test: cmdTest, diff: cmdDiff, audit: cmdAudit, 'migrate-storage': cmdMigrateStorage };
if (cmd === '--version' || cmd === '-v') {
  // the CLI's package.json (the repository's, or @reportwright/cli's next to dist/), and the engine bundled with it
  const cli = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  console.log(`pw ${cli.version} (${cli.name}), engine ${enginePkg.version}`);
  process.exit(0);
}
if (!commands[cmd]) usage(cmd && cmd !== 'help' && cmd !== '--help' ? `unknown command "${cmd}"` : '');
try { await commands[cmd](rest); } catch (e) { fail(e.message); }
