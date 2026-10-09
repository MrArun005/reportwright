// Review finding on 17cd05f: a thumbnail is shared between viewers of one access class only when its drawing cannot
// differ per viewer (thumbs.principalIndependent, checked at render time over every report it loaded).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const keep = { ...process.env };
let thumbs, users, perms;
const P = (e) => perms.userPrincipal(e);
beforeAll(async () => {
  Object.assign(process.env, { PW_AUTH: 'users', PW_SESSION_SECRET: 'r3b-share-'.padEnd(48, 'x'), PW_RENDER_WORKERS: '0', PW_STORAGE: `sqlite:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-share-')), 's.db')}` });
  thumbs = await import('../../src/server/thumbs.js'); users = await import('../../src/server/users.js'); perms = await import('../../src/server/perms.js');
  for (const e of ['a@x.io', 'b@x.io']) await users.createUser({ email: e, role: 'viewer', groups: ['sales'], password: 'a long password 1' });
});
afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); });

const def = (value, extra = {}) => ({ $schema: 'reportwright/report@1', name: 'T', page: { size: 'A4', margins: [36, 36, 36, 36] }, sections: { body: { height: 100, items: [{ type: 'textbox', name: 'T1', x: 0, y: 0, w: 200, h: 20, value }] } }, ...extra });
const draw = async (id, d, e) => { let t = await thumbs.thumbnail(id, d, await P(e), 'http://pw.test'); for (let i = 0; t.pending && i < 5; i++) { await thumbsIdle(); t = await thumbs.thumbnail(id, d, await P(e), 'http://pw.test'); } return t; };
const thumbsIdle = () => thumbs.thumbsIdle();
const queued = () => globalThis.__pwThumbJobs.seq;

describe('thumbnail sharing', () => {
  it('the check: anything naming the user, a source with headers or credentials, an unknown type is dependent', () => {
    expect(thumbs.principalIndependent(def('Static text'))).toBe(true);
    expect(thumbs.principalIndependent(def('=User!UserID'))).toBe(false);
    expect(thumbs.principalIndependent(def('x', { parameters: [{ name: 'who', default: '=Globals!User' }] }))).toBe(false);
    expect(thumbs.principalIndependent(def('x', { dataSources: [{ name: 's', type: 'rest', url: 'https://a.example/x', headers: { authorization: 'Bearer =Parameters.t' } }] }))).toBe(false);
    expect(thumbs.principalIndependent(def('x', { dataSources: [{ name: 's', type: 'sql', connection: 'main', query: 'select * from t where owner = @user' }] }))).toBe(false);
    expect(thumbs.principalIndependent(def('x', { dataSources: [{ name: 's', type: 'ldap' }] }))).toBe(false);
    expect(thumbs.principalIndependent(null)).toBe(false);
  });
  it('a static report is drawn once for two viewers of the same class', async () => {
    const d = def('Static text');
    const n0 = queued();
    expect((await draw('static', d, 'a@x.io')).svg).toBeTruthy();
    const n1 = queued();
    expect((await draw('static', d, 'b@x.io')).svg).toBeTruthy();
    expect(n1 - n0).toBe(1);
    expect(queued()).toBe(n1); // b got a's drawing
  });
  it('a user-dependent report is drawn per viewer', async () => {
    const d = def('=User!UserID');
    const n0 = queued();
    await draw('mine', d, 'a@x.io');
    await draw('mine', d, 'b@x.io');
    expect(queued() - n0).toBe(2);
  });
  it('a report that loads a viewer-dependent subreport at render time stops being shared', async () => {
    const { writeReport } = await import('../../src/server/reports.js');
    await writeReport('sub-dep', def('=User!UserID'));
    await perms.setReportAccess({ kind: 'service' }, 'sub-dep', { grants: [{ to: 'group:sales', level: 'view' }] });
    const parent = def('Parent');
    parent.sections.body.items.push({ type: 'subreport', name: 'S', x: 0, y: 30, w: 200, h: 40, report: 'sub-dep' });
    expect(thumbs.principalIndependent(parent)).toBe(true); // statically it looks shareable
    const drew = await thumbs.drawThumb({ def: parent, principal: await P('a@x.io'), base: 'http://pw.test' });
    expect(drew.independent).toBe(false); // the render saw the subreport
    const n0 = queued();
    await draw('parent', parent, 'a@x.io'); // drawn for the class, found dependent: kept for nobody
    await draw('parent', parent, 'a@x.io'); // per viewer from now on
    await draw('parent', parent, 'b@x.io');
    expect(queued() - n0).toBe(3);
  });
});

describe('decision cache keys come from the decision context (review finding)', () => {
  it('changing any input of a decision changes the key; the decision reads only the context', async () => {
    const base = { kind: 'user', email: 'a@x.io', role: 'viewer', groups: ['sales'] };
    const c0 = perms.decisionContext(base);
    expect(Object.keys(c0).sort()).toEqual(['email', 'embed', 'groups', 'key', 'kind', 'role']);
    const stamp = (p) => perms.accessStamp(p);
    const s0 = await stamp(base);
    for (const [what, p] of [['email', { ...base, email: 'b@x.io' }], ['role', { ...base, role: 'designer' }], ['groups', { ...base, groups: ['ops'] }],
      ['session version', { ...base, sv: 7 }], ['key scope', { ...base, viaKey: 'abcd1234' }], ['kind', { kind: 'anon' }]])
      expect(await stamp(p), what).not.toBe(s0);
    process.env.PW_EMBED_ORIGINS = 'https://e.example';
    try { expect(await stamp(base), 'embed mode').not.toBe(s0); } finally { delete process.env.PW_EMBED_ORIGINS; }
    const before = await stamp(base);
    const f = await perms.createFolder({ kind: 'service' }, { name: 'Chain' });
    expect(await stamp(base), 'the folder chain / grants').not.toBe(before);
    expect(f.id).toBeTruthy();
    // group order and case do not matter to the decision, so not to the key either
    expect(await stamp({ ...base, groups: ['SALES', 'sales'] })).toBe(await stamp(base));
  });
});
