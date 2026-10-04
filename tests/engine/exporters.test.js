import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { render } from '../../src/engine/index.js';
import { exportCsv } from '../../src/exporters/csv.js';
import { exportXlsx, excelFormat } from '../../src/exporters/xlsx.js';
import { exportHtml } from '../../src/exporters/html.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontStore, report } from '../helpers.js';

const data = { rows: [
  { region: 'South', city: 'Bengaluru', amt: 1234.5, on: '2026-01-05' },
  { region: 'North', city: 'Delhi, NCR', amt: 50, on: '2026-02-01' },
  { region: 'South', city: 'Chennai', amt: 200, on: '2026-03-10' },
] };
const def = () => {
  const d = report([{
    type: 'table', name: 'Sales', x: 0, y: 0, w: 300, h: 54, dataSet: 'Rows', columns: [{ width: 120 }, { width: 100 }, { width: 80 }],
    header: [{ height: 18, cells: [{ value: 'City' }, { value: 'On' }, { value: 'Amount' }] }],
    groups: [{ name: 'Region', expr: '=Fields.region', sort: 'asc', header: [{ height: 18, cells: [{ value: '=Fields.region', colSpan: 3 }, null, null] }], footer: [] }],
    detail: [{ height: 18, cells: [{ value: '=Fields.city' }, { value: '=Fields.on', style: { format: 'dd MMM yyyy' } }, { value: '=Fields.amt', style: { format: 'N2' } }] }],
    footer: [{ height: 18, cells: [{ value: 'Total', colSpan: 2 }, null, { value: '=Sum(Fields.amt)', style: { format: 'C2' } }] }],
    bookmark: 'Sales',
  }, { type: 'textbox', name: 'Link', x: 0, y: 80, w: 100, h: 14, value: 'Site', action: { type: 'url', url: 'https://example.com' }, bookmark: 'Footer link' }], { data });
  d.dataSets[0].fields = [{ name: 'region', type: 'string' }, { name: 'city', type: 'string' }, { name: 'amt', type: 'number' }, { name: 'on', type: 'date' }];
  return d;
};

