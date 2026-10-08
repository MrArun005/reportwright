// "Switch to ReportWright" page. Imports run in this page (site/switch/importers.js is src/importers bundled by
// scripts/build-switch-importers.mjs); nothing is uploaded. The designer and viewer mount the way site.js does.
import { INVOICE_REPORT, RW_CODE, OTHERS, CONCEPTS } from './switch/snippets.js';

const SERVER = new URL('.', document.baseURI).href.replace(/\/$/, '');
let viewerMod = null, designerMod = null, importersMod = null;
const loadViewer = () => (viewerMod ||= import(`${SERVER}/embed/esm/viewer.js`));
const loadDesigner = () => (designerMod ||= import(`${SERVER}/embed/esm/designer.js`));
const loadImporters = () => (importersMod ||= import('./switch/importers.js'));

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const fail = (host, e) => { host.replaceChildren(el('p', { className: 'host-msg', textContent: `Could not load: ${e.message}` })); console.error(e); };

/* ---------- theme (same as site.js) ---------- */
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const syncHosts = () => { for (const h of document.querySelectorAll('.mount')) h.dataset.theme = isDark() ? 'dark' : 'light'; };
const mountBox = () => { const b = el('div', { className: 'mount', style: 'height:100%' }); b.dataset.theme = isDark() ? 'dark' : 'light'; return b; };
$('#theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('pw-site-theme', next); } catch {}
  syncHosts();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncHosts);
syncHosts();

const whenNear = (node, fn) => {
  const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '300px 0px' });
  io.observe(node);
};

/* ---------- 01 import ---------- */
const SAMPLES = [
  ['SSRS', [['rs-Transcript.rdl', 'Certification transcript', 'Microsoft sample · lists, tables, image'], ['kitchen-sink.rdl', 'Kitchen sink', 'one report using most of RDL 2016 · SQL']]],
  ['ActiveReportsJS', [['invoice.rdlx-json', 'Invoice', 'inline data · master and detail'], ['regional-sales.rdlx-json', 'Regional sales', 'chart · matrix · Lookup']]],
  ['JasperReports', [['jr7-tabular-TabularReport.jrxml', 'Tabular report', 'JasperReports 7.x format'], ['jr6-charts-PieChartReport.jrxml', 'Pie chart', 'JasperReports 6 · SQL']]],
  ['BIRT', [['sum-total.rptdesign', 'Sum total', 'smallest file · SQL'], ['Grouping-CustomerListAfter_Grouping.rptdesign', 'Customer list, grouped', 'BIRT tutorial sample']]],
];
const KIND = (n) => (/\.rdlx-json$/i.test(n) ? 'ActiveReportsJS' : /\.rdlc?$/i.test(n) ? 'SSRS' : /\.jrxml$/i.test(n) ? 'JasperReports' : /\.rptdesign$/i.test(n) ? 'BIRT' : null);
const stage = $('#stage');
let designer = null, viewer = null, current = null, view = 'designer', runId = 0;

for (const [tool, files] of SAMPLES) {
  $('#samples').append(el('div', { className: 'sample-row' }, el('span', { className: 'sample-tool', textContent: tool }),
    ...files.map(([f, t, k]) => {
      const b = el('button', { type: 'button', className: 'btn', title: k, textContent: t });
      b.addEventListener('click', async () => {
        try { const r = await fetch(`switch/samples/${f}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); load(f, await r.text()); }
        catch (e) { fail(stage, e); }
      });
      return b;
    })));
}

// the preview is never an empty box: open the first sample (the SSRS transcript) when the stage comes near, unless a file was chosen first
whenNear(stage, async () => {
  if (runId) return;
  const [f] = SAMPLES[0][1][0];
  try { const r = await fetch(`switch/samples/${f}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); if (!runId) load(f, await r.text()); }
  catch (e) { fail(stage, e); }
});

const drop = $('#drop'), fileIn = $('#file');
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) readFile(f); });
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) readFile(f); });
// the whole window must not navigate away when a file misses the box
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { if (!e.target.closest?.('#drop')) e.preventDefault(); });

const readFile = async (f) => load(f.name, await f.text());

async function load(name, text) {
  const run = ++runId;
  const kind = KIND(name);
  if (!kind) return showError(name, `${name} is not a file this page reads. Use .rdl, .rdlc, .rdlx-json, .jrxml or .rptdesign.`);
  let r;
  try {
    const { importXmlReport, importRdlx } = await loadImporters();
    r = kind === 'ActiveReportsJS' ? importRdlx(text, { name: name.replace(/\.[^.]+$/, '') }) : importXmlReport(text, { name: name.replace(/\.[^.]+$/, '') });
  } catch (e) { return showError(name, `The importer stopped on ${name}: ${e.message}`); }
  if (run !== runId) return;
  if (r.error) return showError(name, r.error, r.warnings);
  current = { name, kind, ...r };
  showResult();
  open();
}

