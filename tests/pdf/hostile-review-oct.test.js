// Regressions for the two independent security reviews of October 2026 (inputs and crypto; output injection).
// Each describe is one finding; each test failed before its fix.
import { describe, it, expect } from 'vitest';
import { createPdf } from '../../packages/pdf/src/index.js';
import { buildSfnt } from '../../packages/pdf/src/fonts/subset.js';
import { sfntTables } from '../../packages/pdf/src/fonts/truetype.js';
import { INTER } from './tools.js';

const sink = () => ({ write() {} });

describe('F2: a cmap format 4 with an odd segCountX2 is a broken font', () => {
  it('refuses it at embedFont with the typed error, not a RangeError at text time', async () => {
    const cmap = new Uint8Array(32), dv = new DataView(cmap.buffer);
    dv.setUint16(2, 1); dv.setUint16(4, 3); dv.setUint16(6, 1); dv.setUint32(8, 12);
    dv.setUint16(12, 4); dv.setUint16(14, 20); dv.setUint16(18, 1); // segCountX2 = 1
    dv.setUint16(26, 0xffff);
    const t = sfntTables(INTER);
    t.set('cmap', cmap);
    const pdf = createPdf(sink());
    await expect(pdf.embedFont(buildSfnt(t))).rejects.toThrow(/^Broken font: .*segCountX2/);
  });
});
