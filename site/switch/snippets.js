// The "same invoice" for the Switch page. One source of truth: the page shows these strings,
// and scripts/check-switch-snippets.mjs runs RW_CODE against the real @reportwright/engine.
// The other libraries' snippets are written from their public docs and are NOT run here.

export const INVOICE = {
  number: 'INV-1001',
  customer: 'Asha Traders',
  lines: [
    { item: 'Steel bracket', qty: 4, price: 120.5 },
    { item: 'Hinge pack', qty: 10, price: 15 },
    { item: 'Copper wire', qty: 2, price: 900 },
  ],
};

const right = { textAlign: 'right' };
export const INVOICE_REPORT = {
  $schema: 'pagewright/report@1',
  name: 'Invoice',
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'inv', type: 'json', data: { lines: INVOICE.lines.map(l => ({ ...l, amount: l.qty * l.price })) } }],
  dataSets: [{ name: 'Lines', source: 'inv', path: '$.lines' }],
  sections: { body: { items: [
    { type: 'textbox', name: 'Title', x: 0, y: 0, w: 400, h: 24, value: `Invoice ${INVOICE.number}`, style: { fontSize: 18, fontWeight: 'bold' } },
    { type: 'textbox', name: 'BillTo', x: 0, y: 28, w: 400, h: 16, value: `Bill to: ${INVOICE.customer}` },
    { type: 'table', name: 'Lines', x: 0, y: 60, w: 523, h: 60, dataSet: 'Lines', repeatHeader: true,
      columns: [{ width: 253 }, { width: 50 }, { width: 100 }, { width: 120 }],
      header: [{ height: 18, style: { fontWeight: 'bold' }, cells: [{ value: 'Item' }, { value: 'Qty', style: right }, { value: 'Price', style: right }, { value: 'Amount', style: right }] }],
      detail: [{ height: 18, cells: [{ value: '=Fields.item' }, { value: '=Fields.qty', style: right }, { value: '=Fields.price', style: { ...right, format: 'N2' } }, { value: '=Fields.amount', style: { ...right, format: 'N2' } }] }],
      footer: [{ height: 18, style: { fontWeight: 'bold' }, cells: [{ value: 'Total' }, { value: '' }, { value: '' }, { value: '=Sum(Fields.amount)', style: { ...right, format: 'N2' } }] }] },
  ] } },
};

export const RW_CODE = `import { render, defaultFontStore, exportPdf } from '@reportwright/engine';
import fs from 'node:fs';

// The report is data: a JSON definition. This one is also what the viewer above is showing.
const report = ${JSON.stringify(INVOICE_REPORT, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, '$1:').replace(/"/g, "'")};

const fonts = defaultFontStore();                       // from @reportwright/fonts
const model = await render(report, { fontStore: fonts }); // the laid-out pages
fs.writeFileSync('invoice.pdf', await exportPdf(model, { fonts, title: 'Invoice' }));
// same model: exportXlsx(model, { fonts }), exportDocx(model, { fonts }), exportHtml(model), exportCsv(model)
// (Excel, Word, CSV and HTML rebuild tables from data: render(report, { fontStore: fonts, exportData: true }))
`;

const lines = `const invoice = {
  number: 'INV-1001',
  customer: 'Asha Traders',
  lines: [
    { item: 'Steel bracket', qty: 4, price: 120.5 },
    { item: 'Hinge pack', qty: 10, price: 15 },
    { item: 'Copper wire', qty: 2, price: 900 },
  ],
};
const total = invoice.lines.reduce((s, l) => s + l.qty * l.price, 0);`;

