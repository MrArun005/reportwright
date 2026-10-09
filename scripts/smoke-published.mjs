// Post-publish smoke test, run by .github/workflows/publish.yml in a clean folder where all 9 @reportwright/*
// packages were installed from the npm registry (never the workspace). Usage: node smoke-published.mjs <version>
// Needs sample.pw.json beside it and qpdf on PATH. Exits non-zero on the first failed check; each check prints a line.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const version = process.argv[2];
const PKGS = ['fonts', 'fonts-cjk', 'engine', 'cli', 'viewer', 'react', 'vue', 'svelte', 'angular'];
const DOM = new Set(['viewer', 'react', 'vue', 'svelte', 'angular']); // browser packages: no DOM in Node
const require = createRequire(path.join(process.cwd(), 'x.js'));
const ok = (m) => console.log('ok  ' + m);
const assert = (c, m) => { if (!c) throw new Error(m); };
const dir = (p) => path.dirname(require.resolve(`@reportwright/${p}/package.json`));
const magic = (b, s) => Buffer.from(b.subarray(0, s.length)).toString('latin1') === s;

for (const p of PKGS) {
  const pj = JSON.parse(fs.readFileSync(path.join(dir(p), 'package.json'), 'utf8'));
  assert(pj.version === version, `${p}: installed ${pj.version}, expected ${version}`);
  const e = pj.exports?.['.'];
  const rel = (typeof e === 'string' ? e : e?.default ?? e?.import) ?? pj.module ?? pj.main;
  assert(rel, `${p}: package.json names no main entry`);
  const file = path.join(dir(p), rel);
  assert(fs.existsSync(file), `${p}: entry ${rel} is missing`);
  try { await import(pathToFileURL(file).href); ok(`${p} main entry imports`); } catch (err) {
    // a browser package needs a DOM or its framework (peers we do not install); anything else is a real failure
    const peer = err.code === 'ERR_MODULE_NOT_FOUND' && /'(react|react-dom|vue|svelte|@angular[^']*)'/.test(err.message);
    assert(DOM.has(p) && (err instanceof ReferenceError || peer), `${p}: import failed: ${err.stack || err}`);
    ok(`${p} main entry exists (not run in Node: ${err.message.split('\n')[0]})`);
  }
}

// render and export a small report
const { render, defaultFontStore, exportPdf, exportXlsx, exportDocx } = await import('@reportwright/engine');
const fonts = defaultFontStore();
const model = await render(JSON.parse(fs.readFileSync('sample.pw.json', 'utf8')), { fontStore: fonts, exportData: true });
const pdf = await exportPdf(model, { fonts, title: 'Smoke' });
const xlsx = await exportXlsx(model, { fonts });
const docx = await exportDocx(model, { fonts });
assert(magic(pdf, '%PDF-'), 'the PDF has no %PDF- header');
assert(magic(xlsx, 'PK') && magic(docx, 'PK'), 'the XLSX or DOCX is not a zip');
fs.writeFileSync('out.pdf', pdf); fs.writeFileSync('out.xlsx', xlsx); fs.writeFileSync('out.docx', docx);
ok(`engine + fonts: PDF ${pdf.length}, XLSX ${xlsx.length}, DOCX ${docx.length} bytes`);
execFileSync('qpdf', ['--check', 'out.pdf'], { stdio: 'inherit' });
ok('qpdf --check passes');

// the CLI, from the registry install
execFileSync('npx', ['--no-install', 'pw', 'render', 'sample.pw.json', '-f', 'pdf', '-o', 'cli.pdf'], { stdio: 'inherit' });
assert(magic(fs.readFileSync('cli.pdf'), '%PDF-'), 'pw render wrote no PDF');
ok('pw render makes a PDF');

// the viewer's files: the modules, the worker and its side files, one file each (no chunk imports in the worker)
const vd = path.join(dir('viewer'), 'dist');
for (const f of ['viewer.js', 'designer.js', 'engine.worker.js', 'engine.worker.bwip.js', 'peer/viewer.js', 'peer/engine.worker.js']) assert(fs.existsSync(path.join(vd, f)), `viewer: dist/${f} is missing`);
for (const f of fs.readdirSync(vd).filter(f => /^engine\.worker.*\.js$/.test(f))) assert(!/from\s*["']\.\/chunk-/.test(fs.readFileSync(path.join(vd, f), 'utf8')), `viewer: ${f} imports a chunk (the worker is one file)`);
ok('viewer: dist files and the one-file worker are present');

// the wrappers resolve their peer @reportwright/viewer, at this version
for (const w of ['react', 'vue', 'svelte', 'angular']) {
  const pj = JSON.parse(fs.readFileSync(path.join(dir(w), 'package.json'), 'utf8'));
  assert(pj.peerDependencies?.['@reportwright/viewer'] === version, `${w}: peer @reportwright/viewer is ${pj.peerDependencies?.['@reportwright/viewer']}, expected ${version}`);
  assert(fs.existsSync(createRequire(path.join(dir(w), 'package.json')).resolve('@reportwright/viewer/package.json')), `${w}: cannot resolve @reportwright/viewer`);
}
ok('wrappers resolve @reportwright/viewer');
console.log(`SMOKE PASSED for ${version}`);
