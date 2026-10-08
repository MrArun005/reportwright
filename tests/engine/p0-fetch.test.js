// P0: the engine library's default fetch (no `fetch` option) is guarded (SSRF), time-limited and size-capped.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '../../src/engine/index.js';
import { checkUrl, privateHost } from '../../src/engine/data/guard.js';
import { fontStore } from '../helpers.js';

const def = (url, extra = {}) => ({
  $schema: 'pagewright/report@1', name: 'F', page: { size: 'A4' },
  parameters: [{ name: 'u', type: 'string', default: '' }],
  dataSources: [{ name: 's', type: 'rest', url, ...extra }], dataSets: [{ name: 'Rows', source: 's', path: '$' }],
  sections: { body: { items: [] } },
});
const ok = () => new Response('[{"a":1}]', { headers: { 'content-type': 'application/json' } });
let calls;
const stub = (impl = ok) => { calls = []; vi.stubGlobal('fetch', vi.fn(async (u, init) => { calls.push(String(u)); return impl(u, init); })); };
afterEach(() => vi.unstubAllGlobals());

describe('P0: SSRF guard on the default fetch', () => {
  const bad = ['http://127.0.0.1/x', 'http://2130706433/x', 'http://0x7f.1/x', 'http://0177.0.0.1/x', 'http://127.1/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x',
    'http://[::ffff:7f00:1]/x', 'http://169.254.169.254/latest', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://10.1.2.3/', 'http://192.168.1.1/', 'http://172.20.0.1/',
    'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[64:ff9b::7f00:1]/', 'http://localhost:3000/x', 'http://a.localhost/', 'file:///etc/passwd', 'data:application/json,[]', 'http://u:p@example.com/'];
  for (const url of bad) it(`refuses ${url} without fetching it`, async () => {
    stub();
    await expect(render(def(url), { fontStore })).rejects.toMatchObject({ status: expect.any(Number) });
    expect(calls).toEqual([]);
  });
  it('a public host is fetched; allowHosts and unsafeFetch let a private one through', async () => {
    stub(); await render(def('https://api.example.com/rows'), { fontStore }); expect(calls).toEqual(['https://api.example.com/rows']);
    stub(); await render(def('http://10.0.0.5/rows'), { fontStore, allowHosts: ['10.0.0.5'] }); expect(calls).toHaveLength(1);
    stub(); await render(def('http://127.0.0.1/rows'), { fontStore, unsafeFetch: true }); expect(calls).toHaveLength(1);
  });
  it('a redirect hop is checked again (into a private address: refused), at most 5', async () => {
    stub((u) => (String(u).includes('example.com') ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/meta' } }) : ok()));
    await expect(render(def('https://api.example.com/r'), { fontStore })).rejects.toMatchObject({ status: 403 });
    expect(calls).toEqual(['https://api.example.com/r']);
    stub((u) => new Response(null, { status: 302, headers: { location: `${u}x` } }));
    await expect(render(def('https://api.example.com/r'), { fontStore })).rejects.toThrow(/Too many redirects/);
    expect(calls.length).toBe(6);
  });
  it('in Node, a name that resolves to a private address is refused', async () => {
    const real = process.getBuiltinModule;
    vi.spyOn(process, 'getBuiltinModule').mockImplementation((m) => (m === 'node:dns' ? { promises: { lookup: async () => [{ address: '127.0.0.1', family: 4 }] } } : real(m)));
    await expect(checkUrl('https://rebind.example.com/', [])).rejects.toMatchObject({ status: 403 });
    vi.restoreAllMocks();
    expect(privateHost('8.8.8.8')).toBe(false);
  });
  it('a parameter fills the path and query, not the scheme and host', async () => {
    stub();
    await expect(render(def('https://{Parameters.u}/x'), { fontStore, parameters: { u: 'evil.example' } })).rejects.toMatchObject({ status: 403 });
    await expect(render(def('{Parameters.u}'), { fontStore, parameters: { u: 'https://api.example.com/x' } })).rejects.toMatchObject({ status: 403 });
    await expect(render(def('=Parameters.u'), { fontStore, parameters: { u: 'https://api.example.com/x' } })).rejects.toMatchObject({ status: 403 });
    expect(calls).toEqual([]);
    await render(def('{Parameters.u}'), { fontStore, parameters: { u: 'https://api.example.com/x' }, allowHosts: ['api.example.com'] });
    await render(def('https://api.example.com/{Parameters.u}'), { fontStore, parameters: { u: 'rows' } });
    expect(calls).toEqual(['https://api.example.com/x', 'https://api.example.com/rows']);
  });
});

describe('P0: time limit and size cap on every engine fetch', () => {
  it('a source that never answers stops at fetchTimeoutMs (504)', async () => {
    stub((u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))));
    const t = Date.now();
    await expect(render(def('https://slow.example.com/'), { fontStore, fetchTimeoutMs: 150 })).rejects.toMatchObject({ status: 504 });
    expect(Date.now() - t).toBeLessThan(3000);
  });
  it('a body past maxFetchBytes (as decoded, so a gzip bomb too) stops with 413, the caller\'s fetch included', async () => {
    const big = () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(65536).fill(32)); c.close(); } }));
    stub(big);
    await expect(render(def('https://big.example.com/'), { fontStore, maxFetchBytes: 1048576 })).rejects.toMatchObject({ status: 413 });
    await expect(render(def('https://big.example.com/'), { fontStore, maxFetchBytes: 1048576, fetch: async () => big() })).rejects.toMatchObject({ status: 413 });
  });
});
