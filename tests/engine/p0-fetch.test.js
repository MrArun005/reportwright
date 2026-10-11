// P0: the engine library's default fetch (no `fetch` option) is guarded (SSRF), time-limited and size-capped.
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import { render } from '../../src/engine/index.js';
import { checkUrl, privateHost, redirectRequest } from '../../src/engine/data/guard.js';
import { fontStore } from '../helpers.js';

const def = (url, extra = {}) => ({
  $schema: 'reportwright/report@1', name: 'F', page: { size: 'A4' },
  parameters: [{ name: 'u', type: 'string', default: '' }],
  dataSources: [{ name: 's', type: 'rest', url, ...extra }], dataSets: [{ name: 'Rows', source: 's', path: '$' }],
  sections: { body: { items: [] } },
});

// two local servers (two origins): A answers, redirects, stalls, floods; B records what reached it
let A, B, a, b;
const seen = [];
const listen = (h) => new Promise(r => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => r(s)); });
beforeAll(async () => {
  B = await listen((req, res) => { seen.push({ url: req.url, headers: req.headers }); res.setHeader('content-type', 'application/json'); res.end('[{"b":1}]'); });
  b = `http://127.0.0.1:${B.address().port}`;
  A = await listen((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url.startsWith('/to-b')) { res.statusCode = 302; res.setHeader('location', `${b}/landed`); return res.end(); }
    if (req.url.startsWith('/to-meta')) { res.statusCode = 302; res.setHeader('location', 'http://169.254.169.254/latest'); return res.end(); }
    if (req.url.startsWith('/loop')) { res.statusCode = 302; res.setHeader('location', `${req.url}x`); return res.end(); }
    if (req.url.startsWith('/stall')) return; // never answers
    if (req.url.startsWith('/drip')) { res.write('['); const t = setInterval(() => res.write(' '), 20); res.on('close', () => clearInterval(t)); return; }
    if (req.url.startsWith('/big')) { res.setHeader('content-type', 'application/json'); return res.end(Buffer.alloc(2 * 1048576, 32)); }
    if (req.url.startsWith('/bomb')) { res.setHeader('content-type', 'application/json'); res.setHeader('content-encoding', 'gzip'); return res.end(zlib.gzipSync(Buffer.alloc(50 * 1048576, 32))); }
    res.setHeader('content-type', 'application/json'); res.end('[{"a":1}]');
  });
  a = `http://127.0.0.1:${A.address().port}`;
});
afterAll(() => { A.close(); B.close(); });
afterEach(() => { vi.restoreAllMocks(); seen.length = 0; });
const local = { allowHosts: ['127.0.0.1'] };

