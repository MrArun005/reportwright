// "Made by hand in the designer": recipes recorded by scripts/site-recipes/*.mjs driving the real designer.
// Each recipe's steps (learn/<id>.steps.json), screenshots and finished report (learn/<id>.pw.json) come from its script.
const SERVER = new URL('.', document.baseURI).href.replace(/\/$/, '');
let designerMod = null;
const loadDesigner = () => (designerMod ||= import(`${SERVER}/embed/esm/designer.js`));

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

/** [after step, image, caption]; "result" is the finished report, shown last and largest. */
const RECIPES = [
  { id: 'grouped-table', title: 'Grouped table, subtotals, Page N of M', k: 'table gallery · nested groups · page footer',
    what: 'Rows grouped by region, then city. Each city ends with a subtotal, each region with a total, the report with a grand total; the region header repeats when a region runs onto the next page, and every page says "Page N of M".',
    shots: [[3, 'grouped-table-1-gallery', 'The table gallery: Grouped, grouped by region, four columns kept.'],
      [7, 'grouped-table-2-groups', 'Two groups: G1 region and G2 city headers, F2 and F1 their subtotal rows, F the grand total.'],
      [9, 'grouped-table-3-footer', 'The title in the page header and Page {Globals.PageNumber} of {Globals.TotalPages} in the page footer.']],
    result: 'Page 2 of 13: the East header repeated at the top, the Bhubaneswar subtotal, Kolkata starting.' },
  { id: 'combo-chart', title: 'Combo chart on two axes', k: 'chart gallery · series · secondary axis',
    what: 'Disbursed amounts as columns on the left axis and the number of loans as a line on a second axis on the right, by month.',
    shots: [[2, 'combo-chart-1-gallery', 'The chart gallery draws every type with the real data; Column is picked.'],
      [4, 'combo-chart-2-series', 'The second series: Draw as Line, Axis Secondary.'],
      [6, 'combo-chart-3-axes', 'The chart on the canvas once both axes have titles.']],
    result: 'The finished chart: ₹ millions on the left, loans on the right.' },
  { id: 'drill-through', title: 'Drill-down and drill-through', k: 'collapsible groups · cell action · parameter map',
    what: 'One row per region that opens to its cities, and a city name that opens the city report for that city and year, inside the same viewer with a breadcrumb back.',
    shots: [[6, 'drill-through-1-drilldown', 'The summary table with the city group added and the region group set to drill down.'],
      [7, 'drill-through-2-action', 'The city cell\'s action: Open another report, sales-city, with city and year filled in.'],
      [10, 'drill-through-3-drilled', 'After a click on Delhi: the city report, with the breadcrumb back to this one.']],
    result: 'North opened with ▶: its three cities, each a link.' },
  { id: 'cascading-parameters', title: 'Cascading parameters', k: 'parameters · data set filters',
    what: 'A Region parameter, and a City parameter whose choices are only that region\'s cities. The table and the title follow both.',
    shots: [[3, 'cascading-parameters-1-parameter', 'Region takes its choices from the Regions data set.'],
      [5, 'cascading-parameters-2-cascade', 'City takes its choices from Cities, which filters on Parameters.region. The dialog lists the 3 choices for North.'],
      [8, 'cascading-parameters-3-design', 'The report on the canvas: a list table and a title made from both parameters.'],
      [10, 'cascading-parameters-4-preview', 'Preview with Region South and City Chennai. Before Chennai was picked, City listed only Bengaluru, Chennai and Hyderabad.']],
    result: 'Chennai, South region: 36 rows and their total.' },
  { id: 'pivot-table', title: 'Pivot table with totals and % of row', k: 'pivot wizard · nested row groups · drill-down',
    what: 'Region › city down the side, product across the top, disbursed and each product\'s share of the row in every cell, with subtotals per region, a total column and a grand total. Regions open and close.',
    shots: [[3, 'pivot-table-1-wizard', 'The pivot wizard previews the pivot as fields go into Rows, Cols and Values.'],
      [5, 'pivot-table-2-values', 'The second value: Label Share, Show % of row, Format P1.']],
    result: 'East, South and West open with their cities and totals; North closed to one line.' },
  { id: 'sparklines', title: 'Sparklines and data bars in cells', k: 'cell visuals · column widths',
    what: 'One row per city with its year as a sparkline of monthly disbursements and its loans as a data bar, drawn inside the table cells.',
    shots: [[4, 'sparklines-1-sparkline', 'The third cell set to show a sparkline: one point per month, the sum of disbursed.'],
      [6, 'sparklines-2-databar', 'The table after the column widths are set to fit the page.']],
    result: 'Twelve cities: the month-by-month line and the loans bar on every row.' },
];

/* ---------- theme (same switch and storage key as the main page) ---------- */
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const syncHosts = () => { for (const h of document.querySelectorAll('.mount')) h.dataset.theme = isDark() ? 'dark' : 'light'; };
$('#theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('pw-site-theme', next); } catch {}
  syncHosts();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncHosts);

/** The steps' light markup: `code`, **bold**, *em*. Text is escaped first. */
const md = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<em>$1</em>');

const figure = (src, caption, cls = '') => el('figure', { className: `shot ${cls}` },
  el('a', { href: src, target: '_blank', rel: 'noopener', title: 'Open the full-size image' }, el('img', { src, alt: caption, loading: 'lazy', decoding: 'async' })),
  el('figcaption', { textContent: caption }));

