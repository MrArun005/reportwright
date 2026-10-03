// @ts-check
// PDF/A-2b: what a plain pdf-lib file lacks. pdf-lib only, so it also runs in the browser.
// Checked with veraPDF (PDF/A-2B profile) in tests/engine/pdfa-sign.test.js.
import { PDFName, PDFNumber, PDFString, PDFHexString, PDFArray, PDFDict } from 'pdf-lib';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {import('pdf-lib').PDFDocument} doc  call after all pages, fields and annotations are added
 * @param {{ icc?: Uint8Array, title?: string, author?: string, created?: Date }} opt
 *   icc: an RGB ICC profile (the sRGB one in public/icc)
 */
export function makePdfA(doc, { icc, title = 'Report', author, created = new Date() } = {}) {
  if (!icc?.length) throw new Error('PDF/A needs an sRGB colour profile: pass pdfa.icc (public/icc/sRGB-v2-magic.icc)');
  // The Info dictionary and the XMP metadata must say the same thing, to the second.
  const when = new Date(Math.floor(created.getTime() / 1000) * 1000);
  const stamp = when.toISOString().replace('.000Z', 'Z');
  doc.setTitle(title);
  doc.setProducer('Pagewright');
  doc.setCreator('Pagewright');
  if (author) doc.setAuthor(author);
  doc.setCreationDate(when);
  doc.setModificationDate(when);

  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(title)}</rdf:li></rdf:Alt></dc:title>${author ? `<dc:creator><rdf:Seq><rdf:li>${xml(author)}</rdf:li></rdf:Seq></dc:creator>` : ''}</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>Pagewright</xmp:CreatorTool><xmp:CreateDate>${stamp}</xmp:CreateDate><xmp:ModifyDate>${stamp}</xmp:ModifyDate><xmp:MetadataDate>${stamp}</xmp:MetadataDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>Pagewright</pdf:Producer></rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const ctx = doc.context;
  const bytes = new TextEncoder().encode(xmp);
  // the metadata stream must not be compressed
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream(bytes, { Type: 'Metadata', Subtype: 'XML', Length: bytes.length })));

  const profile = ctx.register(ctx.flateStream(icc, { N: 3 }));
  const intent = ctx.register(ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: profile }));
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([intent]));

  // every annotation must print (links, form widgets, the signature widget)
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (!(a instanceof PDFDict)) continue;
      const f = a.lookup(PDFName.of('F'));
      const flags = f instanceof PDFNumber ? f.asNumber() : 0;
      // set Print (4); clear Invisible (1), Hidden (2), ToggleNoView (256) and NoView (32)
      a.set(PDFName.of('F'), PDFNumber.of((flags | 4) & ~(1 | 2 | 32 | 256)));
    }
  }
  // NeedAppearances asks the reader to redraw fields; PDF/A forbids it (appearances are already drawn)
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (acro instanceof PDFDict) acro.delete(PDFName.of('NeedAppearances'));

  // a file identifier
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
}
