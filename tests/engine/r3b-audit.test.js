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
  it('a flood from many addresses is capped in total (PW_AUDIT_ANON_PER_MINUTE), still counted', async () => {
    await wipe();
    process.env.PW_AUDIT_ANON_PER_MINUTE = '100';
    try {
      for (let s = 0; s < 40; s++) for (let i = 0; i < 10; i++) await A.audit('auth.sso_failed', { req: new Request(BASE, { headers: { 'x-pw-peer': `198.18.${s}.1` } }), detail: { reason: 'garbage' } });
      await A.flushFlood();
      const all = await rows('auth.sso_failed');
      expect(all.length).toBeLessThanOrEqual(101);
      expect(total(all)).toBe(400);
      expect(all.find(e => e.ip === '*')?.detail.repeated).toBe(300);
    } finally { delete process.env.PW_AUDIT_ANON_PER_MINUTE; }
  });
  it('events with a signed-in actor are never aggregated', async () => {
    await wipe();
    for (let i = 0; i < 50; i++) await A.audit('auth.login', { actor: 'user:a@x.io', req: new Request(BASE, { headers: { 'x-pw-peer': '192.0.2.1' } }) });
    expect((await rows('auth.login')).length).toBe(50);
  });
});

describe('an API render writes one compact event', () => {
  it('one report.render (no api.call), well under the 1.5 KB of before; sampling for anonymous embed renders', async () => {
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
    process.env.PW_AUDIT_ANON_RENDER_SAMPLE = '0.1';
    try {
      for (let i = 0; i < 400; i++) await A.audit('report.render', { principal: { kind: 'anon' }, report: 'inv' });
      const kept = (await rows('report.render')).filter(e => e.detail?.sample === 0.1).length;
      expect(kept).toBeGreaterThan(10);
      expect(kept).toBeLessThan(100);
    } finally { delete process.env.PW_AUDIT_ANON_RENDER_SAMPLE; }
  });
});
