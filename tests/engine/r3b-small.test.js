// R3-B item 6: the smaller findings, one test each.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const keep = { ...process.env };
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); });

describe('OIDC jwks_uri goes through the SSRF guard (REVIEW-SECURITY-2 L2)', () => {
  it('a discovery document pointing the keys at a private host is refused', async () => {
    process.env.PW_OIDC_ISSUER = 'https://idp.example.com';
    process.env.PW_OIDC_CLIENT_ID = 'pw';
    const { verifyIdToken } = await import('../../src/server/sso.js');
    for (const uri of ['https://10.0.0.5/keys', 'https://169.254.169.254/latest/meta-data', 'https://127.0.0.1:9/jwks']) {
      const e = await verifyIdToken('a.b.c', { issuer: 'https://idp.example.com', jwks_uri: uri }, 'n').then(() => null, x => x);
      expect(e?.status, uri).toBe(401);
      expect(String(e.message), uri).toMatch(/private|local/i);
    }
  });
});

describe('PW_DATA_KEY: no silent fallback, versioned seals, a changed key is refused (REVIEW-ARCH-2 2.8)', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const K1 = 'k1-'.padEnd(40, 'a'), K2 = 'k2-'.padEnd(40, 'b');
  const fresh = () => { process.env.PW_STORAGE = `sqlite:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-dk-')), 's.db')}`; delete globalThis.__pwDataKid; };
  it('production without PW_DATA_KEY refuses to seal (it never uses the session secret there)', async () => {
    fresh();
    Object.assign(process.env, { PW_MODE: 'prod', PW_SESSION_SECRET: 's'.repeat(40) });
    delete process.env.PW_DATA_KEY;
    const { seal } = await import('../../src/server/totp.js');
    expect(() => seal('JBSWY3DPEHPK3PXP')).toThrow(/needs PW_DATA_KEY/);
  });
  it('a rotation with PW_DATA_KEY_OLD keeps old seals readable; a change without it is caught at boot', async () => {
    fresh();
    Object.assign(process.env, { PW_MODE: 'prod', PW_SESSION_SECRET: 's'.repeat(40), PW_DATA_KEY: K1 });
    const t = await import('../../src/server/totp.js');
    const sealed = t.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).toMatch(/^v2:[0-9a-f]{8}:/);
    await new Promise(r => setTimeout(r, 50)); // the key id is recorded in settings
    expect(await t.checkDataKey()).toBe('');
    process.env.PW_SESSION_SECRET = 'rotated'.padEnd(40, 'z'); // the usual answer to a leaked session secret
    expect(t.unseal(sealed)).toBe('JBSWY3DPEHPK3PXP');      // changes nothing for the seals
    process.env.PW_DATA_KEY = K2;
    expect(t.unseal(sealed)).toBe(null);
    expect(await t.checkDataKey()).toMatch(/no longer configured.*PW_DATA_KEY_OLD/);
    process.env.PW_DATA_KEY_OLD = K1;
    expect(t.unseal(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(await t.checkDataKey()).toBe('');
    expect(t.seal('X').split(':')[1]).not.toBe(sealed.split(':')[1]); // new seals use the new key
  });
});