describe('exporters', () => {
  it('writes CSV with raw numbers, ISO dates and quoting', async () => {
    const out = await render(def(), { fontStore });
    const csv = exportCsv(out);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Delhi, NCR",2026-02-01,50');
    expect(csv).toContain('Bengaluru,2026-01-05,1234.5');
    expect(csv).toContain('Total,,1484.5');
  });

  it('writes an Excel sheet with types, formats, merges and outline levels', async () => {
    const out = await render(def(), { fontStore });
    const bytes = await exportXlsx(out, ExcelJS, { currency: 'INR' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.getWorksheet('Sales');
    expect(ws.getRow(1).getCell(1).value).toBe('City');
    expect(ws.getRow(2).getCell(1).value).toBe('North');               // group header, sorted
    const r3 = ws.getRow(3);
    expect(r3.getCell(1).value).toBe('Delhi, NCR');
    expect(r3.getCell(2).value).toBeInstanceOf(Date);
    expect(r3.getCell(3).value).toBe(50);
    expect(r3.getCell(3).numFmt).toBe('#,##0.00');
    expect(r3.outlineLevel).toBe(1);
    const last = ws.getRow(ws.rowCount);
    expect(last.getCell(3).value).toEqual({ formula: 'SUBTOTAL(9,C3,C5:C6)', result: 1484.5 }); // a live total (exports batch 2)
    expect(last.getCell(3).numFmt).toBe('"₹"#,##0.00');
    expect(ws.model.merges.length).toBeGreaterThan(0);
    expect(excelFormat('dd MMM yyyy')).toBe('dd mmm yyyy');
  });

  it('writes self-contained HTML with subset-free fallback fonts and live URL links', async () => {
    const out = await render(def(), { fontStore });
    const html = await exportHtml(out, fontStore, { title: 'T' });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('@font-face');
    expect(html).toContain('<svg');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).not.toContain('data-action');
  });

  it('adds URL annotations and an outline to the PDF', async () => {
    const out = await render(def(), { fontStore });
    expect(out.bookmarks.map(b => b.label)).toEqual(['Sales', 'Footer link']); // the table's own bookmark counts too
    const bytes = await exportPdf(out, fontStore);
    const { PDFDocument, PDFName } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
    const link = doc.context.lookup(annots.get(0));
    expect(String(link.lookup(PDFName.of('A')).lookup(PDFName.of('URI')))).toContain('https://example.com');
    expect(doc.catalog.lookup(PDFName.of('Outlines'))).toBeTruthy();
  });
});

describe('PDF internal links', () => {
  const tb = (name, value, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value, ...extra });
  const def = () => report([
    { type: 'toc', name: 'Toc', x: 0, y: 0, w: 400, h: 20, title: 'Contents', source: 'headings' },
    tb('Jump', 'Go to the results', 60, { action: { type: 'bookmark', target: 'Results here' } }),
    tb('Nowhere', 'Missing', 80, { action: { type: 'bookmark', target: 'No such bookmark' } }),
    tb('H1', 'Intro', 100, { headingLevel: 1 }),
    tb('H2', 'Results', 140, { headingLevel: 1, bookmark: 'Results here', pageBreakBefore: true }),
  ]);
  it('bookmark jumps and TOC entries are GoTo links to the target page and height', async () => {
    const { PDFDocument, PDFName, PDFArray } = await import('pdf-lib');
    const m = await render(def(), { fontStore });
    expect(m.pages.length).toBe(2);
    const results = m.bookmarks.find(b => b.label === 'Results here');
    expect(results.page).toBe(2);
    const doc = await PDFDocument.load(await exportPdf(m, fontStore));
    const pages = doc.getPages();
    const H = pages[0].getHeight();
    const links = pages[0].node.lookup(PDFName.of('Annots'), PDFArray).asArray().map(r => doc.context.lookup(r)).map(a => {
      expect(a.lookup(PDFName.of('Subtype')).toString()).toBe('/Link');
      const d = a.lookup(PDFName.of('Dest'), PDFArray);
      expect(d.get(1).toString()).toBe('/XYZ');
      // which page it goes to, the height there, and the link's own top in model coordinates
      return { page: pages.findIndex(p => p.ref === d.get(0)) + 1, top: d.lookup(3).asNumber(), at: H - a.lookup(PDFName.of('Rect'), PDFArray).lookup(3).asNumber() };
    });
    // two TOC lines (Intro p1, Results p2) and the jump; a link to a missing bookmark writes nothing
    expect(links.length).toBe(3);
    const toResults = links.filter(l => l.page === 2);
    expect(toResults.length).toBe(2);
    for (const l of toResults) expect(l.top).toBeCloseTo(H - results.y + 4, 3);
    const jump = m.pages[0].items.find(i => i.t === 'link' && i.action.target === 'Results here' && !i.action.page);
    expect(toResults.some(l => Math.abs(l.at - jump.y) < 0.01)).toBe(true);
    expect(links.filter(l => l.page === 1).length).toBe(1); // Intro, a heading on page 1
  });
});

