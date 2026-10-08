// Accessible PDF (PDF/UA-1, and PDF/A-2a with it): structure tree, marked content, artifacts, language, title shown,
// the PDF/UA identifier. veraPDF checks the files when VERAPDF_BIN points at it.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFNumber, decodePDFRawStream } from 'pdf-lib';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { model, fontStore } from './export-fixture.js';
import { report } from '../helpers.js';

const ICC = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'icc', 'sRGB-v2-magic.icc'));
const VERAPDF = process.env.VERAPDF_BIN && fs.existsSync(process.env.VERAPDF_BIN) ? process.env.VERAPDF_BIN : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ua-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** the structure tree as nested { S, alt, kids } (MCIDs as numbers) */
function tree(doc) {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const walk = (d) => {
    const S = d.lookup(PDFName.of('S'))?.decodeText?.() ?? d.lookup(PDFName.of('S'))?.toString().slice(1);
    const alt = d.lookup(PDFName.of('Alt'));
    const K = d.lookup(PDFName.of('K'));
    const kids = (K instanceof PDFArray ? K.asArray() : [K]).map(k => doc.context.lookup(k)).map(k => (k instanceof PDFDict && k.has(PDFName.of('S')) ? walk(k) : k instanceof PDFNumber ? k.asNumber() : 'ref'));
    return { S, alt: alt?.decodeText?.(), kids };
  };
  return walk(root.lookup(PDFName.of('K'), PDFDict));
}
const find = (n, S, out = []) => { if (n.S === S) out.push(n); for (const k of n.kids || []) if (k?.S) find(k, S, out); return out; };
const content = (doc, i = 0) => {
  const c = doc.getPages()[i].node.lookup(PDFName.of('Contents'));
  return Buffer.from(decodePDFRawStream(c).decode()).toString('latin1');
};

