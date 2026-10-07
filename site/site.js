// ReportWright demo site. No server: the viewer and designer come from embed/esm, and the few API paths they read
// (api/reports/<id>, api/fonts, api/sample/...) are static files written by scripts/build-site.mjs.

/** The one "Get it" call to action. Change it here; every [data-get-it] link on the page follows. */
const GET_IT = { label: 'Get it', href: '#embed' };

// Everything is relative to this page, so the site works at any path on any static host.
const SERVER = new URL('.', document.baseURI).href.replace(/\/$/, '');
let viewerMod = null, designerMod = null;
const loadViewer = () => (viewerMod ||= import(`${SERVER}/embed/esm/viewer.js`));
const loadDesigner = () => (designerMod ||= import(`${SERVER}/embed/esm/designer.js`));

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

for (const a of document.querySelectorAll('[data-get-it]')) { a.href = GET_IT.href; a.textContent = GET_IT.label; }

/* ---------- theme ---------- */
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
// the viewer and designer live in shadow roots; their dark theme follows data-theme on the host element
const syncHosts = () => { for (const h of document.querySelectorAll('.mount')) h.dataset.theme = isDark() ? 'dark' : 'light'; };
/** The element a viewer or designer mounts in (its shadow host). */
const mountBox = () => { const b = el('div', { className: 'mount', style: 'height:100%' }); b.dataset.theme = isDark() ? 'dark' : 'light'; return b; };
$('#theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('pw-site-theme', next); } catch {}
  syncHosts();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncHosts);
syncHosts();

/** Run fn once, when the element is near the viewport. */
const whenNear = (node, fn) => {
  const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '300px 0px' });
  io.observe(node);
};
const fail = (host, e) => { host.replaceChildren(el('p', { className: 'host-msg', textContent: `Could not load: ${e.message}` })); console.error(e); };

