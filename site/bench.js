// The benchmarks page: everything shown comes from bench/results.json (written by bench/run.mjs). Nothing is typed in
// here except the pinned versions (bench/package.json) and how each library is used (bench/README.md).
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

/* theme: the same switch and storage key as the demo page */
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
$('#theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('pw-site-theme', next); } catch {}
});

const LIBS = [
  { id: 'reportwright', name: '@reportwright/engine', pinned: '0.12.1', how: 'JSON report definition; render() + exportPdf() for the invoice, exportPdfStream() for the table' },
  { id: 'pdfmake', name: 'pdfmake', pinned: '0.3.11', how: 'Document definition; table headerRows: 1; footer(currentPage, pageCount)' },
  { id: 'react-pdf', name: '@react-pdf/renderer', pinned: '4.9.0 (react 19.3.0)', how: 'React components; fixed header row and footer render prop; rows as flex Views' },
  { id: 'pdfkit', name: 'PDFKit', pinned: '0.20.2', how: 'Manual layout: rows, page breaks and header placed by hand; bufferPages for page numbers' },
  { id: 'puppeteer', name: 'Puppeteer', pinned: '25.13.0 (+ its Chrome)', how: 'HTML + CSS printed by headless Chrome; <thead> repeats; @page margin box for page numbers' },
];
const libName = (id) => LIBS.find(l => l.id === id)?.name || id;

const n0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const ms = (v) => (v >= 10000 ? `${n1.format(v / 1000)} s` : v >= 100 ? `${n0.format(v)} ms` : `${n1.format(v)} ms`);
const mb = (v) => `${n0.format(v)} MB`;
const kb = (b) => (b >= 1048576 ? `${n1.format(b / 1048576)} MB` : `${n0.format(b / 1024)} KB`);

/** a bar for value/max with a min–max whisker, as inline SVG */
function bar(stat, max) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 12'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'bar-svg'); svg.setAttribute('aria-hidden', 'true');
  const x = (v) => Math.max(0.6, (v / max) * 100);
  svg.innerHTML = `<rect class="bar-fill" x="0" y="2" width="${x(stat.median)}" height="8"/>`
    + `<line class="bar-spread" x1="${x(stat.min)}" x2="${x(stat.max)}" y1="6" y2="6" vector-effect="non-scaling-stroke"/>`;
  return svg;
}

/**
 * One results block: a table of libraries with a bar for the main metric and the other metrics as columns.
 * cols: [{ label, get(cell) -> number|undefined, fmt, stat?(cell) }]; the first column gets the bar.
 */
function block(title, note, cells, cols) {
  const ok = cells.filter(c => c.status === 'ok');
  const best = cols.map(col => (col.noBest ? NaN : Math.min(...ok.map(col.get).filter(v => v != null)))); // pages are a fact, not a race
  const max = Math.max(...ok.map(c => (cols[0].stat?.(c)?.max ?? cols[0].get(c)) || 0), 1e-9);
  const head = el('tr', {}, el('th', { scope: 'col', textContent: 'Library' }), el('th', { scope: 'col', className: 'bar-col', textContent: cols[0].label }), ...cols.slice(1).map(c => el('th', { scope: 'col', className: 'num-col', textContent: c.label })));
  const rows = cells.map(c => {
    const tr = el('tr', {}, el('th', { scope: 'row', textContent: libName(c.lib) }));
    if (c.status !== 'ok') {
      tr.append(el('td', { colSpan: cols.length, className: 'dnf', textContent: c.status === 'skipped' ? c.note : `${c.status === 'timeout' ? 'Did not finish' : 'Failed'}: ${c.note}` }));
      return tr;
    }
    cols.forEach((col, i) => {
      const v = col.get(c);
      const txt = el('span', { className: v != null && v === best[i] ? 'best' : '', textContent: v == null ? '—' : col.fmt(v) });
      if (i === 0) {
        const s = col.stat?.(c);
        const cell = el('td', { className: 'bar-col' }, el('div', { className: 'bar-cell' }, s ? bar(s, max) : '', txt));
        if (s) cell.title = `median ${col.fmt(s.median)}, min ${col.fmt(s.min)}, max ${col.fmt(s.max)} over ${c.runs} runs`;
        tr.append(cell);
      } else tr.append(el('td', { className: 'num-col' }, txt));
    });
    return tr;
  });
  return el('article', { className: 'result' }, el('h3', { textContent: title }), el('p', { className: 'fine', textContent: note }),
    el('div', { className: 'scroll' }, el('table', { className: 'data' }, el('thead', {}, head), el('tbody', {}, ...rows))));
}

