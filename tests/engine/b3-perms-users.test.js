// Permissions between users, through the real route handlers (SQLite storage), with seeded users: an admin, designers
// Amy and Ben, a viewer Val and Gus (a viewer in the Sales group). Folder and report shares at view / edit / manage,
// inheritance, revoke taking effect on the next request, a viewer never designs, a private report hides everything
// that hangs off it (thumbnail, versions, exports, batches and their output, schedules), and API keys acting as a
// user get exactly that user's access.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-b3perms-'));
const ENV = {
  PW_AUTH: 'users', PW_SESSION_SECRET: 'y'.repeat(40), PW_STORAGE: `sqlite:${path.join(tmp, 'pw.db')}`,
  PW_API_KEYS: 'amy@x.io|amy-key,ben@x.io|ben-key,val@x.io|val-key,gus@x.io|gus-key',
};
const saved = {};
const BASE = 'http://pw.test';
const P = (id) => ({ params: Promise.resolve({ id }) });
const def = (name) => ({ $schema: 'reportwright/report@1', name, page: { size: 'A4', margins: [36, 36, 36, 36] }, dataSources: [], dataSets: [], sections: { body: { items: [{ type: 'textbox', x: 0, y: 0, w: 200, h: 16, value: name }] } } });

let cookie = {}, R, users, perms, store;
const req = (p, { method = 'GET', who, key, body } = {}) => new Request(BASE + p, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: { origin: BASE, ...(who && { cookie: cookie[who] }), ...(key && { authorization: `Bearer ${key}` }), ...(body !== undefined && { 'content-type': 'application/json' }), ...(method === 'PUT' && /^\/api\/reports\/[^/]+$/.test(p) && { 'if-match': '*' }) },
});
const st = async (res) => (await res).status;
const json = async (res) => (await res).json();
const thumbOf = async (who, id) => {
  const { thumbsIdle } = await import('../../src/server/thumbs.js');
  let res = await R.thumb.GET(req(`/api/reports/${id}/thumb`, { who }), P(id));
  for (let i = 0; res.status === 202 && i < 5; i++) { await thumbsIdle(); res = await R.thumb.GET(req(`/api/reports/${id}/thumb`, { who }), P(id)); }
  return res;
};
const listIds = async (who) => (await json(R.list.GET(req('/api/reports', { who })))).map(r => `${r.id}:${r.access}`).sort();
const save = (who, id, name) => st(R.one.PUT(req(`/api/reports/${id}`, { who, method: 'PUT', body: def(name) }), P(id)));
// grants replace the report's list: Amy keeps her own manage grant in every share she sends
const AMY = { to: 'user:amy@x.io', level: 'manage' };
const share = (who, id, body) => st(R.access.PUT(req(`/api/reports/${id}/access`, { who, method: 'PUT', body: body.grants ? { ...body, grants: [AMY, ...body.grants] } : body }), P(id)));

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  ({ store } = await import('../../src/server/storage/index.js'));
  for (const k of ['reports', 'users', 'folders', 'reportacl', 'schedules', 'jobs']) for (const id of await store().ids(k)) await store().remove(k, id);
  users = await import('../../src/server/users.js');
  perms = await import('../../src/server/perms.js');
  const session = await import('../../src/server/session.js');
  R = {
    list: await import('../../app/api/reports/route.js'),
    one: await import('../../app/api/reports/[id]/route.js'),
    versions: await import('../../app/api/reports/[id]/versions/route.js'),
    pdf: await import('../../app/api/reports/[id]/pdf/route.js'),
    thumb: await import('../../app/api/reports/[id]/thumb/route.js'),
    access: await import('../../app/api/reports/[id]/access/route.js'),
    folders: await import('../../app/api/folders/route.js'),
    folder: await import('../../app/api/folders/[id]/route.js'),
    render: await import('../../app/api/v1/render/route.js'),
    templates: await import('../../app/api/v1/templates/route.js'),
    batches: await import('../../app/api/v1/batches/route.js'),
    batch: await import('../../app/api/v1/batches/[id]/route.js'),
    download: await import('../../app/api/v1/batches/[id]/download/route.js'),
    schedules: await import('../../app/api/v1/schedules/route.js'),
    schedule: await import('../../app/api/v1/schedules/[id]/route.js'),
  };
  for (const [email, role, groups] of [['admin@x.io', 'admin', []], ['amy@x.io', 'designer', []], ['ben@x.io', 'designer', []], ['val@x.io', 'viewer', []], ['gus@x.io', 'viewer', ['Sales']]]) {
    await users.createUser({ email, role, password: 'a long password', groups });
    cookie[email.split('@')[0]] = session.sessionCookie(new Request(BASE), await users.getUser(email)).split(';')[0];
  }
}, 60000);
afterAll(() => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('permissions between users (route handlers, SQLite)', () => {
  let sales, made;
  it('folder shares: view, edit and manage, inherited by the reports inside', async () => {
    const f = await R.folders.POST(req('/api/folders', { who: 'admin', method: 'POST', body: { name: 'Sales' } }));
    expect(f.status).toBeLessThan(300);
    sales = (await f.json()).id;
    expect(await st(R.folder.PATCH(req(`/api/folders/${sales}`, { who: 'admin', method: 'PATCH', body: { inherit: false, grants: [{ to: 'group:sales', level: 'view' }, { to: 'user:ben@x.io', level: 'edit' }, { to: 'user:amy@x.io', level: 'manage' }] } }), P(sales)))).toBe(200);
    const r = await R.list.POST(req('/api/reports', { who: 'amy', method: 'POST', body: { name: 'Pipeline', folder: sales } }));
    expect(r.status).toBe(201);
    made = (await r.json()).id;
    expect(await save('amy', made, 'Pipeline v1')).toBe(200);
    expect(await listIds('gus')).toEqual([`${made}:view`]); // through the Sales group
    expect(await listIds('val')).toEqual([]); // not in the folder's shares
    expect(await listIds('ben')).toContain(`${made}:edit`);
    expect(await listIds('amy')).toContain(`${made}:manage`);
    // view: reads and renders, never writes
    expect(await st(R.one.GET(req(`/api/reports/${made}`, { who: 'gus' }), P(made)))).toBe(200);
    expect(await st(R.pdf.GET(req(`/api/reports/${made}/pdf`, { who: 'gus' }), P(made)))).toBe(200);
    expect(await save('gus', made, 'x')).toBe(403);
    // edit: saves and sees versions, but cannot share, move or delete
    expect(await save('ben', made, 'Pipeline v2')).toBe(200);
    expect(await st(R.versions.GET(req(`/api/reports/${made}/versions`, { who: 'ben' }), P(made)))).toBe(200);
    expect(await share('ben', made, { grants: [{ to: 'user:val@x.io', level: 'view' }] })).toBe(403);
    expect(await st(R.one.DELETE(req(`/api/reports/${made}`, { who: 'ben', method: 'DELETE' }), P(made)))).toBe(403);
    // manage on the folder: Amy changes its shares; Ben cannot
    expect(await st(R.folder.PATCH(req(`/api/folders/${sales}`, { who: 'ben', method: 'PATCH', body: { name: 'Mine' } }), P(sales)))).toBe(403);
  });

  it('report shares add to the folder\'s; breaking inheritance drops the folder\'s; a revoke works on the next request', async () => {
    expect(await share('amy', made, { grants: [{ to: 'user:val@x.io', level: 'view' }] })).toBe(200);
    expect(await listIds('val')).toEqual([`${made}:view`]);
    expect(await listIds('gus')).toEqual([`${made}:view`]); // the folder's share still applies
    expect(await share('amy', made, { inherit: false, grants: [{ to: 'user:val@x.io', level: 'view' }] })).toBe(200);
    expect(await st(R.one.GET(req(`/api/reports/${made}`, { who: 'gus' }), P(made)))).toBe(404);
    expect(await save('ben', made, 'x')).toBe(404); // Ben's edit came from the folder
    expect(await st(R.one.GET(req(`/api/reports/${made}`, { who: 'amy' }), P(made)))).toBe(200); // the creator keeps manage
    // revoke: Val's share goes, the very next request is "not found", by cookie and by key
    expect(await st(R.one.GET(req(`/api/reports/${made}`, { who: 'val' }), P(made)))).toBe(200);
    expect(await share('amy', made, { grants: [] })).toBe(200);
    expect(await st(R.one.GET(req(`/api/reports/${made}`, { who: 'val' }), P(made)))).toBe(404);
    expect(await st(R.render.POST(req('/api/v1/render', { key: 'val-key', method: 'POST', body: { template: made, format: 'csv' } })))).toBe(404);
    // a group revoke: Gus leaves Sales, the folder share no longer reaches him
    expect(await share('amy', made, { inherit: true })).toBe(200);
    expect(await st(R.one.GET(req(`/api/reports/${made}`, { who: 'gus' }), P(made)))).toBe(200);
    await users.updateUser('gus@x.io', { groups: [] });
    expect(await st(R.one.GET(req(`/api/reports/${made}`, { who: 'gus' }), P(made)))).toBe(404);
    await users.updateUser('gus@x.io', { groups: ['Sales'] });
  });

  it('a viewer cannot design or save, even with a manage share', async () => {
    expect(await share('amy', made, { grants: [{ to: 'user:val@x.io', level: 'manage' }] })).toBe(200);
    expect(await st(R.list.POST(req('/api/reports', { who: 'val', method: 'POST', body: { name: 'Mine', folder: sales } })))).toBe(403);
    expect(await save('val', made, 'Val was here')).toBe(403);
    expect(await save('val', 'val-new', 'New')).not.toBe(200);
    expect(await st(R.render.POST(req('/api/v1/render', { key: 'val-key', method: 'POST', body: { template: def('Inline'), format: 'csv' } })))).toBe(403); // an inline definition is designing
    expect((await json(R.one.GET(req(`/api/reports/${made}`, { who: 'amy' }), P(made)))).name).toBe('Pipeline v2');
    expect(await share('amy', made, { grants: [] })).toBe(200);
  });

  it('Ben sees nothing of Amy\'s private report: definition, thumbnail, versions, exports, batches, their output, schedules', async () => {
    const r = await R.list.POST(req('/api/reports', { who: 'amy', method: 'POST', body: { name: 'Private' } }));
    expect(r.status).toBe(201);
    const id = (await r.json()).id;
    expect(await save('amy', id, 'Private v1')).toBe(200);
    expect(await save('amy', id, 'Private v2')).toBe(200);
    expect(await listIds('ben')).toContain(`${id}:view`); // the default: other designers view
    expect(await share('amy', id, { inherit: false, grants: [] })).toBe(200);
    expect((await thumbOf('amy', id)).status).toBe(200); // drawn and cached for Amy
    // Amy's own batch and schedule on it
    const b = await R.batches.POST(req('/api/v1/batches', { key: 'amy-key', method: 'POST', body: { template: id, format: 'csv', items: [{ parameters: {} }], output: { type: 'zip' } } }));
    expect(b.status).toBeLessThan(300);
    const bid = (await b.json()).id;
    const { workOnce } = await import('../../src/server/jobs.js');
    await workOnce('test-runner');
    expect(await st(R.download.GET(req(`/api/v1/batches/${bid}/download`, { key: 'amy-key' }), P(bid)))).toBe(200);
    const s = await R.schedules.POST(req('/api/v1/schedules', { key: 'amy-key', method: 'POST', body: { template: id, cron: '0 7 * * *', items: [{ parameters: {} }], output: { type: 'none' } } }));
    expect(s.status).toBe(201);
    const sid = (await s.json()).id;

    expect(await listIds('ben')).not.toContain(`${id}:view`);
    for (const [what, res] of [
      ['definition', R.one.GET(req(`/api/reports/${id}`, { who: 'ben' }), P(id))],
      ['thumbnail', thumbOf('ben', id)],
      ['versions', R.versions.GET(req(`/api/reports/${id}/versions`, { who: 'ben' }), P(id))],
      ['pdf', R.pdf.GET(req(`/api/reports/${id}/pdf`, { who: 'ben' }), P(id))],
      ['xlsx', R.pdf.GET(req(`/api/reports/${id}/pdf?format=xlsx`, { who: 'ben' }), P(id))],
      ['csv', R.pdf.GET(req(`/api/reports/${id}/pdf?format=csv`, { who: 'ben' }), P(id))],
      ['access', R.access.GET(req(`/api/reports/${id}/access`, { who: 'ben' }), P(id))],
      ['render by key', R.render.POST(req('/api/v1/render', { key: 'ben-key', method: 'POST', body: { template: id, format: 'pdf' } }))],
      ['an old version by key', R.render.POST(req('/api/v1/render', { key: 'ben-key', method: 'POST', body: { template: `${id}@20200101T000000000`, format: 'csv' } }))],
      ['a batch on it', R.batches.POST(req('/api/v1/batches', { key: 'ben-key', method: 'POST', body: { template: id, items: [{ parameters: {} }] } }))],
      ['Amy\'s batch', R.batch.GET(req(`/api/v1/batches/${bid}`, { key: 'ben-key' }), P(bid))],
      ['Amy\'s batch output', R.download.GET(req(`/api/v1/batches/${bid}/download`, { key: 'ben-key' }), P(bid))],
      ['a schedule on it', R.schedules.POST(req('/api/v1/schedules', { key: 'ben-key', method: 'POST', body: { template: id, cron: '0 7 * * *', items: [{ parameters: {} }] } }))],
      ['Amy\'s schedule', R.schedule.GET(req(`/api/v1/schedules/${sid}`, { key: 'ben-key' }), P(sid))],
      ['Amy\'s schedule, changed', R.schedule.PUT(req(`/api/v1/schedules/${sid}`, { key: 'ben-key', method: 'PUT', body: { enabled: false } }), P(sid))],
      ['Amy\'s schedule, deleted', R.schedule.DELETE(req(`/api/v1/schedules/${sid}`, { key: 'ben-key', method: 'DELETE' }), P(sid))],
    ]) expect(await st(res), what).toBe(404);
    expect((await json(R.templates.GET(req('/api/v1/templates', { key: 'ben-key' })))).map(t => t.id)).not.toContain(id);
    expect((await json(R.schedules.GET(req('/api/v1/schedules', { key: 'ben-key' })))).map(t => t.id)).not.toContain(sid);
    // and the schedule is still there for Amy
    expect(await st(R.schedule.GET(req(`/api/v1/schedules/${sid}`, { key: 'amy-key' }), P(sid)))).toBe(200);
  }, 60000);

  it('an API key acting as a user is limited exactly as the user: share, revoke, role', async () => {
    const tpl = async (key) => (await json(R.templates.GET(req('/api/v1/templates', { key })))).map(t => t.id);
    const render = (key) => st(R.render.POST(req('/api/v1/render', { key, method: 'POST', body: { template: made, format: 'csv' } })));
    expect(await tpl('gus-key')).toEqual([made]); // Sales folder
    expect(await render('gus-key')).toBe(200);
    expect(await tpl('val-key')).toEqual([]);
    expect(await render('val-key')).toBe(404);
    await users.updateUser('gus@x.io', { groups: [] });
    expect(await render('gus-key')).toBe(404);
    expect(await tpl('gus-key')).toEqual([]);
    await users.updateUser('gus@x.io', { groups: ['Sales'] });
    // a designer demoted to viewer loses designing through the key at once
    expect(await st(R.render.POST(req('/api/v1/render', { key: 'ben-key', method: 'POST', body: { template: def('Inline'), format: 'csv' } })))).toBe(200);
    await users.updateUser('ben@x.io', { role: 'viewer' });
    try { expect(await st(R.render.POST(req('/api/v1/render', { key: 'ben-key', method: 'POST', body: { template: def('Inline'), format: 'csv' } })))).toBe(403); }
    finally { await users.updateUser('ben@x.io', { role: 'designer' }); }
  });
});
