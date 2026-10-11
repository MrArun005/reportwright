// @reportwright/engine: a JSON report definition. The invoice is render() + exportPdf(); the table report is
// exportPdfStream() (the README's way for large reports), with the rows passed as the array they already are and
// presorted: true (they come in group order, as an ORDER BY would give them).
import fs from 'node:fs';
import { render, exportPdf, exportPdfStream, FontStore, fontFile } from '@reportwright/engine';
import { FONT, PAGE, COLS, INV_COLS, FONT_SIZE, ROW_H, INVOICE, BODY_W } from '../data.mjs';

// Inter comes from the same files as everyone else's; the engine's other faces (none used here) from @reportwright/fonts
const fontsDir = FONT.regular.replace(/Inter-Regular\.ttf$/, '');
const fonts = new FontStore(async (key) => fs.promises.readFile(fontsDir + fontFile(key)));

export const name = '@reportwright/engine';
export async function setup() {}
export async function teardown() {}

const page = { size: 'A4', margins: [PAGE.margin, PAGE.margin, PAGE.margin, PAGE.margin] };
const comply = (o) => ({ ...(o.pdfa ? { pdfa: true } : {}), ...(o.ua ? { tagged: { lang: 'en-US' } } : {}) });
const tb = (x, y, w, h, value, style = {}) => ({ type: 'textbox', name: `T${x}_${y}_${String(value).length}`, x, y, w, h, value, style: { fontSize: 9, ...style } });

export async function invoice(out, o = {}) {
  const I = INVOICE;
  const items = [
    tb(0, 0, 300, 24, I.seller.name, { fontSize: 18, fontWeight: 'bold' }),
    tb(323, 0, 200, 24, 'INVOICE', { fontSize: 18, fontWeight: 'bold', textAlign: 'right' }),
    ...I.seller.lines.map((l, i) => tb(0, 26 + i * 12, 300, 12, l)),
    ...[`Invoice no ${I.number}`, `Date ${I.date}`, `Due ${I.due}`].map((l, i) => tb(323, 26 + i * 12, 200, 12, l, { textAlign: 'right' })),
    tb(0, 96, 300, 12, 'Bill to', { fontWeight: 'bold' }),
    tb(0, 110, 300, 14, I.buyer.name, { fontSize: 10, fontWeight: 'bold' }),
    ...I.buyer.lines.map((l, i) => tb(0, 124 + i * 12, 300, 12, l)),
    { type: 'table', name: 'Items', dataSet: 'Items', x: 0, y: 196, w: BODY_W, h: 18 * 16, // its full height, so the note below is not pushed down
      columns: INV_COLS.map(c => ({ width: c.width })),
      header: [{ height: 18, style: { fontWeight: 'bold', backgroundColor: '#eef2f7', fontSize: 9 }, cells: INV_COLS.map(c => ({ value: c.label, style: c.right ? { textAlign: 'right' } : {} })) }],
      detail: [{ height: 18, style: { borderBottom: '0.5 solid #e5e7eb', fontSize: 9 }, cells: INV_COLS.map(c => ({ value: `=Fields.${c.key}`, style: c.right ? { textAlign: 'right' } : {} })) }],
      footer: [['Subtotal', I.subtotal], ['VAT 20%', I.tax], ['Total', I.total]].map(([l, v], i) => ({ height: 18, style: { fontSize: 9, ...(i === 2 ? { fontWeight: 'bold' } : {}) },
        cells: [null, null, { value: l, style: { textAlign: 'right' } }, { value: v, style: { textAlign: 'right' } }] })) },
    tb(0, 196 + 18 * 16 + 24, BODY_W, 24, I.note, { canGrow: true }),
  ];
  const def = { $schema: 'reportwright/report@1', name: 'Invoice', locale: 'en-US', page,
    dataSources: [{ name: 'inv', type: 'json', data: I.items }],
    dataSets: [{ name: 'Items', source: 'inv', fields: INV_COLS.map(c => ({ name: c.key, type: 'string' })) }],
    sections: { body: { items } } };
  const model = await render(def, { fontStore: fonts, exportData: !!o.ua });
  fs.writeFileSync(out, await exportPdf(model, { fonts, title: 'Invoice', ...comply(o) }));
  return { pages: model.pages.length };
}

const total = (label) => [{ height: ROW_H, style: { fontWeight: 'bold', fontSize: FONT_SIZE }, cells: [{ value: label, colSpan: 2 }, null, { value: '=CountRows()' }, null, null, { value: '=Sum(Fields.amount)', style: { format: 'N2', textAlign: 'right' } }, null] }];

export async function table(rows, out, o = {}) {
  const def = {
    $schema: 'reportwright/report@1', name: 'Ledger', locale: 'en-US', page,
    dataSources: [{ name: 'db', type: 'json', data: rows }],
    dataSets: [{ name: 'Tx', source: 'db', fields: COLS.map(c => ({ name: c.key, type: c.key === 'id' || c.key === 'amount' ? 'number' : 'string' })) }],
    sections: {
      body: { items: [{ type: 'table', name: 'Tx', dataSet: 'Tx', x: 0, y: 0, w: BODY_W, h: 40, repeatHeader: true,
        columns: COLS.map(c => ({ width: c.width })),
        header: [{ height: 16, style: { fontWeight: 'bold', backgroundColor: '#eef2f7', fontSize: FONT_SIZE }, cells: COLS.map(c => ({ value: c.label, style: c.right ? { textAlign: 'right' } : {} })) }],
        detail: [{ height: ROW_H, style: { borderBottom: '0.5 solid #e5e7eb', fontSize: FONT_SIZE }, cells: COLS.map(c => ({ value: `=Fields.${c.key}`, style: c.key === 'amount' ? { format: 'N2', textAlign: 'right' } : {} })) }],
        footer: total('Grand total'),
        groups: [{ name: 'Region', expr: '=Fields.region',
          header: [{ height: 16, style: { fontWeight: 'bold', backgroundColor: '#dbeafe', fontSize: FONT_SIZE }, cells: [{ value: '="Region " & Fields.region', colSpan: 7 }, null, null, null, null, null, null] }],
          footer: total('Region total') }] }] },
      pageFooter: { height: PAGE.footer, items: [tb(0, 4, BODY_W, 12, 'Page {Globals.PageNumber} of {Globals.TotalPages}', { fontSize: 8, textAlign: 'right' })] },
    },
  };
  const sink = fs.createWriteStream(out);
  const r = await exportPdfStream(def, { fonts, title: 'Ledger', presorted: true, maxRows: Math.max(rows.length, 5_000_000), timeoutMs: 24 * 3600e3, ...comply(o) }, sink);
  await new Promise((ok, fail) => sink.end((e) => (e ? fail(e) : ok())));
  if (!r.streamed) process.stderr.write(`reportwright: written whole: ${r.why}\n`);
  return { pages: r.pages };
}