/* ---------- gallery ---------- */
const DEMOS = [
  { id: 'sales-dashboard', title: 'Sales dashboard', k: 'charts · matrix · sparklines',
    what: 'Column, donut and line charts, a region × product matrix, per-city sparklines, data bars and bullets against a cap, and a QR code, on one A4 page.',
    try: 'Switch the year in the parameter panel; every chart and total re-renders.' },
  { id: 'sales-explorer', title: 'Sales explorer', k: 'drill-down · drill-through',
    what: 'Region › city › product groups that open and close with the totals and paging kept correct, sortable headers, and charts you can click.',
    try: 'Click a bar or a blue city name to drill through to the city report, then back with the breadcrumb. ▶ expands a group.' },
  { id: 'stress-ledger', title: 'Stress ledger', k: '5,000 rows · drill-down · pivot', designer: true,
    what: '5,000 deliberately messy transactions (nulls, Unicode, bad dates, mixed types): KPIs, five charts, a 3-level region › branch › account ledger that opens and closes, a pivot, a contents page and barcodes, over 300 pages. Its one warning is real: the data has Japanese text and this site ships no CJK font.',
    try: 'Expand a region with ▶, change Regions and watch Branches cascade, then click an account ID to drill through to its detail report.' },
  { id: 'torture-test-designer', title: 'Torture test', k: '18 pages · combo chart · bookmarks', designer: true,
    what: 'A 180-loan lending portfolio: cover with a QR code, numbered contents, KPI band, region × product pivot, combo chart on two axes, a grouped register with sparklines, and loan detail pages.',
    try: 'Untick a region or a status in the parameters, sort the register by a column header, or click a watchlist loan to jump to its detail page.' },
  { id: 'charts-showcase', title: 'Charts', k: 'every chart type · overlays · palettes',
    what: 'Column, bar, line, area, pie, donut, scatter, bubble, radar, polar, candlestick, OHLC, gauge and funnel; trend lines, moving averages, reference bands, data-label templates and the palettes, all drawn by the engine.',
    try: 'Export the PDF and compare it with the screen: the charts are the same drawing, not a screenshot.' },
  { id: 'tablix-showcase', title: 'Pivot tables', k: 'pivot · merged cells · recursive groups',
    what: 'Region › city × year pivots with % of row and subtotals, merged header cells, a recursive cost hierarchy, a three-across grid list, and an 18-month table wider than the page that continues with its first column repeated.',
    try: 'Page to the wide table: the columns that do not fit move to the next page and the region column comes with them.' },
  { id: 'reuse-showcase', title: 'Master report and parts', k: 'master · part library · theme · layers', designer: true,
    what: 'A content report placed inside a master report (header, footer, styles), report parts inserted linked and as a copy from a part library, a theme chosen by a parameter, and screen-only and designer-only layers.',
    try: 'Open it in the Designer playground below: the master\'s items are drawn locked around the content, and the designer-only Notes layer appears.' },
  { id: 'invoice-gallery', title: 'Invoice', k: 'table gallery · totals',
    what: 'An invoice made with the designer\'s table gallery: grouped lines, formats, totals and a "Page n of m" footer.',
    try: 'Export it: PDF, Excel and Word buttons are in the toolbar (on a phone, under More).' },
  { id: 'loan-statement', title: 'Loan statement', k: 'REST data · long table',
    what: 'A multi-page amortisation statement from a REST source, with a repeating header row and running balances.',
    try: 'Change the loan account parameter to LN-2025-001982 for a different borrower and schedule.' },
  { id: 'loan-statement-hindi', title: 'Loan statement (Hindi)', k: 'HarfBuzz · Devanagari',
    what: 'The same statement with Hindi body text, shaped by HarfBuzz. The original uses an uploaded brand font; with no font server here it falls back to Inter and the bundled Noto Sans Devanagari, as designed.',
    try: 'Search for a Hindi word with the search box; export the PDF and the text stays shaped.' },
  { id: 'product-catalogue', title: 'Product catalogue', k: 'interactive filters · 194 products',
    what: 'A catalogue health report over 194 products: bar and donut charts, a category × availability matrix, bullets and data bars. Data is a dummyjson.com snapshot shipped with this site.',
    try: 'Click a bar, a slice or a brand to filter; click a product to drill through to its detail page.' },
  { id: 'parameter-editors', title: 'Parameter editors', k: 'slider · range · date range',
    what: 'Every parameter editor: slider, numeric range, date range, radio, multi-select list and toggle, laid out as a grid above the pages.',
    try: 'Drag the amount range or narrow the dates; the report re-runs as you change them.' },
  { id: 'expressions-showcase', title: 'Expressions', k: 'functions · nested data · CSV',
    what: 'Aggregates, report functions, TopN, Previous, Between filters over a CSV source, and nested data sets, each with its result.',
    try: 'Change the minimum score parameter and watch the TopN table and the filtered rows.' },
  { id: 'richtext-showcase', title: 'Rich text', k: 'HTML runs · lists · vertical text',
    what: 'Mixed bold, italic, colour, highlight, sub- and superscript in one paragraph, nested lists, links, and vertical text, all laid out by the engine.',
    try: 'Export to PDF and compare: the line breaks are the same.' },
  { id: 'platform-showcase', title: 'Barcodes, images, TOC', k: 'QR · Data Matrix · PDF417',
    what: 'A numbered table of contents with final page numbers, linear and 2-D barcodes drawn as vectors, embedded and data-bound images.',
    try: 'Zoom in on a barcode: it stays sharp. Click a contents line to jump to its heading.' },
  { id: 'style-showcase', title: 'Text and styling', k: 'justify · shrink-to-fit · rotation',
    what: 'Justified paragraphs, shrink-to-fit, rotated labels, strike-through, links and a background image with text over it.',
    try: 'Open the PDF export side by side; the justified lines break at the same words.' },
  { id: 'imported-regional-sales', title: 'Imported from ActiveReports', k: '.rdlx-json import',
    what: 'A report converted from an ActiveReportsJS .rdlx-json file by the importer: chart, matrix, Lookup and share-of-total expressions kept.',
    try: 'Pick fewer regions in the parameters; the chart, matrix and shares follow.' },
  { id: 'imported-ssrs-transcript', title: 'Imported from SSRS', k: '.rdl import · Microsoft sample',
    what: 'A Microsoft SQL Server Reporting Services sample report (a certification transcript), converted from .rdl by the importer: lists, tables, an embedded image and the page footer kept.',
    try: 'Export it to Word or Excel: an SSRS report, now rendered with no SSRS server.' },
];

