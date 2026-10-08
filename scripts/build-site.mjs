// Builds dist-site/: the static live demo (no server). npm run build:site
// Every URL in the site is relative, so dist-site works at any path on any static host.
// PW_SITE_BASE (default /pagewright-demo/) and PW_SITE_ORIGIN only fill the canonical link.
//
// The demo has no ReportWright server, so the parts of its API the viewer calls are written as static files:
//   api/reports/<id>         the report definitions in reports/
//   api/fonts                [] (no uploaded fonts)
//   api/sample/...           the same deterministic sample data the server's /api/sample routes return
//                            (hard = the 5,000-row set stress-ledger asks for; torture = torture-test-designer's portfolio)
//   data/dummyjson/...       a checked-in snapshot of dummyjson.com (product reports), so no live third-party call
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sampleSales } from '../src/sample/sales.js';
import { sampleLoan, listSampleAccounts } from '../src/sample/loans.js';
import { sampleStress } from '../src/sample/stress.js';
import { sampleHard } from '../src/sample/hard.js';
import { sampleTorture } from '../src/sample/torture.js';

const root = path.join(import.meta.dirname, '..');
const out = path.join(root, 'dist-site');
const base = (process.env.PW_SITE_BASE || '/pagewright-demo/').replace(/^\/?/, '/').replace(/\/?$/, '/');
const siteOrigin = (process.env.PW_SITE_ORIGIN || 'https://mrarun005.github.io').replace(/\/$/, '');

if (!process.argv.includes('--no-embed')) execFileSync(process.execPath, [path.join(root, 'scripts/build-embed.mjs')], { stdio: 'inherit' });

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });
const copy = (from, to = from) => fs.cpSync(path.join(root, 'public', from), path.join(out, to), { recursive: true });
copy('embed'); copy('fonts'); copy('icc'); copy('harfbuzz-subset.wasm');
// the embed is minified with no source maps; make sure nothing else slipped in
for (const f of fs.readdirSync(out, { recursive: true }).map(String)) {
  if (f.endsWith('.map')) fs.rmSync(path.join(out, f));
  else if (f.endsWith('.js')) { // vendored ExcelJS points at a map that is not shipped
    const js = fs.readFileSync(path.join(out, f), 'utf8');
    if (js.includes('sourceMappingURL=')) fs.writeFileSync(path.join(out, f), js.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n'));
  }
}

const write = (rel, data) => {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data));
};

// report definitions; the product reports read the dummyjson snapshot instead of the live API
const DUMMY = 'https://dummyjson.com/';
const reportList = [];
for (const file of fs.readdirSync(path.join(root, 'reports')).filter(f => f.endsWith('.pw.json'))) {
  const def = JSON.parse(fs.readFileSync(path.join(root, 'reports', file), 'utf8'));
  let snap = false;
  for (const s of def.dataSources || []) {
    if (typeof s.url === 'string' && s.url.startsWith(DUMMY)) {
      s.url = '/data/dummyjson/' + s.url.slice(DUMMY.length).replace('products?limit=0', 'products-all');
      snap = true;
    }
  }
  let json = JSON.stringify(def);
  // the report must not claim live data it no longer reads
  if (snap) json = json.replace('Live from dummyjson.com.', 'From a dummyjson.com snapshot.').replace('(live API)', '(dummyjson snapshot)').replaceAll('Live data: dummyjson.com', 'Data: dummyjson.com snapshot');
  write(`api/reports/${file.replace(/\.pw\.json$/, '')}`, json);
  if (!file.startsWith('e2e-')) { // the report list, as GET /api/reports returns it (test fixtures left out)
    let items = 0;
    const count = (list) => (list || []).forEach(i => { items++; count(i.items); });
    for (const sec of Object.values(def.sections || {})) for (const b of Array.isArray(sec) ? sec : [sec]) count(b?.items);
    reportList.push({ id: file.replace(/\.pw\.json$/, ''), name: def.name || file, updatedAt: '', items, parameters: (def.parameters || []).map(p => ({ name: p.name, type: p.type || 'string', required: !!p.required })) });
  }
}
// The designer's drill-through, subreport and master/part pickers fetch api/reports (no slash). A static host cannot
// have a file and a folder of that name, so the list is the folder's index: GitHub Pages redirects api/reports to
// api/reports/ and serves this file; the designer reads the body as JSON whatever its content type.
write('api/reports/index.html', reportList.sort((x, y) => x.name.localeCompare(y.name)));
write('api/fonts', []);
for (const y of [2024, 2025, 2026]) write(`api/sample/sales/${y}`, sampleSales(String(y)));
for (const { id } of listSampleAccounts()) write(`api/sample/loans/${id}`, sampleLoan(id));
// the stress report's row-count choices
const stress = JSON.parse(fs.readFileSync(path.join(root, 'reports/stress-scale.pw.json'), 'utf8')).parameters[0].options.map(o => o.value);
for (const n of stress) write(`api/sample/stress/${n}`, sampleStress(n));
// stress-ledger and account-detail read /api/sample/hard?rows=5000; a static host ignores the query string,
// so api/sample/hard is the 5,000-row set. Change both if a report ever asks for another row count.
const hardUrls = ['stress-ledger', 'account-detail'].flatMap(id => JSON.parse(fs.readFileSync(path.join(root, `reports/${id}.pw.json`), 'utf8')).dataSources.map(s => s.url));
// account-detail also sends &account=; it filters by account itself, so the 5,000-row set still answers it
if (hardUrls.some(u => !u.startsWith('/api/sample/hard?') || new URLSearchParams(u.split('?')[1]).get('rows') !== '5000')) throw new Error(`api/sample/hard is emitted for rows=5000 only; reports ask for ${hardUrls}`);
write('api/sample/hard', sampleHard(5000));
write('api/sample/torture', sampleTorture());

// dummyjson snapshot: products-all is the list; each product also as products/<id>
const products = JSON.parse(fs.readFileSync(path.join(root, 'site/data/dummyjson/products-all'), 'utf8'));
for (const p of products.products) write(`data/dummyjson/products/${p.id}`, p);

for (const page of ['index.html']) {
  const f = path.join(out, page);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replaceAll('%SITE_URL%', siteOrigin + base));
}
const size = fs.readdirSync(out, { recursive: true }).reduce((s, f) => { const st = fs.statSync(path.join(out, String(f))); return st.isFile() ? s + st.size : s; }, 0);
console.log(`dist-site: ${(size / 1048576).toFixed(1)} MB, canonical ${siteOrigin + base}`);
