// No sign-in configured: production fails closed, SQL in a saved report needs a designer (at save and at run).
// From the 2026-10-04 external review: an anonymous cross-origin POST saved a report with SQL, and running it returned
// the table. Each test here failed before the fix.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { proxy } from '../../proxy.js';
import { POST as createReport } from '../../app/api/reports/route.js';
import { PUT as saveReport } from '../../app/api/reports/[id]/route.js';
import { POST as restoreVersion } from '../../app/api/reports/[id]/versions/route.js';
import { POST as importReport } from '../../app/api/reports/import/route.js';
import { POST as runSqlRoute } from '../../app/api/data/sql/route.js';
import { GET as pdfRoute } from '../../app/api/reports/[id]/pdf/route.js';
import { POST as v1Render } from '../../app/api/v1/render/route.js';
import { POST as v1Schedules } from '../../app/api/v1/schedules/route.js';
import { writeReport, readReport, listVersions } from '../../src/server/reports.js';
import { principalOf, principalFromId, serverSources, stampDefinition, readRunnable, canDesign, OPEN, PUBLIC, NOBODY } from '../../src/server/perms.js';
import { apiPrincipal } from '../../src/server/auth.js';
import { baseUrl, renderTo, assertFixedHosts } from '../../src/server/renderer.js';
import { serverFetch, safeFetch, strictUrl } from '../../src/server/safeFetch.js';
import { GET as dataProxy } from '../../app/api/data/proxy/route.js';
import { checkDelivery } from '../../src/server/jobs.js';
import { reportFetch } from '../../src/viewer/dataFetch.js';
import { POST as auditExport } from '../../app/api/audit/export/route.js';

const ORIGIN = 'http://pw.test';
const EVIL = 'http://evil.example';
const withEnv = async (vars, fn) => {
  const old = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
// production with no sign-in of any kind
const PROD_OPEN = { NODE_ENV: 'production', PW_AUTH: undefined, PW_BASIC_AUTH: undefined, PW_PUBLIC_READONLY: undefined, PW_API_KEYS: undefined, PW_ALLOW_KEYLESS: undefined };
const rq = (p, { method = 'GET', origin = ORIGIN, body, headers = {} } = {}) => new Request(ORIGIN + p, {
  method, headers: { host: 'pw.test', ...(origin && { origin }), ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});
const P = (id) => ({ params: Promise.resolve({ id }) });
const SQL_DEF = { name: 'Payroll', dataSources: [{ name: 'db', type: 'sql', connection: 'main', query: 'select name, salary from salaries' }], dataSets: [], sections: { body: { items: [] } } };
const SECRET = 'a-long-secret-the-reverse-proxy-sends';
const VIA_PROXY = { 'x-pagewright-proxy-secret': SECRET };
const runSaved = (id, o = {}) => runSqlRoute(rq('/api/data/sql', { method: 'POST', body: { report: id, source: 'db' }, ...o }));

let tmp, dbn = 0;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-open-'));
  const file = path.join(tmp, 'hr.db');
  const db = new DatabaseSync(file);
  db.exec("create table salaries (name text, salary int); insert into salaries values ('ceo', 999999);");
  db.close();
  process.env.PW_DB_MAIN = `sqlite:${file}`;
});
beforeEach(() => { process.env.PW_STORAGE = `sqlite:${path.join(tmp, `s-${++dbn}.db`)}`; });
afterAll(() => { delete process.env.PW_DB_MAIN; fs.rmSync(tmp, { recursive: true, force: true }); });

