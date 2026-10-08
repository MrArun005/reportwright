// A tagged PDF's link annotation says what the link does: the text it covers, else its tooltip, else its URL.
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontStore, report } from '../helpers.js';

const HREF = 'https://example.test/docs';
const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value, ...extra });

async function linkContents(items) {
  const model = await render(report(items), { fontStore, exportData: true });
  const doc = await PDFDocument.load(await exportPdf(model, fontStore, { tagged: { lang: 'en' } }));
  const annots = doc.getPages()[0].node.lookup(PDFName.of('Annots'), PDFArray);
  const out = [];
  for (let i = 0; i < annots.size(); i++) {
    const a = doc.context.lookup(annots.get(i), PDFDict);
    if (a.lookup(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
    out.push(a.lookup(PDFName.of('Contents'))?.decodeText?.());
  }
  return out;
}

describe('link annotation /Contents', () => {
  it('the visible text the link covers', async () => {
    const link = tb('Visit', 'Read the docs', 40, { action: { type: 'url', url: HREF }, tooltip: 'Ignored tip' });
    expect(await linkContents([link])).toEqual(['Read the docs']);
  });
  it('the tooltip when there is no visible text', async () => {
    const empty = tb('Hidden', '', 40, { action: { type: 'url', url: HREF }, tooltip: 'Open the handbook' });
    expect(await linkContents([empty])).toEqual(['Open the handbook']);
  });
  it('the URL when there is neither text nor tooltip', async () => {
    const empty = tb('Hidden', '', 40, { action: { type: 'url', url: HREF } });
    expect(await linkContents([empty])).toEqual([HREF]);
  });
});
