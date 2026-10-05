// R1-A S-5 and S-6: 500s are logged with a reference and answered generically; a health endpoint needs no key and
// answers 200 only when healthy; Prometheus metrics behind a key; a short PW_AUDIT_KEY is never silently off.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { errorResponse } from '../../src/server/errors.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-r1a-ops-'));
const keep = { ...process.env };
beforeAll(() => { process.env.PW_STORAGE = `sqlite:${path.join(tmp, 's.db')}`; process.env.PW_RENDER_WORKERS = '0'; });
afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); fs.rmSync(tmp, { recursive: true, force: true }); });

describe('S-5: errors, health, metrics', () => {
  it('an unexpected error: a generic answer with a reference, and the detail in the log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = errorResponse(new Error('ENOENT: /srv/secret/path/db.sqlite password=hunter2'));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).not.toMatch(/secret|hunter2|ENOENT/);
      expect(body.error).toContain(body.requestId);
      expect(res.headers.get('x-request-id')).toBe(body.requestId);
      const line = JSON.parse(log.mock.calls.at(-1)[0]);
      expect(line).toMatchObject({ level: 'error', id: body.requestId, status: 500 });
      expect(line.message).toContain('hunter2'); // the operator sees it
      // a message written for the caller (it has a status) goes back as written, 5xx too, and 5xx is still logged
      expect((await errorResponse(Object.assign(new Error('Report not found'), { status: 404 })).json()).error).toBe('Report not found');
      const n = log.mock.calls.length;
      const r503 = await errorResponse(Object.assign(new Error('The server is busy.'), { status: 503 })).json();
      expect(r503.error).toBe('The server is busy.');
      expect(log.mock.calls.length).toBe(n + 1);
    } finally { log.mockRestore(); }
  });

  it('a route answers an unexpected error generically (the reports route on a broken storage)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const was = process.env.PW_STORAGE;
    process.env.PW_STORAGE = 'sqlite:/nonexistent-dir-r1a/x/y.db';
    try {
      const { GET } = await import('../../app/api/reports/route.js');
      const res = await GET(new Request('http://pw.test/api/reports'));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/Reference: [0-9a-f]{8}/);
      expect(body.error).not.toContain('nonexistent-dir-r1a');
    } finally { process.env.PW_STORAGE = was; log.mockRestore(); }
  });

  it('readyz and livez need no key; readyz is 503 when the storage does not answer', async () => {
    const { GET: ready } = await import('../../app/api/v1/readyz/route.js');
    const { GET: live } = await import('../../app/api/v1/livez/route.js');
    expect((await live()).status).toBe(200);
    const ok = await ready();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, checks: { storage: true, workers: true } });
    const was = process.env.PW_STORAGE;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.PW_STORAGE = 'sqlite:/nonexistent-dir-r1a/x/y.db';
    try { expect((await ready()).status).toBe(503); } finally { process.env.PW_STORAGE = was; log.mockRestore(); }
    // with accounts on, the gate lets both through without a session (they are under /api/v1)
    const { proxy } = await import('../../proxy.js');
    process.env.PW_AUTH = 'users'; process.env.PW_SESSION_SECRET = 'x'.repeat(48);
    try { expect(await proxy(new Request('http://pw.test/api/v1/readyz'))).toBeUndefined(); } finally { delete process.env.PW_AUTH; delete process.env.PW_SESSION_SECRET; }
  });

  it('metrics: Prometheus text behind a service key', async () => {
    process.env.PW_API_KEYS = 'metrics-key-123456';
    try {
      const { GET } = await import('../../app/api/v1/metrics/route.js');
      expect((await GET(new Request('http://pw.test/api/v1/metrics'))).status).toBe(401);
      const res = await GET(new Request('http://pw.test/api/v1/metrics', { headers: { authorization: 'Bearer metrics-key-123456' } }));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/plain; version=0.0.4/);
      const text = await res.text();
      for (const m of ['pagewright_renders_total{outcome="done"}', 'pagewright_render_duration_seconds_bucket{le="+Inf"}', 'pagewright_render_queue{class="interactive"}',
        'pagewright_render_worker_restarts_total', 'pagewright_sqlite_queries_total{outcome="killed"}', '# TYPE pagewright_render_duration_seconds histogram']) expect(text).toContain(m);
    } finally { delete process.env.PW_API_KEYS; }
  });

  it('the Docker HEALTHCHECK asks readyz and passes on 200 only', () => {
    const df = fs.readFileSync(path.join(import.meta.dirname, '../../Dockerfile'), 'utf8');
    expect(df).toMatch(/HEALTHCHECK[^\n]*\/api\/v1\/readyz[^\n]*status===200/);
  });
});

describe('S-6: a short PW_AUDIT_KEY is never silently off', () => {
  const set = (o) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  afterAll(() => set({ PW_AUDIT_KEY: undefined, PW_SESSION_SECRET: undefined, NODE_ENV: keep.NODE_ENV }));
  it('the review repro: 31 characters beside a valid session secret', async () => {
    const audit = await import('../../src/server/audit.js');
    set({ PW_AUDIT_KEY: 'k'.repeat(31), PW_SESSION_SECRET: 's'.repeat(36), NODE_ENV: 'production' });
    expect(audit.auditKeyProblem()).toMatch(/31 characters/);
    expect(() => audit.publicKey()).toThrow(/PW_AUDIT_KEY/); // production: refuses, never signs nothing
    const { register } = await import('../../instrumentation.js');
    process.env.NEXT_RUNTIME = 'nodejs';
    try { await expect(register()).rejects.toThrow(/PW_AUDIT_KEY/); } finally { delete process.env.NEXT_RUNTIME; }
    set({ NODE_ENV: 'development' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(audit.publicKey()).toBeTruthy(); // development: loud, and signed with the session secret
      expect(audit.keySource()).toBe('PW_SESSION_SECRET');
    } finally { log.mockRestore(); }
    set({ PW_AUDIT_KEY: 'k'.repeat(32) });
    expect(audit.auditKeyProblem()).toBe('');
    expect(audit.keySource()).toBe('PW_AUDIT_KEY');
  });
});

