import { describe, it, expect } from 'vitest';
import { parseCron, matches, nextRun } from '../../src/server/cron.js';

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
