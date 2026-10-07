// Phase A security fixes from the 2026-10-04 review. Each test failed before its fix.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { safeFetch, isPrivate } from '../../src/server/safeFetch.js';
import { safeName } from '../../src/server/jobs.js';
import { authorize } from '../../src/server/auth.js';
import { basicAuth } from '../../src/server/basicAuth.js';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const withEnv = async (vars, fn) => {
  const old = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

describe('isPrivate', () => {
  it('blocks loopback, private, link-local, shared, benchmark, multicast and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255',
      '::', '::1', 'fd00::1', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe']) expect(isPrivate(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '64:ff9b::808:808']) expect(isPrivate(ip), ip).toBe(false);
  });
});

describe('safeFetch', () => {
  let server, origin;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/hop') { res.writeHead(302, { location: `http://127.0.0.2:${server.address().port}/` }); return res.end(); }
      if (req.url === '/big') { res.write(Buffer.alloc(2 * 1024 * 1024)); return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ method: req.method, body, auth: req.headers.authorization || null })); });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => server.close());

  it('refuses private and local addresses', async () => {
    for (const u of [`${origin}/`, 'http://localhost:9/', 'http://[::1]:9/', 'http://169.254.169.254/latest/meta-data', 'http://0x7f000001:9/']) {
      await expect(safeFetch(u), u).rejects.toThrow(/private|not written plainly/); // 0x7f000001 is refused as written, before any lookup
    }
  });
  it('refuses other protocols', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/http/);
  });
  it('lets through this server (by origin) and listed internal hosts (by name)', async () => {
    const r = await safeFetch(`${origin}/x`, { method: 'POST', body: 'hi', headers: { authorization: 'Bearer t' } }, { allow: [origin] });
    expect(await r.json()).toEqual({ method: 'POST', body: 'hi', auth: 'Bearer t' });
    expect((await safeFetch(`${origin}/x`, {}, { allow: ['127.0.0.1'] })).status).toBe(200);
  });
  it('with PW_BASIC_AUTH, calls to this server carry the app password, and calls elsewhere do not', () => withEnv({ PW_BASIC_AUTH: 'admin:s3cret', PW_INTERNAL_HOSTS: '127.0.0.1' }, async () => {
    const { serverFetch } = await import('../../src/server/safeFetch.js');
    const self = await (await serverFetch(origin)(`${origin}/x`)).json();
    expect(self.auth).toBe(`Basic ${Buffer.from('admin:s3cret').toString('base64')}`);
    const other = await (await serverFetch('http://reports.example.com')(`${origin}/x`)).json();
    expect(other.auth).toBe(null);
  }));
  it('checks every redirect hop', async () => {
    await expect(safeFetch(`${origin}/hop`, {}, { allow: [origin] })).rejects.toThrow(/private/);
  });
  // PW_FETCH_MAX_MB (default 64) set to 1 here, so the test reads 2 MB, not 64
  it('stops reading a response over PW_FETCH_MAX_MB', () => withEnv({ PW_FETCH_MAX_MB: '1' }, async () => {
    const r = await safeFetch(`${origin}/big`, {}, { allow: [origin] });
    await expect(r.arrayBuffer()).rejects.toThrow(/larger than 1 MB/);
  }));
});

