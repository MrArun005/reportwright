// Batch 4 tester list, group 2: links, the outline and page labels in the PDF (items 1, 2, 3, 4).
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, report } from '../helpers.js';

const annots = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const out = [];
  for (const p of doc.getPages()) {
    const a = p.node.lookup(PDFName.of('Annots'));
    if (!(a instanceof PDFArray)) continue;
    for (const r of a.asArray()) {
      const d = doc.context.lookup(r);
      const A = d.lookup(PDFName.of('A'));
      out.push(A instanceof PDFDict ? { uri: A.lookup(PDFName.of('URI'))?.decodeText?.() ?? String(A.lookup(PDFName.of('URI'))) } : { dest: !!d.get(PDFName.of('Dest')) });
    }
  }
  return { doc, out };
};
const outline = (doc) => {
  const rows = [];
  const walk = (n, d) => { for (let k = n?.lookup?.(PDFName.of('First')); k; k = k.lookup(PDFName.of('Next'))) { rows.push([d, k.lookup(PDFName.of('Title')).decodeText()]); walk(k, d + 1); } };
  walk(doc.catalog.lookup(PDFName.of('Outlines')), 0);
  return rows;
};
const rows = [{ id: 5, r: 'North', b: 'B1' }, { id: 6, r: 'North', b: 'B2' }, { id: 7, r: 'South', b: 'B3' }];

describe('1, 2: links in the PDF', () => {
  const def = () => {
    const d = report([
      { type: 'textbox', name: 'Top', x: 0, y: 0, w: 200, h: 16, value: 'Top', bookmark: 'Top' },
      { type: 'textbox', name: 'Url', x: 0, y: 20, w: 200, h: 16, value: 'Café', action: { type: 'url', url: 'https://example.com/café?q=ü' } },
      { type: 'textbox', name: 'Back', x: 0, y: 40, w: 200, h: 16, value: 'Back to top', action: { type: 'bookmark', target: 'Top' } },
      { type: 'table', name: 'T', x: 0, y: 60, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }], header: [{ height: 14, cells: [{ value: 'Id' }] }],
        detail: [{ height: 14, cells: [{ value: '=Fields.id', action: { type: 'report', report: 'account-detail', params: { accountId: '=Fields.id', tag: 'a b' } } }] }] },
    ], { data: { rows } });
    return d;
  };
  it('drill-through becomes a URI to the viewer with its parameters when a base URL is known; jumps go to their place', async () => {
    const model = await render(def(), { fontStore });
    const { out } = await annots(await exportPdf(model, fontStore, { drillBase: 'https://pw.example/' }));
    const uris = out.filter(o => o.uri).map(o => o.uri);
    expect(uris).toContain('https://pw.example/viewer/account-detail?accountId=5&tag=a+b');
    expect(uris).toContain('https://pw.example/viewer/account-detail?accountId=7&tag=a+b');
    expect(uris).toContain('https://example.com/caf%C3%A9?q=%C3%BC'); // a URI is ASCII
    expect(out.filter(o => o.dest).length).toBe(1);
  });
  it('without a base URL a drill-through is not a link (as in the HTML export)', async () => {
    const { out } = await annots(await exportPdf(await render(def(), { fontStore }), fontStore));
    expect(out.filter(o => o.uri && o.uri.includes('/viewer/'))).toEqual([]);
  });
  it('validate() warns about text styled as a link that has no action', () => {
    const d = report([{ type: 'textbox', name: 'Fake', x: 0, y: 0, w: 100, h: 16, value: 'Open account', style: { color: '#2563eb', textDecoration: 'underline' } }]);
    expect(validate(d).warnings.join('\n')).toMatch(/Fake: .*looks like a link/);
    const ok = report([{ type: 'textbox', name: 'Real', x: 0, y: 0, w: 100, h: 16, value: 'Open', style: { textDecoration: 'underline' }, action: { type: 'url', url: 'https://x.io' } }]);
    expect(validate(ok).warnings.join('\n')).not.toMatch(/looks like a link/);
  });
});

describe('3: the outline nests (headings and groups)', () => {
  it('headings by level; a table\'s groups under its bookmark, inner groups under outer ones', async () => {
    const d = report([
      { type: 'textbox', name: 'H1', x: 0, y: 0, w: 200, h: 18, value: 'Portfolio', headingLevel: 1 },
      { type: 'textbox', name: 'H2', x: 0, y: 20, w: 200, h: 16, value: 'By region', headingLevel: 2 },
      { type: 'table', name: 'T', x: 0, y: 40, w: 200, h: 40, dataSet: 'Rows', bookmark: 'Accounts', columns: [{ width: 200 }],
        groups: [{ name: 'R', expr: '=Fields.r', header: [{ height: 14, cells: [{ value: '=Fields.r', bookmark: '=Fields.r' }] }] },
          { name: 'B', expr: '=Fields.b', header: [{ height: 14, cells: [{ value: '=Fields.b', bookmark: '=Fields.b' }] }] }],
        detail: [{ height: 14, cells: [{ value: '=Fields.id' }] }] },
    ], { data: { rows } });
    const { doc } = await annots(await exportPdf(await render(d, { fontStore }), fontStore));
    expect(outline(doc)).toEqual([[0, 'Portfolio'], [1, 'By region'], [0, 'Accounts'], [1, 'North'], [2, 'B1'], [2, 'B2'], [1, 'South'], [2, 'B3']]);
  });
});

describe('4: page labels', () => {
  it('every PDF has them; a section that restarts its numbering restarts its labels', async () => {
    const d = report([{ type: 'list', name: 'L', x: 0, y: 0, w: 200, h: 20, dataSet: 'Rows', newSection: true, pageBreakBetween: true, items: [{ type: 'textbox', x: 0, y: 0, w: 100, h: 16, value: '=Fields.r' }] }], { data: { rows } });
    const doc = await PDFDocument.load(await exportPdf(await render(d, { fontStore }), fontStore));
    const nums = doc.catalog.lookup(PDFName.of('PageLabels')).lookup(PDFName.of('Nums')).asArray().filter((_, i) => i % 2 === 0).map(n => n.asNumber());
    expect(nums[0]).toBe(0);
    expect(nums.length).toBe(doc.getPageCount());
  });
});