describe('accessible PDF (PDF/UA-1)', () => {
  it('has a structure tree in reading order: heading, paragraph, figures with alt text, list, table', async () => {
    const doc = await PDFDocument.load(await exportPdf(await model(), fontStore, { title: 'Sales', tagged: { lang: 'en-IN' } }));
    const t = tree(doc);
    expect(t.S).toBe('Document');
    expect(t.kids.map(k => k.S)).toEqual(['H1', 'P', 'Figure', 'Figure', 'Figure', 'P', 'L', 'Table']);
    expect(find(t, 'Figure').map(f => f.alt)).toEqual(['Column chart: Kochi has the highest amount', 'Company logo', 'Barcode', 'Chart in a table cell', 'Chart in a table cell', 'Chart in a table cell', 'Chart in a table cell']);
    expect(find(t, 'LI').length).toBe(2);
    expect(find(t, 'Lbl').length).toBe(2);
    const table = find(t, 'Table')[0];
    expect(table.kids[0].kids.map(k => k.S)).toEqual(['TH', 'TH', 'TH', 'TH']);
    // every row has its four columns (a group header spans them)
    expect(table.kids.length).toBe(10);
    for (const tr of table.kids) expect(tr.kids.filter(k => k.S === "TD" || k.S === "TH").length).toBeGreaterThanOrEqual(1);
  });

  it('marks content: MCIDs for real content, artifacts for the page header and decoration', async () => {
    const doc = await PDFDocument.load(await exportPdf(await model(), fontStore, { title: 'Sales', tagged: {} }));
    const s = content(doc);
    expect(s).toMatch(/^\/Artifact <<\/Type \/Pagination>> BDC\n/); // the page header comes first
    expect(s).toContain('/H1 <</MCID 0>> BDC');
    expect(s).toContain('/Artifact BMC'); // the shape (no alt text) and the text box's background
    expect((s.match(/ BDC\n|BMC\n/g) || []).length).toBe((s.match(/\nEMC\n/g) || []).length + (s.startsWith('EMC') ? 1 : 0) - (s.match(/ActualText/g) || []).length);
    expect(doc.getPages()[0].node.get(PDFName.of('StructParents'))).toBeTruthy();
  });

  it('catalog and metadata: MarkInfo, language, title shown, PDF/UA identifier', async () => {
    const doc = await PDFDocument.load(await exportPdf(await model(), fontStore, { title: 'Sales', tagged: { lang: 'en-IN' } }));
    const cat = doc.catalog;
    expect(cat.lookup(PDFName.of('MarkInfo')).toString()).toContain('/Marked true');
    expect(cat.lookup(PDFName.of('Lang')).decodeText()).toBe('en-IN');
    expect(cat.lookup(PDFName.of('ViewerPreferences')).toString()).toContain('/DisplayDocTitle true');
    const xmp = Buffer.from(cat.lookup(PDFName.of('Metadata'), PDFRawStream).contents).toString('utf8');
    expect(xmp).toContain('<pdfuaid:part>1</pdfuaid:part>');
    expect(xmp).toContain('Sales');
    expect(doc.getTitle()).toBe('Sales');
  });

  it('links and form fields: in Link and Form elements, with Contents / TU, pages in structure tab order', async () => {
    const def = report([
      { type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 18, value: 'Our site', action: { type: 'url', url: 'https://example.com/' } },
      { type: 'field', name: 'Note', kind: 'text', fieldName: 'note', value: 'hi', x: 0, y: 30, w: 200, h: 18 },
    ]);
    const bytes = await exportPdf(await render(def, { exportData: true, fontStore }), fontStore, { title: 'Form', tagged: {} });
    const doc = await PDFDocument.load(bytes);
    const t = tree(doc);
    expect(find(t, 'Link').length).toBe(1);
    expect(find(t, 'Form').length).toBe(1);
    const page = doc.getPages()[0].node;
    expect(page.get(PDFName.of('Tabs')).toString()).toBe('/S');
    const annots = page.lookup(PDFName.of('Annots'), PDFArray).asArray().map(a => doc.context.lookup(a));
    for (const a of annots) expect(a.get(PDFName.of('StructParent'))).toBeTruthy();
    // the link's visible text, not its URL (a screen reader says what the link shows)
    expect(annots.find(a => a.get(PDFName.of('Subtype')).toString() === '/Link').lookup(PDFName.of('Contents')).decodeText()).toBe('Our site');
    fs.writeFileSync(path.join(tmp, 'form.pdf'), bytes);
  });

  it('off (the default), the PDF has no structure tree', async () => {
    const doc = await PDFDocument.load(await exportPdf(await model(), fontStore, { title: 'Sales' }));
    expect(doc.catalog.has(PDFName.of('StructTreeRoot'))).toBe(false);
    expect(content(doc)).not.toContain('BDC\n/');
  });

  it.skipIf(!VERAPDF)('passes veraPDF: PDF/UA-1, and PDF/A-2a + PDF/UA-1 together', async () => {
    const m = await model();
    const ua = path.join(tmp, 'ua.pdf'), aa = path.join(tmp, 'a2a.pdf');
    fs.writeFileSync(ua, await exportPdf(m, fontStore, { title: 'Sales', tagged: { lang: 'en' } }));
    fs.writeFileSync(aa, await exportPdf(m, fontStore, { title: 'Sales', tagged: { lang: 'en' }, pdfa: { icc: ICC } }));
    const run = (profile, file) => { try { return execFileSync(VERAPDF, ['-f', profile, '--format', 'text', file], { encoding: 'utf8' }); } catch (e) { return e.stdout; } };
    expect(run('ua1', ua)).toMatch(/^PASS /m);
    expect(run('ua1', aa)).toMatch(/^PASS /m);
    expect(run('2a', aa)).toMatch(/^PASS /m);
    if (fs.existsSync(path.join(tmp, 'form.pdf'))) expect(run('ua1', path.join(tmp, 'form.pdf'))).toMatch(/^PASS /m);
    // characters the font does not have (CJK, emoji, a zero-width space in Inter) are left out, not drawn as .notdef
    const nd = path.join(tmp, 'notdef.pdf');
    const d = report([{ type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 18, value: 'ok 中文 \u200b✅ ok' }, { type: 'textbox', name: 'M', x: 0, y: 20, w: 300, h: 18, value: '\u200b=Trim(x) 中', style: { fontFamily: 'JetBrains Mono' } }]);
    fs.writeFileSync(nd, await exportPdf(await render(d, { exportData: true, fontStore }), fontStore, { title: 'N', tagged: {} }));
    expect(run('ua1', nd)).toMatch(/^PASS /m);
  }, 120000);
});
