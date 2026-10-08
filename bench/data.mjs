// The shared workload: the same data, font file, page and formatting for every library. See README.md.
import { fileURLToPath } from 'node:url';

// One font file for everyone: Inter from @reportwright/fonts (the same bytes, whichever library embeds it).
const font = (f) => fileURLToPath(import.meta.resolve(`@reportwright/fonts/public/fonts/${f}`));
export const FONT = { regular: font('Inter-Regular.ttf'), bold: font('Inter-Bold.ttf') };

// A4 portrait in points; 36 pt margins on every side. The page footer (18 pt) sits inside the bottom margin's
// content edge, so the body area is the same for everyone: 523 x (841.89 - 36 - 54).
export const PAGE = { width: 595.28, height: 841.89, margin: 36, footer: 18 };
export const BODY_W = PAGE.width - 2 * PAGE.margin; // 523.28

// table columns, in points (sum 523)
export const COLS = [
  { key: 'id', label: 'Id', width: 50 },
  { key: 'account', label: 'Account', width: 62 },
  { key: 'region', label: 'Region', width: 50 },
  { key: 'type', label: 'Type', width: 62 },
  { key: 'date', label: 'Date', width: 62 },
  { key: 'amount', label: 'Amount', width: 70, right: true },
  { key: 'reference', label: 'Reference', width: 167 },
];
export const FONT_SIZE = 9;
export const ROW_H = 14;

const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 1234.5 -> "1,234.50": the one number format (ReportWright's N2 in en-US gives the same text) */
export const money = (n) => nf.format(n);

const REGIONS = ['North', 'South', 'East', 'West'];
const TYPES = ['Deposit', 'Withdrawal', 'Transfer', 'Fee', 'Interest'];
/**
 * n ledger rows, deterministic, already in group order (region blocks), as a database query ordered by region gives
 * them. Dates are ISO strings shown as they are; amounts are numbers shown with money().
 */
export function tableRows(n) {
  const rows = new Array(n);
  for (let j = 0; j < n; j++) {
    rows[j] = {
      id: j + 1,
      account: `AC${10000 + ((j * 7) % 9000)}`,
      region: REGIONS[Math.floor((j * 4) / n)],
      type: TYPES[j % 5],
      date: new Date(Date.UTC(2025, j % 12, 1 + (j % 28))).toISOString().slice(0, 10),
      amount: Math.round((((j * 7919) % 200000) - 100000) * 1.37) / 100,
      reference: `REF-${j * 31}`,
    };
  }
  return rows;
}

/**
 * The groups, for libraries that have no grouping of their own: the harness computes them once, the same way for each,
 * and the library only lays the rows out. [{ region, rows, count, sum }]
 */
export function groupsOf(rows) {
  const out = [];
  for (const r of rows) {
    let g = out[out.length - 1];
    if (!g || g.region !== r.region) out.push((g = { region: r.region, rows: [], count: 0, sum: 0 }));
    g.rows.push(r); g.count++; g.sum += r.amount;
  }
  return out;
}
export const grandTotal = (groups) => ({ count: groups.reduce((s, g) => s + g.count, 0), sum: groups.reduce((s, g) => s + g.sum, 0) });

// The one-page invoice. Amounts are computed here once; every library prints these strings.
const LINES = [
  ['Annual platform licence (50 seats)', 1, 12000], ['Implementation services, phase 1', 40, 150], ['Report design workshop (2 days)', 2, 1800],
  ['Data source connectors', 3, 450], ['Premium support, 12 months', 1, 2400], ['Training: report authors', 12, 95],
  ['Training: administrators', 4, 140], ['Custom chart palette', 1, 600], ['Barcode label templates', 5, 120],
  ['SSO integration (SAML)', 1, 900], ['Migration of 25 SSRS reports', 25, 60], ['Travel and expenses', 1, 734.5],
];
export const INVOICE = {
  seller: { name: 'Northwind Analytics Ltd', lines: ['14 Harbour Road', 'Bristol BS1 5TY', 'United Kingdom', 'VAT GB 123 4567 89'] },
  buyer: { name: 'Contoso Retail plc', lines: ['Accounts payable', '220 Market Street', 'Manchester M1 1AA', 'United Kingdom'] },
  number: 'INV-2026-0042', date: '2026-10-01', due: '2026-10-31',
  items: LINES.map(([description, qty, price]) => ({ description, qty: String(qty), price: money(price), amount: money(qty * price) })),
  subtotal: money(LINES.reduce((s, [, q, p]) => s + q * p, 0)),
  tax: money(LINES.reduce((s, [, q, p]) => s + q * p, 0) * 0.2),
  total: money(LINES.reduce((s, [, q, p]) => s + q * p, 0) * 1.2),
  note: 'Payment within 30 days to Northwind Analytics Ltd, sort code 12-34-56, account 12345678. Thank you for your business.',
};
// invoice item columns (sum 523)
export const INV_COLS = [
  { key: 'description', label: 'Description', width: 283 },
  { key: 'qty', label: 'Qty', width: 60, right: true },
  { key: 'price', label: 'Unit price', width: 90, right: true },
  { key: 'amount', label: 'Amount', width: 90, right: true },
];