describe('P0: SSRF guard on the default fetch', () => {
  const bad = ['http://127.0.0.1/x', 'http://2130706433/x', 'http://0x7f.1/x', 'http://0177.0.0.1/x', 'http://127.1/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x',
    'http://[::ffff:7f00:1]/x', 'http://169.254.169.254/latest', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://10.1.2.3/', 'http://192.168.1.1/', 'http://172.20.0.1/',
    'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[64:ff9b::7f00:1]/', 'http://localhost:3000/x', 'http://a.localhost/', 'file:///etc/passwd', 'data:application/json,[]',
    'gopher://example.com/', 'http://u:p@example.com/'];
  for (const url of bad) it(`refuses ${url}`, async () => {
    await expect(render(def(url), { fontStore })).rejects.toMatchObject({ status: expect.any(Number) });
  });
  it('allowHosts lets a private host through (pinned request); unsafeFetch turns the guard off', async () => {
    await render(def(`${a}/rows`), { fontStore, ...local });
    expect(seen.map(s => s.url)).toEqual(['/rows']);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    await render(def('http://127.0.0.1:1/rows'), { fontStore, unsafeFetch: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('a name that resolves to a private address, or does not resolve, is refused (fail closed, pinned lookup)', async () => {
    const real = process.getBuiltinModule;
    for (const answer of [(n, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]), (n, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }]),
      (n, o, cb) => cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })), (n, o, cb) => cb(null, [])]) {
      vi.spyOn(process, 'getBuiltinModule').mockImplementation((m) => (m === 'node:dns' ? { lookup: answer } : real(m)));
      await expect(render(def('http://rebind.example.com/x'), { fontStore })).rejects.toThrow();
      vi.restoreAllMocks();
    }
    expect(privateHost('8.8.8.8')).toBe(false);
    expect(() => checkUrl('http://[::ffff:a9fe:a9fe]/', [])).toThrow(/private/);
  });
  it('a redirect hop is checked again; another origin gets none of the source\'s headers; at most 5 hops', async () => {
    await render(def(`${a}/to-b`, { headers: { authorization: 'Bearer s3cret', 'x-token': 'abc', accept: 'application/json' } }), { fontStore, ...local });
    const landed = seen.find(s => s.url === '/landed');
    expect(landed.headers.authorization).toBeUndefined();
    expect(landed.headers['x-token']).toBeUndefined();
    expect(landed.headers.accept).toBe('application/json');
    await expect(render(def(`${a}/to-meta`), { fontStore, ...local })).rejects.toMatchObject({ status: 403 });
    seen.length = 0;
    await expect(render(def(`${a}/loop`), { fontStore, ...local })).rejects.toThrow(/Too many redirects/);
    expect(seen.length).toBe(6);
  });
  it('https never redirects to http', () => {
    expect(() => redirectRequest(new URL('https://a.example/'), new URL('http://a.example/x'), {}, 302)).toThrow(/https to http/);
    const r = redirectRequest(new URL('https://a.example/'), new URL('https://b.example/'), { method: 'POST', body: 'x', headers: { cookie: 'c', 'x-api-key': 'k', 'content-type': 'text/plain' } }, 303);
    expect([...r.headers.keys()]).toEqual(['content-type']);
    expect(r.method).toBe('GET');
  });
  it('a parameter fills the path and query, not the scheme and host', async () => {
    await expect(render(def('http://{Parameters.u}/x'), { fontStore, parameters: { u: '127.0.0.1' }, ...local })).rejects.toMatchObject({ status: 403 });
    await expect(render(def('{Parameters.u}'), { fontStore, parameters: { u: `${a}/x` } })).rejects.toMatchObject({ status: 403 });
    await expect(render(def('=Parameters.u'), { fontStore, parameters: { u: 'https://api.example.com/x' } })).rejects.toMatchObject({ status: 403 });
    expect(seen).toEqual([]);
    await render(def('{Parameters.u}'), { fontStore, parameters: { u: `${a}/whole` }, ...local });
    await render(def(`${a}/{Parameters.u}`), { fontStore, parameters: { u: 'rows' }, ...local });
    expect(seen.map(s => s.url)).toEqual(['/whole', '/rows']);
  });
});

describe('P0: one time limit and one byte cap per request (hops, headers and body)', () => {
  it('a source that never answers, or drips its body, stops at fetchTimeoutMs (504)', async () => {
    for (const p of ['/stall', '/drip']) {
      const t = Date.now();
      await expect(render(def(`${a}${p}`), { fontStore, ...local, fetchTimeoutMs: 300 })).rejects.toMatchObject({ status: 504 });
      expect(Date.now() - t).toBeLessThan(3000);
    }
  });
  it('a body past maxFetchBytes stops with 413; a gzip bomb through the caller\'s fetch is counted decoded', async () => {
    await expect(render(def(`${a}/big`), { fontStore, ...local, maxFetchBytes: 1048576 })).rejects.toMatchObject({ status: 413 });
    const t = Date.now();
    await expect(render(def(`${a}/bomb`), { fontStore, maxFetchBytes: 1048576, fetch: (u, i) => globalThis.fetch(u, i) })).rejects.toMatchObject({ status: 413 });
    expect(Date.now() - t).toBeLessThan(5000);
  });
});
