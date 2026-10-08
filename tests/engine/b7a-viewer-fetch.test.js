// B7a: the viewer's data fetch in the browser (reportFetch): the SSRF guard (N2) and errors that say why (#18).
import { describe, it, expect, afterEach } from 'vitest';
import { reportFetch, setFetchPolicy } from '../../src/viewer/dataFetch.js';
import { loadSources } from '../../src/engine/data/index.js';

const recorder = () => {
  const calls = [];
  const f0 = async (u, init) => { calls.push([u, init]); return new Response('{"rows":[{"a":1}]}', { headers: { 'content-type': 'application/json' } }); };
  return { calls, f0 };
};
afterEach(() => setFetchPolicy({}));

describe('the viewer refuses private and local addresses (N2)', () => {
  const BAD = ['http://192.168.1.1/rows', 'http://10.0.0.1/', 'http://172.16.5.4/', 'http://127.0.0.1:8080/', 'http://localhost:3000/x', 'http://api.localhost/',
    'http://printer.local/', 'http://db.internal/', 'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://[::1]/',
    'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[::ffff:192.168.1.1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://user:pw@example.com/',
    'file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com/'];
  it.each(BAD)('%s is refused before any request', async (url) => {
    const { calls, f0 } = recorder();
    await expect(reportFetch('https://pw.example.com', f0)(url)).rejects.toMatchObject({ status: expect.any(Number) });
    expect(calls).toHaveLength(0);
  });
  it('a public host is allowed (no cookies)', async () => {
    const { calls, f0 } = recorder();
    const r = await reportFetch('https://pw.example.com', f0)('https://api.example.com/rows?k=1');
    expect(r.ok).toBe(true);
    expect(calls[0][0]).toBe('https://api.example.com/rows?k=1');
    expect(calls[0][1].credentials).toBe('omit');
  });
  it('the viewer\'s own server is not refused (a dev server on localhost serves its own data)', async () => {
    const { calls, f0 } = recorder();
    await reportFetch('http://localhost:3000', f0)('/api/sample/sales');
    expect(calls).toHaveLength(1);
  });
  it('allowHosts lets a named private host through; unsafeFetch turns the guard off', async () => {
    const { calls, f0 } = recorder();
    setFetchPolicy({ allowHosts: ['192.168.1.1'] });
    await reportFetch('https://pw.example.com', f0)('http://192.168.1.1/rows');
    await expect(reportFetch('https://pw.example.com', f0)('http://192.168.1.2/rows')).rejects.toMatchObject({ status: 403 });
    setFetchPolicy({ unsafeFetch: true });
    await reportFetch('https://pw.example.com', f0)('http://10.1.2.3/rows');
    expect(calls.map(c => c[0])).toEqual(['http://192.168.1.1/rows', 'http://10.1.2.3/rows']);
  });
  it('a redirect cannot be followed blind into a private address: redirects are checked by hand', async () => {
    const seen = [];
    const f0 = async (u, init) => { seen.push(init.redirect); return u.includes('a.example') ? new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/rows' } }) : new Response('[]'); };
    await expect(reportFetch('https://pw.example.com', f0)('https://a.example.com/rows')).rejects.toMatchObject({ status: 403 });
    expect(seen).toEqual(['manual']);
  });
  it('a fetch the page brings (fetch option) is the transport; the guard still runs', async () => {
    const { calls, f0 } = recorder();
    setFetchPolicy({ fetch: f0 });
    await reportFetch('https://pw.example.com')('https://api.example.com/rows');
    await expect(reportFetch('https://pw.example.com')('http://127.0.0.1/rows')).rejects.toMatchObject({ status: 403 });
    expect(calls.map(c => c[0])).toEqual(['https://api.example.com/rows']);
  });
  it('through the engine: a REST source at a private address fails; a host made by a parameter is refused', async () => {
    const { calls, f0 } = recorder();
    const f = reportFetch('https://pw.example.com', f0);
    const def = (url) => ({ dataSources: [{ name: 's', type: 'rest', url }] });
    await expect(loadSources(def('http://192.168.1.1/rows'), { params: {}, fetch: f, baseUrl: 'https://pw.example.com' })).rejects.toThrow(/private or local/);
    await expect(loadSources(def('{Parameters.u}'), { params: { u: 'https://api.example.com/rows' }, fetch: f, baseUrl: 'https://pw.example.com' })).rejects.toThrow(/host is made by a parameter/);
    await expect(loadSources(def('https://{Parameters.h}/rows'), { params: { h: 'api.example.com' }, fetch: f, baseUrl: 'https://pw.example.com' })).rejects.toThrow(/host is made by a parameter/);
    expect(calls).toHaveLength(0);
    // the path and query may come from a parameter; a whole-URL parameter whose host is in allowHosts is fine
    await loadSources(def('https://api.example.com/rows/{Parameters.id}'), { params: { id: '7' }, fetch: f, baseUrl: 'https://pw.example.com' });
    setFetchPolicy({ allowHosts: ['api.example.com'] });
    await loadSources(def('{Parameters.u}'), { params: { u: 'https://api.example.com/rows' }, fetch: reportFetch('https://pw.example.com', f0), baseUrl: 'https://pw.example.com' });
    expect(calls.map(c => c[0])).toEqual(['https://api.example.com/rows/7', 'https://api.example.com/rows']);
  });
});

describe('a refused request says why', () => {
  it('a refused address names the viewer option that allows it', async () => {
    const err = await reportFetch('https://pw.example.com', async () => new Response('[]'))('http://192.168.1.1/rows').catch(e => e);
    expect(err.message).toMatch(/192\.168\.1\.1/);
    expect(err.message).toMatch(/allowHosts/);
  });
});