/* ---------- recipe list and recipe view ---------- */
const list = $('#recipe-list');
const view = $('#recipe');
const stepsCache = new Map();
const tabs = RECIPES.map((r) => {
  const b = el('button', { type: 'button', role: 'tab', id: `tab-${r.id}` }, el('span', { className: 't', textContent: r.title }), el('span', { className: 'k', textContent: r.k }));
  b.setAttribute('aria-controls', 'recipe');
  b.addEventListener('click', () => { show(r.id); history.replaceState(null, '', `#recipe=${r.id}`); });
  list.append(el('li', {}, b));
  return b;
});

async function show(id) {
  const r = RECIPES.find(x => x.id === id) || RECIPES[0];
  tabs.forEach((b, i) => b.setAttribute('aria-selected', String(RECIPES[i] === r)));
  let steps = stepsCache.get(r.id);
  if (!steps) {
    try { steps = await (await fetch(`learn/${r.id}.steps.json`)).json(); } catch { steps = []; }
    stepsCache.set(r.id, steps);
  }
  const open = el('button', { type: 'button', className: 'btn btn-solid', textContent: 'Open in the playground' });
  open.addEventListener('click', () => { pick.value = r.id; openDesigner(r.id); $('#playground').scrollIntoView({ behavior: 'smooth' }); });
  const ol = el('ol', { className: 'steps' });
  steps.forEach((s, i) => {
    const li = el('li', { innerHTML: md(s) });
    const shot = r.shots.find(([n]) => n === i + 1);
    if (shot) li.append(el('a', { className: 'see', href: `#shot-${shot[1]}`, textContent: 'see picture' }));
    ol.append(li);
  });
  const figs = el('div', { className: 'shots' }, ...r.shots.map(([n, img, cap]) => {
    const f = figure(`learn/${img}.webp`, cap);
    f.id = `shot-${img}`;
    f.querySelector('figcaption').prepend(el('b', { textContent: `Step ${n}. ` }));
    return f;
  }));
  view.replaceChildren(
    el('header', { className: 'recipe-head' },
      el('div', {}, el('h3', { textContent: r.title }), el('p', { className: 'stage-what', textContent: r.what })),
      el('div', { className: 'recipe-actions' }, open, el('a', { className: 'btn', href: `learn/${r.id}.pw.json`, download: `${r.id}.pw.json`, textContent: 'Download .pw.json' }))),
    el('div', { className: 'recipe-body' },
      el('div', { className: 'recipe-steps' }, el('p', { className: 'label', textContent: `${steps.length} steps in the designer` }), ol,
        el('p', { className: 'fine', innerHTML: `Recorded by <code>scripts/site-recipes/${r.id}.mjs</code>.` })),
      el('div', { className: 'recipe-figs' }, figure(`learn/${r.id}-result.webp`, r.result, 'result'), figs)),
  );
}

const fromHash = () => (location.hash.match(/^#recipe=([\w-]+)/) || [])[1];
show(fromHash() || RECIPES[0].id);
addEventListener('hashchange', () => { const id = fromHash(); if (id) show(id); });

/* ---------- playground ---------- */
const pick = $('#play-pick');
for (const r of RECIPES) pick.append(el('option', { value: r.id, textContent: r.title }));
pick.value = fromHash() || RECIPES[0].id;
const host = $('#play-host');
let designer = null, opened = '';
async function openDesigner(id) {
  if (innerWidth < 900 && !host.dataset.anyway) return narrow(id);
  designer?.unmount(); designer = null; opened = id;
  host.replaceChildren(el('p', { className: 'host-msg', textContent: 'Loading the designer…' }));
  try {
    const [{ mountDesigner }, definition] = await Promise.all([
      loadDesigner(),
      fetch(`learn/${id}.pw.json`).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    ]);
    if (opened !== id) return;
    const box = el('div', { className: 'mount', style: 'height:100%' });
    box.dataset.theme = isDark() ? 'dark' : 'light';
    host.replaceChildren(box);
    designer = mountDesigner(box, { server: SERVER, definition, height: '100%', onSave: () => {}, panels: { data: true, inspector: true } });
  } catch (e) {
    host.replaceChildren(el('p', { className: 'host-msg', textContent: `Could not load: ${e.message}` }));
    console.error(e);
  }
}
// The designer needs about 900 px; on a phone, ask first (as the main page does).
function narrow(id) {
  const go = el('button', { type: 'button', className: 'btn', textContent: 'Load it anyway' });
  go.addEventListener('click', () => { host.dataset.anyway = '1'; openDesigner(id); });
  host.replaceChildren(el('div', { className: 'host-msg narrow' }, el('p', { textContent: 'The designer is built for a laptop or desktop screen: its toolbox, page and property panels need about 900 px of width.' }), go));
}
pick.addEventListener('change', () => openDesigner(pick.value));
$('#play-download').addEventListener('click', () => {
  if (!designer) return;
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(designer.getDefinition(), null, 2)], { type: 'application/json' })), download: `${pick.value}.pw.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); if (!opened) openDesigner(pick.value); } }, { rootMargin: '300px 0px' });
io.observe(host);
