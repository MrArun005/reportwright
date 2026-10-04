// DateAdd / DateDiff across a daylight-saving change. A .NET DateTime has no time zone, so VB date arithmetic is on
// the wall clock: +1 day keeps the time of day, and the hours between two clock times are clock hours. Runs in
// America/New_York (DST began 9 Mar 2025, 02:00 → 03:00; ended 2 Nov 2025, 02:00 → 01:00).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vb } from './vb.js';

const tz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });

const F = (e) => vb(`=Format(${e}, "yyyy-MM-dd HH:mm")`);

describe('wall-clock date arithmetic across DST (America/New_York)', () => {
  it('the zone is in effect', () => expect(new Date(2025, 2, 9, 12).getTimezoneOffset()).toBe(240));
  it('DateAdd("d") keeps the time of day', () => {
    expect(F('DateAdd("d", 1, #3/8/2025 12:00:00#)')).toBe('2025-03-09 12:00');
    expect(F('DateAdd("d", 1, #11/1/2025 12:00:00#)')).toBe('2025-11-02 12:00');
    expect(F('DateAdd("ww", 1, #3/5/2025 00:30:00#)')).toBe('2025-03-12 00:30');
    expect(F('DateAdd("m", 1, #2/9/2025 12:00:00#)')).toBe('2025-03-09 12:00');
  });
  it('DateAdd("h") counts clock hours', () => {
    expect(F('DateAdd("h", 24, #3/8/2025 12:00:00#)')).toBe('2025-03-09 12:00');
  });
  it('DateDiff counts clock days and hours', () => {
    expect(vb('=DateDiff("d", #3/8/2025 12:00:00#, #3/9/2025 12:00:00#)')).toBe(1);
    expect(vb('=DateDiff("h", #3/9/2025 00:00:00#, #3/9/2025 04:00:00#)')).toBe(4);
    expect(vb('=DateDiff("d", #11/1/2025 00:00:00#, #11/3/2025 00:00:00#)')).toBe(2);
  });
});
