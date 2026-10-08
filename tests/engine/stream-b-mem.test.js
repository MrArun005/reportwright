// Streaming phase B, the memory proof (scripts/mem-stream.mjs): the data CSV of a 6-column report keeps a flat
// resident memory from 100k to 300k rows (unsorted, and sorted through the spill), so 1M projects under 300 MB.
// Each run is its own process with a streaming worker's heap; the rows come from a local HTTP JSON source.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dataServer, runOnce, FLAT_MB } from '../../scripts/mem-stream.mjs';

let srv;
beforeAll(async () => { srv = await dataServer(); });
afterAll(() => srv?.server.close());

describe('streaming memory: a flat line', () => {
  for (const shape of ['plain', 'sorted']) {
    it(`CSV, ${shape}: RSS at 300k rows ≤ RSS at 100k + ${FLAT_MB} MB`, async () => {
      const a = await runOnce('csv', 100000, shape, srv.url);
      const b = await runOnce('csv', 300000, shape, srv.url);
      console.log(`[mem] csv ${shape}: ${a.peakMB} MB (100k) → ${b.peakMB} MB (300k)`);
      expect(a.streamed && b.streamed).toBe(true);
      expect(b.bytes).toBeGreaterThan(3 * a.bytes - 100000);
      expect(b.peakMB).toBeLessThanOrEqual(a.peakMB + FLAT_MB);
      expect(b.peakMB).toBeLessThan(300);
    }, 300000);
  }
});
