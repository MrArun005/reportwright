// PDFKit, manual layout: every row is placed by this code (x, y, a new page when the body is full, the header drawn
// again at the top of each page). "Page N of M" uses bufferPages and switchToPage after the body, as PDFKit's docs
// show, so every page stays in memory until the end. Groups and subtotals come from groupsOf() (PDFKit has none).
// PDFKit 0.20 also has doc.table(); this harness uses manual layout as the contest's PDFKit entry.
// PDF/A: subset 'PDF/A-2b'. PDF/UA: subset 'PDF/UA' + tagged, with the structure tree built by hand (doc.struct per
// cell, decoration and page numbers marked as artifacts): PDFKit's documented way, and why its UA code is longer.
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { FONT, PAGE, COLS, INV_COLS, FONT_SIZE, ROW_H, INVOICE, BODY_W, money, groupsOf, grandTotal } from '../data.mjs';

export const name = 'pdfkit';
export async function setup() {}
export async function teardown() {}

const M = PAGE.margin, L = M, R = M + BODY_W;
const BOTTOM = PAGE.height - M - PAGE.footer; // the body's last y

function open(out, o, title, bufferPages) {
  const subset = o.ua ? (o.pdfa ? 'PDF/A-2a' : 'PDF/UA') : o.pdfa ? 'PDF/A-2b' : undefined;
  const doc = new PDFDocument({ size: [PAGE.width, PAGE.height], margins: { top: M, left: M, right: M, bottom: M }, bufferPages,
    info: { Title: title }, ...(subset ? { subset, pdfVersion: '1.7' } : {}), ...(o.ua ? { tagged: true, lang: 'en-US', displayTitle: true } : {}) });
  doc.registerFont('Inter', FONT.regular);
  doc.registerFont('Inter-Bold', FONT.bold);
  const done = new Promise((ok, fail) => doc.pipe(fs.createWriteStream(out)).on('finish', ok).on('error', fail));
  // drawing helpers; with o.ua, text goes into structure elements and decoration is an artifact
  const art = (fn) => { if (o.ua) doc.markContent('Artifact'); fn(); if (o.ua) doc.endMarkedContent(); };
  const put = (s, x, y, w, { bold = false, size = FONT_SIZE, right = false } = {}) => {
    doc.font(bold ? 'Inter-Bold' : 'Inter').fontSize(size);
    doc.text(s, right ? x + w - 2 - doc.widthOfString(s) : x + 2, y, { lineBreak: false });
  };
  // a structure element around fn's content (o.ua), or just fn
  const tag = (parent, type, fn) => { if (!o.ua) return fn(); const s = doc.struct(type, fn); parent.add(s); s.end(); };
  return { doc, done, art, put, tag };
}

/** one table row: cells [{ text, w, right, bold, span }], bg colour, bottom rule */
function rowDrawer({ doc, art, put, tag }, o) {
  return (parent, y, h, cells, { bg, rule = true, th = false } = {}) => {
    if (bg || rule) art(() => {
      if (bg) doc.rect(L, y, BODY_W, h).fill(bg);
      if (rule) doc.moveTo(L, y + h).lineTo(R, y + h).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
      doc.fillColor('black');
    });
    const tr = o.ua ? doc.struct('TR') : null;
    if (tr) parent.add(tr);
    let x = L;
    for (const c of cells) {
      if (c.text) tag(tr, th ? 'TH' : 'TD', () => put(c.text, x, y + (h - FONT_SIZE) / 2 - 1, c.w, c));
      else if (tr) tr.add(doc.struct(th ? 'TH' : 'TD')); // an empty cell is still a cell
      x += c.w;
    }
    tr?.end();
  };
}

