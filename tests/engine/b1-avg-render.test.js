// The Overview's average render time comes from the durable audit (detail.ms), not one serverless instance's counters.
import { describe, it, expect, vi } from 'vitest';

const today = new Date().toISOString().slice(0, 10);
vi.mock('../../src/server/audit.js', () => ({
  queryAudit: async ({ type }) => (type === 'report.render'
    ? [{ at: `${today}T01:00:00Z`, type, format: 'pdf', detail: { pages: 1, ms: 100 } }, { at: `${today}T02:00:00Z`, type, format: 'pdf', detail: { pages: 1, ms: 300 } }, { at: `${today}T03:00:00Z`, type, format: 'csv', detail: {} }]
    : []),
}));

describe('average render time', () => {
  it('averages detail.ms of the renders in the range', async () => {
    const { activity } = await import('../../src/home/overview.js');
    const a = await activity({ p: { kind: 'service', id: 'x' }, all: true, days: 7, by: 'day' });
    expect(a.avgMs).toBe(200);
    expect(a.timed).toBe(2);
  });
});