export const OTHERS = {
  pdfmake: { label: 'pdfmake', code: `import pdfMake from 'pdfmake/build/pdfmake';
import 'pdfmake/build/vfs_fonts';

${lines}

pdfMake.createPdf({
  content: [
    { text: \`Invoice \${invoice.number}\`, fontSize: 18, bold: true },
    { text: \`Bill to: \${invoice.customer}\`, margin: [0, 4, 0, 16] },
    { table: {
        headerRows: 1,
        widths: ['*', 40, 70, 80],
        body: [
          ['Item', 'Qty', 'Price', 'Amount'].map(t => ({ text: t, bold: true })),
          ...invoice.lines.map(l => [l.item, l.qty, l.price.toFixed(2), (l.qty * l.price).toFixed(2)]),
          [{ text: 'Total', bold: true, colSpan: 3 }, {}, {}, { text: total.toFixed(2), bold: true }],
        ],
    } },
  ],
}).download('invoice.pdf');` },
  reactpdf: { label: '@react-pdf/renderer', code: `import { Document, Page, View, Text, StyleSheet, renderToFile } from '@react-pdf/renderer';

${lines}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10 },
  row: { flexDirection: 'row' },
  item: { flex: 1 },
  num: { width: 80, textAlign: 'right' },
  bold: { fontWeight: 'bold' },
});

const Invoice = () => (
  <Document>
    <Page size="A4" style={s.page}>
      <Text style={{ fontSize: 18 }}>Invoice {invoice.number}</Text>
      <Text>Bill to: {invoice.customer}</Text>
      <View style={[s.row, s.bold]}><Text style={s.item}>Item</Text><Text style={s.num}>Qty</Text><Text style={s.num}>Price</Text><Text style={s.num}>Amount</Text></View>
      {invoice.lines.map(l => (
        <View style={s.row} key={l.item}>
          <Text style={s.item}>{l.item}</Text><Text style={s.num}>{l.qty}</Text>
          <Text style={s.num}>{l.price.toFixed(2)}</Text><Text style={s.num}>{(l.qty * l.price).toFixed(2)}</Text>
        </View>
      ))}
      <View style={[s.row, s.bold]}><Text style={s.item}>Total</Text><Text style={s.num}>{total.toFixed(2)}</Text></View>
    </Page>
  </Document>
);

await renderToFile(<Invoice />, 'invoice.pdf');` },
  puppeteer: { label: 'Puppeteer (HTML to PDF)', code: `import puppeteer from 'puppeteer';

${lines}

const rows = invoice.lines.map(l =>
  \`<tr><td>\${l.item}</td><td class="n">\${l.qty}</td><td class="n">\${l.price.toFixed(2)}</td><td class="n">\${(l.qty * l.price).toFixed(2)}</td></tr>\`).join('');
const html = \`<style>td,th{padding:3px 4px}.n{text-align:right}</style>
  <h1>Invoice \${invoice.number}</h1><p>Bill to: \${invoice.customer}</p>
  <table style="width:100%;border-collapse:collapse">
    <thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead>
    <tbody>\${rows}</tbody>
    <tfoot><tr><th>Total</th><td></td><td></td><th class="n">\${total.toFixed(2)}</th></tr></tfoot>
  </table>\`;

const browser = await puppeteer.launch();     // downloads and starts a Chromium
const page = await browser.newPage();
await page.setContent(html);
await page.pdf({ path: 'invoice.pdf', format: 'A4', margin: { top: '36pt', bottom: '36pt', left: '36pt', right: '36pt' } });
await browser.close();` },
  pdfkit: { label: 'PDFKit', code: `import PDFDocument from 'pdfkit';
import fs from 'node:fs';

${lines}

const doc = new PDFDocument({ size: 'A4', margin: 36 });
doc.pipe(fs.createWriteStream('invoice.pdf'));

doc.fontSize(18).text(\`Invoice \${invoice.number}\`);
doc.fontSize(10).text(\`Bill to: \${invoice.customer}\`);

// no table object: you place every cell yourself, and add the page when y runs out
let y = 110;
const row = (cells, bold) => {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
  cells.forEach((t, i) => doc.text(String(t), [36, 290, 340, 440][i], y, { width: i ? 80 : 250, align: i ? 'right' : 'left' }));
  y += 18;
};
row(['Item', 'Qty', 'Price', 'Amount'], true);
for (const l of invoice.lines) row([l.item, l.qty, l.price.toFixed(2), (l.qty * l.price).toFixed(2)]);
row(['Total', '', '', total.toFixed(2)], true);

doc.end();` },
};

/** their concept -> ours; kept to what the engine docs and the check script back up */
export const CONCEPTS = [
  ['Document definition object / JSX tree / HTML string / drawing calls', 'A JSON report definition (<code>$schema: "pagewright/report@1"</code>). It is data, so it can be saved, diffed, validated (<code>validate()</code>) and opened in the designer.'],
  ['A table you build from <code>body</code> rows, <code>&lt;View&gt;</code> rows, <code>&lt;tr&gt;</code> or <code>doc.text(x, y)</code>', 'A <code>table</code> item bound to a data set: one <code>detail</code> row repeated per record, plus <code>header</code> and <code>footer</code> rows. <code>repeatHeader: true</code> repeats the header on each page.'],
  ['<code>invoice.lines.map(...)</code> and <code>reduce</code> for the total', '<code>=Fields.qty</code> in a cell, <code>=Sum(Fields.amount)</code> in the footer. Groups, sorts and filters are properties of the table.'],
  ['<code>toFixed(2)</code>, <code>toLocaleString</code>', 'A cell style <code>format</code> such as <code>N2</code> or <code>C2</code>, read in the report\'s locale.'],
  ['Page size and margins (<code>pageSize</code>, <code>&lt;Page size&gt;</code>, <code>format</code>, <code>margin</code>)', '<code>page: { size: "A4", margins: [36, 36, 36, 36] }</code>, in points.'],
  ['Headers, footers, page numbers (pdfmake <code>footer</code>, react-pdf <code>fixed</code>, Puppeteer <code>footerTemplate</code>)', '<code>pageHeader</code> and <code>pageFooter</code> sections; text such as <code>Page {Globals.PageNumber} of {Globals.TotalPages}</code>.'],
  ['<code>createPdf().download()</code>, <code>renderToFile</code>, <code>page.pdf()</code>, <code>doc.end()</code>', '<code>render()</code> once, then <code>exportPdf(model)</code>, <code>exportXlsx</code>, <code>exportDocx</code>, <code>exportHtml</code> from the same page model.'],
  ['Look at the output, adjust numbers, repeat', 'Open the same definition in the designer (<code>mountDesigner</code>) or the viewer (<code>mountViewer</code>) and see the pages before you export.'],
];
