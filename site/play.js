// ReportWright playground: the designer full-screen, plus start-from, data, export, share and autosave.
// No server: api/reports and api/sample are static files written by scripts/build-site.mjs.
const SERVER = new URL('.', document.baseURI).href.replace(/\/$/, '');
const MINE = '__mine', KEY = 'pw-play-autosave', HASH = '#r=', MAX_URL = 8000;
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const BLANK = { $schema: 'pagewright/report@1', name: 'New report', page: { size: 'A4', margins: [36, 36, 36, 36] }, dataSources: [], dataSets: [], sections: { body: { items: [] } } };
const SAMPLES = [
  ['Sales 2024', 'sales/2024'], ['Sales 2025', 'sales/2025'], ['Sales 2026', 'sales/2026'],
  ['Loan statement LN-2025-001982', 'loans/LN-2025-001982'], ['Loan statement LN-2026-004417', 'loans/LN-2026-004417'],
  ['Stress ledger, 5,000 rows', 'hard'], ['Lending portfolio, 180 loans', 'torture'],
];

const loadDesigner = () => import(`${SERVER}/embed/esm/designer.js`);
const loadViewer = () => import(`${SERVER}/embed/esm/viewer.js`);

/* ---------- theme (same key as the main page) ---------- */
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const syncHosts = () => { for (const h of document.querySelectorAll('.mount')) h.dataset.theme = isDark() ? 'dark' : 'light'; };
$('#theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('pw-site-theme', next); } catch {}
  syncHosts();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncHosts);

/* ---------- status line ---------- */
const status = $('#status');
const say = (text, ...kids) => status.replaceChildren(...(text || kids.length ? [text || '', ...kids] : []));

/* ---------- share encoding: deflate-raw + base64url ---------- */
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const toB64u = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const encodeDef = async (def) => toB64u(await pipe(new TextEncoder().encode(JSON.stringify(def)), new CompressionStream('deflate-raw')));
const decodeDef = async (s) => JSON.parse(new TextDecoder().decode(await pipe(fromB64u(s), new DecompressionStream('deflate-raw'))));

