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
    // review: an array on a single-value parameter is bound as "North,South" by the engine: refused
    expect(() => checkParameterValues(def, { region: ['North', 'South'] }, viewer)).toThrow(/region/);
    expect(() => checkParameterValues(def, { year: [2025, 2026] }, viewer)).toThrow(/year/);
    // multi values are split as the engine splits them (an option holding a comma, an escaped comma)
    const commas = { parameters: [{ name: 'c', type: 'string', multi: true, options: [{ value: 'Pune, MH' }, { value: 'Delhi' }] }] };
    expect(() => checkParameterValues(commas, { c: 'Pune, MH,Delhi' }, viewer)).not.toThrow();
    // hidden parameters are set by drill-through: not checked
    expect(() => checkParameterValues({ parameters: [{ name: 'h', hidden: true, options: [{ value: 'a' }] }] }, { h: 'zzz' }, viewer)).not.toThrow();
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

describe('a batch mails and calls its webhook once, even after a lost lease (REVIEW-SECURITY-2 L9)', () => {
  it('the first runner claims the side effect; one that took the job over does not repeat it', async () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    process.env.PW_STORAGE = `sqlite:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-once-')), 's.db')}`;
    const { claimOnce } = await import('../../src/server/jobs.js');
    expect(await claimOnce('mail:j_1', 'runner-a')).toBe(true);
    expect(await claimOnce('mail:j_1', 'runner-b')).toBe(false); // the new owner after a lost lease
    expect(await claimOnce('mail:j_1', 'runner-a')).toBe(true);  // the same runner asking again (a retry inside one run)
    expect(await claimOnce('webhook:j_1', 'runner-b')).toBe(true); // each side effect on its own
    const src = fs.readFileSync('src/server/jobs.js', 'utf8');
    expect(src).toMatch(/claimOnce\(`mail:\$\{job\.id\}`, runId\)/);
    expect(src).toMatch(/claimOnce\(`webhook:\$\{job\.id\}`, runId\)/);
    expect(src).toMatch(/'idempotency-key': `\$\{job\.id\}:batch\.finished`/);
  });
});

describe('a data source that answers 404/5xx is a 502 with a clear message (synthetic-user run)', () => {
  it('not a generic 500, and no URL in the message', async () => {
    const { errorResponse } = await import('../../src/server/errors.js');
    const err = console.error; console.error = () => {};
    try {
      const r = errorResponse(new Error('HTTP 404 from https://api.example.com/v1/orders?token=SECRET123'));
      expect(r.status).toBe(502);
      const body = await r.json();
      expect(body.error).toMatch(/data source.*HTTP 404/);
      expect(body.error).not.toMatch(/SECRET123|api\.example\.com/); // the URL is in the log only (review finding)
      expect(body.requestId).toBeTruthy();
      expect(errorResponse(new Error('Data source "orders": HTTP 500 from https://api.example.com/x')).status).toBe(502); // as the engine wraps it
      expect(errorResponse(Object.assign(new Error('HTTP 503 from x'), { status: 400 })).status).toBe(400); // a status the code chose stands
    } finally { console.error = err; }
  });
});

describe('batch output: streamed, paged, indexed (REVIEW-ARCH-2 2.7)', () => {
  it('a file blob opens as a stream; the batch list pages with a cursor; Postgres gets a prefix index', async () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-stream-'));
    process.env.PW_STORAGE = `sqlite:${path.join(d, 's.db')}`; delete process.env.PW_BLOBS;
    const { blobs } = await import('../../src/server/blobs.js');
    await blobs().put('jobs/b_x/output.zip', Buffer.alloc(300000, 7));
    const o = await blobs().open('jobs/b_x/output.zip');
    expect(o.size).toBe(300000);
    expect((await new Response(o.stream).arrayBuffer()).byteLength).toBe(300000);
    const { store } = await import('../../src/server/storage/index.js');
    for (let i = 0; i < 7; i++) await store().put('jobs', `b_${String(i).padStart(3, '0')}`, JSON.stringify({ id: `b_${String(i).padStart(3, '0')}`, owner: 'service', status: 'completed', createdAt: new Date().toISOString(), results: [], errors: [], total: 0 }));
    const jobs = await import('../../src/server/jobs.js');
    const p1 = await jobs.listJobPage({ kind: 'service' }, { limit: 3 });
    expect(p1.jobs.map(j => j.id)).toEqual(['b_006', 'b_005', 'b_004']);
    const p2 = await jobs.listJobPage({ kind: 'service' }, { limit: 3, before: p1.next });
    expect(p2.jobs.map(j => j.id)).toEqual(['b_003', 'b_002', 'b_001']);
    const p3 = await jobs.listJobPage({ kind: 'service' }, { limit: 3, before: p2.next });
    expect(p3).toMatchObject({ next: null });
    const { MIGRATIONS } = await import('../../src/server/storage/sql.js');
    expect(MIGRATIONS.find(m => m.v === 3).sql('postgres')[0]).toMatch(/text_pattern_ops/);
    expect(MIGRATIONS.find(m => m.v === 3).sql('sqlite')).toEqual([]);
  });
});

describe('a batch past PW_BATCH_MAX_OUTPUT_MB builds no zip (it would be built in one worker\'s memory)', () => {
  it('the batch completes with a clear error and no download', async () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    process.env.PW_STORAGE = `sqlite:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-cap-')), 's.db')}`;
    process.env.PW_BATCH_MAX_OUTPUT_MB = '0.000001'; process.env.PW_RENDER_WORKERS = '0';
    const jobs = await import('../../src/server/jobs.js');
    const def = { $schema: 'pagewright/report@1', name: 'Cap', parameters: [{ name: 'n' }], sections: { body: { height: 40, items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 100, h: 20, value: '=Parameters.n' }] } } };
    const job = await jobs.createBatch({ template: def, items: [{ parameters: { n: '1' } }, { parameters: { n: '2' } }], format: 'json', output: { type: 'zip' } }, null);
    for (let i = 0; i < 5 && (await jobs.workOnce('T')) !== null; i++) { /* run it */ }
    const done = await jobs.getJob(job.id);
    expect(done.done).toBe(2);
    expect(done.errors.join(' ')).toMatch(/PW_BATCH_MAX_OUTPUT_MB/);
    expect(done.download).toBeFalsy();
  }, 60000);
});

describe('the data-source error log carries no query string', () => {
  it('?api_key= is not written to the log', async () => {
    const { errorResponse } = await import('../../src/server/errors.js');
    const lines = []; const err = console.error; console.error = (l) => lines.push(String(l));
    try { errorResponse(new Error('Data source "s": HTTP 404 from http://h.example/x?api_key=TOPSECRET')); } finally { console.error = err; }
    expect(lines.join('\n')).not.toMatch(/TOPSECRET/);
    expect(lines.join('\n')).toMatch(/h\.example\/x\?…/);
  });
});
