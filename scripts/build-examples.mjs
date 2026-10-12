// Builds site/examples/: the "Migration examples" page's data. Every example is produced by ReportWright's own batch
// importer (src/cli/importBatch.js) on an official sample file from the repository's corpora; nothing is written by hand.
//   site/examples/index.json                       the cards, coverage and sources (read by site/examples.js)
//   site/examples/<tool>/<name>/definition.pw.json the converted report (the importer's output, unchanged)
//   site/examples/<tool>/<name>/notes.json         the import result: stats, items not mapped, references, expressions
//   site/examples/<tool>/<name>/preview.pdf        only when the report renders from its own embedded sample data
//   site/examples/<tool>/<name>/thumb.png          the first page, when pdftoppm (poppler) is installed
// A report whose data comes from a database is not rendered: it is listed with "needs your database" and its design only.
// Runs from scripts/build-site.mjs (npm run build:site). site/examples/ is generated and gitignored.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { importFolder } from '../src/cli/importBatch.js';
import { render, FontStore } from '../src/engine/index.js';
import { fontFile } from '../src/engine/text/fonts.js';
import { exportPdf } from '../src/exporters/pdf.js';

const root = path.join(import.meta.dirname, '..');
const out = path.join(root, 'site', 'examples');
const PUB = fs.existsSync(path.join(root, 'public', 'fonts')) ? path.join(root, 'public')
  : path.join(path.dirname(createRequire(import.meta.url).resolve('@reportwright/fonts/package.json')), 'public');
const fontStore = new FontStore((k) => fs.readFileSync(path.join(PUB, 'fonts', fontFile(k))));
const REPO = 'https://github.com/MrArun005/reportwright/blob/main/';

/** The corpora. Only the redistributable ones are listed; the rest are in EXCLUDED with the reason. */
const CORPORA = [
  { tool: 'SSRS', slug: 'ssrs', dir: 'tests/fixtures/rdl/corpus', source: 'Microsoft SQL Server Reporting Services samples',
    licence: 'MIT', copyright: 'Copyright (c) Microsoft Corporation',
    licenceUrl: 'https://github.com/microsoft/Reporting-Services/blob/master/License.md',
    sourceUrl: 'https://github.com/microsoft/Reporting-Services', readme: 'tests/fixtures/rdl/corpus/README.md' },
  { tool: 'JasperReports', slug: 'jasperreports', dir: 'tests/fixtures/jrxml/corpus', source: 'JasperReports Library demo samples',
    licence: 'LGPL-3.0', copyright: 'Copyright (C) TIBCO Software Inc. / Cloud Software Group, Inc. and the JasperReports contributors',
    licenceUrl: 'https://github.com/TIBCOSoftware/jasperreports/blob/master/LICENSE',
    sourceUrl: 'https://github.com/TIBCOSoftware/jasperreports', readme: 'tests/fixtures/jrxml/corpus/README.md' },
  { tool: 'BIRT', slug: 'birt', dir: 'tests/fixtures/birt/corpus', source: 'Eclipse BIRT sample reports',
    licence: 'EPL-2.0', copyright: 'Eclipse Foundation and the BIRT contributors',
    licenceUrl: 'https://github.com/eclipse-birt/birt/blob/master/LICENSE',
    sourceUrl: 'https://github.com/eclipse-birt/birt', readme: 'tests/fixtures/birt/corpus/README.md' },
];
const EXCLUDED = [
  { tool: 'ActiveReports', files: 'tests/fixtures/rdlx/*.rdlx-json, site/switch/samples/*.rdlx-json',
    reason: 'No official ActiveReports sample is in the repository. These are the project\'s own importer fixtures, so there is no third-party sample to redistribute.' },
  { tool: 'SSRS (project fixture)', files: 'tests/fixtures/rdl/kitchen-sink.rdl, tests/fixtures/rdl/truncated.rdl',
    reason: 'Written for ReportWright\'s own importer tests (kitchen-sink) or a cut-off copy kept to test refusal (truncated). Not official samples.' },
  { tool: 'Switch samples', files: 'site/switch/samples/*', reason: 'Copies of corpus files and project fixtures; the corpus copies are already listed under their own tool.' },
];

