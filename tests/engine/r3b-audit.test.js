// R3-B item 4: audit flooding (REVIEW-SECURITY-2 M3, PoC p3: 600 unauthenticated requests wrote 600 rows in 765 ms,
// "status":"ok" on auth.login_failed) and audit growth per API render (EXTERNAL-REVIEW-3 §3.11: api.call +
// report.render, about 1.5 KB per render).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { report } from '../helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r3b-audit-'));
const ENV = { PW_AUTH: 'users', PW_SESSION_SECRET: 's'.repeat(40), PW_API_KEYS: 'svc-secret-key-123', PW_STORAGE: `sqlite:${path.join(tmp, 'a.db')}`, PW_RENDER_WORKERS: '0', PW_AUDIT_CHECKPOINTS: 'off' };
const saved = {};
const BASE = 'http://pw.test';
let A, store;
beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  globalThis.__pwPeers = true;
  A = await import('../../src/server/audit.js');
  ({ store } = await import('../../src/server/storage/index.js'));
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete globalThis.__pwPeers;
  fs.rmSync(tmp, { recursive: true, force: true });
});
const rows = async (type) => (await store().queryAudit({ limit: 100000, ...(type ? { type } : {}) }));
const total = (list) => list.reduce((n, e) => n + (e.detail?.repeated || 1), 0);
const wipe = () => store().pruneAudit('9999-01-01T00:00:00.000Z');

describe('unauthenticated events are rate-limited, counted, never lost', () => {
  it('PoC p3: 300 keyless /api/v1 calls + 300 malformed sign-ins from one address write a few dozen rows, all counted', async () => {
    await wipe();
    const { GET: templates } = await import('../../app/api/v1/templates/route.js');
    const { POST: login } = await import('../../app/api/auth/login/route.js');
    const h = { origin: BASE, 'content-type': 'application/json', 'x-pw-peer': '203.0.113.9' };
    const codes = new Set();
    for (let i = 0; i < 300; i++) {
      codes.add((await templates(new Request(`${BASE}/api/v1/templates`, { headers: h }))).status);
      codes.add((await login(new Request(`${BASE}/api/auth/login`, { method: 'POST', headers: h, body: JSON.stringify({ email: `not-an-email-${'A'.repeat(50)}`, password: 'x' }) }))).status);
    }
    expect([...codes]).toEqual([401]);
    await A.flushFlood();
    const calls = await rows('api.call'), failed = await rows('auth.login_failed');
    expect(calls.length + failed.length).toBe(20 + 2); // 20 from this address in full, then one counted entry per type
    expect(total(calls)).toBe(300);
    expect(total(failed)).toBe(300);
    expect(failed.every(e => e.status === 'failed')).toBe(true); // was "ok"
    const agg = failed.find(e => e.detail?.repeated);
    expect(agg).toMatchObject({ ip: '203.0.113.9', status: 'failed', detail: { repeated: 290 } });
  });
  it('a flood from many addresses is capped in total (PW_AUDIT_ANON_PER_MINUTE), still counted per source', async () => {
    await wipe();
    for (let n = 0; n < 40; n++) for (let i = 0; i < 10; i++) await A.audit('auth.sso_failed', { req: new Request(BASE, { headers: { 'x-pw-peer': `198.18.${n}.1` } }), detail: { reason: 'garbage' } });
    await A.flushFlood();
    const all = await rows('auth.sso_failed');
    expect(all.length).toBeLessThanOrEqual(100 + 40); // 600 a minute is 100 per 10 s window, then one counted entry per source
    expect(total(all)).toBe(400);
  });
  it('a different action is never hidden among identical repeats: it gets its own entry and count', async () => {
    await wipe();
    const h = { 'x-pw-peer': '203.0.113.50' };
    for (let i = 0; i < 100; i++) await A.audit('auth.login_failed', { req: new Request(BASE, { headers: h }), detail: { reason: 'bad email' } });
    await A.audit('auth.login_failed', { req: new Request(BASE, { headers: h }), detail: { email: 'admin@x.io', reason: 'wrong email or password' } });
    for (let i = 0; i < 3; i++) await A.audit('auth.reset_request', { req: new Request(BASE, { headers: h }), detail: { email: 'admin@x.io' } });
    await A.flushFlood();
    const failed = await rows('auth.login_failed');
    expect(failed.filter(e => e.detail?.email === 'admin@x.io').map(e => e.detail.repeated || 1)).toEqual([1]);
    expect(total(failed)).toBe(101);
    expect(total(await rows('auth.reset_request'))).toBe(3);
  });
  it('events with a signed-in actor are never aggregated', async () => {
    await wipe();
    for (let i = 0; i < 50; i++) await A.audit('auth.login', { actor: 'user:a@x.io', req: new Request(BASE, { headers: { 'x-pw-peer': '192.0.2.1' } }) });
    expect((await rows('auth.login')).length).toBe(50);
  });
});

