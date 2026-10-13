// The data proxy reads the upstream body as a stream and stops at its 5 MB cap: a large answer is never buffered whole.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let pulled = 0;
const upstream = vi.fn();
vi.mock('@/server/safeFetch.js', async (orig) => ({ ...(await orig()), safeFetch: (...a) => upstream(...a) }));
vi.mock('@/server/audit.js', () => ({ audit: async () => {} }));

const lazy = (mb, headers = {}) => {
  pulled = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream({ pull(c) { if (pulled >= mb) { c.close(); return; } pulled++; c.enqueue(chunk); } });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json', ...headers } });
};

describe('GET /api/data/proxy: body cap', () => {
  beforeEach(() => { process.env.PW_PROXY_ALLOW = 'api.example.com'; });
  const get = async () => (await import('../../app/api/data/proxy/route.js')).GET(new Request('http://localhost/api/data/proxy?url=' + encodeURIComponent('https://api.example.com/rows')));

  it('an answer with no content-length is cut off past 5 MB, not read whole', async () => {
    upstream.mockResolvedValueOnce(lazy(40));
    const res = await get();
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10); // stopped right after the cap, not all 40 MB
  });

  it('a declared content-length over the cap is refused before reading', async () => {
    upstream.mockResolvedValueOnce(lazy(40, { 'content-length': String(40 * 1024 * 1024) }));
    const res = await get();
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(2);
  });

  it('an answer under the cap passes through unchanged', async () => {
    upstream.mockResolvedValueOnce(new Response('[{"a":1}]', { status: 200, headers: { 'content-type': 'application/json' } }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[{"a":1}]');
  });
});
