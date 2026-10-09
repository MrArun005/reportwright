// Regressions for the two independent security reviews of October 2026 (inputs and crypto; output injection).
// Each describe is one finding; each test failed before its fix.
import { describe, it, expect } from 'vitest';
import { createPdf } from '../../packages/pdf/src/index.js';
import { buildSfnt } from '../../packages/pdf/src/fonts/subset.js';
import { sfntTables } from '../../packages/pdf/src/fonts/truetype.js';
import { INTER } from './tools.js';
import { EN16931 } from './standards-fixture.js';
import { readInvoice } from '../../packages/pdf/src/standards/facturx.js';

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

describe('F3: the Factur-X guideline is read from ExchangedDocumentContext only, never from comments, CDATA or PIs', () => {
  const A3 = { pdfa: { part: 3, conformance: 'b' } };
  const EXT = 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended';
  const fake = `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${EXT}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>`;
  const real = (id) => `<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${id}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>`;
  const inv = (body) => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n<rsm:CrossIndustryInvoice xmlns:rsm="urn:x" xmlns:ram="urn:y">\n${body}\n</rsm:CrossIndustryInvoice>`);
  const hidden = {
    'a comment (the reviewer\'s PoC)': `<!-- ${fake} -->`,
    'a CDATA section': `<rsm:Note><![CDATA[${fake}]]></rsm:Note>`,
    'a processing instruction': `<?note ${fake}?>`,
    'an element outside ExchangedDocumentContext': `<rsm:Other>${fake}</rsm:Other>`,
  };
  for (const [where, decoy] of Object.entries(hidden)) {
    it(`a MINIMUM invoice with an EXTENDED guideline in ${where} is not accepted as EXTENDED`, async () => {
      const b = inv(`${decoy}\n${real('urn:factur-x.eu:1p0:minimum')}`);
      expect(readInvoice(b).guideline).toBe('urn:factur-x.eu:1p0:minimum');
      const pdf = createPdf(sink(), A3);
      await expect(pdf.facturX(b, { profile: 'EXTENDED' })).rejects.toThrow(/is not the EXTENDED profile/);
    });
  }
  it('two guideline IDs are refused (exactly one)', async () => {
    const b = inv(`<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${EXT}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:factur-x.eu:1p0:minimum</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>`);
    expect(readInvoice(b).guideline).toBe(null);
    const pdf = createPdf(sink(), A3);
    await expect(pdf.facturX(b, { profile: 'EXTENDED' })).rejects.toThrow(/not the EXTENDED profile/);
  });
  it('the real fixture still reads', () => {
    expect(readInvoice(EN16931)).toEqual({ root: 'CrossIndustryInvoice', guideline: 'urn:cen.eu:en16931:2017' });
  });
});
