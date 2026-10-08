// GET /api/v1/cron: off without CRON_SECRET (404), refused without the Bearer secret (401), and with it runs the
// schedule tick and the batch queue. Storage, rate limits and rendering are stubbed; the route and cronSecretOk are real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SECRET = 'cron-secret-0123456789abcdef';

vi.mock('@/server/limits.js', () => ({ checkCredential: async (_who, verify) => verify() }));
vi.mock('@/server/schedules.js', () => ({ tickAs: vi.fn(async () => ['sched-1']), cronHorizonMs: () => 0 }));
vi.mock('@/server/jobs.js', async () => {
  const real = await vi.importActual('@/server/jobs.js');
  return { ...real, drainQueue: vi.fn(async () => 2), sweepJobs: vi.fn(async () => 0) };
});

const { GET } = await import('../../app/api/v1/cron/route.js');
const { tickAs } = await import('@/server/schedules.js');
const { drainQueue } = await import('@/server/jobs.js');

const req = (auth) => new Request('http://localhost/api/v1/cron', { headers: auth === undefined ? {} : { authorization: auth } });

describe('GET /api/v1/cron', () => {
  let saved;
  beforeEach(() => { saved = process.env.CRON_SECRET; vi.clearAllMocks(); });
  afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved; });

  it('is off (404) when CRON_SECRET is unset or shorter than 16 characters', async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req(`Bearer ${SECRET}`))).status).toBe(404);
    process.env.CRON_SECRET = 'short';
    expect((await GET(req('Bearer short'))).status).toBe(404);
    expect(tickAs).not.toHaveBeenCalled();
  });

  it('refuses (401) without the secret, with a wrong one, or with the secret but no Bearer prefix', async () => {
    process.env.CRON_SECRET = SECRET;
    expect((await GET(req(undefined))).status).toBe(401);
    expect((await GET(req('Bearer nope-nope-nope-nope-nope'))).status).toBe(401);
    expect((await GET(req(SECRET))).status).toBe(401);
    expect(tickAs).not.toHaveBeenCalled();
    expect(drainQueue).not.toHaveBeenCalled();
  });

  it('with the Bearer secret runs the tick and drains the queue', async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, schedules: ['sched-1'], batches: 2, swept: 0 });
    expect(tickAs).toHaveBeenCalledTimes(1);
    expect(drainQueue).toHaveBeenCalledTimes(1);
  });
});
