// Regressions for the two independent security reviews of October 2026 (inputs and crypto; output injection).
// Each describe is one finding; each test failed before its fix.
import { describe, it, expect } from 'vitest';
import { createPdf, toBytes } from '../../packages/pdf/src/index.js';
import { buildSfnt } from '../../packages/pdf/src/fonts/subset.js';
import { sfntTables } from '../../packages/pdf/src/fonts/truetype.js';
import { INTER } from './tools.js';
import zlib from 'node:zlib';
import { SIG, ihdr, chunk } from './image-fixtures.js';
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

describe('F7: bytes after a JPEG\'s EOI are not embedded', () => {
  const seg = (m, data) => Buffer.concat([Buffer.from([0xff, m, (data.length + 2) >> 8, (data.length + 2) & 255]), data]);
  const sof = Buffer.alloc(15); sof[0] = 8; sof.writeUInt16BE(10, 1); sof.writeUInt16BE(10, 3); sof[5] = 3;
  // two scans (progressive-like, a DHT between them), stuffed FF 00 and a restart marker in the entropy data
  const scans = Buffer.concat([seg(0xda, Buffer.alloc(10)), Buffer.from([1, 2, 0xff, 0x00, 3, 0xff, 0xd0, 4]), seg(0xc4, Buffer.from([0xff, 0xd9, 0, 0])), seg(0xda, Buffer.alloc(10)), Buffer.from([5, 0xff, 0xff, 0xd9])]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xc0, sof), scans]);
  it('cuts the stream at the EOI that ends the image data', async () => {
    const out = Buffer.from(await toBytes(async (pdf) => { await pdf.embedImage(Buffer.concat([jpeg, Buffer.from('APPENDED-SECRET \xff\xd9 more', 'latin1')])); pdf.addPage(); }, { compress: false })).toString('latin1');
    expect(out).not.toContain('APPENDED-SECRET');
    expect(out).toContain(`/Length ${jpeg.length}`);
    expect(out).toContain(jpeg.toString('latin1'));
  });
});

describe('F6: a passed-through PNG (no alpha, not interlaced) is checked row by row and cut at the end of its zlib stream', () => {
  const rgb = (rows, tail = Buffer.alloc(0), split = false) => {
    const z = Buffer.concat([zlib.deflateSync(rows), tail]);
    const idat = split ? [chunk('IDAT', z.subarray(0, 7)), chunk('IDAT', z.subarray(7))] : [chunk('IDAT', z)];
    return Buffer.concat([SIG, ihdr(4, 4, 8, 2), ...idat, chunk('IEND', Buffer.alloc(0))]);
  };
  const rows = () => { const r = Buffer.alloc(4 * 13); for (let y = 0; y < 4; y++) for (let i = 1; i < 13; i++) r[y * 13 + i] = y * 40 + i; return r; };
  it('a row filter byte over 4 is refused', async () => {
    const r = rows(); r[2 * 13] = 7;
    await expect(toBytes(async (pdf) => { await pdf.embedImage(rgb(r)); })).rejects.toThrow(/PNG: unknown row filter 7/);
  });
  it('data after the zlib stream is dropped, in one IDAT or split over two', async () => {
    for (const split of [false, true]) {
      const tail = Buffer.from('TRAILING-SECRET', 'latin1');
      const out = Buffer.from(await toBytes(async (pdf) => { await pdf.embedImage(rgb(rows(), tail, split)); pdf.addPage(); }, { compress: false })).toString('latin1');
      expect(out).not.toContain('TRAILING-SECRET');
      const z = zlib.deflateSync(rows());
      expect(out).toContain(z.toString('latin1'));
      expect(out).toContain(`/Length ${z.length}`);
    }
  });
});