describe('PDF outline', () => {
  it('nests bookmarks by level, with First/Last/Next/Prev/Parent/Count', async () => {
    const { PDFDocument, PDFName, PDFNumber } = await import('pdf-lib');
    const tb = (name, y, extra) => ({ type: 'textbox', name, x: 0, y, w: 300, h: 18, value: name, ...extra });
    const m = await render(report([
      tb('A', 0, { bookmark: 'A' }),
      tb('A1', 20, { bookmark: 'A1', bookmarkLevel: 1 }),
      tb('A2', 40, { bookmark: 'A2', headingLevel: 2 }), // a bookmarked heading: its level is the heading's
      tb('A2x', 60, { bookmark: 'A2x', bookmarkLevel: 3 }), // a skipped level: still the child of A2
      tb('B', 80, { bookmark: 'B' }),
      tb('Hd', 100, { headingLevel: 1 }), // a heading without a bookmark stays out of the outline
    ]), { fontStore });
    expect(m.bookmarks.map(b => [b.label, b.level])).toEqual([['A', 0], ['A1', 1], ['A2', 1], ['A2x', 3], ['B', 0]]);
    const doc = await PDFDocument.load(await exportPdf(m, fontStore));
    const get = (d, k) => d.lookup(PDFName.of(k));
    const ref = (d, k) => d.get(PDFName.of(k));
    const title = (d) => d && get(d, 'Title').decodeText();
    const kids = (d) => { const out = []; for (let k = get(d, 'First'); k; k = get(k, 'Next')) out.push(k); return out; };
    const root = doc.catalog.lookup(PDFName.of('Outlines'));
    const tree = (d) => kids(d).map(k => (kids(k).length ? { [title(k)]: tree(k) } : title(k)));
    expect(tree(root)).toEqual([{ A: ['A1', { A2: ['A2x'] }] }, 'B']);
    expect(get(root, 'Count')).toEqual(PDFNumber.of(5));
    const [a, b] = kids(root);
    expect(get(a, 'Count')).toEqual(PDFNumber.of(3)); // open: every descendant shows
    expect(get(b, 'Count')).toBeUndefined();
    expect(title(get(root, 'Last'))).toBe('B');
    expect(ref(a, 'Parent')).toBe(doc.catalog.get(PDFName.of('Outlines')));
    const [a1, a2] = kids(a);
    expect(ref(a1, 'Parent')).toBe(ref(root, 'First'));
    expect(ref(a2, 'Prev')).toBe(ref(a, 'First'));
    expect(ref(a2, 'Next')).toBeUndefined();
    expect(title(get(a, 'Last'))).toBe('A2');
    expect(title(get(kids(a2)[0], 'Parent'))).toBe('A2');
    expect(title(a1)).toBe('A1'); // no indentation spaces: the nesting shows the level
  });
});

describe('HTML export links', () => {
  const linked = (action, tooltip) => report([{ type: 'textbox', name: 'L', x: 0, y: 0, w: 200, h: 20, value: 'Open', action, ...(tooltip ? { tooltip } : {}) }]);
  const html = async (def) => exportHtml(await render(def, { fontStore }), fontStore);
  it('the href is the action URL, never the tooltip', async () => {
    const out = await html(linked({ type: 'url', url: 'https://ok.example/a?b=1&c=2' }, 'javascript:alert(1)'));
    expect(out).toContain('href="https://ok.example/a?b=1&amp;c=2"');
    expect(out).not.toMatch(/href="javascript:/i);
  });
  it('drops links that a browser would open somewhere else or run', async () => {
    for (const url of ['//evil.example/x', '/\\evil.example', 'javascript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x']) {
      const out = await html(linked({ type: 'url', url }));
      expect(out, url).not.toMatch(/<a href/);
    }
  });
  it('keeps safe relative and mailto links', async () => {
    expect(await html(linked({ type: 'url', url: '/viewer/x?y=1' }))).toContain('href="/viewer/x?y=1"');
    expect(await html(linked({ type: 'url', url: 'mailto:a@b.example' }))).toContain('href="mailto:a@b.example"');
  });
});

describe('PDF strings cannot break out of their objects', () => {
  const evil = 'Q3) >> /S /JavaScript /JS (app.alert(1)) /X (';
  it('bookmark titles and link URLs with parentheses add no JavaScript action, and titles round-trip', async () => {
    const { PDFDocument, PDFDict, PDFName } = await import('pdf-lib');
    const def = report([{ type: 'textbox', name: 'B', x: 0, y: 0, w: 300, h: 20, value: 'Region', bookmark: `="${evil}"`, action: { type: 'url', url: `https://ok.example/a${encodeURIComponent(')')})/x)>>/S/JavaScript/JS(app.alert(2))` } },
      { type: 'textbox', name: 'H', x: 0, y: 30, w: 300, h: 20, value: 'हिंदी', bookmark: '=\"दक्षिण क्षेत्र\"' }]);
    const doc = await PDFDocument.load(await exportPdf(await render(def, { fontStore }), fontStore));
    const dicts = doc.context.enumerateIndirectObjects().map(([, o]) => o).filter(o => o instanceof PDFDict);
    for (const d of dicts) {
      expect(d.get(PDFName.of('S'))?.toString()).not.toBe('/JavaScript');
      expect(d.has(PDFName.of('JS'))).toBe(false);
    }
    const titles = dicts.filter(d => d.has(PDFName.of('Title')) && d.has(PDFName.of('Dest'))).map(d => d.lookup(PDFName.of('Title')).decodeText());
    expect(titles).toContain(evil);
    expect(titles).toContain('दक्षिण क्षेत्र');
  });
});
