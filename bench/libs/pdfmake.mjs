// pdfmake: a document definition (content, table with headerRows: 1 so the header repeats, footer(currentPage, pageCount)).
// pdfmake has no grouping: the groups and subtotals are computed by groupsOf() (the same code for every library
// without grouping) and become ordinary table rows. PDF/A and PDF/UA: pdfmake passes `subset`, `version`, `tagged`
// and `language` through to PDFKit; it has no API for a structure tree, so a tagged file has the flag but no tags.
import pdfmake from 'pdfmake';
import { FONT, PAGE, COLS, INV_COLS, FONT_SIZE, INVOICE, money, groupsOf, grandTotal } from '../data.mjs';

export const name = 'pdfmake';
export async function setup() {
  pdfmake.setFonts({ Inter: { normal: FONT.regular, bold: FONT.bold, italics: FONT.regular, bolditalics: FONT.bold } });
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((p) => p === FONT.regular || p === FONT.bold);
}
export async function teardown() {}

const comply = (o, title) => ({
  info: { title },
  ...(o.pdfa ? { subset: 'PDF/A-2b', version: '1.7' } : {}),
  ...(o.ua ? { subset: o.pdfa ? 'PDF/A-2a' : 'PDF/UA', version: '1.7', tagged: true, displayTitle: true, language: 'en-US' } : {}),
});
const lineLayout = { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#e5e7eb',
  paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 2, paddingBottom: () => 1 };

export async function invoice(out, o = {}) {
  const I = INVOICE;
  const r = (text, extra = {}) => ({ text, alignment: 'right', ...extra });
  const dd = {
    pageSize: 'A4', pageMargins: [PAGE.margin, PAGE.margin, PAGE.margin, PAGE.margin],
    defaultStyle: { font: 'Inter', fontSize: 9, lineHeight: 1.1 }, ...comply(o, 'Invoice'),
    content: [
      { columns: [{ text: I.seller.name, fontSize: 18, bold: true }, r('INVOICE', { fontSize: 18, bold: true })], margin: [0, 0, 0, 4] },
      { columns: [{ stack: I.seller.lines }, { stack: [`Invoice no ${I.number}`, `Date ${I.date}`, `Due ${I.due}`].map(t => r(t)) }] },
      { text: 'Bill to', bold: true, margin: [0, 22, 0, 2] },
      { text: I.buyer.name, bold: true, fontSize: 10 },
      { stack: I.buyer.lines, margin: [0, 0, 0, 24] },
      { table: { headerRows: 1, widths: INV_COLS.map(c => c.width - 4), heights: 18 - 3,
        body: [
          INV_COLS.map(c => ({ text: c.label, bold: true, fillColor: '#eef2f7', alignment: c.right ? 'right' : 'left' })),
          ...I.items.map(it => INV_COLS.map(c => ({ text: it[c.key], alignment: c.right ? 'right' : 'left' }))),
          ...[['Subtotal', I.subtotal], ['VAT 20%', I.tax], ['Total', I.total]].map(([l, v], i) => ['', '', r(l, { bold: i === 2 }), r(v, { bold: i === 2 })]),
        ] }, layout: lineLayout },
      { text: I.note, margin: [0, 24, 0, 0] },
    ],
  };
  await pdfmake.createPdf(dd).write(out);
  return { pages: 1 };
}

export async function table(rows, out, o = {}) {
  const groups = groupsOf(rows);
  const total = (label, g) => [{ text: label, bold: true, colSpan: 2 }, '', { text: String(g.count), bold: true }, '', '', { text: money(g.sum), bold: true, alignment: 'right' }, ''];
  const body = [COLS.map(c => ({ text: c.label, bold: true, fillColor: '#eef2f7', alignment: c.right ? 'right' : 'left' }))];
  for (const g of groups) {
    body.push([{ text: `Region ${g.region}`, bold: true, fillColor: '#dbeafe', colSpan: 7 }, '', '', '', '', '', '']);
    for (const x of g.rows) body.push([String(x.id), x.account, x.region, x.type, x.date, { text: money(x.amount), alignment: 'right' }, x.reference]);
    body.push(total('Region total', g));
  }
  body.push(total('Grand total', grandTotal(groups)));
  let pageCount = 0;
  const dd = {
    pageSize: 'A4', pageMargins: [PAGE.margin, PAGE.margin, PAGE.margin, PAGE.margin + PAGE.footer],
    defaultStyle: { font: 'Inter', fontSize: FONT_SIZE, lineHeight: 1.1 }, ...comply(o, 'Ledger'),
    footer: (currentPage, count) => { pageCount = count; return { text: `Page ${currentPage} of ${count}`, alignment: 'right', fontSize: 8, margin: [PAGE.margin, 4, PAGE.margin, 0] }; },
    content: [{ table: { headerRows: 1, widths: COLS.map(c => c.width - 4), body }, layout: lineLayout }],
  };
  await pdfmake.createPdf(dd).write(out);
  return { pages: pageCount };
}