export async function invoice(out, o = {}) {
  const I = INVOICE;
  const k = open(out, o, 'Invoice', false);
  const { doc, put, tag } = k;
  const root = o.ua ? doc.struct('Document') : null;
  if (root) doc.addStructure(root);
  const P = (fn) => tag(root, 'P', fn);
  P(() => put(I.seller.name, L - 2, M, 300, { bold: true, size: 18 }));
  P(() => put('INVOICE', L + 323, M, 200 + 2, { bold: true, size: 18, right: true }));
  I.seller.lines.forEach((l, i) => P(() => put(l, L - 2, M + 26 + i * 12, 300)));
  [`Invoice no ${I.number}`, `Date ${I.date}`, `Due ${I.due}`].forEach((l, i) => P(() => put(l, L + 323, M + 26 + i * 12, 200 + 2, { right: true })));
  P(() => put('Bill to', L - 2, M + 96, 300, { bold: true }));
  P(() => put(I.buyer.name, L - 2, M + 110, 300, { bold: true, size: 10 }));
  I.buyer.lines.forEach((l, i) => P(() => put(l, L - 2, M + 124 + i * 12, 300)));
  const table = o.ua ? doc.struct('Table') : null;
  if (table) root.add(table);
  const row = rowDrawer(k, o);
  let y = M + 196;
  const cols = (vals, bold) => INV_COLS.map((c, i) => ({ text: vals[i], w: c.width, right: c.right, bold }));
  row(table, y, 18, cols(INV_COLS.map(c => c.label), true), { bg: '#eef2f7', th: true }); y += 18;
  for (const it of I.items) { row(table, y, 18, cols(INV_COLS.map(c => it[c.key]))); y += 18; }
  [['Subtotal', I.subtotal], ['VAT 20%', I.tax], ['Total', I.total]].forEach(([l, v], i) => { row(table, y, 18, cols(['', '', l, v], i === 2), { rule: false }); y += 18; });
  table?.end();
  // the note wraps: PDFKit's text wrapping with a width
  tag(root, 'P', () => doc.font('Inter').fontSize(9).text(I.note, L, y + 24, { width: BODY_W }));
  root?.end();
  doc.end();
  await k.done;
  return { pages: 1 };
}

export async function table(rows, out, o = {}) {
  const k = open(out, o, 'Ledger', true);
  const { doc, art, put } = k;
  const root = o.ua ? doc.struct('Document') : null;
  if (root) doc.addStructure(root);
  const tbl = o.ua ? doc.struct('Table') : null;
  if (tbl) root.add(tbl);
  const row = rowDrawer(k, o);
  const cells = (vals, bold) => COLS.map((c, i) => ({ text: vals[i], w: c.width, right: c.right, bold }));
  const header = () => row(tbl, y, 16, cells(COLS.map(c => c.label), true), { bg: '#eef2f7', th: true, rule: false });
  let y = M;
  header(); y += 16;
  const need = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = M; header(); y += 16; } };
  const total = (label, g) => { need(ROW_H); row(tbl, y, ROW_H, cells([label, '', String(g.count), '', '', money(g.sum), ''], true), { rule: false }); y += ROW_H; };
  const groups = groupsOf(rows);
  for (const g of groups) {
    need(16 + ROW_H); // keep a group header with its first row
    // seven cells, the text overflowing the first: PDFKit's structure API has no ColSpan attribute (nor TH Scope)
    row(tbl, y, 16, cells([`Region ${g.region}`, '', '', '', '', '', ''], true), { bg: '#dbeafe', rule: false }); y += 16;
    for (const x of g.rows) {
      need(ROW_H);
      row(tbl, y, ROW_H, cells([String(x.id), x.account, x.region, x.type, x.date, money(x.amount), x.reference]));
      y += ROW_H;
    }
    total('Region total', g);
  }
  total('Grand total', grandTotal(groups));
  tbl?.end();
  root?.end();
  // page numbers, once the page count is known
  const { count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing inside the bottom margin must not add a page
    art(() => put(`Page ${i + 1} of ${count}`, L, BOTTOM + 4, BODY_W, { size: 8, right: true }));
  }
  doc.end();
  await k.done;
  return { pages: count };
}
