// A once-a-day outside cron (Vercel, 06:00 UTC) runs every schedule due before its next call, once per slot.
import { describe, it, expect, afterEach } from 'vitest';
import { isDue, dueAt, cronHorizonMs } from '../../src/server/schedules.js';

const DAY = 86400000;
const s = { cron: '0 7 * * *', timezone: 'Asia/Kolkata', createdAt: '2026-10-01T00:00:00Z' }; // 07:00 IST = 01:30 UTC

describe('cron horizon', () => {
  afterEach(() => { delete process.env.PW_CRON; });
  it('PW_CRON=daily looks a day ahead, hourly an hour, unset none', () => {
    process.env.PW_CRON = 'daily'; expect(cronHorizonMs()).toBe(DAY);
    process.env.PW_CRON = 'hourly'; expect(cronHorizonMs()).toBe(3600000);
    delete process.env.PW_CRON; expect(cronHorizonMs()).toBe(0);
  });
  it('the 06:00 UTC tick runs a 07:00 IST schedule and an 18:00 UTC one due before the next tick, each slot once', () => {
    const tick = new Date('2026-10-06T06:00:00Z');
    const last = { ...s, lastRunAt: '2026-10-05T06:00:00Z' };
    expect(dueAt(last, tick, DAY)?.toISOString()).toBe('2026-10-06T01:30:00.000Z');
    // run (lastRunAt = the tick): a second call minutes later does not take tomorrow's slot (never past today, UTC)
    expect(dueAt({ ...s, lastRunAt: tick.toISOString() }, new Date('2026-10-06T06:05:00Z'), DAY)).toBeNull();
    const evening = { cron: '0 18 * * *', timezone: 'UTC', lastRunAt: '2026-10-05T18:00:00Z' };
    expect(isDue(evening, tick)).toBe(false);
    expect(dueAt(evening, tick, DAY)?.toISOString()).toBe('2026-10-06T18:00:00.000Z');
    // after running the 18:00 slot early (lastRunAt = the slot), a second call the same day does not run it again
    expect(dueAt({ ...evening, lastRunAt: '2026-10-06T18:00:00.000Z' }, new Date('2026-10-06T12:00:00Z'), DAY)).toBeNull();
    // the next day's tick runs the next slot
    expect(dueAt({ ...evening, lastRunAt: '2026-10-06T18:00:00.000Z' }, new Date(tick.getTime() + DAY), DAY)?.toISOString()).toBe('2026-10-07T18:00:00.000Z');
  });
});
