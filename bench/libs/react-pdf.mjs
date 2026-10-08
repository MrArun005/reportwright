// @react-pdf/renderer: React components (written with createElement, so the harness needs no JSX build step).
// The column header is a `fixed` View (repeated on every page), the footer a `fixed` Text with a render prop for
// "Page N of M", rows are flex-row Views with wrap={false}. No table or grouping primitive: groups and subtotals come
// from groupsOf(). No PDF/A or PDF/UA option, so --pdfa / --ua write the ordinary file (and veraPDF says so).
import React from 'react';
import { Document, Page, View, Text, Font, renderToFile } from '@react-pdf/renderer';
import { FONT, PAGE, COLS, INV_COLS, FONT_SIZE, ROW_H, INVOICE, money, groupsOf, grandTotal } from '../data.mjs';

const h = React.createElement;
export const name = '@react-pdf/renderer';
export async function setup() {
  Font.register({ family: 'Inter', fonts: [{ src: FONT.regular }, { src: FONT.bold, fontWeight: 'bold' }] });
  Font.registerHyphenationCallback((word) => [word]); // no hyphenation, like the other libraries
}
export async function teardown() {}

const M = PAGE.margin;
const pageStyle = { fontFamily: 'Inter', fontSize: FONT_SIZE, paddingTop: M, paddingLeft: M, paddingRight: M, paddingBottom: M + PAGE.footer };
const cellStyle = (w, right, bold) => ({ width: w, paddingHorizontal: 2, textAlign: right ? 'right' : 'left', ...(bold ? { fontWeight: 'bold' } : {}) });
const row = (height, cells, extra = {}, props = {}) => h(View, { wrap: false, style: { flexDirection: 'row', alignItems: 'center', height, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', ...extra }, ...props }, ...cells);
const txt = (s, w, right, bold) => h(Text, { style: cellStyle(w, right, bold) }, s);

export async function invoice(out) {
  const I = INVOICE;
  const R = { textAlign: 'right' };
  const doc = h(Document, { title: 'Invoice' }, h(Page, { size: 'A4', style: { ...pageStyle, paddingBottom: M } },
    h(View, { style: { flexDirection: 'row', justifyContent: 'space-between', height: 26 } },
      h(Text, { style: { fontSize: 18, fontWeight: 'bold' } }, I.seller.name), h(Text, { style: { fontSize: 18, fontWeight: 'bold' } }, 'INVOICE')),
    h(View, { style: { flexDirection: 'row', justifyContent: 'space-between', height: 70 } },
      h(View, null, ...I.seller.lines.map(l => h(Text, { style: { height: 12 } }, l))),
      h(View, null, ...[`Invoice no ${I.number}`, `Date ${I.date}`, `Due ${I.due}`].map(l => h(Text, { style: { height: 12, ...R } }, l)))),
    h(Text, { style: { fontWeight: 'bold', height: 14 } }, 'Bill to'),
    h(Text, { style: { fontWeight: 'bold', fontSize: 10, height: 14 } }, I.buyer.name),
    h(View, { style: { height: 72 } }, ...I.buyer.lines.map(l => h(Text, { style: { height: 12 } }, l))),
    row(18, INV_COLS.map(c => txt(c.label, c.width, c.right, true)), { backgroundColor: '#eef2f7', borderBottomWidth: 0 }),
    ...I.items.map(it => row(18, INV_COLS.map(c => txt(it[c.key], c.width, c.right)))),
    ...[['Subtotal', I.subtotal], ['VAT 20%', I.tax], ['Total', I.total]].map(([l, v], i) =>
      row(18, [txt('', INV_COLS[0].width), txt('', INV_COLS[1].width), txt(l, INV_COLS[2].width, true, i === 2), txt(v, INV_COLS[3].width, true, i === 2)], { borderBottomWidth: 0 })),
    h(Text, { style: { marginTop: 24 } }, I.note)));
  await renderToFile(doc, out);
  return { pages: 1 };
}

export async function table(rows, out) {
  const groups = groupsOf(rows);
  let pages = 0;
  const cells = (vals, bold) => COLS.map((c, i) => txt(vals[i], c.width, c.right, bold));
  const total = (label, g, key) => row(ROW_H, cells([label, '', String(g.count), '', '', money(g.sum), ''], true), { borderBottomWidth: 0 }, { key });
  const body = [];
  for (const g of groups) {
    body.push(row(16, [txt(`Region ${g.region}`, 523, false, true)], { backgroundColor: '#dbeafe', borderBottomWidth: 0 }, { key: `g${g.region}`, minPresenceAhead: ROW_H }));
    for (const x of g.rows) body.push(row(ROW_H, cells([String(x.id), x.account, x.region, x.type, x.date, money(x.amount), x.reference]), {}, { key: x.id }));
    body.push(total('Region total', g, `t${g.region}`));
  }
  body.push(total('Grand total', grandTotal(groups), 'grand'));
  const doc = h(Document, { title: 'Ledger' }, h(Page, { size: 'A4', style: pageStyle, wrap: true },
    row(16, cells(COLS.map(c => c.label), true), { backgroundColor: '#eef2f7', borderBottomWidth: 0 }, { fixed: true }),
    ...body,
    h(Text, { fixed: true, style: { position: 'absolute', left: M, right: M, bottom: M, fontSize: 8, textAlign: 'right' },
      render: ({ pageNumber, totalPages }) => { pages = totalPages; return `Page ${pageNumber} of ${totalPages}`; } })));
  await renderToFile(doc, out);
  return { pages };
}