function showError(name, msg, warnings = []) {
  $('#result').hidden = false;
  $('#res-title').textContent = `Could not import ${name}`;
  $('#res-stats').textContent = msg;
  $('#res-warn').replaceChildren(...warnings.map(w => el('li', { textContent: w })));
  $('#res-note').textContent = '';
  $('#res-download').hidden = true;
  current = null;
}

function showResult() {
  const { name, kind, definition, warnings, stats } = current;
  $('#result').hidden = false;
  $('#res-download').hidden = false;
  $('#res-title').textContent = `${name} (${kind})`;
  $('#res-stats').textContent = stats
    ? `${stats.items} items: ${stats.mapped} converted as they were, ${stats.approximated} approximated, ${stats.dropped} left out. ${warnings.length} note${warnings.length === 1 ? '' : 's'}.`
    : `${warnings.length} note${warnings.length === 1 ? '' : 's'}.`;
  $('#res-warn').replaceChildren(...(warnings.length ? warnings : ['The importer had nothing to report for this file.']).map(w => el('li', { textContent: w })));
  const sql = (definition.dataSources || []).filter(s => s.type === 'sql');
  $('#res-note').textContent = sql.length
    ? `${sql.length === 1 ? 'A data source in this report reads from a SQL database' : sql.length + ' data sources in this report read from SQL databases'}. SQL runs on the ReportWright server, not in this page, so the Preview tab shows the layout without those rows. The connection string is never imported.`
    : '';
  $('#res-note').textContent += (sql.length ? ' ' : '') + 'If the file points at images by URL, the preview fetches them, as a browser would.';
}

// SQL runs on the ReportWright server, so in this page a SQL source is previewed as an empty JSON source: the layout, no rows.
const previewable = (def) => ({ ...def, dataSources: (def.dataSources || []).map(s => (s.type === 'sql' ? { name: s.name, type: 'json', data: [] } : s)) });

