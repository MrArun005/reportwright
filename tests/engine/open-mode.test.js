// No sign-in configured: production fails closed, SQL in a saved report needs a designer (at save and at run).
// From the 2026-10-04 external review: an anonymous cross-origin POST saved a report with SQL, and running it returned
// the table. Each test here failed before the fix.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  it('PW_AUTH=proxy: a reverse proxy in front signs people in; the app trusts what reaches it, same-site writes only', () => withEnv({ ...PROD_OPEN, PW_AUTH: 'proxy' }, async () => {
    expect(await proxy(rq('/designer/x'))).toBe(undefined);
    await saveAndRun();
  }));
  it('API keys: with accounts off a user\'s key ("email|key") is a service key (it was the open server before)', () => withEnv({ ...PROD_OPEN, PW_API_KEYS: 'a@x.io|k1,k2' }, async () => {
    for (const k of ['k1', 'k2']) {
      const { principal } = await apiPrincipal(rq('/api/v1/render', { method: 'POST', headers: { authorization: `Bearer ${k}` } }));
      expect(principal.kind).toBe('service');
      expect(canDesign(principal)).toBe(true);
    }
  }));
});

describe('development with no sign-in', () => {
  const DEV = { NODE_ENV: 'development', PW_AUTH: undefined, PW_BASIC_AUTH: undefined };
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
