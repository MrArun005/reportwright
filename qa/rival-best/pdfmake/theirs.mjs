// pdfmake's showcase: tables nested in table cells (its playground "tables" example, scaled).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { orders } from './data.mjs';
const PdfPrinter = createRequire(import.meta.url)('pdfmake/src/printer');
const printer = new PdfPrinter({ Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } });
const body = [[{ text: 'Order', bold: true }, { text: 'Customer', bold: true }, { text: 'Lines', bold: true }]];
for (const o of orders) body.push([o.id, o.customer, { table: { widths: ['*', 40, 60], body: [['SKU', 'Qty', 'Price'].map((text) => ({ text, bold: true })), ...o.lines.map((l) => [l.sku, String(l.qty), l.price.toFixed(2)])] }, layout: 'lightHorizontalLines' }]);
const doc = printer.createPdfKitDocument({ pageSize: 'A4', pageMargins: 40, defaultStyle: { font: 'Helvetica', fontSize: 9 },
  content: [{ text: 'Orders', fontSize: 18, bold: true, margin: [0, 0, 0, 10] }, { table: { headerRows: 1, widths: [70, 110, '*'], body } }] });
doc.pipe(fs.createWriteStream(process.env.OUT + '/theirs.pdf'));
doc.end();
