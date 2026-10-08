// PW_INTERNAL_HOSTS are reachable only by data sources a designer (or a service key) saved: a viewer, a public
// principal or a parameter never widens that. Images never reach them.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { stampDefinition, readRunnable, serverSources, OPEN, PUBLIC } from '../../src/server/perms.js';
import { writeReport } from '../../src/server/reports.js';
import { renderTo, assertFixedHosts } from '../../src/server/renderer.js';

let srv, port, hits = [], tmp, n = 0;
const keep = { ...process.env };
beforeAll(async () => {
  srv = await new Promise(r => { const s = http.createServer((q, a) => { hits.push(q.url); a.setHeader('content-type', 'application/json'); a.end('[{"v":"internal secret"}]'); }); s.listen(0, '127.0.0.1', () => r(s)); });
  port = srv.address().port;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-int-'));
  process.env.PW_INTERNAL_HOSTS = '127.0.0.1';
});
beforeEach(() => { hits = []; process.env.PW_STORAGE = `sqlite:${path.join(tmp, `s-${++n}.db`)}`; });
afterAll(() => { srv.close(); for (const k of ['PW_INTERNAL_HOSTS', 'PW_STORAGE', 'PW_FIXED_FETCH_HOSTS']) if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; fs.rmSync(tmp, { recursive: true, force: true }); });

const def = (url, items = []) => ({ $schema: 'pagewright/report@1', name: 'I', page: { size: 'A4' }, parameters: [{ name: 'u', type: 'string', default: '' }],
  dataSources: [{ name: 's', type: 'rest', url }], dataSets: [{ name: 'Rows', source: 's', path: '$' }],
  sections: { body: { items: [{ type: 'textbox', x: 0, y: 0, w: 300, h: 20, dataSet: 'Rows', value: '=First(Fields.v)' }, ...items] } } });
const viewer = { kind: 'user', email: 'v@x.io', role: 'viewer', groups: [] };
const designer = { kind: 'user', email: 'd@x.io', role: 'designer', groups: [] };

describe('internal hosts: designer-saved data sources only', () => {
  it('an internal source, or one whose host a parameter builds, is privileged', () => {
    expect(serverSources(def(`http://127.0.0.1:${port}/rows`))).toHaveLength(1);
    expect(serverSources(def('={Parameters.u}'))).toHaveLength(1);
    expect(serverSources(def('https://{Parameters.u}/rows'))).toHaveLength(1);
  });
  it('a viewer or public principal cannot save one; a report not saved by a designer does not run', async () => {
    const d = def(`http://127.0.0.1:${port}/rows`);
    await expect(stampDefinition(viewer, 'r1', d)).rejects.toMatchObject({ status: 403 });
    await expect(stampDefinition(PUBLIC, 'r1', d)).rejects.toMatchObject({ status: 403 });
    await writeReport('r1', d);
    await expect(readRunnable(OPEN, 'r1')).rejects.toMatchObject({ status: 403 });
    expect(hits).toEqual([]);
  });
  it('a designer-saved internal source runs', async () => {
    const d = def(`http://127.0.0.1:${port}/rows`);
    await writeReport('r2', d);
    await stampDefinition(designer, 'r2', d);
    const ok = await readRunnable(OPEN, 'r2');
    await renderTo(ok, { format: 'json', principal: viewer, baseUrl: 'http://pw.test' });
    expect(hits).toEqual(['/rows']);
  });
  it('a parameter cannot point a saved report at an internal host (fixed hosts, the production default)', async () => {
    process.env.PW_FIXED_FETCH_HOSTS = '1';
    expect(() => assertFixedHosts(def('{Parameters.u}'))).toThrow(/host is made by an expression or a parameter/);
    await expect(renderTo(def('{Parameters.u}'), { format: 'json', principal: viewer, baseUrl: 'http://pw.test', parameters: { u: `http://127.0.0.1:${port}/rows` } })).rejects.toMatchObject({ status: 403 });
    expect(hits).toEqual([]);
    delete process.env.PW_FIXED_FETCH_HOSTS;
  });
  it('an image URL never reaches an internal host, fixed hosts on or off', async () => {
    for (const fixed of ['1', '0']) {
      process.env.PW_FIXED_FETCH_HOSTS = fixed;
      const d = { ...def('/api/none'), dataSources: [{ name: 's', type: 'json', data: [{ v: 1 }] }] };
      d.sections.body.items.push({ type: 'image', x: 0, y: 30, w: 50, h: 50, src: '=Parameters.u' });
      await renderTo(d, { format: 'pdf', principal: viewer, baseUrl: 'http://pw.test', parameters: { u: `http://127.0.0.1:${port}/img.png` } });
    }
    delete process.env.PW_FIXED_FETCH_HOSTS;
    expect(hits).toEqual([]);
  });
});