describe('an API render writes one compact event', () => {
  it('one report.render (it names the caller: no second api.call event), well under the 1.5 KB of before', async () => {
    await wipe();
    await store().put('reports', 'inv', JSON.stringify(report([{ type: 'text', x: 0, y: 0, w: 100, h: 20, value: 'Hi' }])));
    const { POST } = await import('../../app/api/v1/render/route.js');
    const before = (await rows()).length;
    const r = await POST(new Request(`${BASE}/api/v1/render`, { method: 'POST', headers: { authorization: 'Bearer svc-secret-key-123', 'content-type': 'application/json', 'x-pw-peer': '192.0.2.5' }, body: JSON.stringify({ template: 'inv', format: 'pdf', parameters: { a: 1 } }) }));
    expect(r.status).toBe(200);
    const after = await rows();
    expect(after.length - before).toBe(1);
    expect(after[0].type).toBe('report.render');
    const bytes = Buffer.byteLength(JSON.stringify(after[0]));
    console.log(`[r3b] audit bytes per API render: ${bytes} (one event)`);
    expect(bytes).toBeLessThan(750);
    expect(after[0].detail).not.toHaveProperty('signed');
    // never sampled: anonymous embed renders are all recorded (identical ones counted)
    for (let i = 0; i < 50; i++) await A.audit('report.render', { principal: { kind: 'anon' }, report: 'inv', req: new Request(BASE, { headers: { 'x-pw-peer': '192.0.2.77' } }) });
    await A.flushFlood();
    expect(total((await rows('report.render')).filter(e => e.ip === '192.0.2.77'))).toBe(50);
  });
});

describe('every path that renders, exports or reads data writes an audit event (ratchet)', () => {
  const ROOT = path.join(import.meta.dirname, '../..');
  const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(n => (n.isDirectory() ? walk(`${d}/${n.name}`) : /\.(m?js|jsx)$/.test(n.name) ? [`${d}/${n.name}`] : []));
  // a file that renders a report, exports one, runs SQL or fetches data for someone must also call audit(
  const RENDERS = /\b(renderInPool|thumbnail|runSavedSql|runSql|safeFetch|packInPool|renderReport|exportPdf|exportXlsx|exportDocx)\s*\(/;
  // the modules that do the work for a route that audits (the route is checked), or never for a caller
  const LIBS = new Set(['src/server/pool.js', 'src/server/renderer.js', 'src/server/sql.js', 'src/server/sql/schema.js', 'src/server/thumbs.js', 'src/server/safeFetch.js',
    'src/server/sso.js', 'src/server/siem.js', 'src/server/render-worker.mjs', 'src/server/snapshots.js', 'src/server/schedulePage.js', 'src/server/ai.js']);
  it('lists them all', () => {
    const files = [...walk('app/api'), ...walk('src/server')].filter(f => !LIBS.has(f) && RENDERS.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    const silent = files.filter(f => !/\baudit\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(silent).toEqual([]);
  });
  it('a thumbnail view is recorded once per viewer and report per window, repeats counted', async () => {
    await wipe();
    for (let i = 0; i < 5; i++) await A.audit('report.view', { principal: { kind: 'user', email: 'v@x.io', role: 'viewer', groups: [] }, report: 'inv', detail: { via: 'thumbnail' }, repeat: true });
    await A.audit('report.view', { principal: { kind: 'user', email: 'v@x.io', role: 'viewer', groups: [] }, report: 'other', detail: { via: 'thumbnail' }, repeat: true });
    expect((await rows('report.view')).length).toBe(2); // the first of each, at once
    await A.flushFlood();
    const all = await rows('report.view');
    expect(total(all.filter(e => e.report === 'inv'))).toBe(5);
    expect(total(all.filter(e => e.report === 'other'))).toBe(1);
  });
});