describe('server renders fetch through the guard', () => {
  it('a report cannot read a private address through server-side rendering', async () => {
    const { renderTo } = await import('../../src/server/renderer.js');
    const def = report([], { def: { dataSources: [{ name: 'src', type: 'rest', url: 'http://169.254.169.254/latest/meta-data' }] } });
    await expect(renderTo(def, { format: 'json', baseUrl: 'http://127.0.0.1:3000' })).rejects.toThrow(/private/);
    await expect(renderTo(def, { format: 'json', baseUrl: 'http://127.0.0.1:3000' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('batches', () => {
  it('a folder or file name cannot climb out of its directory', () => {
    const outputs = path.join('/srv', 'data', 'outputs');
    for (const bad of ['..', '.', '...', '../schedules.json', '.hidden']) {
      const n = safeName(bad);
      expect(n.startsWith('.'), bad).toBe(false);
      expect(path.join(outputs, n).startsWith(outputs + path.sep), bad).toBe(true);
    }
    expect(safeName('loan-2026.pdf')).toBe('loan-2026.pdf');
  });
});

describe('API keys', () => {
  it('a key with non-ASCII characters is refused, not a crash', () => withEnv({ PW_API_KEYS: 'abc' }, async () => {
    const res = await authorize(new Request('http://x/api/v1/render', { headers: { authorization: 'Bearer ébc' } }));
    expect(res.status).toBe(401);
    expect(await authorize(new Request('http://x/api/v1/render', { headers: { authorization: 'Bearer abc' } }))).toBe(null);
  }));
});

describe('basic auth (PW_BASIC_AUTH)', () => {
  const req = (url, init = {}) => new Request(`http://x${url}`, init);
  const basic = (s) => ({ authorization: `Basic ${Buffer.from(s).toString('base64')}` });

  it('is off until PW_BASIC_AUTH is set', () => withEnv({ PW_BASIC_AUTH: '' }, async () => {
    expect(await basicAuth(req('/designer/a'))).toBe(null);
  }));
  it('asks for the password on pages and report routes', () => withEnv({ PW_BASIC_AUTH: 'admin:s3cret' }, async () => {
    const r = await basicAuth(req('/designer/a'));
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/^Basic /);
    expect((await basicAuth(req('/api/reports/a', { method: 'PUT', headers: basic('admin:wrong') }))).status).toBe(401);
    expect(await basicAuth(req('/api/reports/a', { method: 'PUT', headers: basic('admin:s3cret') }))).toBe(null);
  }));
  it('leaves /api/v1 (API keys) and the embed script alone', () => withEnv({ PW_BASIC_AUTH: 'admin:s3cret' }, async () => {
    expect(await basicAuth(req('/api/v1/render', { method: 'POST' }))).toBe(null);
    expect(await basicAuth(req('/embed/pagewright-viewer.js'))).toBe(null);
  }));
  it('with PW_EMBED_ORIGINS, embeds can read reports and sample data but not change them', () => withEnv({ PW_BASIC_AUTH: 'admin:s3cret', PW_EMBED_ORIGINS: 'https://host.example' }, async () => {
    expect(await basicAuth(req('/api/reports/loan-statement'))).toBe(null);
    expect(await basicAuth(req('/api/sample/loans'))).toBe(null);
    expect((await basicAuth(req('/api/reports/loan-statement', { method: 'PUT' }))).status).toBe(401);
    expect((await basicAuth(req('/api/reports/loan-statement/pdf'))).status).toBe(401);
  }));
});

describe('subreports', () => {
  it('one render cannot fan out into thousands of subreports', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => ({ n: i }));
    const list = { type: 'list', name: 'L', x: 0, y: 0, w: 300, h: 20, dataSet: 'Rows', items: [{ type: 'subreport', name: 'S', x: 0, y: 0, w: 300, h: 20, report: 'child', params: { n: '=Fields.n' } }] };
    const child = report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 14, value: 'child' }]);
    await expect(render(report([list], { data: { rows } }), { fontStore, loadReport: async () => child })).rejects.toThrow(/2000 subreports/);
  });
});

describe('report storage', () => {
  it('refuses report definitions over 5 MB', async () => {
    const { readDefinition } = await import('../../src/server/reports.js');
    const big = new Request('http://x/api/reports/a', { method: 'PUT', body: JSON.stringify({ pad: 'x'.repeat(5 * 1024 * 1024) }) });
    await expect(readDefinition(big)).rejects.toMatchObject({ status: 413 });
    expect(await readDefinition(new Request('http://x/api/reports/a', { method: 'PUT', body: '{"name":"ok"}' }))).toEqual({ name: 'ok' });
  });
});