describe('PW_MODE=dev on a production build (REVIEW-SECURITY-2 L3, PoC p6)', () => {
  it('refused on a public address without sign-in; loud on localhost or with sign-in', async () => {
    const { checkConfig } = await import('../../src/server/config.js');
    const open = checkConfig({ NODE_ENV: 'production', PW_MODE: 'dev' });
    expect(open.fatal.join(' ')).toMatch(/PW_MODE=dev on a production build/);
    expect(checkConfig({ NODE_ENV: 'production', PW_MODE: 'dev', HOSTNAME: '127.0.0.1' }).fatal).toEqual([]);
    expect(checkConfig({ NODE_ENV: 'production', PW_MODE: 'dev', HOSTNAME: '127.0.0.1' }).warnings.join(' ')).toMatch(/PW_MODE=dev on a production build/);
    expect(checkConfig({ NODE_ENV: 'production', PW_MODE: 'dev', PW_BASIC_AUTH: 'a:b' }).fatal).toEqual([]);
    expect(checkConfig({ NODE_ENV: 'development', PW_MODE: 'dev' }).warnings.join(' ')).not.toMatch(/production build/);
  });
  it('reportConfig stops that start even in dev mode', async () => {
    Object.assign(process.env, { NODE_ENV: 'production', PW_MODE: 'dev' });
    delete process.env.PW_AUTH; delete process.env.PW_BASIC_AUTH; delete process.env.HOSTNAME;
    const { reportConfig } = await import('../../src/server/config.js');
    expect(() => reportConfig()).toThrow(/will not start.*PW_MODE=dev/);
  });
});

describe('a parameter\'s fixed list of values holds on the server (REVIEW-SECURITY-2 L7)', () => {
  it('a viewer cannot send a value off the list; a designer can; lists from data and blanks pass', async () => {
    const { checkParameterValues } = await import('../../src/server/perms.js');
    const def = { parameters: [
      { name: 'region', type: 'string', options: [{ value: '', label: 'All' }, { value: 'North' }, { value: 'South' }] },
      { name: 'regions', type: 'string', multi: true, options: [{ value: 'North' }, { value: 'South' }] },
      { name: 'year', type: 'number', options: [{ value: 2025 }, { value: 2026 }] },
      { name: 'city', type: 'string', options: [{ value: 'Pune' }], optionsFrom: { dataSet: 'Cities' } },
    ] };
    const viewer = { kind: 'user', email: 'v@x.io', role: 'viewer', groups: [] }, designer = { ...viewer, role: 'designer' };
    expect(() => checkParameterValues(def, { region: 'North', regions: ['South'], year: '2026', city: 'Anywhere' }, viewer)).not.toThrow();
    expect(() => checkParameterValues(def, { region: '' }, viewer)).not.toThrow();
    expect(() => checkParameterValues(def, { region: 'East' }, viewer)).toThrow(/"East" is not one of the values the parameter "region"/);
    expect(() => checkParameterValues(def, { regions: ['North', 'East'] }, viewer)).toThrow(/regions/);
    expect(() => checkParameterValues(def, { regions: 'North,East' }, viewer)).toThrow(/regions/);
    expect(() => checkParameterValues(def, { year: 1999 }, viewer)).toThrow(/year/);
    expect(() => checkParameterValues(def, { region: 'East' }, designer)).not.toThrow();
    try { checkParameterValues(def, { region: 'East' }, viewer); } catch (e) { expect(e.status).toBe(400); }
  });
});

describe('the anonymous sample cost is capped (REVIEW-SECURITY-2 L8, PoC p5)', () => {
  it('a reader who is not signed in gets at most 5,000 stress rows; a signed-in user the full cap', async () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    Object.assign(process.env, { PW_AUTH: 'users', PW_SESSION_SECRET: 'r3b-sample-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-sample-')), 's.db')}` });
    const { GET } = await import('../../app/api/sample/stress/[rows]/route.js');
    const at = (rows, cookie = '') => GET(new Request(`http://pw.test/api/sample/stress/${rows}`, { headers: { cookie } }), { params: Promise.resolve({ rows: String(rows) }) });
    expect((await at(200000)).status).toBe(400);
    expect((await at(5000)).status).toBe(200);
    const users = await import('../../src/server/users.js'), session = await import('../../src/server/session.js');
    await users.createUser({ email: 'v@x.io', role: 'viewer', password: 'a long password 1' });
    const c = session.sessionCookie(new Request('http://pw.test'), await users.getUser('v@x.io')).split(';')[0];
    expect((await at(20000, c)).status).toBe(200);
  });
});
