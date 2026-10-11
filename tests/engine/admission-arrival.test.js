// QA load finding (qa-load run 38155428659): 200 VUs on one API key, 0 × 429/503 — requests waited in auth and the
// template read before the pool, where admission never counted them. Admission now counts from arrival (pool.arrive).
import { describe, it, expect, afterEach } from 'vitest';
import { arrive } from '../../src/server/pool.js';

const keep = { ...process.env };
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); });
const req = (key) => new Request('http://x/api/v1/render', { method: 'POST', headers: { authorization: `Bearer ${key}` } });
const refused = (fn) => { try { fn(); return null; } catch (e) { return e; } };

describe('admission from arrival', () => {
  it('a flood on one key: 429 + Retry-After past the per-principal cap, before auth or the pool', () => {
    Object.assign(process.env, { PW_RENDER_WORKERS: '2', PW_RENDER_QUEUE: '50', PW_RENDER_QUEUE_PER_PRINCIPAL: '4', PW_RENDER_MAX_WAIT_MS: '600000' });
    const held = [];
    let rejected = [];
    for (let i = 0; i < 200; i++) { const e = refused(() => held.push(arrive(req('k1')))); if (e) rejected.push(e); }
    expect(held.length).toBe(4);
    expect(rejected.length).toBe(196);
    for (const e of rejected) { expect(e.status).toBe(429); expect(e.retryAfter).toBeGreaterThanOrEqual(1); }
    // after auth, bound to its principal: still counted, still capped
    const p = { kind: 'service', key: 'k1' };
    for (const t of held) t.bind(p);
    const e = refused(() => arrive(req('k1')));
    expect(e?.status).toBe(429);
    // finishing frees the place
    for (const t of held) { t.release(); t.release(); } // release is idempotent
    const t = arrive(req('k1')); t.release();
  });

  it('many callers at once: 503 + Retry-After past PW_RENDER_QUEUE', () => {
    Object.assign(process.env, { PW_RENDER_WORKERS: '2', PW_RENDER_QUEUE: '10', PW_RENDER_QUEUE_PER_PRINCIPAL: '100', PW_RENDER_MAX_WAIT_MS: '600000' });
    const held = [];
    for (let i = 0; i < 10; i++) held.push(arrive(req(`a${i}`)));
    const e = refused(() => arrive(req('a0'))); // a caller already in, over a full queue
    held.push(arrive(req('new'))); // a fresh caller still gets in (up to twice the queue)
    expect(e?.status).toBe(503);
    expect(e.retryAfter).toBeGreaterThanOrEqual(1);
    for (const t of held) t.release();
  });

  it('estimated wait past PW_RENDER_MAX_WAIT_MS: 503 + Retry-After', () => {
    Object.assign(process.env, { PW_RENDER_WORKERS: '1', PW_RENDER_QUEUE: '1000', PW_RENDER_QUEUE_PER_PRINCIPAL: '100', PW_RENDER_MAX_WAIT_MS: '1000' });
    const held = [];
    let e = null;
    for (let i = 0; i < 100 && !e; i++) { e = refused(() => held.push(arrive(req('w')))); }
    expect(e?.status).toBe(503);
    expect(e.message).toMatch(/would wait/);
    expect(e.retryAfter).toBeGreaterThanOrEqual(1);
    for (const t of held) t.release();
  });
  it('a revoked key no longer counts against the principal it was bound to (forget)', () => {
    Object.assign(process.env, { PW_RENDER_WORKERS: '2', PW_RENDER_QUEUE: '50', PW_RENDER_QUEUE_PER_PRINCIPAL: '2', PW_RENDER_MAX_WAIT_MS: '600000' });
    const owner = { kind: 'service', key: 'owner' };
    const t0 = arrive(req('old-key')); t0.bind(owner); t0.release(); // the key once signed in as owner
    const bad = arrive(req('old-key')); bad.forget(); bad.release(); // now refused by auth
    const held = [arrive(req('old-key')), arrive(req('old-key'))]; // a flood on the revoked key fills its own bucket
    expect(refused(() => arrive(req('old-key')))?.status).toBe(429);
    const t = arrive(req('owner-new-key')); t.bind(owner); // the owner is not starved
    for (const x of [...held, t]) x.release();
  });
});
