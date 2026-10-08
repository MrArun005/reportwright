#!/usr/bin/env node
// Install footprint: each library installed alone, at the version bench/package.json pins, into an empty folder
// (npm install --omit=dev; peers such as react and @reportwright/fonts come with it). Counts node_modules on disk
// and, for Puppeteer, the Chrome it downloads. CI only: it downloads every package and a browser. Writes out/install.json.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = import.meta.dirname;
const deps = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).dependencies;
const at = (p) => `${p}@${deps[p]}`;
const SETS = {
  reportwright: [at('@reportwright/engine'), at('@reportwright/fonts')],
  pdfmake: [at('pdfmake')],
  'react-pdf': [at('@react-pdf/renderer'), at('react')],
  pdfkit: [at('pdfkit')],
  puppeteer: [at('puppeteer')],
};
const du = (p) => (fs.existsSync(p) ? Number(execFileSync('du', ['-sk', p], { encoding: 'utf8' }).split('\t')[0]) / 1024 : 0);

const out = {};
for (const [lib, pkgs] of Object.entries(SETS)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rw-inst-${lib}-`));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}');
  const cache = path.join(dir, 'browsers');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', ...pkgs], { cwd: dir, stdio: 'inherit', env: { ...process.env, PUPPETEER_CACHE_DIR: cache } });
  out[lib] = { packages: pkgs, nodeModulesMB: +du(path.join(dir, 'node_modules')).toFixed(1), browserMB: +du(cache).toFixed(1) };
  out[lib].totalMB = +(out[lib].nodeModulesMB + out[lib].browserMB).toFixed(1);
  console.error(`${lib}: ${out[lib].totalMB} MB`);
  fs.rmSync(dir, { recursive: true, force: true });
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out/install.json'), JSON.stringify(out, null, 1) + '\n');
