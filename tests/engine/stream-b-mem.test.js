// Streaming phases B and C, the memory proof (scripts/mem-stream.mjs): the data CSV (unsorted, and sorted through the
// spill) and the grouped Excel export of a 6-column report keep a flat resident memory from 100k to 300k rows, so 1M
// projects under 300 MB.
// Each run is its own process with a streaming worker's heap; the rows come from a local HTTP JSON source.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dataServer, runOnce, FLAT_MB } from '../../scripts/mem-stream.mjs';

let srv;
beforeAll(async () => { srv = await dataServer(); });
afterAll(() => srv?.server.close());

describe('streaming memory: a flat line', () => {
  for (const [format, shape] of [['csv', 'plain'], ['csv', 'sorted'], ['xlsx', 'grouped']]) {
    it(`${format}, ${shape}: RSS at 300k rows ≤ RSS at 100k + ${FLAT_MB} MB`, async () => {
      const a = await runOnce(format, 100000, shape, srv.url);
      const b = await runOnce(format, 300000, shape, srv.url);
      console.log(`[mem] ${format} ${shape}: ${a.peakMB} MB (100k) → ${b.peakMB} MB (300k)`);
      expect(a.streamed && b.streamed).toBe(true);
      expect(b.bytes).toBeGreaterThan(3 * a.bytes - 100000);
      expect(b.peakMB).toBeLessThanOrEqual(a.peakMB + FLAT_MB);
      expect(b.peakMB).toBeLessThan(300);
    }, 300000);
  }
});