function results(r) {
  const at = (workload, rows = 0) => LIBS.map(l => r.cells.find(c => c.lib === l.id && c.workload === workload && c.rows === rows)).filter(Boolean);
  const blocks = [];
  blocks.push(block('Invoice, cold start', 'A fresh process to the invoice on disk, timed from outside (Node start, import, setup or browser launch, render, exit).', at('invoice'), [
    { label: 'Cold start', get: c => c.wallMs.median, stat: c => c.wallMs, fmt: ms },
    { label: 'Import + setup', get: c => c.loadMs.median, fmt: ms },
    { label: 'Render', get: c => c.renderMs.median, fmt: ms },
    { label: 'Peak RSS', get: c => c.peakRssMB.median, fmt: mb },
    { label: 'PDF size', get: c => c.bytes, fmt: kb },
  ]));
  blocks.push(block('Invoice, warm', 'One invoice in a process that has already made ten: the cost a long-running server pays per document (median of 40).', at('invoice-warm'), [
    { label: 'Per invoice', get: c => c.renderMs.median, stat: c => c.renderMs, fmt: ms },
    { label: 'Peak RSS', get: c => c.peakRssMB.median, fmt: mb },
  ]));
  for (const rows of r.method.sizes) {
    blocks.push(block(`Table report, ${n0.format(rows)} rows`, 'Header repeated on every page, four groups with subtotals, a grand total, "Page N of M". Render time is building the document to the file on disk.', at('table', rows), [
      { label: 'Render', get: c => c.renderMs.median, stat: c => c.renderMs, fmt: ms },
      { label: 'Peak RSS', get: c => c.peakRssMB.median, fmt: mb },
      { label: 'PDF size', get: c => c.bytes, fmt: kb },
      { label: 'Pages', get: c => c.pages, fmt: n0.format, noBest: true },
    ]));
  }
  if (r.install) {
    blocks.push(block('Install size', 'Each library installed alone into an empty folder (npm install --omit=dev, peers included), plus the browser Puppeteer downloads.',
      LIBS.filter(l => r.install[l.id]).map(l => ({ lib: l.id, status: 'ok', install: r.install[l.id] })), [
        { label: 'On disk', get: c => c.install.totalMB, fmt: mb },
        { label: 'node_modules', get: c => c.install.nodeModulesMB, fmt: mb },
        { label: 'Browser', get: c => c.install.browserMB, fmt: mb },
      ]));
  } else blocks.push(el('article', { className: 'result' }, el('h3', { textContent: 'Install size' }), el('p', { className: 'fine', textContent: 'Measured in CI only (it downloads every package and a browser). Pending.' })));
  $('#result-blocks').replaceChildren(el('div', { className: 'results-grid' }, ...blocks));
}

