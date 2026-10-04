// Builds dist-site/: the static live demo (no server). npm run build:site
// Every URL in the site is relative, so dist-site works at any path on any static host.
// PW_SITE_BASE (default /pagewright-demo/) and PW_SITE_ORIGIN only fill the canonical link.
//
// The demo has no Pagewright server, so the parts of its API the viewer calls are written as static files:
//   api/reports/<id>         the report definitions in reports/
//   api/fonts                [] (no uploaded fonts)
//   api/sample/...           the same deterministic sample data the server's /api/sample routes return
//   data/dummyjson/...       a checked-in snapshot of dummyjson.com (product reports), so no live third-party call
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sampleSales } from '../src/sample/sales.js';
import { sampleLoan, listSampleAccounts } from '../src/sample/loans.js';
import { sampleStress } from '../src/sample/stress.js';

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
}
write('api/fonts', []);
for (const y of [2024, 2025, 2026]) write(`api/sample/sales/${y}`, sampleSales(String(y)));
for (const { id } of listSampleAccounts()) write(`api/sample/loans/${id}`, sampleLoan(id));
// the stress report's row-count choices
const stress = JSON.parse(fs.readFileSync(path.join(root, 'reports/stress-scale.pw.json'), 'utf8')).parameters[0].options.map(o => o.value);
for (const n of stress) write(`api/sample/stress/${n}`, sampleStress(n));

// dummyjson snapshot: products-all is the list; each product also as products/<id>
const products = JSON.parse(fs.readFileSync(path.join(root, 'site/data/dummyjson/products-all'), 'utf8'));
for (const p of products.products) write(`data/dummyjson/products/${p.id}`, p);

for (const page of ['index.html']) {
  const f = path.join(out, page);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replaceAll('%SITE_URL%', siteOrigin + base));
}
const size = fs.readdirSync(out, { recursive: true }).reduce((s, f) => { const st = fs.statSync(path.join(out, String(f))); return st.isFile() ? s + st.size : s; }, 0);
console.log(`dist-site: ${(size / 1048576).toFixed(1)} MB, canonical ${siteOrigin + base}`);
