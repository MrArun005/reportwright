// Migration examples: renders site/examples/index.json (written by scripts/build-examples.mjs). No server, no network
// beyond the site's own files. Everything shown comes from the importer's output; nothing is typed in here.
const BASE = new URL('.', document.baseURI).href.replace(/\/$/, '');
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const SYM = { '✅': 'converted, nothing dropped', '⚠️': 'approximated, dropped or not imported', '❌': 'no example' };
const RENDER = { rendered: 'Renders from its sample data', 'needs your database': 'Needs your database: design and notes only', failed: 'Did not render', 'not imported': 'Not imported' };

let index = null;
const state = { tool: 'all', cat: 'all' };

const getJson = (p) => fetch(`${BASE}/${p}`).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${p}: HTTP ${r.status}`))));

/* ---------- coverage: category x tool ---------- */
function drawCoverage() {
  const table = $('#coverage');
  const head = table.tHead.rows[0];
  head.replaceChildren(el('th', { scope: 'col', textContent: 'Category' }));
  for (const s of index.sources) head.append(el('th', { scope: 'col', textContent: s.tool }));
  head.append(el('th', { scope: 'col', textContent: 'Total' }));
  const rows = index.categories.filter(c => c.id !== 'drill').map(c => {
    const tr = el('tr', {}, el('th', { scope: 'row', textContent: c.label }));
    for (const s of index.sources) {
      const cell = index.coverage[c.id]?.[s.slug] || { n: 0, bad: 0, symbol: '❌' };
      const detail = cell.n ? `${cell.n} example${cell.n === 1 ? '' : 's'}${cell.bad ? `, ${cell.bad} with gaps` : ''}` : 'no example';
      tr.append(el('td', { className: `cov cov-${cell.symbol === '✅' ? 'ok' : cell.symbol === '⚠️' ? 'warn' : 'none'}`, title: `${s.tool}: ${detail}` },
        el('span', { className: 'sym', 'aria-hidden': 'true', textContent: cell.symbol }),
        el('span', { className: 'sr-only', textContent: `${s.tool}, ${c.label}: ${SYM[cell.symbol]}; ${detail}` }),
        el('span', { className: 'cnt', textContent: ` ${cell.n}` })));
    }
    const total = index.examples.filter(e => e.categories.some(k => k.id === c.id)).length;
    tr.append(el('td', { className: 'cov-total', textContent: String(total) }));
    return tr;
  });
  table.tBodies[0].replaceChildren(...rows);
}

/* ---------- filters ---------- */
function chip(group, value, label, on) {
  const b = el('button', { type: 'button', className: 'chip', textContent: label });
  b.setAttribute('aria-pressed', String(on));
  b.addEventListener('click', () => { state[group] = value; drawFilters(); drawCards(); });
  return b;
}
function drawFilters() {
  $('#f-tool').replaceChildren(chip('tool', 'all', 'All', state.tool === 'all'),
    ...index.sources.map(s => chip('tool', s.slug, s.tool, state.tool === s.slug)));
  $('#f-cat').replaceChildren(chip('cat', 'all', 'All', state.cat === 'all'),
    ...index.categories.map(c => chip('cat', c.id, c.label, state.cat === c.id)));
}

/* ---------- cards ---------- */
const shown = (e) => (state.tool === 'all' || e.slug === state.tool) && (state.cat === 'all' || e.categories.some(c => c.id === state.cat));

function importLine(e) {
  const s = e.stats;
  if (e.status !== 'imported') return `Not imported: ${e.error || 'see the notes'}`;
  return `${s.mapped} of ${s.items} items mapped · ${s.approximated} approximated · ${s.dropped} dropped`;
}

function card(e) {
  const thumb = e.thumb
    ? el('img', { src: `${BASE}/examples/${e.dir}/thumb.png`, alt: `First page of ${e.title}`, loading: 'lazy', className: 'thumb' })
    : el('div', { className: 'thumb thumb-none', 'aria-hidden': 'true', textContent: e.render === 'needs your database' ? 'Needs your database' : 'No preview' });
  const badge = el('span', { className: `badge badge-${e.status === 'imported' ? (e.stats.dropped ? 'warn' : 'ok') : 'none'}`,
    textContent: e.status === 'imported' ? (e.stats.dropped ? 'Converted with gaps' : 'Converted') : 'Not imported' });
  const cats = el('ul', { className: 'tags', 'aria-label': 'Categories' }, ...e.categories.map(c => el('li', { textContent: c.label })));
  const base = `${BASE}/examples/${e.dir}`;
  const actions = el('div', { className: 'actions' });
  const viewer = el('button', { type: 'button', className: 'btn', textContent: 'Open in viewer', disabled: e.render !== 'rendered' });
  if (e.render !== 'rendered') viewer.title = RENDER[e.render] || 'No preview';
  viewer.addEventListener('click', () => openViewer(e, viewer));
  const designer = el('button', { type: 'button', className: 'btn', textContent: 'Open in designer', disabled: e.status !== 'imported' });
  designer.addEventListener('click', () => openDesigner(e, designer));
  const dl = el('a', { className: 'btn', href: `${base}/definition.pw.json`, download: `${e.id}.pw.json`, textContent: 'Download .pw.json' });
  if (e.status !== 'imported') dl.hidden = true;
  const orig = el('a', { className: 'btn btn-quiet', href: e.original.repo, target: '_blank', rel: 'noopener', textContent: 'Original sample file' });
  actions.append(viewer, designer, dl, orig);
  if (e.original.upstream) actions.append(el('a', { className: 'btn btn-quiet', href: e.original.upstream, target: '_blank', rel: 'noopener', textContent: 'Upstream source' }));

  const det = el('details', { className: 'notes' }, el('summary', { textContent: 'Import notes' }));
  det.addEventListener('toggle', async () => {
    if (!det.open || det.dataset.loaded) return;
    det.dataset.loaded = '1';
    try { det.append(renderNotes(await getJson(`examples/${e.dir}/notes.json`))); }
    catch (err) { det.append(el('p', { textContent: `Could not load the notes: ${err.message}` })); }
  });
  const top = e.topNotes.length ? el('ul', { className: 'top-notes' }, ...e.topNotes.map(n => el('li', { textContent: n }))) : null;

  return el('li', { className: 'card' },
    el('figure', { className: 'card-fig' }, thumb),
    el('div', { className: 'card-body' },
      el('p', { className: 'card-meta' }, el('span', { className: 'tool', textContent: e.tool }), ' · ', el('span', { textContent: RENDER[e.render] || e.render })),
      el('h3', { textContent: e.title }),
      el('p', { className: 'result' }, badge, ' ', el('span', { textContent: importLine(e) })),
      top,
      cats,
      det,
      actions));
}

function renderNotes(n) {
  const wrap = el('div', { className: 'notes-body' });
  wrap.append(el('p', { textContent: `Licence: ${n.licence}. Render: ${RENDER[n.render.status] || n.render.status}${n.render.reason ? ` (${n.render.reason})` : ''}` }));
  if (n.error) wrap.append(el('p', { className: 'err', textContent: `Failed: ${n.error}` }));
  if (n.notes?.length) wrap.append(el('h4', { textContent: 'Report notes' }), el('ul', {}, ...n.notes.map(x => el('li', { textContent: x }))));
  if (n.items?.length) {
    wrap.append(el('h4', { textContent: 'Items not mapped exactly' }));
    wrap.append(el('ul', {}, ...n.items.map(i => el('li', { textContent: `${i.name} (${i.state}${i.line ? `, line ${i.line}` : ''}): ${i.notes.join('; ') || 'no reason given'}` }))));
  }
  if (n.expressions?.length) wrap.append(el('h4', { textContent: `Expressions not translated (${n.expressions.length})` }),
    el('ul', {}, ...n.expressions.slice(0, 50).map(x => el('li', {}, el('code', { textContent: x.expression }), ` in ${x.item}`))));
  if (n.references?.length) wrap.append(el('h4', { textContent: 'References' }),
    el('ul', {}, ...n.references.map(r => el('li', { textContent: `${r.kind}: ${r.ref} → ${r.resolved ? r.resolved : 'unresolved'}${r.note ? ` (${r.note})` : ''}` }))));
  if (!n.notes?.length && !n.items?.length && !n.expressions?.length && !n.references?.length) wrap.append(el('p', { textContent: 'Nothing to report: every item mapped.' }));
  return wrap;
}

function drawCards() {
  const list = index.examples.filter(shown);
  $('#cards').replaceChildren(...list.map(card));
  $('#count').textContent = `${list.length} of ${index.examples.length} reports shown.`;
}

/* ---------- viewer: the same mount play.html uses for its export preview ---------- */
async function openViewer(e, btn) {
  const dlg = $('#viewer-dlg'), mount = $('#viewer-mount');
  btn.disabled = true;
  try {
    const def = await getJson(`examples/${e.dir}/definition.pw.json`);
    const { mountViewer } = await import(`${BASE}/embed/esm/viewer.js`);
    mount.replaceChildren();
    $('#viewer-title').textContent = e.title;
    dlg.showModal();
    mountViewer(mount, { server: BASE, definition: def, height: '70vh' });
  } catch (err) {
    $('#ex-status').textContent = `Could not open the viewer: ${err.message}`;
  } finally { btn.disabled = false; }
}
$('#viewer-close').addEventListener('click', () => { $('#viewer-dlg').close(); $('#viewer-mount').replaceChildren(); });

/* ---------- designer: play.html reads a report from its #r= share hash (deflate-raw, base64url) ---------- */
async function openDesigner(e, btn) {
  btn.disabled = true;
  try {
    const def = await getJson(`examples/${e.dir}/definition.pw.json`);
    const bytes = new TextEncoder().encode(JSON.stringify(def));
    const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    let s = ''; for (let i = 0; i < packed.length; i += 0x8000) s += String.fromCharCode(...packed.subarray(i, i + 0x8000));
    const b64 = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (b64.length > 7000) { // too long for a link: the file is the way in
      $('#ex-status').textContent = `${e.title} is too large for a link. Download the .pw.json and open it in the playground.`;
      return;
    }
    location.href = `play.html#r=${b64}`;
  } catch (err) {
    $('#ex-status').textContent = `Could not open the designer: ${err.message}`;
  } finally { btn.disabled = false; }
}

