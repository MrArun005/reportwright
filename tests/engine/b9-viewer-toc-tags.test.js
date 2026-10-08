// N32: a table of contents in a tagged PDF is TOC > TOCI > Reference > Link (the entry text and its number inside one
// link), with the title as H1, not plain P elements and a Link around the page number only.
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber } from 'pdf-lib';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontStore, report } from '../helpers.js';

const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value, ...extra });
const def = () => report([
  { type: 'toc', name: 'Toc', x: 0, y: 0, w: 400, h: 20, title: 'Contents', source: 'headings' },
  tb('H1', 'North', 80, { headingLevel: 1 }),
  tb('H2', 'South', 140, { headingLevel: 1, pageBreakBefore: true }),
]);
function tree(doc) {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const walk = (d) => {
    const S = d.lookup(PDFName.of('S')).decodeText();
    const K = d.lookup(PDFName.of('K'));
    const kids = (K instanceof PDFArray ? K.asArray() : [K]).map(k => doc.context.lookup(k)).map(k => (k instanceof PDFDict && k.has(PDFName.of('S')) ? walk(k) : k instanceof PDFNumber ? 'mcid' : k instanceof PDFDict && k.get(PDFName.of('Type'))?.toString() === '/OBJR' ? 'objr' : 'mcr'));
    return { S, kids };
  };
  return walk(root.lookup(PDFName.of('K'), PDFDict));
}
const shape = (n) => (n.S ? `${n.S}${n.kids.length ? `(${n.kids.map(shape).join(',')})` : ''}` : n);

describe('a table of contents in a tagged PDF (N32)', () => {
  it('is TOC > TOCI > Reference > Link holding the text, the number and the link annotation; the title is H1', async () => {
    const m = await render(def(), { fontStore, exportData: true });
    const doc = await PDFDocument.load(await exportPdf(m, fontStore, { title: 'T', tagged: {} }));
    const t = tree(doc);
    const s = t.kids.map(shape);
    expect(s[0]).toBe('H1(mcid)');
    expect(s[1]).toBe('TOC(TOCI(Reference(Link(mcid,mcid,objr))),TOCI(Reference(Link(mcid,mcid,objr))))');
  });
});