/** Per-file upstream links, where the corpus README gives them (SSRS: a link per row; Jasper: the sample path). */
function upstreamLinks(c) {
  const map = new Map();
  if (!fs.existsSync(path.join(root, c.readme))) return map;
  const text = fs.readFileSync(path.join(root, c.readme), 'utf8');
  if (c.slug === 'ssrs') {
    for (const m of text.matchAll(/\|\s*`([^`]+\.rdl)`\s*\|[^\n]*?\]\((https:[^)\s]+)\)/g)) map.set(m[1], m[2]);
  } else if (c.slug === 'jasperreports') {
    for (const m of text.matchAll(/^\|\s*`([^`]+\.jrxml)`\s*\|\s*(JR \d)\s*\|\s*([^|\s]+)\s*\|/gm)) {
      const isJr6 = m[2] === 'JR 6';
      const base = isJr6 ? 'https://github.com/TIBCOSoftware/jasperreports/blob/jr-6-10-0/jasperreports/demo/samples/'
        : 'https://github.com/TIBCOSoftware/jasperreports/blob/master/demo/samples/';
      map.set(m[1], base + m[3]);
    }
  }
  return map;
}

/** Items of the definition: every object with a string type, depth first. */
function* nodes(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 200) return;
  yield o;
  for (const v of Array.isArray(o) ? o : Object.values(o)) if (v && typeof v === 'object') yield* nodes(v, depth + 1);
}

/**
 * Categories, derived from what the converted definition contains (and the report's name): an example can have several.
 * Rules: crosstabs = a matrix/crosstab item; charts = a chart/gauge/sparkline item; maps = a map item; subreports = a subreport item;
 * grouped = a group in the definition; drill-down = a drill-through/navigation link; parameters = a report parameter;
 * multi-language = a locale/translation key; lists/labels/letters = a list or table item, or a label/letter name;
 * invoices & forms = a name of an invoice, form, statement, order, receipt or letter.
 */
export function categoriesOf(def, name) {
  const types = new Set(), keys = new Set();
  let text = '';
  for (const o of nodes(def)) {
    for (const [k, v] of Object.entries(o)) {
      keys.add(k);
      if (k === 'type' && typeof v === 'string') types.add(v.toLowerCase());
    }
  }
  try { text = JSON.stringify(def).toLowerCase(); } catch { /* not serialisable: no text rules */ }
  const has = (re, set) => [...set].some(t => re.test(t));
  const n = String(name || '').toLowerCase() + ' ' + String(def.name || '').toLowerCase();
  const cats = new Set();
  if (has(/matrix|crosstab/, types) || /crosstab|matrix/.test(n)) cats.add('crosstabs');
  if (has(/chart|gauge|sparkline|bullet/, types) || /chart/.test(n)) cats.add('charts');
  if (has(/map/, types)) cats.add('maps');
  if (types.has('subreport') || has(/subreport/, keys)) cats.add('subreports');
  if (has(/^group/i, keys)) cats.add('grouped');
  if (/drill|navigat/.test(text)) cats.add('drill');
  if (Array.isArray(def.parameters) && def.parameters.length) cats.add('parameters');
  if (has(/^(locale|language|lang|i18n|translation|translations)$/i, keys)) cats.add('multilingual');
  if (has(/^(list|table)$/, types) || /label|letter|mailing|envelope/.test(n)) cats.add('lists');
  if (/invoice|form|statement|order|receipt|letter|transcript|certificate|business/.test(n)) cats.add('forms');
  return [...cats];
}

export const CATEGORIES = [
  ['forms', 'Invoices & forms'], ['grouped', 'Grouped & drill-down'], ['crosstabs', 'Crosstabs & matrices'],
  ['charts', 'Charts & dashboards'], ['subreports', 'Subreports & master-detail'], ['maps', 'Maps'],
  ['parameters', 'Parameters'], ['multilingual', 'Multi-language'], ['lists', 'Lists, labels & letters'],
];
// "drill" is a derived tag without its own column in the coverage table: it shows on the cards and in the filter.
const CAT_LABEL = Object.fromEntries([...CATEGORIES, ['drill', 'Drill-through']]);

/** The data a report reads: embedded in the file, or none needed. */
const embedded = (s) => (s.type === 'json' && s.data != null) || ((s.type === 'csv' || s.type === 'xml') && !!s.data);
const needsDatabase = (def) => (def.dataSources || []).some(s => !embedded(s));

function renderPdf(def) {
  return render(def, { fontStore, parameters: {}, now: new Date('2026-01-01T09:00:00'), fetch: () => Promise.reject(new Error('no network in the examples build')) })
    .then(async (model) => ({ pages: model.pages.length, pdf: await exportPdf(model, fontStore, {}) }));
}