function standards(r) {
  const thead = $('#vera').tHead, tbody = $('#vera').tBodies[0];
  if (!r.verapdf) { tbody.replaceChildren(el('tr', {}, el('td', { textContent: 'veraPDF results pending.' }))); return; }
  const checks = r.verapdf.checks;
  const cols = [['2b', 'invoice', 'PDF/A-2b · invoice'], ['2b', 'table', 'PDF/A-2b · table'], ['ua1', 'invoice', 'PDF/UA-1 · invoice'], ['ua1', 'table', 'PDF/UA-1 · table']];
  thead.replaceChildren(el('tr', {}, el('th', { scope: 'col', textContent: 'Library' }), ...cols.map(([, , l]) => el('th', { scope: 'col', textContent: l })), el('th', { scope: 'col', textContent: 'Option given (PDF/A · PDF/UA)' })));
  const rows = LIBS.filter(l => checks.some(c => c.lib === l.id)).map(l => {
    const tr = el('tr', {}, el('th', { scope: 'row', textContent: l.name }));
    for (const [flavour, workload] of cols) {
      const c = checks.find(x => x.lib === l.id && x.flavour === flavour && x.workload === workload);
      if (!c) { tr.append(el('td', { className: 'muted', textContent: 'not run' })); continue; }
      const verdict = c.compliant === true ? 'Pass' : c.compliant === false ? 'Fail' : 'No verdict';
      const td = el('td', {}, el('span', { className: `verdict ${c.compliant ? 'pass' : 'fail'}`, textContent: verdict }));
      if (c.compliant === false) td.append(el('span', { className: 'why', textContent: ` ${c.failedRules} rule${c.failedRules === 1 ? '' : 's'}` }));
      if (c.failed?.length) td.title = c.failed.map(f => `${f.rule} (${f.checks}×): ${f.description}`).join('\n');
      if (c.note) td.title = c.note;
      tr.append(td);
    }
    const opt = (f) => checks.find(x => x.lib === l.id && x.flavour === f)?.option || '';
    tr.append(el('td', { className: 'opt', textContent: `${opt('2b')} · ${opt('ua1')}` }));
    return tr;
  });
  tbody.replaceChildren(...rows);
  const rowsUsed = [...new Set(checks.filter(c => c.workload === 'table').map(c => c.rows))].join(', ');
  $('#vera-note').textContent = `${r.verapdf.tool}; the table at ${rowsUsed} rows. Hover a verdict for the failed rules. A failure means the file as that library writes it, with the option shown; it is not a claim that the library could never pass with more work.`;

  // capabilities, as the harness uses them (bench/libs/*.mjs)
  const CAPS = [
    ['Repeated header', ['Built in (repeatHeader)', 'Built in (headerRows)', 'Built in (fixed View)', 'Your code (redrawn per page)', 'Built in (<thead>)']],
    ['Page N of M', ['Built in (TotalPages)', 'Built in (footer function)', 'Built in (render prop)', 'Your code (bufferPages, second pass)', 'Built in (CSS counter(pages))']],
    ['Grouped subtotals', ['Built in (groups, Sum, CountRows)', 'Not supported: computed in your code', 'Not supported: computed in your code', 'Not supported: computed in your code', 'Not supported: computed in your code']],
    ['Writes while laying out', ['Yes (exportPdfStream)', 'No (whole document)', 'No (whole document)', 'Pages kept for page numbers', 'No (whole document)']],
    ['PDF/A option', ['Yes', 'Yes (via PDFKit)', 'No', 'Yes', 'No']],
    ['Structure tags (PDF/UA)', ['Built in', 'Flag only, no structure API', 'No', 'By hand (doc.struct)', 'Chrome tagging']],
  ];
  $('#caps').tHead.replaceChildren(el('tr', {}, el('th', { scope: 'col', textContent: '' }), ...LIBS.map(l => el('th', { scope: 'col', textContent: l.name }))));
  $('#caps').tBodies[0].replaceChildren(...CAPS.map(([label, vals]) => el('tr', {}, el('th', { scope: 'row', textContent: label }),
    ...vals.map(v => el('td', { className: /^(Not supported|No\b)/.test(v) ? 'muted' : '', textContent: v })))));
}

function facts(r) {
  const h = r.hardware;
  const dd = (k, v) => el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v }));
  $('#run-facts').replaceChildren(
    dd('Run', `${r.kind === 'benchmark' ? 'Benchmark' : 'Smoke run (not the benchmark)'} · ${r.date.slice(0, 10)}`),
    dd('Machine', `${h.runner === 'local' ? 'Laptop' : h.runner}: ${h.cpu}, ${h.cores} cores, ${h.ramGB} GB`),
    dd('System', `${h.os}, Node ${h.node.replace(/^v/, '')}`),
    dd('Runs', `${r.method.warmup} warmup + ${r.method.runs} measured a cell (${r.method.runsAt100k} at 100,000 rows); a process a run`),
    dd('Rows', r.method.sizes.map(n => n0.format(n)).join(' · ')),
    dd('Timeout', `${r.method.timeoutS} s a run`),
  );
  $('#versions').tBodies[0].replaceChildren(...LIBS.map(l => el('tr', {}, el('th', { scope: 'row', textContent: l.name }),
    el('td', { className: 'mono', textContent: l.pinned + (r.versions[l.id] ? '' : ' · not in this run') }), el('td', { textContent: l.how }))));
  if (r.versions.chrome) $('#versions').tBodies[0].rows[4].cells[1].textContent += ` · Chrome ${r.versions.chrome}`;
}

try {
  const res = await fetch('bench/results.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = await res.json();
  if (r.kind !== 'benchmark') {
    const p = $('#pending');
    p.hidden = false;
    p.append(el('strong', { textContent: 'CI numbers pending. ' }), `The figures below are a ${r.label}. They check that the harness works; they are not the benchmark. The real run is the bench workflow on GitHub Actions.`);
  }
  facts(r);
  results(r);
  standards(r);
} catch (e) {
  $('#result-blocks').replaceChildren(el('p', { className: 'fine', textContent: `results.json did not load (${e.message}).` }));
}