describe('production with no sign-in fails closed', () => {
  it('the reviewer\'s repro: an anonymous cross-origin save, then a run, is refused at the proxy and at each route', () => withEnv(PROD_OPEN, async () => {
    // the proxy: the cross-site write is refused (Origin), and so is the same-site one (no sign-in)
    expect((await proxy(rq('/api/reports', { method: 'POST', origin: EVIL, body: { definition: SQL_DEF } }))).status).toBe(403);
    expect((await proxy(rq('/api/data/sql', { method: 'POST', origin: EVIL, body: { report: 'x', source: 'db' } }))).status).toBe(403);
    // the routes on their own (as the reviewer called them): no save, no run
    const saved = await createReport(rq('/api/reports', { method: 'POST', origin: EVIL, body: { definition: SQL_DEF } }));
    expect(saved.status).toBe(401);
    expect((await saved.json()).error).toMatch(/PW_AUTH=users/);
    // a report saved that way before the fix (out of band here) does not run its SQL either
    await writeReport('stolen', SQL_DEF);
    const ran = await runSaved('stolen', { origin: EVIL });
    expect(ran.status).toBe(401);
    expect(JSON.stringify(await ran.json())).not.toMatch(/999999/);
  }));

  it('refuses a same-origin anonymous save, import, ad-hoc SQL, and every page or API but static files and /api/v1', () => withEnv(PROD_OPEN, async () => {
    const res = await proxy(rq('/api/reports', { method: 'POST', body: { definition: SQL_DEF } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/PW_BASIC_AUTH/);
    expect((await createReport(rq('/api/reports', { method: 'POST', body: { name: 'plain' } }))).status).toBe(401); // no SQL, still a write
    expect((await saveReport(rq('/api/reports/new-one', { method: 'PUT', body: SQL_DEF }), P('new-one'))).status).toBe(401);
    expect((await importReport(rq('/api/reports/import', { method: 'POST', body: { Body: {}, DataSources: [] } }))).status).toBe(401);
    expect((await runSqlRoute(rq('/api/data/sql', { method: 'POST', body: { connection: 'main', query: 'select * from salaries' } }))).status).toBe(403);
    for (const p of ['/', '/viewer/x', '/designer/x', '/api/reports', '/api/reports/x/pdf', '/api/data/sql/connections', '/api/sample/sales']) {
      const r = await proxy(rq(p));
      expect(r?.status, p).toBe(401);
    }
    for (const p of ['/_next/static/x.js', '/fonts/x.woff2', '/embed/pagewright-viewer.js', '/api/v1/templates']) expect(await proxy(rq(p)), p).toBe(undefined);
    expect(await principalOf(rq('/'))).toEqual(NOBODY);
  }));

  it('PW_PUBLIC_READONLY=1: anyone opens and renders saved reports (and their saved SQL); nothing changes', () => withEnv({ ...PROD_OPEN, PW_PUBLIC_READONLY: '1' }, async () => {
    for (const p of ['/', '/viewer/x', '/api/reports', '/api/reports/x', '/api/reports/x/pdf', '/api/sample/sales']) expect(await proxy(rq(p)), p).toBe(undefined);
    expect(await proxy(rq('/api/data/sql', { method: 'POST', body: { report: 'x', source: 'db' } }))).toBe(undefined);
    for (const [m, p] of [['GET', '/designer/x'], ['POST', '/api/reports'], ['PUT', '/api/reports/x'], ['POST', '/api/fonts'], ['GET', '/api/data/sql/connections'], ['GET', '/admin/users']]) {
      expect((await proxy(rq(p, { method: m, body: m === 'GET' ? undefined : {} })))?.status, `${m} ${p}`).toBe(401);
    }
    expect(await principalOf(rq('/'))).toEqual(PUBLIC);
    // a report a designer saved runs its query; one written outside the app does not
    await stampDefinition({ kind: 'service' }, 'payroll', SQL_DEF);
    await writeReport('payroll', SQL_DEF);
    expect(await (await runSaved('payroll')).json()).toEqual({ rows: [{ name: 'ceo', salary: 999999 }] });
    expect((await pdfRoute(rq('/api/reports/payroll/pdf?format=csv'), P('payroll'))).status).toBe(200);
    await writeReport('stolen', SQL_DEF);
    const r = await runSaved('stolen');
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/no designer saved/);
    // but no change, no ad-hoc SQL
    expect((await saveReport(rq('/api/reports/payroll', { method: 'PUT', body: { ...SQL_DEF, name: 'x' } }), P('payroll'))).status).toBe(403);
    expect((await createReport(rq('/api/reports', { method: 'POST', body: { name: 'plain' } }))).status).toBe(403);
    expect((await runSqlRoute(rq('/api/data/sql', { method: 'POST', body: { connection: 'main', query: 'select 1' } }))).status).toBe(403);
  }));

  it('the keyless API in production (PW_ALLOW_KEYLESS=1) is read-only: no definitions, data, signing, schedules', () => withEnv({ ...PROD_OPEN, PW_ALLOW_KEYLESS: '1' }, async () => {
    expect((await apiPrincipal(rq('/api/v1/render', { method: 'POST' }))).principal).toEqual(PUBLIC);
    const inline = await v1Render(rq('/api/v1/render', { method: 'POST', origin: null, body: { template: SQL_DEF, format: 'csv' } }));
    expect(inline.status).toBe(403);
    expect((await v1Schedules(rq('/api/v1/schedules', { method: 'POST', origin: null, body: { template: 'x', cron: '0 * * * *' } }))).status).toBe(401);
    await stampDefinition({ kind: 'service' }, 'payroll', SQL_DEF);
    await writeReport('payroll', SQL_DEF);
    expect((await v1Render(rq('/api/v1/render', { method: 'POST', origin: null, body: { template: 'payroll', format: 'csv', data: { db: [{ name: 'fake' }] } } }))).status).toBe(403);
    expect((await v1Render(rq('/api/v1/render', { method: 'POST', origin: null, body: { template: 'payroll', format: 'pdf', sign: true } }))).status).toBe(401);
    expect((await v1Render(rq('/api/v1/render', { method: 'POST', origin: null, body: { template: 'payroll', format: 'csv' } }))).status).toBe(200);
  }));

  it('records of the open server do not run as it in production with no sign-in, and "nobody" is never the open server', () => withEnv(PROD_OPEN, async () => {
    for (const id of ['open', 'user:a@x.io', 'service:deadbeef', 'nobody', 'anon']) expect(await principalFromId(id), id).toEqual(NOBODY);
    expect(canDesign(OPEN)).toBe(false);
    await withEnv({ NODE_ENV: 'test' }, async () => {
      expect(await principalFromId('nobody')).toEqual(NOBODY);
      expect(await principalFromId('open')).toEqual(OPEN);
    });
  }));
});

describe('each way to sign in still works in production', () => {
  const saveAndRun = async (headers = {}) => {
    expect(await proxy(rq('/api/reports', { method: 'POST', headers, body: { definition: SQL_DEF } }))).toBe(undefined);
    const res = await createReport(rq('/api/reports', { method: 'POST', headers, body: { name: 'Payroll', definition: SQL_DEF } }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await (await runSaved(id, { headers })).json()).toEqual({ rows: [{ name: 'ceo', salary: 999999 }] });
    // cross-site writes stay refused
    expect((await proxy(rq('/api/reports', { method: 'POST', origin: EVIL, headers, body: {} }))).status).toBe(403);
    return id;
  };
  it('PW_BASIC_AUTH: whoever has the password saves and runs SQL, from this site only', () => withEnv({ ...PROD_OPEN, PW_BASIC_AUTH: 'u:p' }, async () => {
    const authorization = `Basic ${Buffer.from('u:p').toString('base64')}`;
    expect((await proxy(rq('/'))).status).toBe(401); // the password is asked for
    await saveAndRun({ authorization });
  }));
  it('PW_AUTH=proxy: the reverse proxy in front signs people in and proves it with PW_PROXY_SECRET; same-site writes only', () => withEnv({ ...PROD_OPEN, PW_AUTH: 'proxy', PW_PROXY_SECRET: SECRET }, async () => {
    expect(await proxy(rq('/designer/x', { headers: VIA_PROXY }))).toBe(undefined);
    await saveAndRun(VIA_PROXY);
  }));
  it('PW_AUTH=proxy in production without a PW_PROXY_SECRET (or a short one) is no sign-in at all: it fails closed', async () => {
    for (const secret of [undefined, 'short']) {
      await withEnv({ ...PROD_OPEN, PW_AUTH: 'proxy', PW_PROXY_SECRET: secret }, async () => {
        expect((await proxy(rq('/designer/x', { headers: VIA_PROXY })))?.status).toBe(401);
        expect((await proxy(rq('/api/reports', { method: 'POST', body: {} })))?.status).toBe(401);
        expect(await principalOf(rq('/'))).toEqual(NOBODY);
      });
    }
  });
  it('API keys: with accounts off a user\'s key ("email|key") is a service key (it was the open server before)', () => withEnv({ ...PROD_OPEN, PW_API_KEYS: 'a@x.io|k1,k2' }, async () => {
    for (const k of ['k1', 'k2']) {
      const { principal } = await apiPrincipal(rq('/api/v1/render', { method: 'POST', headers: { authorization: `Bearer ${k}` } }));
      expect(principal.kind).toBe('service');
      expect(canDesign(principal)).toBe(true);
    }
  }));
});

describe('development with no sign-in', () => {
  const DEV = { NODE_ENV: 'development', PW_AUTH: undefined, PW_BASIC_AUTH: undefined, PW_DEV_HOSTS: 'pw.test' }; // the tests' host name
  it('stays open on this site, and refuses writes and SQL from another site (or with no Origin)', () => withEnv(DEV, async () => {
    expect(await principalOf(rq('/'))).toEqual(OPEN);
    expect(await proxy(rq('/api/reports', { method: 'POST', body: {} }))).toBe(undefined);
    expect((await proxy(rq('/api/reports', { method: 'POST', origin: EVIL, body: {} }))).status).toBe(403);
    expect((await proxy(rq('/api/data/sql', { method: 'POST', origin: EVIL, body: {} }))).status).toBe(403);
    expect((await proxy(rq('/api/reports/x', { method: 'PUT', origin: null, body: {} }))).status).toBe(403);
    const res = await createReport(rq('/api/reports', { method: 'POST', body: { name: 'Payroll', definition: SQL_DEF } }));
    expect(res.status).toBe(201);
    expect((await (await runSaved((await res.json()).id)).json()).rows).toHaveLength(1);
  }));
  it('the keyless API refuses a write from another site\'s page (a text/plain POST needs no preflight)', () => withEnv({ ...DEV, PW_API_KEYS: undefined }, async () => {
    const res = await v1Render(rq('/api/v1/render', { method: 'POST', origin: EVIL, body: JSON.stringify({ template: SQL_DEF, format: 'csv' }), headers: { 'content-type': 'text/plain' } }));
    expect(res.status).toBe(403);
    expect((await apiPrincipal(rq('/api/v1/render', { method: 'POST', origin: null }))).principal).toEqual(OPEN); // curl, scripts
  }));
});

describe('SQL in a stored definition runs only as a designer stored it', () => {
  it('a viewer, anonymous or public principal cannot store server-side data; a designer can', async () => {
    await expect(stampDefinition({ kind: 'user', email: 'v@x.io', role: 'viewer', groups: [] }, 'r', SQL_DEF)).rejects.toMatchObject({ status: 403 });
    await withEnv({ PW_AUTH: 'users' }, async () => {
      await expect(stampDefinition({ kind: 'anon' }, 'r', SQL_DEF)).rejects.toMatchObject({ status: 403 });
      await expect(stampDefinition(PUBLIC, 'r', SQL_DEF)).rejects.toMatchObject({ status: 403 });
    });
    await stampDefinition({ kind: 'user', email: 'd@x.io', role: 'designer', groups: [] }, 'r', SQL_DEF);
  });
  it('a query changed outside the app stops running until a designer saves it; restoring a stamped version runs', async () => {
    const res = await createReport(rq('/api/reports', { method: 'POST', body: { name: 'Pay', definition: SQL_DEF } }));
    const { id } = await res.json();
    expect(await readRunnable(OPEN, id)).toBeTruthy();
    const evil = { ...SQL_DEF, dataSources: [{ ...SQL_DEF.dataSources[0], query: 'select * from salaries where 1 = 1' }] };
    await writeReport(id, evil); // a file edited on disk, a storage row changed
    await expect(readRunnable(OPEN, id)).rejects.toMatchObject({ status: 403 });
    expect((await runSaved(id)).status).toBe(403);
    // a designer opens and saves it: it runs
    expect((await saveReport(rq(`/api/reports/${id}`, { method: 'PUT', body: evil }), P(id))).status).toBe(200);
    expect((await runSaved(id)).status).toBe(200);
    // the first version (stamped when it was saved) comes back by restore and runs
    const first = (await listVersions(id)).at(-1); // the oldest: as it was created
    expect((await restoreVersion(rq(`/api/reports/${id}/versions`, { method: 'POST', body: { version: first.version } }), P(id))).status).toBe(200);
    expect((await readReport(id)).dataSources[0].query).toBe(SQL_DEF.dataSources[0].query);
    expect((await runSaved(id)).status).toBe(200);
  });
  it('counts fetches that can reach PW_INTERNAL_HOSTS (absolute, or built by an expression), not paths on this server', () => withEnv({ PW_INTERNAL_HOSTS: 'hr.internal' }, () => {
    const src = (url, extra = {}) => ({ dataSources: [{ name: 's', type: 'rest', url, ...extra }] });
    expect(serverSources(src('http://hr.internal/salaries'))).toHaveLength(1);
    expect(serverSources(src('={Parameters.base}/x'))).toHaveLength(1);
    expect(serverSources(src('{Parameters.base}/x'))).toHaveLength(1);
    expect(serverSources(src('https://api.example.com/x'))).toHaveLength(0);
    expect(serverSources(src('/api/sample/sales'))).toHaveLength(0);
    expect(serverSources(src('//hr.internal/x'))).toHaveLength(1);
    expect(serverSources(src('http://hr.internal/x', { useProxy: true }))).toHaveLength(0);
    expect(serverSources({ dataSources: [{ name: 'j', type: 'json', data: [] }, { name: 'c', type: 'csv', data: 'a\n1' }] })).toHaveLength(0);
  }));
});

// Second review round (2026-10-04): the self-origin, the server's own credentials, hosts chosen by parameters.
describe('this server\'s own origin and credentials', () => {
  let self, other, seen;
  const listen = () => new Promise((resolve) => {
    const s = http.createServer((q, r) => { seen.push({ port: s.address().port, method: q.method, url: q.url, h: q.headers }); r.setHeader('content-type', 'application/json'); r.end('[{"n":1}]'); });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  beforeAll(async () => { self = await listen(); other = await listen(); });
  afterAll(() => { self.close(); other.close(); });
  beforeEach(() => { seen = []; });
  const at = (s, p = '/x') => `http://127.0.0.1:${s.address().port}${p}`;

  it('never comes from the request: Host and X-Forwarded-Host do not move it', () => {
    const req = new Request('http://localhost:3600/api/reports/x/pdf', { headers: { host: '169.254.169.254', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' } });
    return withEnv({ NODE_ENV: 'development', PW_BASE_URL: undefined }, async () => {
      expect(baseUrl(req)).toBe('http://localhost:3600'); // the address Next listens on (it builds req.url itself), plain http
      await withEnv({ PW_BASE_URL: 'https://reports.example.com/' }, () => expect(baseUrl(req)).toBe('https://reports.example.com'));
      await withEnv({ NODE_ENV: 'production' }, () => expect(baseUrl(req)).toMatch(/\.invalid$/)); // not set: no self at all
    });
  });

  it('production without PW_BASE_URL refuses relative data URLs (fail closed) and names the setting', () => withEnv({ NODE_ENV: 'production', PW_BASE_URL: undefined, PW_AUTH: 'proxy', PW_PROXY_SECRET: SECRET }, async () => {
    const def = { name: 'r', dataSources: [{ name: 'd', type: 'rest', url: '/api/sample/sales/2024' }], dataSets: [], sections: { body: { items: [] } } };
    await expect(renderTo(def, { format: 'json', baseUrl: baseUrl(), principal: OPEN })).rejects.toThrow(/PW_BASE_URL/);
  }));

  it('a data source cannot use the server\'s password or cookie: only GETs go to itself, with its own headers stripped', () => withEnv({ NODE_ENV: 'production', PW_BASIC_AUTH: 'u:secret', PW_INTERNAL_HOSTS: '127.0.0.1', PW_BASE_URL: at(self, '') }, async () => {
    const f = serverFetch(at(self, ''));
    // the review's attack: POST /api/data/sql to itself with a forged Origin, riding on the Basic password
    await expect(f(at(self, '/api/data/sql'), { method: 'POST', headers: { origin: at(self, ''), 'content-type': 'application/json' }, body: '{}' })).rejects.toMatchObject({ status: 403 });
    expect(seen).toHaveLength(0);
    await f(at(self), { headers: { origin: 'http://evil.example', referer: 'http://evil.example/', cookie: 'pw_session=forged', authorization: 'Basic Zm9yZ2Vk' } });
    expect(seen[0].h.authorization).toBe(`Basic ${Buffer.from('u:secret').toString('base64')}`);
    for (const k of ['origin', 'referer', 'cookie']) expect(seen[0].h[k], k).toBeUndefined();
    // any other host (an internal one included) never gets the password
    await f(at(other));
    expect(seen[1].h.authorization).toBeUndefined();
  }));

  it('credentials go only to the exact configured self origin: not another port or scheme, not through a redirect, never with userinfo', () => withEnv({ NODE_ENV: 'production', PW_BASIC_AUTH: 'u:secret', PW_INTERNAL_HOSTS: '127.0.0.1', PW_BASE_URL: at(self, '') }, async () => {
    const basic = `Basic ${Buffer.from('u:secret').toString('base64')}`;
    // a caller that says some other origin is "self" still sends no credentials there (PW_BASE_URL decides)
    await serverFetch(at(other, ''))(at(other));
    expect(seen[0].h.authorization).toBeUndefined();
    // the configured self gets them
    await serverFetch(at(self, ''))(at(self));
    expect(seen[1].h.authorization).toBe(basic);
    // self redirecting to another origin: the credentials stay behind
    seen = [];
    const hop = http.createServer((q, r) => { r.writeHead(302, { location: at(other, '/landed') }); r.end(); });
    await new Promise(r => hop.listen(0, '127.0.0.1', r));
    await withEnv({ PW_BASE_URL: `http://127.0.0.1:${hop.address().port}` }, () => serverFetch(`http://127.0.0.1:${hop.address().port}`)(`http://127.0.0.1:${hop.address().port}/go`));
    hop.close();
    expect(seen[0].url).toBe('/landed');
    expect(seen[0].h.authorization).toBeUndefined();
    // userinfo in a URL is refused outright
    await expect(serverFetch(at(self, ''))(`http://u:secret@127.0.0.1:${self.address().port}/x`)).rejects.toMatchObject({ status: 400 });
    await expect(serverFetch(at(self, ''))(`http://evil@127.0.0.1:${other.address().port}/x`)).rejects.toMatchObject({ status: 400 });
    // https:// or another port of the same host is not self
    await expect(serverFetch(at(self, ''))(`https://127.0.0.1:${self.address().port}/x`)).rejects.toBeTruthy();
    expect(seen.filter(x => x.h.authorization)).toHaveLength(0);
  }));

  it('a report cannot pick the Host header or the framing of a server-side request', () => withEnv({ PW_INTERNAL_HOSTS: '127.0.0.1' }, async () => {
    await serverFetch(at(self, ''))(at(other), { headers: { host: 'admin.internal', 'transfer-encoding': 'chunked', connection: 'upgrade' } });
    expect(seen[0].h.host).toBe(`127.0.0.1:${other.address().port}`);
    expect(seen[0].h['transfer-encoding']).toBeUndefined();
  }));

  it('PW_AUTH=proxy: the server\'s calls to itself carry PW_PROXY_SECRET (and only those)', () => withEnv({ NODE_ENV: 'production', PW_AUTH: 'proxy', PW_PROXY_SECRET: SECRET, PW_INTERNAL_HOSTS: '127.0.0.1', PW_BASE_URL: at(self, '') }, async () => {
    const f = serverFetch(at(self, ''));
    await f(at(self), { headers: { 'x-pagewright-proxy-secret': 'forged' } });
    await f(at(other), { headers: { 'x-pagewright-proxy-secret': 'forged' } });
    expect(seen[0].h['x-pagewright-proxy-secret']).toBe(SECRET);
    expect(seen[1].h['x-pagewright-proxy-secret']).toBeUndefined();
  }));

  it('a viewer\'s API key cannot aim batches or schedules at PW_INTERNAL_HOSTS; a designer or service key can', () => withEnv({ PW_INTERNAL_HOSTS: '127.0.0.1' }, async () => {
    const viewer = { kind: 'user', email: 'v@x.io', role: 'viewer', groups: [] };
    for (const spec of [{ itemsFrom: { url: at(other) } }, { webhook: at(other) }, { items: [{ putUrl: at(other) }] }]) {
      await expect(checkDelivery(spec, viewer), JSON.stringify(spec)).rejects.toMatchObject({ status: 403 });
      await checkDelivery(spec, { kind: 'service' });
    }
    await expect(serverFetch(at(self, ''), { internal: false })(at(other))).rejects.toMatchObject({ status: 403 });
    expect(seen).toHaveLength(0);
  }));
});

describe('a report\'s data sources in the browser (reportFetch)', () => {
  const calls = [];
  const f = reportFetch('https://pw.example.com', async (u, init) => { calls.push([init.method || 'GET', u, init.credentials]); return new Response('[]'); });
  it('may read data on this server: sample data, the data proxy, saved SQL, and paths that are not Pagewright\'s', async () => {
    await f('/api/sample/sales/2024');
    await f('https://pw.example.com/api/data/proxy?url=x');
    await f('/api/data/sql', { method: 'POST', body: '{}' });
    await f('/my-api/rows.json');
    expect(calls.map(c => c[2])).toEqual(['same-origin', 'same-origin', 'same-origin', 'omit']); // not ours: no cookie
  });
  it('may not call Pagewright\'s other APIs or pages with the viewer\'s cookie (an admin opening it would create users)', async () => {
    calls.length = 0;
    for (const [url, method] of [['/api/users', 'POST'], ['/api/users', 'GET'], ['https://pw.example.com//api/users', 'GET'], ['/.//api/users', 'GET'], ['/%61pi/users', 'GET'], ['https://pw.example.com//api/audit', 'GET'], ['/%zz', 'GET'], ['/api/folders/root', 'PATCH'], ['/api/reports/x', 'DELETE'], ['/api/audit', 'GET'],
      ['/admin/users', 'GET'], ['/api/sample/x', 'POST'], ['/api/sample/%2e%2e/%2e%2e/api/users', 'GET'], ['/api/sample%2f..%2f..%2fusers', 'GET'], ['/api/data/sql/test', 'POST'], ['/', 'GET']]) {
      await expect(f(url, { method }), `${method} ${url}`).rejects.toMatchObject({ status: 403 });
    }
    expect(calls).toHaveLength(0);
  });
  it('sends cookies only to its own data routes, and follows no same-origin redirect (into /api/users)', async () => {
    const seen2 = [];
    const g = reportFetch('https://pw.example.com', async (u, init) => { seen2.push(init); return new Response('[]'); });
    await g('/api/sample/x');
    await g('/my-api/rows.json');
    expect(seen2.map(i => [i.credentials, i.redirect])).toEqual([['same-origin', 'error'], ['omit', 'error']]);
  });
  it('an embedded viewer sends the host page nothing: its server is the only "self"', async () => {
    const seen2 = [];
    const g = reportFetch('https://reports.example.com', async (u, init) => { seen2.push([u, init.credentials]); return new Response('[]'); });
    await g('https://host-app.example.com/api/me');
    expect(seen2).toEqual([['https://host-app.example.com/api/me', 'omit']]);
  });
  it('sends no cookies to other sites', async () => {
    calls.length = 0;
    await f('https://api.example.com/x', { method: 'POST' });
    expect(calls[0][2]).toBe('omit');
  });
});

describe('the audit log', () => {
  it('anonymous read-only visitors cannot fill it', () => withEnv({ ...PROD_OPEN, PW_PUBLIC_READONLY: '1' }, async () => {
    await stampDefinition({ kind: 'service' }, 'r', { name: 'r' });
    await writeReport('r', { name: 'r', sections: { body: { items: [] } } });
    expect((await auditExport(rq('/api/audit/export', { method: 'POST', body: { report: 'r', format: 'pdf' } }))).status).toBe(403);
  }));
});

describe('hosts chosen by parameters (PW_FIXED_FETCH_HOSTS)', () => {
  const def = (url) => ({ name: 'r', dataSources: [{ name: 'd', type: 'rest', url }], dataSets: [], sections: { body: { items: [] } } });
  it('counts a host built by an expression as internal (it could be one)', () => withEnv({ PW_INTERNAL_HOSTS: 'hr.internal' }, () => {
    for (const u of ['http://{Parameters.h}/x', 'http://x{Parameters.h}/', 'http://{Parameters.h}.corp/', '={Parameters.u}', 'http://hr.internal{Parameters.p}']) expect(serverSources(def(u)), u).toHaveLength(1);
    expect(serverSources(def('https://api.example.com/x/{Parameters.id}?q={Parameters.q}'))).toHaveLength(0); // only the path and query vary
  }));
  it('in production only the path and query of a server-side fetch may be dynamic; PW_FIXED_FETCH_HOSTS=0 turns it off', async () => {
    await withEnv({ NODE_ENV: 'production', PW_FIXED_FETCH_HOSTS: undefined }, async () => {
      for (const u of ['http://{Parameters.h}/x', '={Parameters.u}', '{Parameters.base}/x', 'http://api.example.com{Parameters.p}']) expect(() => assertFixedHosts(def(u)), u).toThrow(/PW_FIXED_FETCH_HOSTS/);
      for (const u of ['https://api.example.com/x/{Parameters.id}?q={Parameters.q}', '/api/sample/{Parameters.y}', 'https://api.example.com/x']) expect(() => assertFixedHosts(def(u)), u).not.toThrow();
      await expect(renderTo(def('={Parameters.u}'), { format: 'json', baseUrl: 'http://127.0.0.1:1', principal: { kind: 'service' } })).rejects.toMatchObject({ status: 403 });
      await withEnv({ PW_FIXED_FETCH_HOSTS: '0' }, () => expect(() => assertFixedHosts(def('={Parameters.u}'))).not.toThrow());
    });
    await withEnv({ NODE_ENV: 'development', PW_FIXED_FETCH_HOSTS: undefined }, () => expect(() => assertFixedHosts(def('={Parameters.u}'))).not.toThrow());
    await withEnv({ NODE_ENV: 'development', PW_FIXED_FETCH_HOSTS: '1' }, () => expect(() => assertFixedHosts(def('={Parameters.u}'))).toThrow());
  });
});

describe('records and modes', () => {
  it('a removed key\'s schedules stop in every mode; keyless and user records run only in development', () => withEnv({ NODE_ENV: 'production', PW_BASIC_AUTH: 'u:p', PW_API_KEYS: 'newkey', PW_AUTH: undefined }, async () => {
    for (const id of ['service:deadbeef', 'open', 'user:a@x.io', 'nobody']) expect(await principalFromId(id), id).toEqual(NOBODY);
    const key = (await apiPrincipal(rq('/api/v1/templates', { headers: { authorization: 'Bearer newkey' } }))).principal.key;
    expect(await principalFromId(`service:${key}`)).toEqual({ kind: 'service', key });
    await withEnv({ NODE_ENV: 'development', PW_BASIC_AUTH: undefined }, async () => {
      expect(await principalFromId('open')).toEqual(OPEN);
      expect(await principalFromId('service:deadbeef')).toEqual(NOBODY);
    });
  }));
  it('development answers only on a local host name (DNS rebinding); PW_DEV_HOSTS adds more', () => withEnv({ NODE_ENV: 'development', PW_AUTH: undefined, PW_BASIC_AUTH: undefined, PW_BASE_URL: undefined }, async () => {
    const at = (host, m = 'POST') => proxy(new Request(`http://${host}/api/data/sql`, { method: m, headers: { host, origin: `http://${host}`, 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' }));
    expect((await at('rebind.evil.example:3000')).status).toBe(403);
    expect((await at('rebind.evil.example:3000', 'GET'))?.status).toBe(403);
    for (const h of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) expect(await at(h), h).toBe(undefined);
    await withEnv({ PW_DEV_HOSTS: 'mybox.lan' }, async () => expect(await at('mybox.lan:3000')).toBe(undefined));
  }));
  it('a PW_BASIC_AUTH without a user and a password is not a sign-in (fails closed)', () => withEnv({ ...PROD_OPEN, PW_BASIC_AUTH: 'x' }, async () => {
    expect((await proxy(rq('/api/reports', { method: 'POST', body: {} }))).status).toBe(401);
    for (const v of [':', 'u:', ':p']) await withEnv({ PW_BASIC_AUTH: v }, async () => expect(await principalOf(rq('/'))).toEqual(NOBODY));
  }));
  it('PW_AUTH=proxy with PW_PROXY_SECRET: requests without the reverse proxy\'s header are refused', () => withEnv({ ...PROD_OPEN, PW_AUTH: 'proxy', PW_PROXY_SECRET: SECRET }, async () => {
    expect((await proxy(rq('/designer/x'))).status).toBe(401);
    expect((await proxy(rq('/designer/x', { headers: { 'x-pagewright-proxy-secret': 'wrong' } }))).status).toBe(401);
    expect((await proxy(rq('/api/data/sql', { method: 'POST', body: {} }))).status).toBe(401); // reached around the proxy
    expect(await proxy(rq('/designer/x', { headers: VIA_PROXY }))).toBe(undefined);
    expect(await proxy(rq('/api/v1/templates'))).toBe(undefined); // its own keys
  }));
});

describe('paths the proxy lets through', () => {
  it('tricks on /api/v1 and static prefixes do not skip the Origin check or the sign-in', () => withEnv({ ...PROD_OPEN, PW_BASIC_AUTH: 'u:p' }, async () => {
    const authorization = `Basic ${Buffer.from('u:p').toString('base64')}`;
    // an encoded dot-segment under /api/v1/ is /api/reports (the URL parser resolves it), not a keyed API call
    expect((await proxy(rq('/api/v1/%2e%2e/reports', { method: 'POST', origin: EVIL, headers: { authorization }, body: {} })))?.status).toBe(403);
    expect((await proxy(rq('/api/v1%2freports', { method: 'POST', origin: EVIL, headers: { authorization }, body: {} })))?.status).toBe(400);
    expect((await proxy(rq('/api/v1x/reports', { method: 'POST', origin: EVIL, headers: { authorization }, body: {} })))?.status).toBe(403);
    expect((await proxy(rq('/_next/%2e%2e/api/reports')))?.status).toBe(401); // /api/reports: the password is asked for
    expect((await proxy(rq('/fonts/..%2fapi/reports')))?.status).toBe(400);
  }));
  it('the same in production with no sign-in, and in read-only mode', async () => {
    await withEnv(PROD_OPEN, async () => {
      expect((await proxy(rq('/api/v1x/templates')))?.status).toBe(401);
      expect((await proxy(rq('/API/reports')))?.status).toBe(401);
      expect((await proxy(rq('/embed/%2e%2e/api/reports')))?.status).toBe(401);
      expect((await proxy(rq('/embed/..%2fapi/reports')))?.status).toBe(400);
    });
    await withEnv({ ...PROD_OPEN, PW_PUBLIC_READONLY: '1' }, async () => {
      expect((await proxy(rq('/viewer/x/../../designer/x')))?.status).toBe(401); // the URL parser makes it /designer/x
      expect((await proxy(rq('/api/reports/x%2f..%2fversions')))?.status).toBe(400);
    });
  });
});

describe('one parse for the check and the fetch (strictUrl)', () => {
  // forms a URL parser rewrites: the host checked must be the host written
  const BYPASS = [
    'http://0x7f.1/', 'http://2130706433/', 'http://0177.0.0.1/', 'http://127.1/', 'http://0x7f000001/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]:80/x'.replace('7f00:1', '127.0.0.1'),
    'http://127.0.0.1./', 'http://LOCALHOST./x', 'http://hr.internal./x',
    'http:\\\\127.0.0.1\\x', 'http:/127.0.0.1/x', 'http:127.0.0.1/x', 'http://evil.com\\@127.0.0.1/', 'http://evil.com\\.127.0.0.1/',
    'http://user@127.0.0.1/', 'http://u:p@api.example.com/', 'http://127.0.0.1:80@evil.com/', 'http://@127.0.0.1/',
    'http://%31%32%37.0.0.1/', 'http://127.0.0.1%2e/', 'http://exa%6dple.com/',
    'http://127.0.0.1\t/', 'http://127.0.0.1\n.evil.com/', ' http://127.0.0.1/', 'http://ex ample.com/',
    'file:///etc/passwd', 'gopher://127.0.0.1/', 'ftp://example.com/', '//example.com/x', '/relative',
  ];
  it.each(BYPASS)('refuses %j', (u) => {
    expect(() => strictUrl(u)).toThrow();
  });
  it.each(['http://api.example.com/x?name=John Smith', 'http://münchen.example/x', 'http://api.example.com/x?a=1#f', 'https://API.Example.COM:8443/x', 'http://127.0.0.1:3000/api/sample/x', 'http://[::1]:3000/', 'https://xn--bcher-kva.example/'])('accepts %j', (u) => {
    expect(strictUrl(u)).toBeInstanceOf(URL);
  });
  it('safeFetch, serverFetch and the data proxy refuse them before any lookup or connection', () => withEnv({ PW_INTERNAL_HOSTS: '127.0.0.1', PW_PROXY_ALLOW: 'example.com' }, async () => {
    for (const u of ['http://0x7f.1/', 'http://user@127.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://127.0.0.1./']) {
      await expect(safeFetch(u), u).rejects.toMatchObject({ status: 400 });
      await expect(serverFetch('http://127.0.0.1:1')(u), u).rejects.toMatchObject({ status: 400 });
    }
    const r = await dataProxy(new Request(`http://pw.test/api/data/proxy?url=${encodeURIComponent('http://exa%6dple.com/x')}`));
    expect(r.status).toBe(400);
  }));
});

describe('round 3', () => {
  it('next dev with PW_AUTH=proxy and no secret still answers only to local host names (DNS rebinding)', () => withEnv({ NODE_ENV: 'development', PW_AUTH: 'proxy', PW_PROXY_SECRET: undefined, PW_BASIC_AUTH: undefined, PW_DEV_HOSTS: undefined, PW_BASE_URL: undefined }, async () => {
    const r = await proxy(new Request('http://evil.example:3000/api/reports', { method: 'POST', headers: { host: 'evil.example:3000', origin: 'http://evil.example:3000' }, body: '{}' }));
    expect(r?.status).toBe(403);
  }));
  it('PW_AUTH=proxy: only static files and /api/v1 skip the proxy secret; embed reads of definitions need it too', () => withEnv({ ...PROD_OPEN, PW_AUTH: 'proxy', PW_PROXY_SECRET: SECRET, PW_EMBED_ORIGINS: 'http://localhost:4000' }, async () => {
    expect((await proxy(rq('/api/reports/x')))?.status).toBe(401);
    expect((await proxy(rq('/api/sample/sales')))?.status).toBe(401);
    expect(await proxy(rq('/api/reports/x', { headers: VIA_PROXY }))).toBe(undefined);
    expect(await proxy(rq('/embed/pagewright-viewer.js'))).toBe(undefined);
  }));
});
