// A failed data request says why (DNS, refused, reset, TLS, timeout) and never prints the query, userinfo or a key
import { describe, it, expect } from 'vitest';
import { loadSources } from '../../src/engine/data/index.js';

const SECRET_URL = 'https://svc-user:pw-Secret1@api.example.test/v1/items?api_key=KEY-Secret2&token=TOK-Secret3&q=1';
const load = (f) => loadSources({ dataSources: [{ name: 'api', type: 'rest', url: SECRET_URL }] }, { params: {}, fetch: f });
const failWith = (code, message = 'fetch failed') => async () => { throw Object.assign(new TypeError(message), { cause: Object.assign(new Error(code), { code }) }); };
const leaks = (e) => ['Secret', 'svc-user', 'api_key', 'token='].some(s => e.message.includes(s));

describe('data source fetch errors', () => {
  it('say the cause from error.cause.code', async () => {
    const cases = [['ENOTFOUND', /DNS|did not resolve/], ['ECONNREFUSED', /connection refused/], ['ECONNRESET', /reset/],
      ['ETIMEDOUT', /timed out/], ['CERT_HAS_EXPIRED', /certificate/]];
    for (const [code, re] of cases) {
      const e = await load(failWith(code)).catch(x => x);
      expect(e.message, code).toMatch(re);
      expect(e.message, code).toContain(code);
    }
  });

  it('never print the query string, userinfo or a key', async () => {
    const e = await load(failWith('ECONNREFUSED')).catch(x => x);
    expect(leaks(e)).toBe(false);
    expect(e.message).toContain('api.example.test/v1/items?…');
  });

  it('keep the refusal status, and redact the URL in an HTTP error', async () => {
    const e = await load(async () => ({ ok: false, status: 401, text: async () => '' })).catch(x => x);
    expect(e.message).toMatch(/HTTP 401/);
    expect(leaks(e)).toBe(false);
  });
});