const list = $('#demo-list');
const host = $('#gallery-viewer');
let current = null, handle = null, galleryLive = false;
const tabs = DEMOS.map((d) => {
  const b = el('button', { type: 'button', role: 'tab', id: `tab-${d.id}` }, el('span', { className: 't', textContent: d.title }), el('span', { className: 'k', textContent: d.designer ? `designer-built · ${d.k}` : d.k }));
  b.setAttribute('aria-controls', 'gallery-viewer');
  b.addEventListener('click', () => { show(d.id); history.replaceState(null, '', `#demo=${d.id}`); });
  list.append(el('li', {}, b));
  return b;
});

async function show(id) {
  const d = DEMOS.find(x => x.id === id) || DEMOS[0];
  current = d.id;
  tabs.forEach((b, i) => b.setAttribute('aria-selected', String(DEMOS[i] === d)));
  $('#demo-title').textContent = d.title;
  $('#demo-what').replaceChildren(...(d.designer ? [el('span', { className: 'made', textContent: 'Built entirely in the Designer, no code' }), ' '] : []), d.what);
  $('#demo-try').replaceChildren(el('b', { textContent: 'Try' }), d.try);
  if (!galleryLive) return;
  handle?.unmount(); handle = null;
  host.replaceChildren(el('p', { className: 'host-msg', textContent: 'Loading the viewer…' }));
  try {
    const { mountViewer } = await loadViewer();
    if (current !== d.id) return;
    const box = mountBox();
    host.replaceChildren(box);
    handle = mountViewer(box, { server: SERVER, report: d.id, height: '100%', title: d.title });
  } catch (e) { fail(host, e); }
}

