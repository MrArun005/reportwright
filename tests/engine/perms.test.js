// Enterprise 2: permissions per report and per folder. The resolver as pure functions, then every route that reads or
// lists reports, on files and SQLite (and Postgres / MySQL / SQL Server when PW_TEST_PG / PW_TEST_MYSQL / PW_TEST_MSSQL
// are set). Every deny path is checked: a report one may not view is "not found".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { reportLevel, folderLevel, checkGrants, DEFAULT_ROOT } from '../../src/server/perms.js';

const S = (o = {}) => ({ folders: new Map(Object.entries(o.folders || {})), reports: new Map(Object.entries(o.reports || {})), root: o.root || DEFAULT_ROOT });
const user = (email, role = 'designer', groups = []) => ({ kind: 'user', email, role, groups });

describe('the resolver', () => {
  it('defaults: designers view every report, viewers see only what a grant gives them, admins manage all', () => {
    const s = S();
    expect(reportLevel(s, user('d@x.io'), 'r')).toBe('view');
    expect(reportLevel(s, user('v@x.io', 'viewer'), 'r')).toBe('none');
    expect(reportLevel(s, user('a@x.io', 'admin'), 'r')).toBe('manage');
    expect(reportLevel(s, user('v@x.io', 'viewer', ['designers']), 'r')).toBe('none'); // a stored group cannot pose as a built-in one
    expect(reportLevel(s, { kind: 'nobody' }, 'r')).toBe('none');
    expect(reportLevel(s, { kind: 'anon' }, 'r')).toBe('none');
    expect(folderLevel(s, user('d@x.io'), null)).toBe('view');
    // the creator's grant (recordNewReport) makes them manage it
    const own = S({ reports: { r: { id: 'r', folder: null, inherit: true, grants: [{ to: 'user:d@x.io', level: 'manage' }] } } });
    expect(reportLevel(own, user('d@x.io'), 'r')).toBe('manage');
    expect(reportLevel(own, user('e@x.io'), 'r')).toBe('view');
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
// a report as a designer saves it: its SQL is recorded as theirs (perms.readRunnable runs no other)
const designerSaves = async (id, d) => {
  const { stampDefinition } = await import('../../src/server/perms.js');
  const { writeReport } = await import('../../src/server/reports.js');
  await stampDefinition({ kind: 'service' }, id, d);
  await writeReport(id, d);
};
// a user as their API key acts (batches and schedules record the key that made them)
const keyId = (k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 8);

describe.each(backends)('routes on %s storage', (kind, setup) => {
  let R, cookie, users, perms, sqlRoute, v1, folders, folderOne, access, thumb, pdf, versions;
  const BASE = 'http://pw.test';
  const req = (p, { method = 'GET', who, body, key, headers = {} } = {}) => new Request(BASE + p, {
    method, headers: { ...(who && { cookie: cookie[who] }), ...(key && { authorization: `Bearer ${key}` }), ...(body !== undefined && { 'content-type': 'application/json' }), origin: BASE, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
  // a thumbnail is drawn in the background: 202 and a placeholder first, the drawing once it is ready
  const thumbOf = async (who, id) => {
    const { thumbsIdle } = await import('../../src/server/thumbs.js');
    let res = await thumb.GET(req(`/api/reports/${id}/thumb`, { who }), P(id));
    for (let i = 0; res.status === 202 && i < 5; i++) { await thumbsIdle(); res = await thumb.GET(req(`/api/reports/${id}/thumb`, { who }), P(id)); }
    return res;
  };

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
    await perms.updateFolder(admin, 'root', { grants: [{ to: 'group:everyone', level: 'view' }], create: [] }); // nobody adds at the top but admins
    const fin = await perms.createFolder(admin, { name: 'Finance' });
    await perms.updateFolder(admin, fin.id, { inherit: false, grants: [{ to: 'group:finance', level: 'view' }, { to: 'user:alice@x.io', level: 'edit' }] });
    R.fin = fin.id;
    await designerSaves('salary', def('Salary'));
    await designerSaves('salary', def('Salary v2')); // a version in the history
    await perms.setReportAccess(admin, 'salary', { folder: fin.id });
    await designerSaves('overview', def('Overview', [{ type: 'subreport', name: 'Sub', x: 0, y: 0, w: 300, h: 40, report: 'salary' }]));
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
    expect((await thumbOf('carol', 'salary')).status).toBe(200);
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

  it('a server-rendered HTML export links drill-through to this server\'s viewer', async () => {
    const { renderTo } = await import('../../src/server/renderer.js');
    const d = def('Drill', [{ type: 'textbox', name: 'D', x: 0, y: 0, w: 200, h: 16, value: 'Open', action: { type: 'report', report: 'salary', params: { region: 'North' } } }]);
    const html = String((await renderTo(d, { format: 'html', baseUrl: 'http://pw.test', principal: { kind: 'service' } })).bytes);
    expect(html).toContain('http://pw.test/viewer/salary?region=North');
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
    await expect(runSchedule(await getSchedule(sid, { kind: 'service' }))).rejects.toMatchObject({ status: 404 });
    await users.updateUser('carol@x.io', { groups: ['Finance'] });
    const { createBatch, workOnce, getJob } = await import('../../src/server/jobs.js');
    const job = await createBatch({ template: 'salary', items: [{ parameters: {} }], output: { type: 'none' }, format: 'csv' }, undefined, await perms.userPrincipal('carol@x.io'));
    await users.updateUser('carol@x.io', { groups: [] }); // access lost while queued
    await workOnce('test-runner');
    expect(await getJob(job.id, { kind: 'service' })).toMatchObject({ status: 'failed' });
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
    await designerSaves('payroll', def('CEO salary 9,999,999'));
    await designerSaves('payroll', def('Payroll v2'));
    await perms.setReportAccess({ kind: 'service' }, 'payroll', { folder: R.fin });
    expect((await listVersions('payroll')).length).toBe(1);
    expect((await R.one.DELETE(req('/api/reports/payroll', { who: 'admin', method: 'DELETE' }), P('payroll'))).status).toBe(200);
    expect(await listVersions('payroll')).toEqual([]);
    for (const [route, init] of [[versions.GET, {}], [versions.POST, { method: 'POST', body: { version: 'x' } }], [access.GET, {}], [access.PUT, { method: 'PUT', body: { grants: [] } }], [R.one.DELETE, { method: 'DELETE' }]]) {
      expect((await route(req('/api/reports/payroll/x', { who: 'admin', ...init }), P('payroll'))).status).toBe(404);
    }
    // the same name again: a new report with no old versions
    await designerSaves('payroll', def('New payroll'));
    expect(await listVersions('payroll')).toEqual([]);
    await R.one.DELETE(req('/api/reports/payroll', { who: 'admin', method: 'DELETE' }), P('payroll'));
  });

  it('review: a new report never inherits history a failed delete left behind', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    await store().addVersion('ghost', '20200101T000000000', JSON.stringify(def('Old secret')), 50); // a delete that died half-way
    expect((await R.one.PUT(req('/api/reports/ghost', { who: 'admin', method: 'PUT', body: def('New') }), P('ghost'))).status).toBe(200);
    expect((await json(await versions.GET(req('/api/reports/ghost/versions', { who: 'admin' }), P('ghost')))).body).toEqual([]);
    const made = (await json(await R.list.POST(req('/api/reports', { who: 'admin', method: 'POST', body: { name: 'Ghost two' } })))).body.id;
    await store().addVersion(made, '20200101T000000000', JSON.stringify(def('x')), 50);
    await R.one.DELETE(req(`/api/reports/${made}`, { who: 'admin', method: 'DELETE' }), P(made));
    await store().addVersion(made, '20200101T000000000', JSON.stringify(def('Old secret')), 50);
    const again = (await json(await R.list.POST(req('/api/reports', { who: 'admin', method: 'POST', body: { name: 'Ghost two' } })))).body.id;
    expect(again).toBe(made);
    expect((await json(await versions.GET(req(`/api/reports/${again}/versions`, { who: 'admin' }), P(again)))).body).toEqual([]);
    for (const id of ['ghost', again]) await R.one.DELETE(req(`/api/reports/${id}`, { who: 'admin', method: 'DELETE' }), P(id));
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
    await designerSaves('race', def('Race'));
    await perms.setReportAccess({ kind: 'service' }, 'race', { grants: [{ to: 'user:bob@x.io', level: 'edit' }] });
    // someone holds the report's lock (a revoke in progress) while bob saves
    expect(await store().lease('lock:report:race', 'revoker', 30000)).toBe(true);
    let done = false;
    const put = R.one.PUT(req('/api/reports/race', { who: 'bob', method: 'PUT', body: def('Bob was here') }), P('race')).then(r => { done = true; return r; });
    await new Promise(r => setTimeout(r, 150));
    expect(done).toBe(false); // waiting for the lock
    await store().put('reportacl', 'race', JSON.stringify({ id: 'race', folder: null, inherit: false, grants: [] })); // the revoke
    await store().release('lock:report:race', 'revoker');
    expect((await put).status).toBe(404);
    expect((await json(await R.one.GET(req('/api/reports/race', { who: 'admin' }), P('race')))).body.sections.body.items[0].value).toBe('Race');
    await R.one.DELETE(req('/api/reports/race', { who: 'admin', method: 'DELETE' }), P('race'));
  });

  it('review: the check inside the lock uses the user as they are now, not as the request began', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const { writeReport } = await import('../../src/server/reports.js');
    await designerSaves('race2', def('Race 2'));
    await perms.setReportAccess({ kind: 'service' }, 'race2', { inherit: false, grants: [{ to: 'group:editors', level: 'edit' }] });
    await users.updateUser('bob@x.io', { groups: ['Editors'] });
    try {
      expect(await store().lease('lock:report:race2', 'revoker', 30000)).toBe(true);
      const put = R.one.PUT(req('/api/reports/race2', { who: 'bob', method: 'PUT', body: def('Bob was here') }), P('race2'));
      await new Promise(r => setTimeout(r, 150));
      // another server takes bob out of Editors while his save waits (straight to storage: this server's cache is stale)
      const u = JSON.parse(await store().get('users', 'bob@x.io'));
      await store().put('users', 'bob@x.io', JSON.stringify({ ...u, groups: [] }));
      await store().release('lock:report:race2', 'revoker');
      expect((await put).status).toBe(404);
      expect((await json(await R.one.GET(req('/api/reports/race2', { who: 'admin' }), P('race2')))).body.sections.body.items[0].value).toBe('Race 2');
    } finally {
      await users.updateUser('bob@x.io', { groups: [] });
      await R.one.DELETE(req('/api/reports/race2', { who: 'admin', method: 'DELETE' }), P('race2'));
    }
  });

  it('review: a thumbnail never shows a subreport after access to it is gone', async () => {
    await perms.setReportAccess({ kind: 'service' }, 'overview', { grants: [] });
    const first = await (await thumbOf('carol', 'overview')).text();
    expect(first).toContain('Salary');
    await users.updateUser('carol@x.io', { groups: [] });
    try {
      const after = await (await thumbOf('carol', 'overview')).text();
      expect(after).not.toContain('Salary');
    } finally { await users.updateUser('carol@x.io', { groups: ['Finance'] }); }
  });

  it('review: a thumbnail is checked on every request: revoked view is 404 even when one was drawn', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    await designerSaves('pic', def('Picture'));
    await perms.setReportAccess({ kind: 'service' }, 'pic', { inherit: false, grants: [{ to: 'user:dan@x.io', level: 'view' }] });
    const res = await thumbOf('dan', 'pic');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Picture');
    await perms.setReportAccess({ kind: 'service' }, 'pic', { grants: [] });
    expect((await thumb.GET(req('/api/reports/pic/thumb', { who: 'dan' }), P('pic'))).status).toBe(404);
    await R.one.DELETE(req('/api/reports/pic', { who: 'admin', method: 'DELETE' }), P('pic'));
  });

  it('review: thumbnails: a revoke between queue and serve, two users with different subreport access', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    const { thumbsIdle } = await import('../../src/server/thumbs.js');
    const id = `two-${kind}`;
    await designerSaves(id, def('Two', [{ type: 'subreport', name: 'Sub', x: 0, y: 0, w: 300, h: 40, report: 'salary' }]));
    await perms.setReportAccess({ kind: 'service' }, id, { inherit: false, grants: [{ to: 'user:carol@x.io', level: 'view' }, { to: 'user:dan@x.io', level: 'view' }] });
    try {
      // carol (Finance) sees the salary subreport, dan does not: the same report, two drawings
      expect(await (await thumbOf('carol', id)).text()).toContain('Salary');
      expect(await (await thumbOf('dan', id)).text()).not.toContain('Salary');
      // queued while carol could see the subreport, drawn after she lost it: never served
      await designerSaves(id, def('Two b', [{ type: 'subreport', name: 'Sub', x: 0, y: 0, w: 300, h: 40, report: 'salary' }]));
      expect((await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'carol' }), P(id))).status).toBe(202);
      await users.updateUser('carol@x.io', { groups: [] });
      await thumbsIdle();
      expect(await (await thumbOf('carol', id)).text()).not.toContain('Salary');
      // queued with view on the report, served after it was revoked: 404
      await users.updateUser('carol@x.io', { groups: ['Finance'] });
      expect((await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'carol' }), P(id))).status).toBe(202);
      await perms.setReportAccess({ kind: 'service' }, id, { grants: [{ to: 'user:dan@x.io', level: 'view' }] });
      await thumbsIdle();
      expect((await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'carol' }), P(id))).status).toBe(404);
    } finally {
      await users.updateUser('carol@x.io', { groups: ['Finance'] });
      await R.one.DELETE(req(`/api/reports/${id}`, { who: 'admin', method: 'DELETE' }), P(id));
    }
  });

  it('review: thumbnails: content pulled from another report by a master is not served after access to it is gone', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    const id = `mst-${kind}`;
    await designerSaves(id, { ...def('Child'), master: 'salary' });
    await perms.setReportAccess({ kind: 'service' }, id, { inherit: false, grants: [{ to: 'user:carol@x.io', level: 'view' }] });
    try {
      expect(await (await thumbOf('carol', id)).text()).toContain('Salary');
      await users.updateUser('carol@x.io', { groups: [] });
      expect(await (await thumbOf('carol', id)).text()).not.toContain('Salary');
    } finally {
      await users.updateUser('carol@x.io', { groups: ['Finance'] });
      await R.one.DELETE(req(`/api/reports/${id}`, { who: 'admin', method: 'DELETE' }), P(id));
    }
  });

  it('review: thumbnails: a grant changed (and changed back) while one is drawn is not cached', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    const { thumbsIdle } = await import('../../src/server/thumbs.js');
    const id = `mid-${kind}`;
    const rows = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    await designerSaves(id, { ...def('Mid', [
      { type: 'subreport', name: 'Sub', x: 0, y: 0, w: 300, h: 40, report: 'salary' },
      { type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 50, w: 500, h: 40, columns: [{ width: 500 }], detail: [{ height: 14, cells: [{ value: '=Len(Replace(Space(200000), " ", "ab"))' }] }] },
    ]), dataSources: [{ name: 'src', type: 'json', data: { rows } }], dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }] });
    try {
      expect((await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'dan' }), P(id))).status).toBe(202);
      await new Promise(r => setTimeout(r, 200)); // drawing now
      await perms.setReportAccess({ kind: 'service' }, 'salary', { grants: [{ to: 'user:dan@x.io', level: 'view' }] });
      await perms.setReportAccess({ kind: 'service' }, 'salary', { grants: [] }); // and back: the same grants as before
      await thumbsIdle();
      expect((await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'dan' }), P(id))).status).toBe(202); // drawn again, not served
    } finally { await thumbsIdle(); await R.one.DELETE(req(`/api/reports/${id}`, { who: 'admin', method: 'DELETE' }), P(id)); }
  }, 60000);

  it('review: a thumbnail worker that dies mid-drawing is not remembered as a broken thumbnail', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    const { thumbsIdle } = await import('../../src/server/thumbs.js');
    const id = `crash-${kind}`;
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    await designerSaves(id, { ...def('Crash', [{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 500, h: 40, columns: [{ width: 500 }], detail: [{ height: 14, cells: [{ value: '=Len(Replace(Space(200000), " ", "ab"))' }] }] }]),
      dataSources: [{ name: 'src', type: 'json', data: { rows } }], dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }] });
    try {
      await thumbsIdle();
      expect((await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'admin' }), P(id))).status).toBe(202);
      let slot;
      while (!(slot = globalThis.__pwRenderPool.slots.find(s => s.job))) await new Promise(r => setTimeout(r, 20));
      await slot.w.terminate(); // the render worker dies while drawing
      await thumbsIdle();
      expect((await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'admin' }), P(id))).status).toBe(202); // drawn again, not a cached 500
    } finally { await thumbsIdle(); await R.one.DELETE(req(`/api/reports/${id}`, { who: 'admin', method: 'DELETE' }), P(id)); }
  }, 60000);

  it('review: a heavy thumbnail is drawn off the event loop, under the time limit, once for many saves', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    const { thumbsIdle } = await import('../../src/server/thumbs.js');
    const rows = Array.from({ length: 3000 }, (_, i) => ({ id: i }));
    // every row builds ten 900 kB strings: seconds of work on one thread even for page 1 alone (thumbnails lay out the
    // first page only), stopped by the render time limit
    const heavy = (n) => ({ ...def(`Heavy ${n}`, [{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 500, h: 40, columns: [{ width: 250 }, { width: 250 }],
      detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=' + Array(10).fill('Len(Replace(Space(450000), " ", "ab"))').join(' + ') }] }] }]),
      dataSources: [{ name: 'src', type: 'json', data: { rows } }], dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }] });
    const id = `heavy-${kind}`; // the thumbnail cache is per process: one id per backend
    const keep = process.env.PW_RENDER_TIMEOUT_MS;
    process.env.PW_RENDER_TIMEOUT_MS = '1500';
    try {
      await designerSaves(id, heavy(0));
      await thumbsIdle();
      const g = globalThis.__pwThumbJobs;
      const before = g.seq;
      let gap = 0, last = Date.now();
      const tick = setInterval(() => { gap = Math.max(gap, Date.now() - last); last = Date.now(); }, 10);
      const t0 = Date.now();
      expect((await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'admin' }), P(id))).status).toBe(202);
      expect(Date.now() - t0).toBeLessThan(1000); // the request does not wait for the drawing
      // five saves while it draws: the newest waits, the ones in between are never drawn
      for (let n = 1; n <= 5; n++) { await designerSaves(id, heavy(n)); expect((await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'admin' }), P(id))).status).toBe(202); }
      await thumbsIdle();
      clearInterval(tick);
      expect(gap).toBeLessThan(500); // the event loop kept turning
      expect(g.seq - before).toBe(2); // the first version, then only the newest
      const res = await thumb.GET(req(`/api/reports/${id}/thumb`, { who: 'admin' }), P(id));
      expect(res.status).toBe(504); // the time limit, as for any server render
    } finally {
      if (keep === undefined) delete process.env.PW_RENDER_TIMEOUT_MS; else process.env.PW_RENDER_TIMEOUT_MS = keep;
      await R.one.DELETE(req(`/api/reports/${id}`, { who: 'admin', method: 'DELETE' }), P(id));
    }
  }, 60000);

  it('review: a lost folder or a folder loop gives nothing, not the top-level grants', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const { writeReport } = await import('../../src/server/reports.js');
    await designerSaves('lost', def('Lost'));
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
    const svc = { kind: 'service', key: (await import('node:crypto')).createHash('sha256').update('svc-key').digest('hex').slice(0, 8) };
    const s = await createSchedule({ template: 'salary', cron: '0 7 * * *', items: [{ parameters: {} }], output: { type: 'none' } }, svc);
    process.env.PW_API_KEYS = keep.replace('svc-key,', ''); // the key is taken out of service
    try { await expect(runSchedule(s)).rejects.toMatchObject({ status: 404 }); } finally { process.env.PW_API_KEYS = keep; }
  });

  it('review: a user key cannot overwrite shared batch output, and a viewer cannot push data', async () => {
    const { createBatch, workOnce, getJob } = await import('../../src/server/jobs.js');
    const svc = { kind: 'service' };
    const run = async (p) => {
      const job = await createBatch({ template: 'overview', items: [{ name: 'invoice-1001', parameters: {} }], output: { type: 'folder', folder: 'payroll-slips' }, format: 'csv' }, undefined, p);
      await workOnce('test-runner');
      return (await getJob(job.id, svc)).folder;
    };
    const shared = await run(svc);
    const bobs = await run({ ...(await perms.userPrincipal('bob@x.io')), viaKey: keyId('bob-key') });
    expect(shared).toMatch(/outputs[\\/]payroll-slips$/);
    expect(bobs).not.toBe(shared);
    expect(bobs).toMatch(/outputs[\\/]users[\\/][0-9a-f]{16}[\\/]payroll-slips$/);
    // pushed data replaces the report's data sources: not for viewers (a render of made-up rows under the report's name)
    const render = (key, extra) => v1.render.POST(req('/api/v1/render', { key, method: 'POST', body: { template: 'overview', format: 'csv', ...extra } }));
    expect((await render('carol-key', { data: { db: [{ n: 9 }] } })).status).toBe(403);
    expect((await v1.batches.POST(req('/api/v1/batches', { key: 'carol-key', method: 'POST', body: { template: 'overview', items: [{ parameters: {}, data: { db: [{ n: 9 }] } }] } }))).status).toBe(403);
    expect((await render('bob-key', { data: { db: [{ n: 9 }] } })).status).toBe(200);
    for (const f of [shared, bobs]) fs.rmSync(path.resolve(f), { recursive: true, force: true });
    fs.rmSync(path.resolve(path.dirname(path.dirname(bobs))), { recursive: true, force: true }); // outputs/users
  });

  it('review: reading a report through the API is audited (definition and thumbnail)', async () => {
    const { queryAudit } = await import('../../src/server/audit.js');
    const before = (await queryAudit({ type: 'report.view', actor: 'user:carol@x.io', limit: 500 })).length;
    expect((await R.one.GET(req('/api/reports/salary', { who: 'carol' }), P('salary'))).status).toBe(200);
    expect((await thumbOf('carol', 'salary')).status).toBe(200);
    const events = await queryAudit({ type: 'report.view', actor: 'user:carol@x.io', limit: 500 });
    expect(events.length - before).toBe(2);
    expect(events.slice(0, 2).map(e => e.detail?.via).sort()).toEqual(['api', 'thumbnail']);
    expect(events[0].report).toBe('salary');
  });

  it('review: a running batch stops at the next item when its owner loses access', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    const { createBatch, workOnce, getJob } = await import('../../src/server/jobs.js');
    const id = `long-${kind}`;
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: i }));
    await designerSaves(id, { ...def('Long', [{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 500, h: 40, columns: [{ width: 500 }], detail: [{ height: 14, cells: [{ value: '=Len(Replace(Space(200000), " ", "ab"))' }] }] }]),
      dataSources: [{ name: 'src', type: 'json', data: { rows } }], dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }] });
    await perms.setReportAccess({ kind: 'service' }, id, { inherit: false, grants: [{ to: 'user:bob@x.io', level: 'view' }] });
    try {
      const job = await createBatch({ template: id, items: Array.from({ length: 12 }, (_, n) => ({ name: `i${n}`, parameters: {} })), output: { type: 'none' }, format: 'csv' }, undefined, { ...(await perms.userPrincipal('bob@x.io')), viaKey: keyId('bob-key') });
      const working = workOnce('test-runner');
      while (!((await getJob(job.id, { kind: 'service' }))?.done >= 1)) await new Promise(r => setTimeout(r, 20));
      await perms.setReportAccess({ kind: 'service' }, id, { grants: [] }); // bob loses the report mid-run
      await working;
      const j = await getJob(job.id, { kind: 'service' });
      expect(j.done).toBeLessThan(8); // what finished or was rendering when access ended (timing), not all 12
      expect(j.failed).toBe(12 - j.done);
      expect(j.errors.at(-1)).toMatch(/may no longer run/);
    } finally { await R.one.DELETE(req(`/api/reports/${id}`, { who: 'admin', method: 'DELETE' }), P(id)); }
  }, 60000);

  it('review: taking a user\'s key out of PW_API_KEYS stops what was scheduled or queued with it', async () => {
    const { runSchedule, getSchedule } = await import('../../src/server/schedules.js');
    const { workOnce, getJob } = await import('../../src/server/jobs.js');
    const keep = process.env.PW_API_KEYS;
    const made = await json(await v1.schedules.POST(req('/api/v1/schedules', { key: 'carol-key', method: 'POST', body: { template: 'salary', cron: '0 7 * * *', items: [{ parameters: {} }], output: { type: 'none' }, ownerKey: 'forged' } })));
    expect(made.status).toBe(201);
    const queued = await json(await v1.batches.POST(req('/api/v1/batches', { key: 'carol-key', method: 'POST', body: { template: 'salary', items: [{ parameters: {} }], output: { type: 'none' }, format: 'csv' } })));
    expect(queued.status).toBe(202);
    process.env.PW_API_KEYS = keep.replace('carol@x.io|carol-key,', ''); // carol stays a user; her leaked key is revoked
    try {
      await expect(runSchedule(await getSchedule(made.body.id, { kind: 'service' }))).rejects.toMatchObject({ status: 404 });
      await workOnce('test-runner');
      expect(await getJob(queued.body.id, { kind: 'service' })).toMatchObject({ status: 'failed' });
    } finally { process.env.PW_API_KEYS = keep; }
    // the same key, still configured: it runs
    const again = await json(await v1.schedules.POST(req('/api/v1/schedules', { key: 'carol-key', method: 'POST', body: { template: 'salary', cron: '0 7 * * *', items: [{ parameters: {} }], output: { type: 'none' } } })));
    const run = await runSchedule(await getSchedule(again.body.id, { kind: 'service' }));
    await workOnce('test-runner');
    expect(await getJob(run.id, { kind: 'service' })).toMatchObject({ status: 'completed' });
  });

  it('review: schedules: owner from the server, other users\' schedules hidden, targets checked, runs as the owner now', async () => {
    const { runSchedule, getSchedule } = await import('../../src/server/schedules.js');
    const { store } = await import('../../src/server/storage/index.js');
    const sch = (key, body, method = 'POST', id = '') => v1[id ? 'schedule' : 'schedules'][method](req(`/api/v1/schedules${id ? `/${id}` : ''}`, { key, method, body }), { params: Promise.resolve({ id }) });
    const base = { template: 'overview', cron: '0 7 * * *', items: [{ parameters: {} }], output: { type: 'none' } };
    // a report the caller may not view: not on create, not by an update
    expect((await sch('bob-key', { ...base, template: 'salary' })).status).toBe(404);
    const mine = await json(await sch('bob-key', { ...base, owner: 'service', ownerKey: 'x' })); // owner fields in the body are ignored
    expect(mine.status).toBe(201);
    const id = mine.body.id;
    expect(JSON.parse(await store().get('schedules', id))).toMatchObject({ owner: 'user:bob@x.io' });
    expect((await sch('bob-key', { template: 'salary' }, 'PUT', id)).status).toBe(404);
    expect((await sch('bob-key', { owner: 'service' }, 'PUT', id)).status).toBe(200);
    expect(JSON.parse(await store().get('schedules', id)).owner).toBe('user:bob@x.io');
    // another user's key sees nothing of it
    expect((await json(await v1.schedules.GET(req('/api/v1/schedules', { key: 'carol-key' })))).body.map(x => x.id)).not.toContain(id);
    for (const m of ['GET', 'PUT', 'DELETE']) expect((await sch('carol-key', m === 'PUT' ? { enabled: false } : undefined, m, id)).status, m).toBe(404);
    // delivery targets: http(s) and not a private or local address, when saved
    for (const bad of [{ webhook: 'http://127.0.0.1:9/x' }, { webhook: 'file:///etc/passwd' }, { items: [{ parameters: {}, putUrl: 'http://169.254.169.254/latest' }] }, { itemsFrom: { url: 'http://10.0.0.1/list' } }]) {
      expect((await sch('bob-key', { ...base, ...bad })).status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
      expect((await sch('bob-key', bad, 'PUT', id)).status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
    }
    // and when it runs (a record changed behind the API): the upload is refused, nothing leaves
    const rec = JSON.parse(await store().get('schedules', id));
    await store().put('schedules', id, JSON.stringify({ ...rec, items: [{ parameters: {}, putUrl: 'http://127.0.0.1:9/steal' }] }));
    await expect(runSchedule(await getSchedule(id, { kind: 'service' }))).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/private or local/) });
    // runs as the owner now: a demoted owner's inline schedule, a deleted owner's schedule
    const inline = await json(await sch('bob-key', { ...base, template: def('Inline') }));
    expect(inline.status).toBe(201);
    await users.updateUser('bob@x.io', { role: 'viewer' });
    try { await expect(runSchedule(await getSchedule(inline.body.id, { kind: 'service' }))).rejects.toMatchObject({ status: 403 }); }
    finally { await users.updateUser('bob@x.io', { role: 'designer' }); }
    await users.createUser({ email: 'gone@x.io', role: 'designer', password: 'a long password' });
    const { createSchedule } = await import('../../src/server/schedules.js');
    const g = await createSchedule(base, await perms.userPrincipal('gone@x.io'));
    await users.deleteUser('gone@x.io');
    await expect(runSchedule(await getSchedule(g.id, { kind: 'service' }))).rejects.toMatchObject({ status: 404 });
    for (const x of [id, inline.body.id, g.id]) await store().remove('schedules', x);
  });

  it('review: a user\'s schedules belong to the key that made them; a record with no key does not run', async () => {
    const { runSchedule, getSchedule } = await import('../../src/server/schedules.js');
    const { store } = await import('../../src/server/storage/index.js');
    const keep = process.env.PW_API_KEYS;
    process.env.PW_API_KEYS = `${keep},carol@x.io|carol-key2`;
    try {
      const base = { template: 'salary', cron: '0 7 * * *', items: [{ parameters: {} }], output: { type: 'none' } };
      const made = await json(await v1.schedules.POST(req('/api/v1/schedules', { key: 'carol-key', method: 'POST', body: base })));
      const id = made.body.id;
      // carol's other key neither sees nor changes it (a leaked second key cannot retarget the first one's schedules)
      expect((await json(await v1.schedules.GET(req('/api/v1/schedules', { key: 'carol-key2' })))).body.map(x => x.id)).not.toContain(id);
      expect((await v1.schedule.PUT(req(`/api/v1/schedules/${id}`, { key: 'carol-key2', method: 'PUT', body: { webhook: 'https://example.com/hook' } }), P(id))).status).toBe(404);
      expect((await v1.schedule.GET(req(`/api/v1/schedules/${id}`, { key: 'carol-key' }), P(id))).status).toBe(200);
      // a user's record with no key (made before keys were recorded) is no one's
      const rec = JSON.parse(await store().get('schedules', id));
      await store().put('schedules', id, JSON.stringify({ ...rec, ownerKey: null }));
      await expect(runSchedule(await getSchedule(id, { kind: 'service' }))).rejects.toMatchObject({ status: 404 });
      await store().remove('schedules', id);
    } finally { process.env.PW_API_KEYS = keep; }
  });

  it('review: a queued inline batch fails when its owner is now a viewer', async () => {
    const { createBatch, workOnce, getJob } = await import('../../src/server/jobs.js');
    const job = await createBatch({ template: def('Inline'), items: [{ parameters: {} }], output: { type: 'none' }, format: 'csv' }, undefined, { ...(await perms.userPrincipal('bob@x.io')), viaKey: keyId('bob-key') });
    await users.updateUser('bob@x.io', { role: 'viewer' });
    try {
      await workOnce('test-runner');
      expect(await getJob(job.id, { kind: 'service' })).toMatchObject({ status: 'failed' });
    } finally { await users.updateUser('bob@x.io', { role: 'designer' }); }
  });

  it('review: a missing, partial, legacy or stale principal gets nothing with accounts on', async () => {
    const crypto = await import('node:crypto');
    const svcId = crypto.createHash('sha256').update('svc-key').digest('hex').slice(0, 8);
    const bad = [undefined, null, {}, { kind: 'bogus' }, { kind: 'open' }, { kind: 'user' }, { kind: 'user', email: 'bob@x.io' },
      { kind: 'user', email: 'bob@x.io', role: 'superuser', groups: [] }, { kind: 'user', email: 'nobody@x.io', role: 'admin', groups: [] },
      { kind: 'user', email: 'bob@x.io', role: 'admin', groups: 'Finance' }, { kind: 'service', key: 'deadbeef' }, { kind: 'service', key: 42 }, { kind: 'anon' }];
    for (const p of bad) {
      for (const need of ['view', 'edit', 'manage']) await expect(perms.checkReport(p, 'salary', need), `${JSON.stringify(p)} ${need}`).rejects.toMatchObject({ status: 404 });
      await expect(perms.canCreateIn(p, null), JSON.stringify(p)).rejects.toMatchObject({ status: 403 });
      await expect(perms.setReportAccess(p, 'salary', { grants: [] }), JSON.stringify(p)).rejects.toMatchObject({ status: 404 });
      await expect(perms.updateFolder(p, 'root', { grants: [] }), JSON.stringify(p)).rejects.toMatchObject({ status: 403 });
      expect(await perms.visibleReports(p, [{ id: 'salary' }, { id: 'overview' }]), JSON.stringify(p)).toEqual([]);
    }
    // a role in the principal is not trusted over the stored user: bob as "admin" is still bob
    await expect(perms.checkReport({ kind: 'user', email: 'bob@x.io', role: 'admin', groups: [] }, 'salary', 'view')).rejects.toMatchObject({ status: 404 });
    // a service key that is configured now manages everything (documented); the same with no key id is the server itself
    for (const need of ['view', 'edit', 'manage']) expect(await perms.checkReport({ kind: 'service', key: svcId }, 'salary', need)).toBe('manage');
    // schedules and batches: a missing principal sees nothing, a record with no owner is no one's
    const { listSchedules } = await import('../../src/server/schedules.js');
    const { listJobs } = await import('../../src/server/jobs.js');
    const { store } = await import('../../src/server/storage/index.js');
    await store().put('schedules', 's_legacy01', JSON.stringify({ id: 's_legacy01', template: 'salary', cron: '0 7 * * *', items: [{ parameters: {} }], enabled: true, timezone: 'UTC', format: 'pdf' }));
    try {
      expect(await listSchedules()).toEqual([]);
      expect(await listSchedules({ kind: 'open' })).toEqual([]);
      expect(await listJobs()).toEqual([]);
      const { runSchedule } = await import('../../src/server/schedules.js');
      await expect(runSchedule({ id: 's_legacy01', template: 'salary', items: [{ parameters: {} }] })).rejects.toMatchObject({ status: 404 }); // runs as no one
      const { loadTemplate } = await import('../../src/server/renderer.js');
      await expect(loadTemplate(def('Inline'), { kind: 'open' })).rejects.toMatchObject({ status: 403 });
      await expect(loadTemplate(def('Inline'), undefined)).rejects.toMatchObject({ status: 403 });
    } finally { await store().remove('schedules', 's_legacy01'); }
  });

  it('a deleted report takes its permissions with it: a new report with the same id starts fresh', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    await designerSaves('temp', def('Temp'));
    await perms.setReportAccess({ kind: 'service' }, 'temp', { grants: [{ to: 'user:bob@x.io', level: 'manage' }] });
    expect((await R.one.DELETE(req('/api/reports/temp', { who: 'admin', method: 'DELETE' }), P('temp'))).status).toBe(200);
    expect((await perms.snapshot()).reports.has('temp')).toBe(false);
  });
});
