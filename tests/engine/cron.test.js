import { describe, it, expect } from 'vitest';
import { parseCron, matches, nextRun } from '../../src/server/cron.js';
import { isDue } from '../../src/server/schedules.js';

describe('cron', () => {
  it('parses ranges, lists and steps', () => {
    const c = parseCron('*/15 7-9 1,15 * 1-5');
    expect([...c.fields[0]]).toEqual([0, 15, 30, 45]);
    expect([...c.fields[1]]).toEqual([7, 8, 9]);
    expect(() => parseCron('61 * * * *')).toThrow(/out of range/);
    expect(() => parseCron('* * *')).toThrow(/5 fields/);
  });
  it('matches in a time zone', () => {
    // 01:30 UTC is 07:00 in Kolkata
    const d = new Date('2026-11-01T01:30:00Z');
    expect(matches('0 7 1 * *', d, 'Asia/Kolkata')).toBe(true);
    expect(matches('0 7 1 * *', d, 'UTC')).toBe(false);
  });
  it('finds the next run', () => {
    const n = nextRun('0 7 1 * *', 'Asia/Kolkata', new Date('2026-10-04T00:00:00Z'));
    expect(n.toISOString()).toBe('2026-11-01T01:30:00.000Z');
  });
});
describe('cron weekdays', () => {
  it('treats 7 as Sunday and accepts 1-7', () => {
    expect([...parseCron('0 0 * * 1-7').fields[4]].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(matches('0 9 * * 7', new Date('2026-10-04T09:00:00Z'), 'UTC')).toBe(true); // a Sunday
  });
});

describe('cron: speed, leap days, daylight saving, restarts', () => {
  const runs = (cron, tz, from, to) => {
    const out = [];
    for (let d = new Date(from); ;) { d = nextRun(cron, tz, d); if (!d || d > new Date(to)) return out; out.push(d.toISOString()); }
  };
  it('finds a yearly run without scanning every minute', () => {
    const t0 = Date.now();
    expect(nextRun('0 9 1 1 *', 'UTC', new Date('2026-10-04T00:00:00Z')).toISOString()).toBe('2027-01-01T09:00:00.000Z');
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it('finds 29 February more than a year ahead', () => {
    expect(nextRun('0 0 29 2 *', 'UTC', new Date('2026-10-04T00:00:00Z')).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
  it('runs once in the repeated hour when clocks go back', () => {
    expect(runs('30 1 * * *', 'America/New_York', '2026-10-31T12:00:00Z', '2026-11-02T12:00:00Z'))
      .toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
  });
  it('still runs on the day clocks skip the hour', () => {
    expect(runs('30 2 * * *', 'America/New_York', '2026-03-07T12:00:00Z', '2026-03-09T12:00:00Z'))
      .toEqual(['2026-03-08T07:30:00.000Z', '2026-03-09T06:30:00.000Z']);
  });
  it('keeps minute steps inside the current hour', () => {
    expect(nextRun('*/15 * * * *', 'Asia/Kolkata', new Date('2026-10-04T00:07:00Z')).toISOString()).toBe('2026-10-04T00:15:00.000Z');
  });
  it('a schedule is due once per run time, across restarts', () => {
    const s = { cron: '0 9 * * *', timezone: 'UTC', createdAt: '2026-10-01T00:00:00Z' };
    expect(isDue({ ...s, lastRunAt: '2026-10-03T09:00:04Z' }, new Date('2026-10-04T09:00:10Z'))).toBe(true);
    expect(isDue({ ...s, lastRunAt: '2026-10-04T09:00:04Z' }, new Date('2026-10-04T09:00:40Z'))).toBe(false); // restart in the same minute
    expect(isDue({ ...s, lastRunAt: '2026-10-02T09:00:04Z' }, new Date('2026-10-04T15:00:00Z'))).toBe(true);  // down at 09:00: catches up once
    expect(isDue({ ...s, cron: '0 10 * * *', lastRunAt: '2026-10-03T09:00:04Z', updatedAt: '2026-10-04T12:00:00Z' }, new Date('2026-10-04T12:00:30Z'))).toBe(false); // edited after 10:00
    expect(isDue({ ...s, enabled: false, lastRunAt: '2026-10-03T09:00:04Z' }, new Date('2026-10-04T09:00:10Z'))).toBe(false);
  });
});
