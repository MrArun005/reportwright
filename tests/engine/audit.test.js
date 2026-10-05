// Enterprise 3: the audit log. Append, query, retention and CSV on files and SQLite (and Postgres / MySQL / SQL Server
// when PW_TEST_PG / PW_TEST_MYSQL / PW_TEST_MSSQL are set); then the routes record what they should and never a secret.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { audit, queryAudit, auditCsv, paramsHash } from '../../src/server/audit.js';
globalThis.__pwPeers = true; // the socket address comes in x-pw-peer, as instrumentation.js stamps it (limits.js trackPeers)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-audit-'));
const home = process.cwd();
const backends = [
  ['file', () => { const d = path.join(tmp, 'files'); fs.mkdirSync(d, { recursive: true }); fs.symlinkSync(path.join(home, 'public'), path.join(d, 'public')); process.chdir(d); return 'file'; }],
  ['sqlite', () => { process.chdir(home); return `sqlite:${path.join(tmp, 'audit.db')}`; }],
];
for (const [k, env] of [['postgres', 'PW_TEST_PG'], ['mysql', 'PW_TEST_MYSQL'], ['mssql', 'PW_TEST_MSSQL']]) if (process.env[env]) backends.push([k, () => { process.chdir(home); return process.env[env]; }]);

const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 's'.repeat(40), PW_API_KEYS: 'svc-secret-key,ann@x.io|ann-secret-key' };
const saved = {};
beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; } });
afterAll(() => {
  process.chdir(home);
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  delete process.env.PW_STORAGE;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('parameter hashes', () => {
  it('are keyed, stable across key order, and never the values', () => {
    const a = paramsHash({ account: 'ACC-123', from: '2026-01-01' });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(paramsHash({ from: '2026-01-01', account: 'ACC-123' })).toBe(a);
    expect(paramsHash({ account: 'ACC-124', from: '2026-01-01' })).not.toBe(a);
    expect(paramsHash({})).toBe(null);
  });
  it('CSV quotes what needs it and defuses formulas', () => {
    const csv = auditCsv([{ at: 't', type: 'report.render', status: 'ok', actor: '=cmd|"/c calc"!A1', ip: '-', report: 'a,b', detail: { x: 1 } }]);
    expect(csv.split('\r\n')[1]).toBe(`t,report.render,ok,"'=cmd|""/c calc""!A1",-,"a,b",,,"{""x"":1}"`);
  });
});

describe.each(backends)('the log on %s storage', (kind, setup) => {
  let store;
  beforeAll(async () => {
    process.env.PW_STORAGE = setup();
    ({ store } = await import('../../src/server/storage/index.js'));
    // start empty: an old run may have left events in a shared database
    await store().pruneAudit('9999-01-01T00:00:00.000Z');
  });

  it('appends and reads back newest first, with filters and paging', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const [i, [type, actor, report]] of [['auth.login', 'user:a@x.io'], ['report.render', 'user:a@x.io', 'sales'], ['report.render', 'user:b@x.io', 'loans'], ['report.update', 'user:b@x.io', 'sales']].entries()) {
        vi.setSystemTime(new Date(Date.UTC(2026, 9, 1 + i, 10)));
        await audit(type, { actor, report, format: type === 'report.render' ? 'pdf' : null, params: { id: i } });
      }
    } finally { vi.useRealTimers(); }
    const all = await queryAudit({ from: '2026-10-01', to: '2026-10-04' });
    expect(all.map(e => e.type)).toEqual(['report.update', 'report.render', 'report.render', 'auth.login']);
    expect(all[1]).toMatchObject({ actor: 'user:b@x.io', report: 'loans', format: 'pdf', status: 'ok', ip: '-' });
    expect(all[1].params).toMatch(/^[0-9a-f]{16}$/);
    expect((await queryAudit({ type: 'report.render' })).map(e => e.report)).toEqual(['loans', 'sales']);
    expect((await queryAudit({ type: 'report.' })).length).toBe(3);
    expect((await queryAudit({ actor: 'user:a@x.io' })).length).toBe(2);
    expect((await queryAudit({ report: 'sales' })).map(e => e.type)).toEqual(['report.update', 'report.render']);
    expect((await queryAudit({ from: '2026-10-02', to: '2026-10-02' })).map(e => e.type)).toEqual(['report.render']);
    const page1 = await queryAudit({ limit: 2 });
    const page2 = await queryAudit({ limit: 2, before: page1[1].id });
    expect([...page1, ...page2].map(e => e.type)).toEqual(['report.update', 'report.render', 'report.render', 'auth.login']);
    await expect(queryAudit({ from: 'yesterday' })).rejects.toMatchObject({ status: 400 });
  });

  it('retention drops old events and keeps new ones', async () => {
    const before = (await queryAudit({})).length;
    await store().pruneAudit('2026-10-03T00:00:00.000Z');
    const left = await queryAudit({});
    expect(left.length).toBe(before - 2);
    expect(left.every(e => e.at >= '2026-10-03')).toBe(true);
  });
});