const fromHash = () => (location.hash.match(/^#demo=([\w-]+)/) || [])[1];
show(fromHash() || DEMOS[0].id);
if (fromHash()) { galleryLive = true; show(fromHash()); $('#gallery').scrollIntoView(); }
whenNear(host, () => { if (!galleryLive) { galleryLive = true; show(current); } });
addEventListener('hashchange', () => { const id = fromHash(); if (id && id !== current) { galleryLive = true; show(id); } });

/* ---------- scale ---------- */
const SIZES = [5000, 20000, 50000, 100000];
const scaleHost = $('#scale-viewer');
let scaleHandle = null, scaleRun = 0;
const sizeBtns = SIZES.map((n) => {
  const b = el('button', { type: 'button', textContent: n.toLocaleString('en-US') + ' rows' });
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => runScale(n));
  $('#scale-sizes').append(b);
  return b;
});
async function runScale(n) {
  const run = ++scaleRun;
  sizeBtns.forEach((b, i) => { b.setAttribute('aria-pressed', String(SIZES[i] === n)); b.disabled = true; });
  for (const id of ['#scale-wall', '#scale-engine', '#scale-pages']) $(id).textContent = '…';
  scaleHandle?.unmount(); scaleHandle = null;
  try {
    const { mountViewer } = await loadViewer(); // the bundle download is not part of the timing
    if (run !== scaleRun) return;
    const box = mountBox();
    scaleHost.replaceChildren(box);
    const t0 = performance.now();
    scaleHandle = mountViewer(box, { server: SERVER, report: 'stress-scale', params: { rows: String(n) }, height: '100%', title: 'Stress test' });
    // done when the page counter shows a total ("/ 2175"; "2175+" would be a partial model). The stats line
    // ("N pages · R rows · T ms") is read too when the toolbar is wide enough to show it (not on a phone).
    const res = await new Promise((resolve, reject) => {
      const tick = () => {
        if (run !== scaleRun) return resolve(null);
        const sr = box.shadowRoot;
        const err = sr?.querySelector('.vmsg.error');
        if (err) return reject(new Error(err.textContent));
        const total = sr?.querySelector('[data-toolbar-id="pageNumber"] .stat')?.textContent.match(/^\/\s*(\d+)$/)?.[1];
        if (total) return resolve({ wall: performance.now() - t0, pages: total, ms: (sr.querySelector('.vstats')?.textContent.replace(/,/g, '').match(/(\d+)\s*ms/) || [])[1] });
        if (performance.now() - t0 > 120000) return reject(new Error('timed out after 2 minutes'));
        setTimeout(tick, 40);
      };
      tick();
    });
    if (!res) return;
    const { pages, ms } = res;
    $('#scale-wall').textContent = `${(res.wall / 1000).toFixed(2)} s`;
    $('#scale-engine').textContent = ms ? `${(ms / 1000).toFixed(2)} s` : '—';
    $('#scale-pages').textContent = pages ? Number(pages).toLocaleString('en-US') : '—';
    const runs = $('#scale-runs');
    runs.querySelector('.empty')?.remove();
    const fmt = (x) => Number(x).toLocaleString('en-US');
    runs.prepend(el('tr', {}, ...[fmt(n), pages ? fmt(pages) : '—', ms ? `${(ms / 1000).toFixed(2)} s` : '—', `${(res.wall / 1000).toFixed(2)} s`, fmt(Math.round(n / (res.wall / 1000)))].map(t => el('td', { textContent: t }))));
  } catch (e) {
    if (run === scaleRun) { fail(scaleHost, e); for (const id of ['#scale-wall', '#scale-engine', '#scale-pages']) $(id).textContent = '—'; }
  } finally {
    if (run === scaleRun) sizeBtns.forEach(b => { b.disabled = false; });
  }
}
whenNear(scaleHost, () => loadViewer()); // warm the bundle so the timing measures the report, not the download

/* ---------- designer ---------- */
const SAMPLES = [
  ['invoice-gallery', 'Invoice'],
  ['sales-dashboard', 'Sales dashboard'],
  ['stress-ledger', 'Stress ledger (built in the designer)'],
  ['reuse-showcase', 'Master report and parts (built in the designer)'],
  ['loan-statement', 'Loan statement'],
  ['richtext-showcase', 'Rich text'],
  ['style-showcase', 'Text and styling'],
  ['', 'Blank report'],
];
const pick = $('#designer-pick');
for (const [id, label] of SAMPLES) pick.append(el('option', { value: id, textContent: label }));
const dHost = $('#designer-host');
const toast = $('#designer-toast');
let designer = null;
const saved = new Map(); // edits saved in this tab, per sample
async function openDesigner(id) {
  designer?.unmount(); designer = null;
  dHost.replaceChildren(el('p', { className: 'host-msg', textContent: 'Loading the designer…' }));
  toast.textContent = '';
  try {
    const [{ mountDesigner }, definition] = await Promise.all([
      loadDesigner(),
      saved.get(id) || (id ? fetch(`${SERVER}/api/reports/${id}`).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))) : undefined),
    ]);
    if (pick.value !== id) return;
    const box = mountBox();
    dHost.replaceChildren(box);
    designer = mountDesigner(box, {
      server: SERVER, definition, height: '100%',
      onSave: (def) => { saved.set(id, def); toast.textContent = `Saved in this tab at ${new Date().toLocaleTimeString()}. Reopen the sample to get it back.`; },
      panels: { data: true, inspector: true },
    });
  } catch (e) { fail(dHost, e); }
}
pick.addEventListener('change', () => openDesigner(pick.value));
$('#designer-download').addEventListener('click', () => {
  if (!designer) return;
  const def = designer.getDefinition();
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' })), download: `${pick.value || 'report'}.pw.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
// The designer is a desktop tool: its three panels need about 900 px. On a phone, ask before loading it.
whenNear(dHost, () => {
  if (innerWidth >= 900) return openDesigner(pick.value);
  const go = el('button', { type: 'button', className: 'btn', textContent: 'Load it anyway' });
  go.addEventListener('click', () => openDesigner(pick.value));
  dHost.replaceChildren(el('div', { className: 'host-msg narrow' }, el('p', { textContent: 'The designer is built for a laptop or desktop screen: its toolbox, page and property panels need about 900 px of width.' }), go));
});

/* ---------- code ---------- */
const SNIPPETS = [
  ['Script tag', `<div id="report"></div>
<script src="https://reports.example.com/embed/reportwright-viewer.js"></script>
<script>
  ReportWright.mountViewer('#report', {
    server: 'https://reports.example.com',
    report: 'loan-statement',
    params: { accountId: 'LN-2025-001982' },
    lang: 'hi',                 // en, hi, es, fr, de, ja, zh, pt-BR, ar
    viewMode: 'continuous',     // 'single' | 'continuous' | 'galley'
    toolbar: {
      hide: ['excel', 'word'],
      add: [{ id: 'email', label: 'Email', after: 'print', onClick: (api) => sendMail(api.page) }],
    },
  });
</script>`],
  ['ES module', `import { mountViewer } from '@reportwright/viewer';

mountViewer('#report', {
  server: 'https://reports.example.com',
  report: 'loan-statement',
  params: { accountId: 'LN-1' },
});
// PDF export and barcodes load only when used.`],
  ['Designer', `import { mountDesigner } from '@reportwright/viewer/designer';

const designer = mountDesigner('#designer', {
  server: 'https://reports.example.com',
  definition,                                   // or report: 'id' to load it from the server
  onSave: (def) => saveToMyApp(def),            // without onSave, Save writes to the ReportWright server
  onOpen: () => pickAReport(),                  // shows an Open… button; return a definition
  readOnly: false,
  toolbox: { hide: ['map', 'chart'] },
  panels: { data: true, inspector: true },
  dataSourceTemplates: [{ label: 'Orders API', source: { name: 'orders', type: 'rest', url: 'https://api.example.com/orders' } }],
});
designer.getDefinition();`],
  ['React', `import { ReportWrightViewer, ReportWrightDesigner } from '@reportwright/react';

<ReportWrightViewer server="https://reports.example.com" report="invoice" params={{ id: '42' }} style={{ height: 720 }} />
<ReportWrightDesigner server="https://reports.example.com" definition={def} onSave={(d) => save(d)} toolbox={{ hide: ['map'] }} />

// Loads on mount, so it is safe in server-rendered apps (Next.js, Remix).`],
  ['Vue', `<script setup>
import { ReportWrightViewer, ReportWrightDesigner } from '@reportwright/vue';
</script>
<template>
  <ReportWrightViewer :options="{ server: 'https://reports.example.com', report: 'invoice', params: { id: '42' } }" />
  <ReportWrightDesigner :options="{ server, definition, onSave: save }" @ready="(h) => (designer = h)" />
</template>`],
  ['Svelte', `<script>
  import { reportWrightViewer, reportWrightDesigner } from '@reportwright/svelte';
</script>
<div use:reportWrightViewer={{ server: 'https://reports.example.com', report: 'invoice', params: { id } }}></div>
<div use:reportWrightDesigner={{ server, definition, onSave: save }}></div>`],
  ['Angular', `// main.ts
import { defineReportWrightElements } from '@reportwright/angular';
defineReportWrightElements();

// a standalone component
@Component({
  selector: 'app-report',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: \`
    <reportwright-viewer [options]="{ server: 'https://reports.example.com', report: 'invoice', params: { id: id } }"></reportwright-viewer>
    <reportwright-designer [options]="{ server: server, definition: def }" (pw-save)="save($event.detail)"></reportwright-designer>\`,
})
export class ReportComponent { /* … */ }`],
  ['This page', `// How this demo runs with no server: the viewer's API paths are static files.
//   api/reports/<id>     report definitions
//   api/sample/...       the sample data the server would return
//   api/fonts            [] (no uploaded fonts)
const SERVER = new URL('.', document.baseURI).href.replace(/\\/$/, '');
const { mountViewer } = await import(\`\${SERVER}/embed/esm/viewer.js\`);

mountViewer(box, { server: SERVER, report: 'sales-explorer', height: '100%' });`],
];
const codeBody = $('#code-body');
const codeTabs = SNIPPETS.map(([label, code], i) => {
  const b = el('button', { type: 'button', role: 'tab', textContent: label });
  b.addEventListener('click', () => {
    codeTabs.forEach((x, j) => x.setAttribute('aria-selected', String(i === j)));
    codeBody.textContent = code;
  });
  $('#code-tabs').append(b);
  return b;
});
codeTabs[0].click();
