// The pw CLI reads data through the engine's guarded fetch: a local --base needs --allow-internal. And every raw
// fetch( in src/ and bin/ is on a reviewed list (a new one fails here until it goes through a guard or is listed).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..', '..');
const run = (args) => new Promise((res) => {
  const c = spawn(process.execPath, [path.join(ROOT, 'bin', 'pw.mjs'), ...args], { cwd: ROOT });
  let out = '', err = '';
  c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
  c.on('close', code => res({ code, out, err }));
});

let srv, base, dir;
beforeAll(async () => {
  srv = await new Promise(r => { const s = http.createServer((q, a) => { a.setHeader('content-type', 'application/json'); a.end('[{"v":"hello from local"}]'); }); s.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-guard-'));
  fs.writeFileSync(path.join(dir, 'r.pw.json'), JSON.stringify({ $schema: 'pagewright/report@1', name: 'R', page: { size: 'A4' },
    dataSources: [{ name: 's', type: 'rest', url: '/rows' }], dataSets: [{ name: 'Rows', source: 's', path: '$' }],
    sections: { body: { items: [{ type: 'textbox', x: 0, y: 0, w: 300, h: 20, dataSet: 'Rows', value: '=First(Fields.v)' }] } } }));
});
afterAll(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('pw render and the fetch guard', () => {
  it('a local --base is refused without --allow-internal, and read with it', async () => {
    const f = path.join(dir, 'r.pw.json');
    const no = await run(['render', f, '--base', base, '-f', 'txt', '-o', '-']);
    expect(no.code).not.toBe(0);
    expect(no.err).toMatch(/private or local/);
    const yes = await run(['render', f, '--base', base, '--allow-internal', '-f', 'txt', '-o', '-']);
    expect(yes.err).toBe('');
    expect(yes.out).toContain('hello from local');
  });
});

/** Files allowed to call fetch( directly, and why. Everything else goes through a guard or is handed one. */
const REVIEWED = {
  'src/engine/data/guard.js': 'the engine guard itself (globalThis.fetch in a browser, behind the checks)',
  'src/engine/data/index.js': 'fetcherFor: globalThis.fetch only behind guardedFetch (unsafeFetch opts out)',
  'src/server/safeFetch.js': 'the server guard itself',
  'src/server/renderer.js': 'batchFetch: wraps the guarded fetch it is handed (a parameter named fetch)',
  'src/server/jobs.js': 'expandItems: the guarded fetch it is handed (a parameter named fetch)',
  'src/server/blobs.js': 'S3 storage at the operator-configured endpoint (PW_BLOBS), never a report URL',
  'src/viewer/dataFetch.js': 'reportFetch: the browser guard itself (same-origin data routes only)',
  'src/viewer/engineClient.js': 'fonts, the report and the colour profile from this app (same origin)',
  'src/viewer/interactiveHtml.js': 'the exported file reads its own embedded snapshot and this app\'s fonts',
  'src/viewer/ViewerShell.jsx': 'this app\'s own API',
  'src/worker/engine.worker.js': 'fonts from this app; data through reportFetch',
  'src/embed/index.js': 'the embed viewer: this app\'s API at its configured server',
  'src/embed/designer.js': 'the embed designer: this app\'s API at its configured server',
  ...Object.fromEntries(['AskAi', 'DataPanel', 'Designer', 'Fonts', 'Inspector', 'Reuse', 'SqlBuilder'].map(n => [`src/designer/${n}.jsx`, 'the designer: this app\'s own API'])),
  'src/designer/store.js': 'the designer: this app\'s own API',
  ...Object.fromEntries(['Account', 'Devices', 'FolderActions', 'MoreWays', 'NewReport', 'ScheduleToggle', 'Schedules', 'Share', 'Thumb', 'TwoFactor'].map(n => [`src/home/${n}.jsx`, 'the home page: this app\'s own API'])),
};
const RAW = /(^|[^.\w$])fetch\(|globalThis\.fetch|window\.fetch/;
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(m?js|jsx)$/.test(e.name) ? [`${d}/${e.name}`] : []));

describe('raw fetch( calls', () => {
  it('appear only in reviewed files', () => {
    const found = [...walk('src'), ...walk('bin')].filter(f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').some(l => !/^\s*(\/\/|\*)/.test(l) && RAW.test(l)));
    expect(found.filter(f => !REVIEWED[f])).toEqual([]);
  });
});