describe('what the routes record', () => {
  let users, session, cookie;
  const BASE = 'http://pw.test';
  beforeAll(async () => {
    process.chdir(home);
    process.env.PW_STORAGE = `sqlite:${path.join(tmp, 'routes.db')}`;
    users = await import('../../src/server/users.js');
    session = await import('../../src/server/session.js');
    await users.createUser({ email: 'boss@x.io', role: 'admin', password: 'the boss password' });
    await users.createUser({ email: 'ann@x.io', role: 'designer', password: 'ann password 123' });
    cookie = session.sessionCookie(new Request(BASE), await users.getUser('boss@x.io')).split(';')[0];
  });
  const rq = (p, { method = 'GET', body, headers = {} } = {}) => new Request(BASE + p, { method, headers: { origin: BASE, 'x-pw-peer': '203.0.113.9', ...(body !== undefined && { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const last = async (type) => (await queryAudit({ type, limit: 1 }))[0];

  it('sign-in, failures and sign-out, never the password', async () => {
    const login = (await import('../../app/api/auth/login/route.js')).POST;
    await login(rq('/api/auth/login', { method: 'POST', body: { email: 'ann@x.io', password: 'not her password at all' } }));
    expect(await last('auth.login_failed')).toMatchObject({ status: 'ok', ip: '203.0.113.9', detail: { email: 'ann@x.io', reason: 'wrong email or password' } });
    const ok = await login(rq('/api/auth/login', { method: 'POST', body: { email: 'ann@x.io', password: 'ann password 123' } }));
    expect(ok.status).toBe(200);
    expect(await last('auth.login')).toMatchObject({ actor: 'user:ann@x.io', ip: '203.0.113.9' });
    const annCookie = ok.headers.get('set-cookie').split(';')[0];
    await (await import('../../app/api/auth/logout/route.js')).POST(rq('/api/auth/logout', { method: 'POST', headers: { cookie: annCookie } }));
    expect(await last('auth.logout')).toMatchObject({ actor: 'user:ann@x.io' });
    const all = JSON.stringify(await queryAudit({ limit: 1000 }));
    expect(all).not.toContain('not her password');
    expect(all).not.toContain('ann password 123');
    expect(all).not.toContain('pw_session');
  });

  it('report changes, sharing and renders, with a hash for the parameters', async () => {
    const list = await import('../../app/api/reports/route.js');
    const one = await import('../../app/api/reports/[id]/route.js');
    const access = await import('../../app/api/reports/[id]/access/route.js');
    const pdf = await import('../../app/api/reports/[id]/pdf/route.js');
    const P = (id) => ({ params: Promise.resolve({ id }) });
    const h = { cookie };
    const { id } = await (await list.POST(rq('/api/reports', { method: 'POST', body: { name: 'Audited' }, headers: h }))).json();
    expect(await last('report.create')).toMatchObject({ actor: 'user:boss@x.io', report: id });
    await one.PUT(rq(`/api/reports/${id}`, { method: 'PUT', body: { $schema: 'pagewright/report@1', name: 'Audited 2', sections: { body: { items: [] } } }, headers: h }), P(id));
    expect(await last('report.update')).toMatchObject({ report: id });
    await access.PUT(rq(`/api/reports/${id}/access`, { method: 'PUT', body: { grants: [{ to: 'user:ann@x.io', level: 'edit' }] }, headers: h }), P(id));
    const share = await last('access.report');
    expect(share.report).toBe(id);
    expect(JSON.stringify(share.detail)).toContain('user:ann@x.io');
    await pdf.GET(rq(`/api/reports/${id}/pdf?format=csv&account=SECRET-ACCOUNT-42`, { headers: h }), P(id));
    const r = await last('report.render');
    expect(r).toMatchObject({ report: id, format: 'csv', params: paramsHash({ account: 'SECRET-ACCOUNT-42' }) });
    expect(JSON.stringify(await queryAudit({ limit: 1000 }))).not.toContain('SECRET-ACCOUNT-42');
    await one.DELETE(rq(`/api/reports/${id}`, { method: 'DELETE', headers: h }), P(id));
    expect(await last('report.delete')).toMatchObject({ report: id });
  });

  it('API key use by key id, never the key; denied keys too', async () => {
    const tpl = (await import('../../app/api/v1/templates/route.js')).GET;
    await tpl(rq('/api/v1/templates', { headers: { authorization: 'Bearer ann-secret-key' } }));
    expect(await last('api.call')).toMatchObject({ actor: 'user:ann@x.io', status: 'ok', detail: { method: 'GET', path: '/api/v1/templates' } });
    await tpl(rq('/api/v1/templates', { headers: { authorization: 'Bearer svc-secret-key' } }));
    expect((await last('api.call')).actor).toMatch(/^service:[0-9a-f]{8}$/);
    await tpl(rq('/api/v1/templates', { headers: { authorization: 'Bearer wrong-key-guess' } }));
    expect(await last('api.call')).toMatchObject({ status: 'denied', detail: { reason: 'unknown key' } });
    const all = JSON.stringify(await queryAudit({ limit: 1000 }));
    for (const s of ['svc-secret-key', 'ann-secret-key', 'wrong-key-guess']) expect(all).not.toContain(s);
  });

  it('user changes by the admin, and permission changes on folders', async () => {
    const u = await import('../../app/api/users/[email]/route.js');
    await u.PATCH(rq('/api/users/ann@x.io', { method: 'PATCH', body: { role: 'viewer', password: 'a brand new password', groups: ['sales'] }, headers: { cookie } }), { params: Promise.resolve({ email: 'ann@x.io' }) });
    const e = await last('user.update');
    expect(e).toMatchObject({ actor: 'user:boss@x.io', detail: { user: 'ann@x.io', role: 'viewer', groups: ['sales'], password: 'changed' } });
    expect(JSON.stringify(e)).not.toContain('a brand new password');
    const folders = await import('../../app/api/folders/route.js');
    const f = await (await folders.POST(rq('/api/folders', { method: 'POST', body: { name: 'Audit F' }, headers: { cookie } }))).json();
    expect(await last('folder.create')).toMatchObject({ detail: { folder: f.id, name: 'Audit F' } });
    const fo = await import('../../app/api/folders/[id]/route.js');
    await fo.PATCH(rq(`/api/folders/${f.id}`, { method: 'PATCH', body: { inherit: false }, headers: { cookie } }), { params: Promise.resolve({ id: f.id }) });
    expect(await last('access.folder')).toMatchObject({ detail: { folder: f.id } });
  });

  it('only admins read the log; anyone who may view a report may record a browser export', async () => {
    const annCookie = session.sessionCookie(new Request(BASE), await users.getUser('ann@x.io')).split(';')[0];
    const log = (await import('../../app/api/audit/route.js')).GET;
    expect((await log(rq('/api/audit', { headers: { cookie: annCookie } }))).status).toBe(403);
    expect((await log(rq('/api/audit'))).status).toBe(403);
    const ok = await log(rq('/api/audit?type=auth.&format=csv', { headers: { cookie } }));
    expect(ok.headers.get('content-type')).toMatch(/text\/csv/);
    expect((await ok.text()).split('\r\n')[0]).toBe('at,type,status,actor,ip,report,format,params,detail');
    const exp = (await import('../../app/api/audit/export/route.js')).POST;
    const { writeReport } = await import('../../src/server/reports.js');
    await writeReport('exp-r', { $schema: 'pagewright/report@1', name: 'E', sections: { body: { items: [] } } });
    expect((await exp(rq('/api/audit/export', { method: 'POST', body: { report: 'exp-r', format: 'xlsx' }, headers: { cookie: annCookie } }))).status).toBe(200);
    expect(await last('report.export')).toMatchObject({ actor: 'user:ann@x.io', report: 'exp-r', format: 'xlsx', detail: { client: true } });
    expect((await exp(rq('/api/audit/export', { method: 'POST', body: { report: 'exp-r', format: 'json' }, headers: { cookie: annCookie } }))).status).toBe(200); // the viewer's JSON export
    expect(await last('report.export')).toMatchObject({ actor: 'user:ann@x.io', report: 'exp-r', format: 'json' });
    expect((await exp(rq('/api/audit/export', { method: 'POST', body: { report: 'exp-r', format: 'evil' }, headers: { cookie: annCookie } }))).status).toBe(400);
    expect((await exp(rq('/api/audit/export', { method: 'POST', body: { report: 'nope', format: 'pdf' }, headers: { cookie: annCookie } }))).status).toBe(404);
    expect((await exp(rq('/api/audit/export', { method: 'POST', body: { report: 'exp-r', format: 'pdf' } }))).status).toBe(401);
  });

  it('schedule runs, and failures to run, as the owner', async () => {
    const { createSchedule, runSchedule } = await import('../../src/server/schedules.js');
    const { writeReport } = await import('../../src/server/reports.js');
    await writeReport('sched-r', { $schema: 'pagewright/report@1', name: 'S', sections: { body: { items: [] } } });
    const ok = await createSchedule({ template: 'sched-r', cron: '0 7 * * *', items: [{ parameters: {} }], output: { type: 'none' }, itemsFrom: undefined }, { kind: 'service' });
    await runSchedule(ok, 'manual');
    expect(await last('schedule.run')).toMatchObject({ report: 'sched-r', status: 'ok', detail: { schedule: ok.id, reason: 'manual' } });
  });

  it('a URL in a detail keeps its origin and path, never its query or password', async () => {
    await audit('schedule.run', { actor: 'service', status: 'failed', detail: { error: 'itemsFrom: HTTP 500 from https://bob:hunter2@api.example.com/list?token=abc123#x' } });
    const e = await last('schedule.run');
    expect(e.detail.error).toBe('itemsFrom: HTTP 500 from https://api.example.com/list');
  });
});