async function open() {
  if (!current) return;
  const run = runId;
  designer?.unmount(); designer = null; viewer?.unmount(); viewer = null;
  stage.replaceChildren(el('p', { className: 'host-msg', textContent: view === 'designer' ? 'Loading the designer…' : 'Loading the viewer…' }));
  try {
    const box = mountBox();
    if (view === 'designer') {
      const { mountDesigner } = await loadDesigner();
      if (run !== runId) return;
      stage.replaceChildren(box);
      designer = mountDesigner(box, { server: SERVER, definition: current.definition, height: '100%', onSave: () => {}, panels: { data: true, inspector: true } });
    } else {
      const { mountViewer } = await loadViewer();
      if (run !== runId) return;
      stage.replaceChildren(box);
      viewer = mountViewer(box, { server: SERVER, definition: previewable(current.definition), height: '100%', title: current.name });
    }
  } catch (e) { fail(stage, e); }
}
for (const [id, v] of [['#tab-designer', 'designer'], ['#tab-preview', 'preview']]) {
  $(id).addEventListener('click', () => {
    view = v;
    $('#tab-designer').setAttribute('aria-selected', String(v === 'designer'));
    $('#tab-preview').setAttribute('aria-selected', String(v === 'preview'));
    open();
  });
}
$('#res-download').addEventListener('click', () => {
  if (!current) return;
  const def = designer?.getDefinition?.() || current.definition;
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' })), download: `${current.name.replace(/\.[^.]+$/, '')}.pw.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------- 02 what does not carry over ---------- */
const GAPS = [
  ['SSRS / Report Builder', 'API.md "SSRS import", FEATURES.md; 32 Microsoft samples import with no item dropped', [
    'Maps and custom report items are left out, with a note.',
    'RDL 2005 Table, Matrix and List are not read: upgrade the file in Report Builder first.',
    'Custom code (<code>Code.</code> calls) is kept as text and never run; rewrite what you need as report functions.',
    'Gauges are approximated: a half-circle gauge with the first pointer\'s value and the scale\'s minimum and maximum.',
    'Shared data sets, XML, SharePoint and cube (MDX) sources come across with no rows.',
    '<code>InScope</code>, <code>User!</code> and <code>ReportItems!</code> of another region stay visible as text.',
    'Connection strings are not imported; set <code>PW_DB_&lt;NAME&gt;</code> on the server.',
  ]],
  ['ActiveReportsJS', 'API.md, FEATURES.md; the repository\'s sample files import with their notes', [
    'Custom JavaScript code is not run. The note lists the functions to rewrite.',
    'A second section\'s own page header or footer is not kept: the first section\'s is used on every page.',
    'Master reports, report parts and layers are mapped, but you import each library and master as its own report; the notes give the id to save each under.',
    'Themes use <code>Theme.Colors.Accent1</code>, not ActiveReports\' <code>!</code> syntax.',
    'Data providers other than JSON, CSV, XML and SQL come across with no rows.',
    'The designer\'s own Import menu does not take <code>.rdlx-json</code> yet (found while building this page); drop it on this page or import it through the server.',
  ]],
  ['JasperReports', 'API.md "JasperReports import"; 49 demo samples, 99.8% of 1,492 elements kept', [
    'Crosstabs, table components, generic elements and multi-axis charts are not converted (noted).',
    'Markup (HTML, styled text) shows as plain text; rotated text is not rotated.',
    'Rows from Java code (a data source) have no equivalent: point a JSON source at the data.',
    'Scriptlet-set variables, <code>PAGE_COUNT</code> and <code>COLUMN_*</code> variables show as text.',
    'Expressions with <code>instanceof</code>, <code>new SimpleDateFormat(…)</code>, Groovy <code>${}</code> strings and <code>$R{}</code> resource bundles stay as text with a note.',
    'Background, no-data and last-page-footer bands are noted, not kept. Relative image paths need a full URL or data URI.',
  ]],
  ['BIRT', 'API.md "BIRT import"; 29 samples, 99.5% of 649 items kept', [
    'Charts, crosstabs, items from libraries and event scripts are not converted (noted).',
    'HTML values show as text.',
    'Several master pages: only the first is used.',
    'Joint and scripted data sets get a note; flat-file, XML and scripted sources need a JSON source pointed at the data.',
    'BIRT JavaScript statements, <code>reportContext</code>, <code>vars</code>, filtered aggregates and ranks show as text.',
  ]],
];
$('#gap-grid').append(...GAPS.map(([t, src, items]) => {
  const a = el('article', {}, el('h3', { textContent: t }), el('p', { className: 'src', textContent: src }));
  const ul = el('ul'); for (const i of items) ul.append(el('li', { innerHTML: i })); a.append(ul);
  return a;
}));
$('#code-gap-grid').append(...[
  ['A rewrite, once', ['There is no code-to-definition converter. You describe the layout as a report definition, by hand or in the designer; the concept map above is the translation guide.', 'Logic that lived in your code (loops, conditionals, number formatting) becomes expressions, table groups and cell formats.']],
  ['Output differences', ['Word export leaves charts out.', 'Word and Excel exports draw no rounded corners.', 'Scripts beyond the bundled fonts (for example Sinhala, Tibetan, Malayalam) need an uploaded font.']],
  ['What you give up', ['Puppeteer renders anything a browser can; ReportWright lays out its own report items, so arbitrary HTML and CSS pages are not what it takes in.', 'pdfmake, react-pdf and PDFKit run entirely in your code; ReportWright\'s designer and viewer are extra parts you adopt (or ignore: <code>render()</code> and <code>exportPdf()</code> work alone in Node).']],
].map(([t, items]) => {
  const a = el('article', {}, el('h3', { textContent: t }));
  const ul = el('ul'); for (const i of items) ul.append(el('li', { innerHTML: i })); a.append(ul);
  return a;
}));

/* ---------- 03 code comparison ---------- */
const pick = $('#lib-pick');
for (const [k, v] of Object.entries(OTHERS)) pick.append(el('option', { value: k, textContent: v.label }));
const NOTES = {
  pdfmake: 'From pdfmake\'s documented API (<code>createPdf</code>, <code>content</code>, <code>table.headerRows</code> / <code>widths</code> / <code>body</code>). Not run for this page.',
  reactpdf: 'From @react-pdf/renderer\'s documented API (<code>Document</code>, <code>Page</code>, <code>View</code>, <code>Text</code>, <code>renderToFile</code>). Not run for this page. Rows are flex rows you build; there is no table component.',
  puppeteer: 'From Puppeteer\'s documented API (<code>setContent</code>, <code>page.pdf</code>). Not run for this page. It needs a Chromium that Puppeteer downloads and starts.',
  pdfkit: 'From PDFKit\'s documented API (<code>PDFDocument</code>, <code>text(x, y)</code>, <code>pipe</code>, <code>end</code>). Not run for this page. It has no table object, so this sketch does not break across pages; you add pages yourself.',
};
const setLib = () => {
  const v = OTHERS[pick.value];
  $('#their-h').textContent = `Theirs: ${v.label}`;
  $('#their-code').textContent = v.code;
  $('#their-note').innerHTML = NOTES[pick.value];
};
pick.addEventListener('change', setLib);
setLib();
$('#our-code').textContent = RW_CODE;
$('#concept-rows').append(...CONCEPTS.map(([a, b]) => el('tr', {}, el('td', { innerHTML: a }), el('td', { innerHTML: b }))));

const live = $('#live');
whenNear(live, async () => {
  try {
    const { mountViewer } = await loadViewer();
    const box = mountBox();
    live.replaceChildren(box);
    mountViewer(box, { server: SERVER, definition: INVOICE_REPORT, height: '100%', title: 'Invoice' });
  } catch (e) { fail(live, e); }
});
