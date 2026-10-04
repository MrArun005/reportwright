// Enterprise 2: permissions per report and per folder. The resolver as pure functions, then every route that reads or
// lists reports, on files and SQLite (and Postgres / MySQL / SQL Server when PW_TEST_PG / PW_TEST_MYSQL / PW_TEST_MSSQL
// are set). Every deny path is checked: a report one may not view is "not found".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reportLevel, folderLevel, checkGrants, DEFAULT_ROOT } from '../../src/server/perms.js';

const S = (o = {}) => ({ folders: new Map(Object.entries(o.folders || {})), reports: new Map(Object.entries(o.reports || {})), root: o.root || DEFAULT_ROOT });
const user = (email, role = 'designer', groups = []) => ({ kind: 'user', email, role, groups });

describe('the resolver', () => {
  it('defaults to what accounts did before: everyone manages within their role', () => {
    const s = S();
    expect(reportLevel(s, user('d@x.io'), 'r')).toBe('manage');
    expect(reportLevel(s, user('v@x.io', 'viewer'), 'r')).toBe('view'); // the role is a ceiling
    expect(reportLevel(s, { kind: 'nobody' }, 'r')).toBe('none');
    expect(reportLevel(s, { kind: 'anon' }, 'r')).toBe('none');
    expect(folderLevel(s, user('d@x.io'), null)).toBe('manage');
  });
  it('inherits from the folder chain, stops where inheritance is off, and takes the highest grant', () => {
    const s = S({
      root: [{ to: 'group:everyone', level: 'view' }],
      folders: {
        f_fin: { id: 'f_fin', name: 'Finance', parent: null, inherit: false, grants: [{ to: 'group:finance', level: 'view' }, { to: 'user:alice@x.io', level: 'edit' }] },
        f_pay: { id: 'f_pay', name: 'Payroll', parent: 'f_fin', inherit: true, grants: [{ to: 'user:carol@x.io', level: 'manage' }] },
        f_open: { id: 'f_open', name: 'Open', parent: null, inherit: true, grants: [] },
      },
      reports: {
        salary: { id: 'salary', folder: 'f_pay', inherit: true, grants: [] },
        secret: { id: 'secret', folder: 'f_open', inherit: false, grants: [{ to: 'user:bob@x.io', level: 'view' }] },
        memo: { id: 'memo', folder: 'f_open', inherit: true, grants: [{ to: 'user:bob@x.io', level: 'edit' }] },
      },
    });
    const bob = user('bob@x.io'), alice = user('alice@x.io'), carol = user('carol@x.io', 'designer', ['Finance']), dan = user('dan@x.io', 'viewer', ['finance']);
    expect(reportLevel(s, bob, 'salary')).toBe('none'); // Finance does not inherit the root
    expect(reportLevel(s, alice, 'salary')).toBe('edit');
    expect(reportLevel(s, carol, 'salary')).toBe('manage'); // group names are case-insensitive
    expect(reportLevel(s, dan, 'salary')).toBe('view');
    expect(reportLevel(s, alice, 'secret')).toBe('none'); // the report breaks inheritance
    expect(reportLevel(s, bob, 'secret')).toBe('view');
    expect(reportLevel(s, alice, 'memo')).toBe('view'); // from the root, through Open
    expect(reportLevel(s, bob, 'memo')).toBe('edit');
    expect(reportLevel(s, user('admin@x.io', 'admin'), 'secret')).toBe('manage');
    expect(reportLevel(s, { kind: 'service' }, 'secret')).toBe('manage');
    expect(folderLevel(s, bob, 'f_fin')).toBe('none');
    expect(folderLevel(s, carol, 'f_pay')).toBe('manage');
    expect(folderLevel(s, carol, 'f_fin')).toBe('view');
    expect(reportLevel(s, user('x@x.io', 'viewer'), 'unknown')).toBe('view'); // no record: at the top
  });
  it('reads "public" for anonymous embed readers only when embedding is on, and never above view', () => {
    const s = S({ reports: { pub: { id: 'pub', folder: null, inherit: false, grants: [{ to: 'group:public', level: 'manage' }] } } });
    const keep = process.env.PW_EMBED_ORIGINS;
    try {
      delete process.env.PW_EMBED_ORIGINS;
      expect(reportLevel(s, { kind: 'anon' }, 'pub')).toBe('none');
      process.env.PW_EMBED_ORIGINS = 'http://localhost:4000';
      expect(reportLevel(s, { kind: 'anon' }, 'pub')).toBe('view');
      expect(reportLevel(s, { kind: 'anon' }, 'other')).toBe('none');
    } finally { if (keep === undefined) delete process.env.PW_EMBED_ORIGINS; else process.env.PW_EMBED_ORIGINS = keep; }
  });
  it('survives a folder loop and a lost parent', () => {
    const s = S({ root: [], folders: { f_a: { id: 'f_a', parent: 'f_b', grants: [] }, f_b: { id: 'f_b', parent: 'f_a', grants: [{ to: 'user:b@x.io', level: 'view' }] } }, reports: { r: { id: 'r', folder: 'f_a', inherit: true, grants: [] } } });
    expect(reportLevel(s, user('b@x.io'), 'r')).toBe('view');
    expect(reportLevel(s, user('c@x.io'), 'r')).toBe('none');
  });
  it('cleans grants and refuses bad ones', () => {
    expect(checkGrants([{ to: 'user:Bob@X.io ', level: 'view' }, { to: 'user:bob@x.io', level: 'edit' }, { to: 'group: Finance', level: 'view' }]))
      .toEqual([{ to: 'user:bob@x.io', level: 'edit' }, { to: 'group:finance', level: 'view' }]);
    for (const bad of [[{ to: 'user:bob', level: 'view' }], [{ to: 'bob@x.io', level: 'view' }], [{ to: 'group:a/b', level: 'view' }], [{ to: 'user:b@x.io', level: 'owner' }], 'x', [null]]) {
      expect(() => checkGrants(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

/* ---------------- routes, per storage backend ---------------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-perms-'));
const home = process.cwd();
const backends = [
  ['file', () => { const d = path.join(tmp, 'files'); fs.mkdirSync(d, { recursive: true }); fs.symlinkSync(path.join(home, 'public'), path.join(d, 'public')); process.chdir(d); return 'file'; }],
  ['sqlite', () => { process.chdir(home); return `sqlite:${path.join(tmp, 'perms.db')}`; }],
];
for (const [k, env] of [['postgres', 'PW_TEST_PG'], ['mysql', 'PW_TEST_MYSQL'], ['mssql', 'PW_TEST_MSSQL']]) if (process.env[env]) backends.push([k, () => { process.chdir(home); return process.env[env]; }]);

const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 'x'.repeat(40), PW_API_KEYS: 'svc-key,bob@x.io|bob-key,carol@x.io|carol-key,dan@x.io|dan-key' };
const saved = {};
beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; } });
afterAll(() => {
  process.chdir(home);
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  delete process.env.PW_STORAGE;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const def = (name, body = [{ type: 'textbox', x: 0, y: 0, w: 200, h: 16, value: name }]) => ({
  $schema: 'pagewright/report@1', name, page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'db', type: 'sql', connection: 'permsdb', query: 'select 1 as n' }], dataSets: [],
  sections: { body: { items: body } },
});
const P = (id) => ({ params: Promise.resolve({ id }) });

describe.each(backends)('routes on %s storage', (kind, setup) => {
  let R, cookie, users, perms, sqlRoute, v1, folders, folderOne, access, thumb, pdf, versions;
  const BASE = 'http://pw.test';
  const req = (p, { method = 'GET', who, body, key, headers = {} } = {}) => new Request(BASE + p, {
    method, headers: { ...(who && { cookie: cookie[who] }), ...(key && { authorization: `Bearer ${key}` }), ...(body !== undefined && { 'content-type': 'application/json' }), origin: BASE, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

  beforeAll(async () => {
    process.env.PW_STORAGE = setup();
    const dbFile = path.join(tmp, `data-${kind}.db`);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbFile); db.exec('create table if not exists t (n int); delete from t; insert into t values (42);'); db.close();
    process.env.PW_DB_PERMSDB = `sqlite:${dbFile}`;
    const { store } = await import('../../src/server/storage/index.js');
    for (const k of ['reports', 'users', 'folders', 'reportacl', 'schedules', 'jobs']) for (const id of await store().ids(k)) await store().remove(k, id);
    users = await import('../../src/server/users.js');
    perms = await import('../../src/server/perms.js');
    const session = await import('../../src/server/session.js');
    const { writeReport } = await import('../../src/server/reports.js');
    R = {
      list: await import('../../app/api/reports/route.js'),
      one: await import('../../app/api/reports/[id]/route.js'),
    };
    versions = await import('../../app/api/reports/[id]/versions/route.js');
    pdf = await import('../../app/api/reports/[id]/pdf/route.js');
    thumb = await import('../../app/api/reports/[id]/thumb/route.js');
    access = await import('../../app/api/reports/[id]/access/route.js');
    folders = await import('../../app/api/folders/route.js');
    folderOne = await import('../../app/api/folders/[id]/route.js');
    sqlRoute = await import('../../app/api/data/sql/route.js');
    v1 = {
      render: await import('../../app/api/v1/render/route.js'),
      templates: await import('../../app/api/v1/templates/route.js'),
      batches: await import('../../app/api/v1/batches/route.js'),
      schedules: await import('../../app/api/v1/schedules/route.js'),
      schedule: await import('../../app/api/v1/schedules/[id]/route.js'),
    };
    cookie = {};
    for (const [email, role, groups] of [['admin@x.io', 'admin', []], ['alice@x.io', 'designer', []], ['bob@x.io', 'designer', []], ['carol@x.io', 'viewer', ['Finance']], ['dan@x.io', 'viewer', []]]) {
      await users.createUser({ email, role, password: 'a long password', groups });
      cookie[email.split('@')[0]] = session.sessionCookie(new Request(BASE), await users.getUser(email)).split(';')[0];
    }
    // the admin locks the top to view, and makes Finance (not inherited): finance group view, alice edit
    const admin = { kind: 'user', email: 'admin@x.io', role: 'admin', groups: [] };
    await perms.updateFolder(admin, 'root', { grants: [{ to: 'group:everyone', level: 'view' }] });
    const fin = await perms.createFolder(admin, { name: 'Finance' });
    await perms.updateFolder(admin, fin.id, { inherit: false, grants: [{ to: 'group:finance', level: 'view' }, { to: 'user:alice@x.io', level: 'edit' }] });
    R.fin = fin.id;
    await writeReport('salary', def('Salary'));
    await writeReport('salary', def('Salary v2')); // a version in the history
    await perms.setReportAccess(admin, 'salary', { folder: fin.id });
    await writeReport('overview', def('Overview', [{ type: 'subreport', name: 'Sub', x: 0, y: 0, w: 300, h: 40, report: 'salary' }]));
  });

  it('lists only what each user may view, with their level', async () => {
    const ids = async (who) => (await json(await R.list.GET(req('/api/reports', { who })))).body.map(r => `${r.id}:${r.access}`).sort();
    expect(await ids('admin')).toEqual(['overview:manage', 'salary:manage']);
    expect(await ids('bob')).toEqual(['overview:view']);
    expect(await ids('alice')).toEqual(['overview:view', 'salary:edit']);
    expect(await ids('carol')).toEqual(['overview:view', 'salary:view']);
    expect((await json(await R.list.GET(req('/api/reports?q=sal', { who: 'bob' })))).body).toEqual([]); // search sees the same list
    const f = async (who) => (await json(await folders.GET(req('/api/folders', { who })))).body;
    expect((await f('bob')).folders).toEqual([]);
    expect((await f('carol')).folders.map(x => [x.name, x.access])).toEqual([['Finance', 'view']]);
    expect((await f('bob')).root.access).toBe('view');
  });

  it('a user who may not view a report gets "not found" from every route', async () => {
    const nf = async (res) => expect((await res).status).toBe(404);
    await nf(R.one.GET(req('/api/reports/salary', { who: 'bob' }), P('salary')));
    await nf(R.one.PUT(req('/api/reports/salary', { who: 'bob', method: 'PUT', body: def('Hacked') }), P('salary')));
    await nf(R.one.DELETE(req('/api/reports/salary', { who: 'bob', method: 'DELETE' }), P('salary')));
    await nf(versions.GET(req('/api/reports/salary/versions', { who: 'bob' }), P('salary')));
    await nf(versions.POST(req('/api/reports/salary/versions', { who: 'bob', method: 'POST', body: { version: 'x' } }), P('salary')));
    await nf(pdf.GET(req('/api/reports/salary/pdf', { who: 'bob' }), P('salary')));
    await nf(pdf.GET(req('/api/reports/salary/pdf?format=csv', { who: 'bob' }), P('salary')));
    await nf(thumb.GET(req('/api/reports/salary/thumb', { who: 'bob' }), P('salary')));
    await nf(access.GET(req('/api/reports/salary/access', { who: 'bob' }), P('salary')));
    await nf(access.PUT(req('/api/reports/salary/access', { who: 'bob', method: 'PUT', body: { grants: [{ to: 'user:bob@x.io', level: 'manage' }] } }), P('salary')));
    await nf(sqlRoute.POST(req('/api/data/sql', { who: 'bob', method: 'POST', body: { report: 'salary', source: 'db' } })));
    await nf(sqlRoute.POST(req('/api/data/sql', { who: 'bob', method: 'POST', body: { report: 'salary@20200101T000000000', source: 'db' } })));
    await nf(folderOne.GET(req(`/api/folders/${R.fin}`, { who: 'bob' }), P(R.fin)));
    await nf(folderOne.PATCH(req(`/api/folders/${R.fin}`, { who: 'bob', method: 'PATCH', body: { grants: [] } }), P(R.fin)));
    await nf(folderOne.DELETE(req(`/api/folders/${R.fin}`, { who: 'bob', method: 'DELETE' }), P(R.fin)));
    // and the report is untouched
    expect((await json(await R.one.GET(req('/api/reports/salary', { who: 'admin' }), P('salary')))).body.name).toBe('Salary v2');
  });

  it('view without edit: reads and renders, but every change is 403', async () => {
    expect((await R.one.GET(req('/api/reports/salary', { who: 'carol' }), P('salary'))).status).toBe(200);
    const c = await pdf.GET(req('/api/reports/salary/pdf?format=csv', { who: 'carol' }), P('salary'));
    expect(c.status, await c.clone().text()).toBe(200);
    expect((await thumb.GET(req('/api/reports/salary/thumb', { who: 'carol' }), P('salary'))).status).toBe(200);
    expect((await json(await sqlRoute.POST(req('/api/data/sql', { who: 'carol', method: 'POST', body: { report: 'salary', source: 'db' } })))).body).toEqual({ rows: [{ n: 1 }] });
    expect((await R.one.PUT(req('/api/reports/salary', { who: 'carol', method: 'PUT', body: def('x') }), P('salary'))).status).toBe(403);
    expect((await R.one.DELETE(req('/api/reports/salary', { who: 'carol', method: 'DELETE' }), P('salary'))).status).toBe(403);
    expect((await versions.GET(req('/api/reports/salary/versions', { who: 'carol' }), P('salary'))).status).toBe(403);
    expect((await access.GET(req('/api/reports/salary/access', { who: 'carol' }), P('salary'))).status).toBe(403);
    // an old version holds settings that may have been removed since: edit needed
    expect((await sqlRoute.POST(req('/api/data/sql', { who: 'carol', method: 'POST', body: { report: 'salary@20200101T000000000', source: 'db' } }))).status).toBe(403);
  });

  it('edit without manage: saves and restores, but cannot delete, move or share', async () => {
    expect((await R.one.PUT(req('/api/reports/salary', { who: 'alice', method: 'PUT', body: def('Salary v3') }), P('salary'))).status).toBe(200);
    const list = (await json(await versions.GET(req('/api/reports/salary/versions', { who: 'alice' }), P('salary')))).body;
    expect(list.length).toBeGreaterThan(0);
    expect((await R.one.DELETE(req('/api/reports/salary', { who: 'alice', method: 'DELETE' }), P('salary'))).status).toBe(403);
    expect((await access.PUT(req('/api/reports/salary/access', { who: 'alice', method: 'PUT', body: { folder: null } }), P('salary'))).status).toBe(403);
    expect((await folderOne.PATCH(req(`/api/folders/${R.fin}`, { who: 'alice', method: 'PATCH', body: { name: 'Mine' } }), P(R.fin))).status).toBe(403);
    // alice may not create reports at the top (root is view for everyone) but may in Finance
    expect((await R.list.POST(req('/api/reports', { who: 'alice', method: 'POST', body: { name: 'Top' } }))).status).toBe(403);
    expect((await R.one.PUT(req('/api/reports/brand-new', { who: 'alice', method: 'PUT', body: def('New') }), P('brand-new'))).status).toBe(404); // like a hidden report: a new id does not leak
    const made = await json(await R.list.POST(req('/api/reports', { who: 'alice', method: 'POST', body: { name: 'Budget', folder: R.fin } })));
    expect(made.status).toBe(201);
    // the creator manages what they made
    expect((await json(await access.GET(req(`/api/reports/${made.body.id}/access`, { who: 'alice' }), P(made.body.id)))).body).toMatchObject({ folder: R.fin, access: 'manage', grants: [{ to: 'user:alice@x.io', level: 'manage' }] });
    expect((await R.one.DELETE(req(`/api/reports/${made.body.id}`, { who: 'alice', method: 'DELETE' }), P(made.body.id))).status).toBe(200);
  });

  it('saving a definition never changes who may see it', async () => {
    const d = { ...def('Salary v4'), folder: null, grants: [{ to: 'group:everyone', level: 'manage' }], access: { inherit: true } };
    expect((await R.one.PUT(req('/api/reports/salary', { who: 'alice', method: 'PUT', body: d }), P('salary'))).status).toBe(200);
    expect((await R.one.GET(req('/api/reports/salary', { who: 'bob' }), P('salary'))).status).toBe(404);
  });

  it('a subreport the user may not view does not render', async () => {
    const { renderTo } = await import('../../src/server/renderer.js');
    const overview = (await json(await R.one.GET(req('/api/reports/overview', { who: 'bob' }), P('overview')))).body;
    const as = async (p) => JSON.stringify((await renderTo(overview, { format: 'json', ...(p && { principal: p }) })).model.pages);
    const bobPages = await as(await perms.userPrincipal('bob@x.io'));
    expect(bobPages).not.toContain('Salary');
    expect(bobPages).toContain('Report \\"salary\\" not found'); // the same words as for a report that does not exist
    expect(await as(await perms.userPrincipal('carol@x.io'))).toContain('Salary v4');
    // a caller that does not say who it renders for gets nothing (fail closed)
    expect(await as(null)).not.toContain('Salary');
    // the server PDF route renders as the signed-in user too
    const csv = await (await pdf.GET(req('/api/reports/overview/pdf?format=csv', { who: 'bob' }), P('overview'))).text();
    expect(csv).not.toContain('Salary');
  });

  it('the server\'s internal pass (data source URLs) never reads a report', async () => {
    const { internalCookie } = await import('../../src/server/session.js');
    const r = new Request(`${BASE}/api/reports/overview`, { headers: { cookie: internalCookie(`${BASE}/api/reports/overview`) } });
    expect((await R.one.GET(r, P('overview'))).status).toBe(404);
  });

  it('anonymous embed readers see only reports shared with "public"', async () => {
    const keep = process.env.PW_EMBED_ORIGINS;
    process.env.PW_EMBED_ORIGINS = 'http://localhost:4000';
    try {
      expect((await R.one.GET(req('/api/reports/overview'), P('overview'))).status).toBe(404);
      await perms.setReportAccess({ kind: 'service' }, 'overview', { grants: [{ to: 'group:public', level: 'view' }] });
      expect((await R.one.GET(req('/api/reports/overview'), P('overview'))).status).toBe(200);
      expect((await R.one.GET(req('/api/reports/salary'), P('salary'))).status).toBe(404);
      expect((await R.one.PUT(req('/api/reports/overview', { method: 'PUT', body: def('x') }), P('overview'))).status).toBe(403); // anonymous: never more than view
    } finally { if (keep === undefined) delete process.env.PW_EMBED_ORIGINS; else process.env.PW_EMBED_ORIGINS = keep; }
  });

  it('API keys: a user\'s key sees what the user sees; a service key sees all', async () => {
    const render = (key, template, extra = {}) => v1.render.POST(req('/api/v1/render', { key, method: 'POST', body: { template, format: 'csv', ...extra } }));
    expect((await render('bob-key', 'salary')).status).toBe(404);
    expect((await render('bob-key', 'salary@20200101T000000000')).status).toBe(404);
    expect((await render('carol-key', 'salary')).status).toBe(200);
    expect((await render('svc-key', 'salary')).status).toBe(200);
    expect((await render('nope', 'salary')).status).toBe(401);
    // an inline definition can name any connection and subreport: designers and service keys only
    expect((await render('carol-key', def('Inline'))).status).toBe(403);
    const bobInline = await render('bob-key', def('Inline', [{ type: 'subreport', name: 'S', x: 0, y: 0, w: 300, h: 40, report: 'salary' }]));
    expect(bobInline.status).toBe(200);
    expect(await bobInline.text()).not.toContain('Salary');
    const tpl = async (key) => (await json(await v1.templates.GET(req('/api/v1/templates', { key })))).body.map(r => r.id).sort();
    expect(await tpl('bob-key')).toEqual(['overview']);
    expect(await tpl('svc-key')).toEqual(['overview', 'salary']);
    expect((await v1.batches.POST(req('/api/v1/batches', { key: 'bob-key', method: 'POST', body: { template: 'salary', items: [{ parameters: {} }] } }))).status).toBe(404);
    expect((await v1.schedules.POST(req('/api/v1/schedules', { key: 'bob-key', method: 'POST', body: { template: 'salary', cron: '0 7 * * *', items: [{ parameters: {} }] } }))).status).toBe(404);
  });

  it('schedules and batches belong to whoever made them; a run checks the owner again', async () => {
    const mk = await json(await v1.schedules.POST(req('/api/v1/schedules', { key: 'carol-key', method: 'POST', body: { template: 'salary', cron: '0 7 * * *', items: [{ parameters: {} }], output: { type: 'none' } } })));
    expect(mk.status).toBe(201);
    expect(mk.body.owner).toBeUndefined();
    const sid = mk.body.id;
    const list = async (key) => (await json(await v1.schedules.GET(req('/api/v1/schedules', { key })))).body.map(s => s.id);
    expect(await list('carol-key')).toEqual([sid]);
    expect(await list('bob-key')).toEqual([]);
    expect(await list('svc-key')).toContain(sid);
    expect((await v1.schedule.GET(req(`/api/v1/schedules/${sid}`, { key: 'bob-key' }), P(sid))).status).toBe(404);
    expect((await v1.schedule.PUT(req(`/api/v1/schedules/${sid}`, { key: 'bob-key', method: 'PUT', body: { cron: '0 8 * * *' } }), P(sid))).status).toBe(404);
    expect((await v1.schedule.DELETE(req(`/api/v1/schedules/${sid}`, { key: 'bob-key', method: 'DELETE' }), P(sid))).status).toBe(404);
    // carol cannot take over the schedule by sending an owner
    await v1.schedule.PUT(req(`/api/v1/schedules/${sid}`, { key: 'carol-key', method: 'PUT', body: { owner: 'service' } }), P(sid));
    expect(await list('carol-key')).toEqual([sid]);
    // carol leaves the finance group: the next run fails as soon as it starts
    await users.updateUser('carol@x.io', { groups: [] });
    const { runSchedule, getSchedule } = await import('../../src/server/schedules.js');
    await expect(runSchedule(await getSchedule(sid))).rejects.toMatchObject({ status: 404 });
    await users.updateUser('carol@x.io', { groups: ['Finance'] });
    const { createBatch, workOnce, getJob } = await import('../../src/server/jobs.js');
    const job = await createBatch({ template: 'salary', items: [{ parameters: {} }], output: { type: 'none' }, format: 'csv' }, undefined, await perms.userPrincipal('carol@x.io'));
    await users.updateUser('carol@x.io', { groups: [] }); // access lost while queued
    await workOnce('test-runner');
    expect(await getJob(job.id)).toMatchObject({ status: 'failed' });
    expect(await getJob(job.id, await perms.userPrincipal('bob@x.io'))).toBe(null); // not bob's
    await users.updateUser('carol@x.io', { groups: ['Finance'] });
  });

  it('folders: manage to change, empty to delete, no loops', async () => {
    const admin = { kind: 'user', email: 'admin@x.io', role: 'admin', groups: [] };
    const sub = await perms.createFolder(admin, { name: 'Sub', parent: R.fin });
    await expect(perms.updateFolder(admin, R.fin, { parent: sub.id })).rejects.toMatchObject({ status: 400 });
    expect((await folderOne.DELETE(req(`/api/folders/${R.fin}`, { who: 'admin', method: 'DELETE' }), P(R.fin))).status).toBe(409);
    expect((await folderOne.DELETE(req(`/api/folders/${sub.id}`, { who: 'admin', method: 'DELETE' }), P(sub.id))).status).toBe(200);
    expect((await folderOne.GET(req('/api/folders/root', { who: 'alice' }), P('root'))).status).toBe(403);
    expect((await folderOne.PATCH(req('/api/folders/root', { who: 'alice', method: 'PATCH', body: { grants: [{ to: 'user:alice@x.io', level: 'manage' }] } }), P('root'))).status).toBe(403);
    expect((await folders.POST(req('/api/folders', { who: 'alice', method: 'POST', body: { name: 'Mine' } }))).status).toBe(403); // root is view for her
    expect((await folderOne.PATCH(req('/api/folders/../x', { who: 'admin', method: 'PATCH', body: {} }), P('../x'))).status).toBe(400);
    expect((await folderOne.PATCH(req(`/api/folders/${R.fin}`, { who: 'admin', method: 'PATCH', body: { grants: [{ to: 'user:nobody', level: 'view' }] } }), P(R.fin))).status).toBe(400);
  });

  it('review: a deleted report takes its history with it; absent ids are not found everywhere', async () => {
    const { writeReport, listVersions } = await import('../../src/server/reports.js');
    await writeReport('payroll', def('CEO salary 9,999,999'));
    await writeReport('payroll', def('Payroll v2'));
    await perms.setReportAccess({ kind: 'service' }, 'payroll', { folder: R.fin });
    expect((await listVersions('payroll')).length).toBe(1);
    expect((await R.one.DELETE(req('/api/reports/payroll', { who: 'admin', method: 'DELETE' }), P('payroll'))).status).toBe(200);
    expect(await listVersions('payroll')).toEqual([]);
    for (const [route, init] of [[versions.GET, {}], [versions.POST, { method: 'POST', body: { version: 'x' } }], [access.GET, {}], [access.PUT, { method: 'PUT', body: { grants: [] } }], [R.one.DELETE, { method: 'DELETE' }]]) {
      expect((await route(req('/api/reports/payroll/x', { who: 'admin', ...init }), P('payroll'))).status).toBe(404);
    }
    // the same name again: a new report with no old versions
    await writeReport('payroll', def('New payroll'));
    expect(await listVersions('payroll')).toEqual([]);
    await R.one.DELETE(req('/api/reports/payroll', { who: 'admin', method: 'DELETE' }), P('payroll'));
  });

  it('review: PUT to a new id answers like a hidden report when the user may not create there', async () => {
    // the top is view-only for alice: a new id and bob's hidden report get the same answer
    expect((await R.one.PUT(req('/api/reports/no-such-report', { who: 'alice', method: 'PUT', body: def('x') }), P('no-such-report'))).status).toBe(404);
  });

  it('review: moving needs manage on the folder it leaves and the folder it goes to', async () => {
    const admin = { kind: 'user', email: 'admin@x.io', role: 'admin', groups: [] };
    const a = await perms.createFolder(admin, { name: 'From' });
    const b = await perms.createFolder(admin, { name: 'To' });
    await perms.updateFolder(admin, a.id, { grants: [{ to: 'user:alice@x.io', level: 'edit' }] });
    await perms.updateFolder(admin, b.id, { grants: [{ to: 'user:alice@x.io', level: 'manage' }] });
    const { id } = await (await R.list.POST(req('/api/reports', { who: 'alice', method: 'POST', body: { name: 'Mover', folder: a.id } }))).json();
    // alice manages her report but only edits the folder it is in: it stays
    expect((await access.PUT(req(`/api/reports/${id}/access`, { who: 'alice', method: 'PUT', body: { folder: b.id } }), P(id))).status).toBe(403);
    await perms.updateFolder(admin, a.id, { grants: [{ to: 'user:alice@x.io', level: 'manage' }] });
    expect((await access.PUT(req(`/api/reports/${id}/access`, { who: 'alice', method: 'PUT', body: { folder: b.id } }), P(id))).status).toBe(200);
    await R.one.DELETE(req(`/api/reports/${id}`, { who: 'admin', method: 'DELETE' }), P(id));
  });

  it('review: the check and the write are one step (a revoke in between wins)', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const { writeReport } = await import('../../src/server/reports.js');
    await writeReport('race', def('Race'));
    await perms.setReportAccess({ kind: 'service' }, 'race', { grants: [{ to: 'user:bob@x.io', level: 'edit' }] });
    // someone holds the permissions lock (a revoke in progress) while bob saves
    expect(await store().lease('lock:acl', 'revoker', 30000)).toBe(true);
    let done = false;
    const put = R.one.PUT(req('/api/reports/race', { who: 'bob', method: 'PUT', body: def('Bob was here') }), P('race')).then(r => { done = true; return r; });
    await new Promise(r => setTimeout(r, 150));
    expect(done).toBe(false); // waiting for the lock
    await store().put('reportacl', 'race', JSON.stringify({ id: 'race', folder: null, inherit: false, grants: [] })); // the revoke
    await store().release('lock:acl', 'revoker');
    expect((await put).status).toBe(404);
    expect((await json(await R.one.GET(req('/api/reports/race', { who: 'admin' }), P('race')))).body.sections.body.items[0].value).toBe('Race');
    await R.one.DELETE(req('/api/reports/race', { who: 'admin', method: 'DELETE' }), P('race'));
  });

  it('review: the check inside the lock uses the user as they are now, not as the request began', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const { writeReport } = await import('../../src/server/reports.js');
    await writeReport('race2', def('Race 2'));
    await perms.setReportAccess({ kind: 'service' }, 'race2', { inherit: false, grants: [{ to: 'group:editors', level: 'edit' }] });
    await users.updateUser('bob@x.io', { groups: ['Editors'] });
    try {
      expect(await store().lease('lock:acl', 'revoker', 30000)).toBe(true);
      const put = R.one.PUT(req('/api/reports/race2', { who: 'bob', method: 'PUT', body: def('Bob was here') }), P('race2'));
      await new Promise(r => setTimeout(r, 150));
      // another server takes bob out of Editors while his save waits (straight to storage: this server's cache is stale)
      const u = JSON.parse(await store().get('users', 'bob@x.io'));
      await store().put('users', 'bob@x.io', JSON.stringify({ ...u, groups: [] }));
      await store().release('lock:acl', 'revoker');
      expect((await put).status).toBe(404);
      expect((await json(await R.one.GET(req('/api/reports/race2', { who: 'admin' }), P('race2')))).body.sections.body.items[0].value).toBe('Race 2');
    } finally {
      await users.updateUser('bob@x.io', { groups: [] });
      await R.one.DELETE(req('/api/reports/race2', { who: 'admin', method: 'DELETE' }), P('race2'));
    }
  });

  it('review: a thumbnail never shows a subreport after access to it is gone', async () => {
    await perms.setReportAccess({ kind: 'service' }, 'overview', { grants: [] });
    const first = await (await thumb.GET(req('/api/reports/overview/thumb', { who: 'carol' }), P('overview'))).text();
    expect(first).toContain('Salary');
    await users.updateUser('carol@x.io', { groups: [] });
    try {
      const after = await (await thumb.GET(req('/api/reports/overview/thumb', { who: 'carol' }), P('overview'))).text();
      expect(after).not.toContain('Salary');
    } finally { await users.updateUser('carol@x.io', { groups: ['Finance'] }); }
  });

  it('review: a lost folder or a folder loop gives nothing, not the top-level grants', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const { writeReport } = await import('../../src/server/reports.js');
    await writeReport('lost', def('Lost'));
    await store().put('reportacl', 'lost', JSON.stringify({ id: 'lost', folder: 'f_gone000000', inherit: true, grants: [] }));
    expect((await R.one.GET(req('/api/reports/lost', { who: 'bob' }), P('lost'))).status).toBe(404);
    await store().put('folders', 'f_loopa00000', JSON.stringify({ id: 'f_loopa00000', name: 'A', parent: 'f_loopb00000', grants: [] }));
    await store().put('folders', 'f_loopb00000', JSON.stringify({ id: 'f_loopb00000', name: 'B', parent: 'f_loopa00000', grants: [] }));
    await store().put('reportacl', 'lost', JSON.stringify({ id: 'lost', folder: 'f_loopa00000', inherit: true, grants: [] }));
    expect((await R.one.GET(req('/api/reports/lost', { who: 'bob' }), P('lost'))).status).toBe(404);
    for (const id of ['f_loopa00000', 'f_loopb00000']) await store().remove('folders', id);
    await R.one.DELETE(req('/api/reports/lost', { who: 'admin', method: 'DELETE' }), P('lost'));
  });

  it('review: /api/v1 without keys is closed when accounts are on; a removed service key\'s schedules stop', async () => {
    const keep = process.env.PW_API_KEYS;
    try {
      delete process.env.PW_API_KEYS;
      expect((await v1.render.POST(req('/api/v1/render', { method: 'POST', body: { template: 'salary', format: 'csv' } }))).status).toBe(401);
    } finally { process.env.PW_API_KEYS = keep; }
    const { createSchedule, runSchedule } = await import('../../src/server/schedules.js');
    const s = await createSchedule({ template: 'salary', cron: '0 7 * * *', items: [{ parameters: {} }], output: { type: 'none' } }, { kind: 'service', key: 'deadbeef' });
    await expect(runSchedule(s)).rejects.toMatchObject({ status: 404 });
  });

  it('review: a queued inline batch fails when its owner is now a viewer', async () => {
    const { createBatch, workOnce, getJob } = await import('../../src/server/jobs.js');
    const job = await createBatch({ template: def('Inline'), items: [{ parameters: {} }], output: { type: 'none' }, format: 'csv' }, undefined, await perms.userPrincipal('bob@x.io'));
    await users.updateUser('bob@x.io', { role: 'viewer' });
    try {
      await workOnce('test-runner');
      expect(await getJob(job.id)).toMatchObject({ status: 'failed' });
    } finally { await users.updateUser('bob@x.io', { role: 'designer' }); }
  });

  it('a deleted report takes its permissions with it: a new report with the same id starts fresh', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    await writeReport('temp', def('Temp'));
    await perms.setReportAccess({ kind: 'service' }, 'temp', { grants: [{ to: 'user:bob@x.io', level: 'manage' }] });
    expect((await R.one.DELETE(req('/api/reports/temp', { who: 'admin', method: 'DELETE' }), P('temp'))).status).toBe(200);
    expect((await perms.snapshot()).reports.has('temp')).toBe(false);
  });
});
