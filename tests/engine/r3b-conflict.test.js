// R3-B item 7: lost updates (REVIEW-ARCH-2 2.5, REVIEW-UX-2 F-4; the synthetic-user run: 58 of 63 near-simultaneous
// two-designer saves both answered 200 and one edit vanished). A save of an existing report names the revision it
// was edited from (If-Match); a stale one is 409 with the current revision, so a 200 always means the edit is stored.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-conflict-'));
const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 'r3b-conflict-'.padEnd(48, 'x'), PW_STORAGE: `sqlite:${path.join(tmp, 's.db')}` };
const saved = {};
const BASE = 'http://pw.test';
let route, users, session, A, B;
beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  users = await import('../../src/server/users.js');
  session = await import('../../src/server/session.js');
  route = await import('../../app/api/reports/[id]/route.js');
  for (const e of ['a@x.test', 'b@x.test']) await users.createUser({ email: e, role: 'designer', password: 'a long password 1' });
  A = session.sessionCookie(new Request(BASE), await users.getUser('a@x.test')).split(';')[0];
  B = session.sessionCookie(new Request(BASE), await users.getUser('b@x.test')).split(';')[0];
});
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } fs.rmSync(tmp, { recursive: true, force: true }); });

const ctx = (id) => ({ params: Promise.resolve({ id }) });
const get = async (id, cookie = A) => { const r = await route.GET(new Request(`${BASE}/api/reports/${id}`, { headers: { cookie } }), ctx(id)); return { status: r.status, etag: r.headers.get('etag'), def: await r.json() }; };
const put = async (id, body, { cookie = A, match } = {}) => {
  const r = await route.PUT(new Request(`${BASE}/api/reports/${id}`, { method: 'PUT', headers: { origin: BASE, cookie, 'content-type': 'application/json', ...(match !== undefined && { 'if-match': match }) }, body: JSON.stringify(body) }), ctx(id));
  return { status: r.status, etag: r.headers.get('etag'), body: await r.json() };
};
const edits = (def) => (def.sections?.pageFooter?.items || []).map(i => i.name);
const withEdit = (def, tag) => ({ ...def, sections: { ...(def.sections || {}), pageFooter: { height: 12, items: [...(def.sections?.pageFooter?.items || []), { type: 'textbox', name: tag, x: 0, y: 0, w: 10, h: 6, value: '' }] } } });

describe('two designers save the same report', () => {
  it('the second save from the same base is 409 with the current revision; neither edit is lost silently', async () => {
    expect((await put('shared', { name: 'Shared' })).status).toBe(200); // a new report needs no If-Match
    await (await import('../../src/server/perms.js')).setReportAccess({ kind: 'service' }, 'shared', { grants: [{ to: 'group:designers', level: 'edit' }] });
    const a = await get('shared', A), b = await get('shared', B);
    expect(a.etag).toMatch(/^"[0-9a-f]{16}"$/);
    const sa = await put('shared', withEdit(a.def, 'E_A'), { cookie: A, match: a.etag });
    expect(sa.status).toBe(200);
    expect(`"${sa.body.rev}"`).toBe(sa.etag);
    const sb = await put('shared', withEdit(b.def, 'E_B'), { cookie: B, match: b.etag });
    expect(sb.status).toBe(409);
    expect(`"${sb.body.rev}"`).toBe(sa.etag); // the current revision, for the designer's merge / overwrite choice
    // B chooses: merge (take theirs, add mine again) and save against the current revision
    const now = await get('shared', B);
    expect(edits(now.def)).toEqual(['E_A']);
    expect((await put('shared', withEdit(now.def, 'E_B'), { cookie: B, match: now.etag })).status).toBe(200);
    const end = await get('shared', A);
    expect(edits(end.def)).toEqual(['E_A', 'E_B']); // a 200 is in the next read
  });
  it('20 saves at once from one base: exactly one 200, every other one a 409 (no silent loss)', async () => {
    const base = await get('shared');
    const r = await Promise.all(Array.from({ length: 20 }, (_, i) => put('shared', withEdit(base.def, `E_${i}`), { cookie: i % 2 ? B : A, match: base.etag })));
    const ok = r.filter(x => x.status === 200);
    expect(ok.length).toBe(1);
    expect(r.filter(x => x.status === 409).length).toBe(19);
    const end = await get('shared');
    const winner = edits(end.def).filter(t => /^E_\d+$/.test(t));
    expect(winner.length).toBe(1);
    expect(end.etag).toBe(ok[0].etag);
  });
  it('a save without If-Match is 428; If-Match: * overwrites on purpose; a deleted report is 409', async () => {
    const r = await put('shared', { name: 'blind' });
    expect(r.status).toBe(428);
    expect(r.body.rev).toMatch(/^[0-9a-f]{16}$/);
    expect((await put('shared', { name: 'on purpose' }, { match: '*' })).status).toBe(200);
    expect((await put('gone-now', { name: 'x' }, { match: '"0123456789abcdef"' })).status).toBe(409);
  });
  it('a viewer of another report learns no revision (the access check comes first)', async () => {
    await users.createUser({ email: 'v@x.test', role: 'viewer', password: 'a long password 1' });
    const V = session.sessionCookie(new Request(BASE), await users.getUser('v@x.test')).split(';')[0];
    const r = await put('shared', { name: 'x' }, { cookie: V });
    expect([403, 404]).toContain(r.status);
    expect(r.body.rev).toBeUndefined();
  });
});

describe('a draft remembers the revision it was made on', () => {
  it('restoring a draft made before someone else\'s save is flagged (REVIEW-UX-2 F-4)', async () => {
    const { writeDraft, readDraft, staleDraft } = await import('../../src/designer/draft.js');
    const mem = new Map();
    const s = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k), get length() { return mem.size; }, key: i => [...mem.keys()][i] };
    writeDraft(s, 'a@x.test', 'r1', { name: 'mine' }, Date.now(), 'aaaaaaaaaaaaaaaa');
    const d = readDraft(s, 'a@x.test', 'r1');
    expect(d.rev).toBe('aaaaaaaaaaaaaaaa');
    expect(staleDraft(d, 'aaaaaaaaaaaaaaaa')).toBe(false);
    expect(staleDraft(d, 'bbbbbbbbbbbbbbbb')).toBe(true); // saved again since: the designer warns before restoring
    expect(staleDraft({ ...d, rev: null }, 'bbbbbbbbbbbbbbbb')).toBe(false); // an old draft without one: as before
  });
});

describe('the ETag is the revision of the definition sent (review finding)', () => {
  it('a save that lands while GET runs does not give the old definition the new revision', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const { revOf } = await import('../../src/server/reports.js');
    const s = store(), orig = s.get;
    let raced = false;
    s.get = async function (k, id) {
      const t = await orig.call(this, k, id);
      if (k === 'reports' && id === 'shared' && !raced) { raced = true; await orig.call(this, 'reports', id); await s.put('reports', 'shared', JSON.stringify({ name: 'saved meanwhile' }, null, 2)); }
      return t;
    };
    try {
      const r = await get('shared', A);
      expect(r.def.name).not.toBe('saved meanwhile');
      expect(r.etag).not.toBe(`"${revOf(JSON.stringify({ name: 'saved meanwhile' }, null, 2))}"`);
      // a save with it is refused: the report changed after the definition this editor holds
      expect((await put('shared', { ...r.def, name: 'blind overwrite' }, { cookie: A, match: r.etag })).status).toBe(409);
    } finally { s.get = orig; }
  });
});