function thumbOf(pdfFile, thumbFile) {
  try {
    const base = thumbFile.replace(/\.png$/, '');
    execFileSync('pdftoppm', ['-png', '-r', '40', '-f', '1', '-l', '1', '-singlefile', pdfFile, base], { stdio: 'ignore', timeout: 60000 });
    return fs.existsSync(thumbFile);
  } catch { return false; }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-examples-'));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const examples = [];
const sources = [];
for (const c of CORPORA) {
  const input = path.join(root, c.dir);
  const outDir = path.join(work, c.slug);
  const report = await importFolder(input, outDir, { log: () => {} });
  const links = upstreamLinks(c);
  sources.push({ tool: c.tool, slug: c.slug, source: c.source, licence: c.licence, copyright: c.copyright, licenceUrl: c.licenceUrl,
    sourceUrl: c.sourceUrl, corpus: c.dir, count: report.files.length });
  for (const rec of report.files) {
    const id = path.basename(rec.output || rec.source, '.pw.json');
    const name = path.basename(rec.source).replace(/\.[^.]+$/, '');
    const dir = path.join(out, c.slug, id);
    fs.mkdirSync(dir, { recursive: true });
    const original = { repo: REPO + c.dir + '/' + path.basename(rec.source), upstream: links.get(path.basename(rec.source)) || null };
    const stats = rec.stats || { items: 0, mapped: 0, approximated: 0, dropped: 0 };
    const droppedItems = (rec.items || []).filter(i => i.state !== 'mapped');
    const notes = { source: rec.source, tool: c.tool, format: rec.format, status: rec.status, error: rec.error || null, stats,
      licence: c.licence, original,
      notes: rec.notes || [], items: droppedItems.map(i => ({ name: i.name, state: i.state, line: i.line ?? null, column: i.column ?? null,
        notes: (i.notes || []).map(n => n.message) })),
      references: rec.references || [], expressions: (rec.expressions || []).map(e => ({ item: e.item, expression: e.expression })),
      render: { status: 'not imported' } };
    let cats = [];
    let defJson = null;
    if (rec.status === 'imported') {
      const file = path.join(outDir, rec.output);
      defJson = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.copyFileSync(file, path.join(dir, 'definition.pw.json'));
      cats = categoriesOf(defJson, name);
      if (needsDatabase(defJson)) {
        notes.render = { status: 'needs your database', reason: 'The report reads data from a database or a source with no sample data in the file. Only the design and the import notes are shown.' };
      } else {
        try {
          const { pages, pdf } = await renderPdf(defJson);
          const pdfFile = path.join(dir, 'preview.pdf');
          fs.writeFileSync(pdfFile, pdf);
          const thumb = thumbOf(pdfFile, path.join(dir, 'thumb.png'));
          notes.render = { status: 'rendered', pages, thumb };
        } catch (e) {
          notes.render = { status: 'failed', reason: e instanceof Error ? e.message : String(e) };
        }
      }
    }
    fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify(notes, null, 2) + '\n');
    examples.push({ id, tool: c.tool, slug: c.slug, name, title: defJson?.name || name, status: rec.status, stats,
      categories: cats.map(k => ({ id: k, label: CAT_LABEL[k] })), render: notes.render.status,
      thumb: notes.render.thumb === true, preview: notes.render.status === 'rendered',
      topNotes: [...notes.notes, ...droppedItems.flatMap(i => (i.notes || []).map(n => `${i.name}: ${n.message}`))].slice(0, 3),
      error: rec.error || null, licence: c.licence, original, dir: `${c.slug}/${id}` });
  }
}

// coverage: category x tool. ✅ every example in the cell imported with nothing dropped; ⚠️ some were approximated or dropped
// something, or did not import; ❌ no example in the cell.
const coverage = {};
for (const [id] of [...CATEGORIES]) {
  coverage[id] = {};
  for (const s of sources) {
    const cell = examples.filter(e => e.slug === s.slug && e.categories.some(c => c.id === id));
    const bad = cell.filter(e => e.status !== 'imported' || e.stats.dropped > 0).length;
    coverage[id][s.slug] = { n: cell.length, bad, symbol: cell.length === 0 ? '❌' : bad ? '⚠️' : '✅' };
  }
}
const totals = Object.fromEntries(sources.map(s => [s.slug, {
  reports: examples.filter(e => e.slug === s.slug).length,
  imported: examples.filter(e => e.slug === s.slug && e.status === 'imported').length,
  rendered: examples.filter(e => e.slug === s.slug && e.render === 'rendered').length,
  needsDatabase: examples.filter(e => e.slug === s.slug && e.render === 'needs your database').length,
}]));

const index = { generated: new Date().toISOString(), categories: [...CATEGORIES.map(([id, label]) => ({ id, label })), { id: 'drill', label: CAT_LABEL.drill }],
  sources, excluded: EXCLUDED, examples, coverage, totals };
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
fs.rmSync(work, { recursive: true, force: true });

const imported = examples.filter(e => e.status === 'imported').length;
const sum = (k) => Object.values(totals).reduce((a, t) => a + t[k], 0);
console.log(`examples: ${examples.length} reports, ${imported} imported, ${sum('rendered')} rendered, ${sum('needsDatabase')} need a database`);
if (!imported) throw new Error('no example imported: the importer or the corpora are broken');