/* ---------- designer ---------- */
const host = $('#host');
let designer = null, baseline = '', last = '';
const current = () => designer?.getDefinition();
const download = (blob, name) => {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const fileBase = () => (current()?.name || 'report').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'report';

function save() { // autosave: a full quota or blocked storage just means no autosave
  try {
    const cur = JSON.stringify(current());
    if (cur !== last) { localStorage.setItem(KEY, cur); last = cur; }
  } catch { /* ponytail: silent; the .pw.json download is the backup */ }
}
setInterval(() => { if (designer) save(); }, 1500);
addEventListener('pagehide', () => { if (designer) save(); });

/** Show a definition in the designer (remounts: the designer has no setDefinition). */
async function open(def) {
  designer?.unmount(); designer = null;
  host.replaceChildren(el('p', { className: 'host-msg', textContent: 'Loading the designer…' }));
  try {
    const { mountDesigner } = await loadDesigner();
    const box = el('div', { className: 'mount' });
    box.dataset.theme = isDark() ? 'dark' : 'light';
    host.replaceChildren(box);
    designer = mountDesigner(box, {
      server: SERVER, definition: def, height: '100%', panels: { data: true, inspector: true },
      onSave: () => { save(); say(`Saved in this browser at ${new Date().toLocaleTimeString()}.`); },
    });
    baseline = JSON.stringify(def); last = '';
    window.__designer = designer; // handy in the console
  } catch (e) { host.replaceChildren(el('p', { className: 'host-msg', textContent: `Could not load the designer: ${e.message}` })); console.error(e); }
}
const dirty = () => designer && JSON.stringify(current()) !== baseline;
const confirmLose = () => !dirty() || confirm('Replace the report you are editing? Your changes are kept in this browser until you do something else, but this opens a different report.');
const getJson = (path) => fetch(`${SERVER}/${path}`).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${path}: HTTP ${r.status}`))));

/* ---------- start from ---------- */
const start = $('#start');
const startReady = fetch(`${SERVER}/api/reports/`).then(r => r.json()).then(list => { // the folder's index.html is the report list
  for (const r of list) start.append(el('option', { value: r.id, textContent: r.name }));
}).catch(e => console.error(e));
/** After a restore or a share link: show which gallery report this is, or "Your report". */
async function syncStart(def) {
  await startReady;
  const hit = def.name === BLANK.name ? { value: '' } : [...start.options].find(o => o.value && o.value !== MINE && o.textContent === def.name);
  if (hit) start.value = hit.value;
  else { if (!start.querySelector(`[value="${MINE}"]`)) start.append(el('option', { value: MINE, textContent: 'Your report' })); start.value = MINE; }
  start.dataset.at = start.value;
}
start.addEventListener('change', async () => {
  const id = start.value;
  if (id === MINE) return;
  if (!confirmLose()) { start.value = start.dataset.at || ''; return; }
  start.dataset.at = id;
  try { await open(id ? await getJson(`api/reports/${id}`) : structuredClone(BLANK)); say(id ? `Opened "${start.selectedOptions[0].text}". Edits stay in this browser.` : ''); }
  catch (e) { say(`Could not open it: ${e.message}`); }
});
$('#fresh').addEventListener('click', async () => {
  if (!confirmLose()) return;
  try { localStorage.removeItem(KEY); } catch {}
  history.replaceState(null, '', location.pathname + location.search);
  start.value = ''; start.dataset.at = '';
  await open(structuredClone(BLANK)); say('Started fresh.');
});

/* ---------- data ---------- */
const data = $('#data'), file = $('#file');
for (const [label, path] of SAMPLES) data.append(el('option', { value: `s:${path}`, textContent: label }));
data.append(el('option', { value: 'paste', textContent: 'Paste JSON or CSV…' }), el('option', { value: 'file', textContent: 'Load a JSON or CSV file…' }));
/** Make `payload` (parsed JSON, or CSV text) the report's data source "data", keeping everything else. */
async function useData(payload, label) {
  if (!designer) return;
  const def = current();
  const src = typeof payload === 'string' ? { name: 'data', type: 'csv', data: payload } : { name: 'data', type: 'json', data: payload };
  const srcs = (def.dataSources || []).filter(s => s.name !== 'data');
  def.dataSources = [...srcs, src];
  await open(def);
  say(`Data "${label}" added as the data source "data". Open the Data panel to build a data set from it.`);
}
const parseText = (text, name = '') => {
  const t = text.trim();
  if (!t) throw new Error('There is nothing to load.');
  if (/\.csv$/i.test(name) || !/^[[{"\d-]|^(true|false|null)\b/.test(t)) return t.includes('\n') || t.includes(',') ? t : (() => { throw new Error('That is neither JSON nor CSV.'); })();
  try { return JSON.parse(t); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
};
data.addEventListener('change', async () => {
  const v = data.value; data.value = '';
  if (v === 'paste') return $('#paste-dlg').showModal();
  if (v === 'file') return file.click();
  if (!v) return;
  try { await useData(await getJson(`api/sample/${v.slice(2)}`), data.querySelector(`[value="${v}"]`).textContent); }
  catch (e) { say(`Could not load the sample: ${e.message}`); }
});
file.addEventListener('change', async () => {
  const f = file.files[0]; file.value = '';
  if (!f) return;
  try { await useData(parseText(await f.text(), f.name), f.name); } catch (e) { say(e.message); }
});
$('#paste-ok').addEventListener('click', async (ev) => {
  ev.preventDefault();
  try { const p = parseText($('#paste-text').value); $('#paste-err').textContent = ''; $('#paste-dlg').close(); await useData(p, 'pasted data'); }
  catch (e) { $('#paste-err').textContent = e.message; }
});

/* ---------- export: a viewer mounted out of sight renders the current definition ---------- */
async function exportAs(fmt, btn) {
  if (!designer) return;
  btn.disabled = true; say(`Making the ${fmt === 'xlsx' ? 'Excel file' : 'PDF'}…`);
  const box = el('div', { className: 'mount' });
  box.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;height:700px';
  document.body.append(box);
  let v;
  try {
    const { mountViewer } = await loadViewer();
    v = mountViewer(box, { server: SERVER, definition: current(), height: '700px' });
    // the viewer's api gets the model a moment after 'ready', so wait for the page count
    const ready = new Promise((res, rej) => { v.on('ready', res); v.on('error', (d) => rej(new Error(d?.message || 'the report did not run'))); });
    const blob = await Promise.race([ready.then(async () => { for (let i = 0; i < 50 && !v.getPageCount(); i++) await new Promise(r => setTimeout(r, 100)); return v.export(fmt); }), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 2 minutes')), 120000))]);
    download(blob, `${fileBase()}.${fmt}`); say(`Downloaded ${fileBase()}.${fmt}.`);
  } catch (e) { say(`Export failed: ${e.message}`); console.error(e); }
  finally { try { v?.unmount(); } catch {} box.remove(); btn.disabled = false; }
}
for (const b of document.querySelectorAll('[data-export]')) b.addEventListener('click', () => exportAs(b.dataset.export, b));
const downloadJson = () => designer && download(new Blob([JSON.stringify(current(), null, 2)], { type: 'application/json' }), `${fileBase()}.pw.json`);
$('#dl-json').addEventListener('click', downloadJson);

/* ---------- share ---------- */
$('#share').addEventListener('click', async () => {
  if (!designer) return;
  const url = `${location.origin}${location.pathname}${HASH}${await encodeDef(current())}`;
  const long = url.length > MAX_URL, input = $('#share-url');
  $('#share-msg').textContent = long
    ? `This report is too long for a link (${url.length.toLocaleString('en-US')} characters; about ${MAX_URL.toLocaleString('en-US')} is the practical limit, usually because it carries a lot of data). Download the .pw.json instead and send that file.`
    : 'Anyone with this link opens the same report. The report is inside the link itself; nothing is uploaded.';
  input.value = long ? '' : url; input.hidden = long;
  $('#share-copy').hidden = long; $('#share-dl').hidden = !long;
  $('#share-dlg').showModal();
  if (!long) input.select();
});
$('#share-copy').addEventListener('click', async () => {
  const i = $('#share-url');
  try { await navigator.clipboard.writeText(i.value); $('#share-copy').textContent = 'Copied'; } catch { i.select(); $('#share-copy').textContent = 'Press Ctrl+C'; }
  setTimeout(() => { $('#share-copy').textContent = 'Copy link'; }, 2000);
});
$('#share-dl').addEventListener('click', downloadJson);

/* ---------- boot: a share link, else the autosave, else a blank report ---------- */
(async () => {
  let def = null;
  if (location.hash.startsWith(HASH)) {
    try { def = await decodeDef(location.hash.slice(HASH.length)); say('Opened from a share link. Your edits stay in this browser.'); }
    catch { say('That share link could not be read; it may have been cut short.'); }
    history.replaceState(null, '', location.pathname + location.search); // reloads then use the autosave
  }
  if (!def) {
    try {
      const s = localStorage.getItem(KEY);
      if (s) {
        def = JSON.parse(s);
        const b = el('button', { type: 'button', textContent: 'Start fresh' });
        b.addEventListener('click', () => $('#fresh').click());
        say('Restored your last session from this browser.', b);
      }
    } catch { def = null; }
  }
  await open(def || structuredClone(BLANK));
  if (def) { save(); syncStart(def); }
})();