/* ---------- sources and exclusions ---------- */
function drawSources() {
  $('#sources').replaceChildren(...index.sources.map(s => el('li', {},
    el('strong', { textContent: s.tool }), ` · ${s.count} files from ${s.source} · `,
    el('a', { href: s.licenceUrl, target: '_blank', rel: 'noopener', textContent: `${s.licence} licence` }),
    ` (${s.copyright}) · `, el('a', { href: s.sourceUrl, target: '_blank', rel: 'noopener', textContent: 'source' }))));
  $('#excluded').replaceChildren(...index.excluded.map(x => el('li', {},
    el('strong', { textContent: x.tool }), ` (${x.files}): ${x.reason}`)));
}

/* ---------- boot ---------- */
(async () => {
  try {
    index = await getJson('examples/index.json');
    $('#ex-status').textContent = `${index.totals ? Object.values(index.totals).reduce((a, t) => a + t.imported, 0) : index.examples.length} reports imported from ${index.sources.length} official sample sets, generated ${new Date(index.generated).toLocaleString('en-GB')}.`;
    drawCoverage(); drawFilters(); drawCards(); drawSources();
  } catch (err) {
    $('#ex-status').textContent = `The examples are not built here yet (${err.message}). They are built by npm run build:site.`;
  }
})();
