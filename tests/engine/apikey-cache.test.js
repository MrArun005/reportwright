// auth.apiPrincipal: a right API key seen in the last 30 s skips the credential check's storage leases (the render
// hot path); a revoked or rotated key (PW_API_KEYS changed) is refused at once; wrong keys are never cached.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-keycache-'));
const keep = { ...process.env };
const req = (k) => new Request('http://pw.test/api/v1/render', { method: 'POST', headers: { authorization: `Bearer ${k}` } });
let auth, limits;
beforeAll(async () => {
  Object.assign(process.env, { PW_STORAGE: `sqlite:${path.join(tmp, 's.db')}`, PW_API_KEYS: 'key-a-0123456789,key-b-0123456789' });
  limits = await import('../../src/server/limits.js');
  auth = await import('../../src/server/auth.js');
});
afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); fs.rmSync(tmp, { recursive: true, force: true }); });

describe('API key validation cache', () => {
  it('one storage check per key per TTL; revocation is immediate; wrong keys always checked', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const lease = vi.spyOn(store(), 'lease');
    expect((await auth.apiPrincipal(req('key-a-0123456789'), { quiet: true })).principal?.kind).toBe('service');
    const after1 = lease.mock.calls.length;
    expect(after1).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) expect((await auth.apiPrincipal(req('key-a-0123456789'), { quiet: true })).principal).toBeTruthy();
    expect(lease.mock.calls.length).toBe(after1); // no storage leases on the hot path
    for (let i = 0; i < 2; i++) expect((await auth.apiPrincipal(req('wrong-key-xxxxxx'), { quiet: true })).res?.status).toBe(401);
    expect(lease.mock.calls.length).toBeGreaterThan(after1); // a wrong key still pays the credential check
    process.env.PW_API_KEYS = 'key-b-0123456789'; // key a revoked
    expect((await auth.apiPrincipal(req('key-a-0123456789'), { quiet: true })).res?.status).toBe(401);
    lease.mockRestore();
  });
});
