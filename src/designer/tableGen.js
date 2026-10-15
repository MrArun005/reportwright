// @ts-check
// Tables and matrices made from a data set: what the table gallery and "drag a data set onto the page"
// insert. Pure functions; the result is an ordinary item the user can change afterwards.

const HEAD = { fontWeight: 'bold', backgroundColor: '#f1f5f9', borderBottom: '0.75 solid #94a3b8' };
const TOTAL = { fontWeight: 'bold', borderTop: '0.75 solid #94a3b8' };
const ROW_H = 18;
// a total of these means nothing: rates, prices, percentages, averages, ids, years
const NOT_ADDITIVE = /rate|price|percent|pct|ratio|avg|average|^month$|^day$/i;
// row numbers: an instalment, a line, a serial number (by name), or a column that counts up by one down the sample rows
const SEQ_NAME = /^(installment|instalment|inst|seq|sequence|serial|sr|sno|slno|srno|idx|index|rank|line|lineno|row|rownum|rowno|pos|position|step|period|sl)(_?(no|num|number))?$/i;
const isSequence = (name, rows) => {
  const v = (rows || []).slice(0, 200).map(r => r?.[name]);
  return v.length >= 5 && v.every((x, i) => Number.isInteger(x) && (i === 0 || x === v[i - 1] + 1));
};
let ROWS = null; // the sample rows while tableFor runs
const additive = (f) => f.type === 'number' && !NOT_ADDITIVE.test(f.name) && !isCode(f.name) && !SEQ_NAME.test(f.name) && !isSequence(f.name, ROWS);

/** "dueDate" → "Due date", "customer_name" → "Customer name"; all-caps names stay. */
export function labelOf(name) {
  if (/^[A-Z0-9_]+$/.test(name)) return name.replace(/_/g, ' ');
  const words = name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().split(/\s+/).map(w => w.toLowerCase());
  return words.length ? words[0][0].toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '') : name;
}

// ids, codes and years read as they are: 2785, not 2,785 or 2,785.00
// whole words or a camelCase suffix only: "paid" and "principalPaid" are money, not ids. Money-like names never are.
const MONEY_LIKE = /amount|paid|price|total|balance|principal|interest|emi|fee|cost|tax|salary|revenue|sales|value|due|outstanding|disburs|rate|income|expense|budget|spend|profit|margin/i;
const CODE_LIKE = [/^(id|year|no|pin|code|number|seq)$/i, /_(id|no|code|number|seq)$/i, /[a-z](Id|ID|No|Code|Number|Seq)$/, /zip/i];
// parts of a date as numbers: no grouping, no decimals (month 3, not 3.00)
const DATE_PART = /^(year|month|quarter|week|day|hour|fy|fiscalyear)$|(Year|Month|Quarter)$/;
export const isCode = (name) => !MONEY_LIKE.test(name) && (CODE_LIKE.some(r => r.test(name)) || DATE_PART.test(name));
// counts are whole numbers even before sample data is there
const WHOLE = /count|qty|quantity|units|^n$|days|items|loans|orders|customers|visits|^num/i;
/**
 * One format per field, the same in detail rows, subtotals, totals and charts:
 * ids, years and month numbers plain (0); counts N0; money N2 (C2 when the report has a currency); dates 12 Jan 2026;
 * other numbers N0 when every sample value is whole, else N2. Without sample rows the name decides.
 * @param {{ name: string, type?: string }} f @param {any[]} [rows] @param {{ currency?: string }} [opt]
 */
export function formatFor(f, rows, { currency } = {}) {
  if (f.type === 'date') return 'dd MMM yyyy';
  if (f.type !== 'number') return undefined;
  if (isCode(f.name)) return '0';
  if (WHOLE.test(f.name)) return 'N0';
  if (MONEY_LIKE.test(f.name)) return currency ? 'C2' : 'N2';
  const vals = (rows || []).map(r => r?.[f.name]).filter(v => typeof v === 'number');
  if (!vals.length) return 'N2';
  return vals.every(Number.isInteger) ? 'N0' : 'N2';
}
/** A compact axis format for values up to `max`: 300M, 2,730M, 50K (none below 20 of the unit: 15,000 stays as it is). */
export function compactFormat(max) {
  const m = Math.abs(Number(max) || 0);
  for (const [u, f] of [[1e9, '#,##0,,,"B"'], [1e6, '#,##0,,"M"'], [1e3, '#,##0,"K"']]) if (m / u >= 20) return f;
  return null;
}
let CUR = null; // the report's currency while tableFor / matrixFor run
const cellStyle = (f, rows) => {
  const format = formatFor(f, rows, { currency: CUR });
  return f.type === 'number' ? { format, textAlign: 'right' } : format ? { format } : {};
};

/** Column widths in proportion to what the fields hold, filling `width`. */
function widths(fields, width) {
  const weight = fields.map(f => (f.type === 'string' ? 2 : f.type === 'date' ? 1.2 : 1));
  const sum = weight.reduce((a, b) => a + b, 0) || 1;
  return weight.map(w => (width * w) / sum);
}

/**
 * @param {{ name: string, fields?: { name: string, type?: string }[] }} ds
 * @param {{ layout?: 'list'|'grouped'|'summary', groupBy?: string, width?: number, rows?: any[], fields?: string[], currency?: string }} opt
 *   fields: which fields, in order (default all); rows: sample rows, to pick number formats; currency: the symbol for money cells
 */
export function tableFor(ds, opt = {}) {
  CUR = opt.currency || null;
  ROWS = opt.rows || null;
  try { return tableOf(ds, opt); } finally { CUR = null; ROWS = null; }
}
function tableOf(ds, { layout = 'list', groupBy, width = 523, rows, fields: pick } = {}) {
  let fields = (ds.fields || []).filter(f => !pick || pick.includes(f.name));
  if (pick) fields.sort((a, b) => pick.indexOf(a.name) - pick.indexOf(b.name));
  const group = (layout === 'grouped' || layout === 'summary') && groupBy ? (ds.fields || []).find(f => f.name === groupBy) : null;
  // a total row's bold and rule are the row's style (one place to change or clear); cells keep only their number format
  const nums = (list) => list.map(f => (additive(f) ? { value: `=Sum(Fields.${f.name})`, style: cellStyle(f, rows) } : { value: '' }));

  if (group && layout === 'summary') {
    // one row per group: the group, then the totals of the number fields
    const cols = [group, ...fields.filter(additive)];
    const w = widths(cols, width);
    const totals = (first) => [{ value: first, style: { fontWeight: 'bold' } }, ...cols.slice(1).map(f => ({ value: `=Sum(Fields.${f.name})`, style: cellStyle(f, rows) }))];
    return {
      type: 'table', dataSet: ds.name, w: width, h: ROW_H * 3, repeatHeader: true,
      columns: w.map(x => ({ width: x })),
      header: [{ height: ROW_H, style: HEAD, cells: cols.map(f => ({ value: labelOf(f.name), style: f.type === 'number' ? { textAlign: 'right' } : {} })) }],
      groups: [{ name: `By${group.name[0].toUpperCase()}${group.name.slice(1)}`, expr: `=Fields.${group.name}`, sort: 'asc', header: [{ height: ROW_H, cells: totals(`=Fields.${group.name}`) }] }],
      detail: [],
      footer: [{ height: ROW_H, style: TOTAL, cells: [{ value: 'Total' }, ...nums(cols.slice(1))] }],
    };
  }

  const cols = group ? fields.filter(f => f.name !== group.name) : fields;
  const w = widths(cols, width);
  const hasNums = cols.some(additive);
  const footRow = (label) => ({ height: ROW_H, style: TOTAL, cells: cols.map((f, i) => (additive(f) ? nums([f])[0] : { value: i === 0 ? label : '' })) });
  const item = {
    type: 'table', dataSet: ds.name, w: width, h: ROW_H * (2 + (hasNums ? 1 : 0) + (group ? 2 : 0)), repeatHeader: true,
    columns: w.map(x => ({ width: x })),
    header: [{ height: ROW_H, style: HEAD, cells: cols.map(f => ({ value: labelOf(f.name), style: f.type === 'number' ? { textAlign: 'right' } : {} })) }],
    detail: [{ height: ROW_H, style: { borderBottom: '0.5 solid #e5e7eb' }, cells: cols.map(f => ({ value: `=Fields.${f.name}`, style: cellStyle(f, rows) })) }],
    footer: hasNums ? [footRow('Total')] : [],
  };
  if (group) {
    item.groups = [{
      name: `By${group.name[0].toUpperCase()}${group.name.slice(1)}`, expr: `=Fields.${group.name}`, sort: 'asc',
      header: [{ height: ROW_H, cells: [{ value: `=Fields.${group.name}`, colSpan: cols.length, style: { fontWeight: 'bold', ...cellStyle(group, rows), textAlign: 'left' } }] }],
      footer: hasNums ? [footRow('Subtotal')] : [],
    }];
  }
  return item;
}

/**
 * @param {{ name: string, fields?: { name: string, type?: string }[] }} ds
 * @param {{ rows: string, columns: string, value: string, agg?: string, width?: number, sample?: any[], currency?: string }} opt
 */
export function matrixFor(ds, { rows, columns, value, agg = 'Sum', width = 523, sample, currency }) {
  const vf = (ds.fields || []).find(f => f.name === value);
  const name = (f) => f.replace(/\W/g, '').replace(/^./, c => c.toUpperCase()) || 'Group';
  // the tablix form, as the pivot editor edits it: no conversion (and no changed settings) on its first edit
  return {
    type: 'matrix', dataSet: ds.name, w: width, h: ROW_H * 3, corner: labelOf(rows),
    rowGroups: [{ name: name(rows), expr: `=Fields.${rows}`, sort: 'asc', total: 'after' }],
    columnGroups: [{ name: `${name(columns)}${name(columns) === name(rows) ? '2' : ''}`, expr: `=Fields.${columns}`, sort: 'asc', total: 'after' }],
    values: [{ value: agg === 'Count' ? '=CountRows()' : `=${agg}(Fields.${value})`, format: agg === 'Count' ? 'N0' : (vf && formatFor(vf, sample, { currency })) || 'N2' }],
  };
}

/**
 * The fields Instant visuals starts with: the text field with the fewest distinct values (2 to 24; never an id, a
 * code or a field unique on almost every row), a second such field when there is one, and the first additive number
 * (an amount, not an id or a rate). No rows yet: by name and type only. A 180 × 180 pivot of Id by Borrower helps nobody.
 * @param {{ name: string, type?: string }[]} fields @param {any[]} rows
 * @returns {string[]}
 */
export function instantPicks(fields, rows = []) {
  const sample = rows.slice(0, 2000);
  const card = (f) => new Set(sample.map(r => r?.[f.name])).size;
  const dims = fields.filter(f => f.type !== 'number' && f.type !== 'object' && !isCode(f.name) && !/name$|^(email|phone|address|description|notes?|comment)$/i.test(f.name))
    .map(f => ({ f, n: sample.length ? card(f) : 0 }))
    .filter(x => !sample.length || (x.n >= 2 && x.n <= 24 && x.n < sample.length * 0.5))
    .sort((a, b) => a.n - b.n).map(x => x.f.name);
  ROWS = rows;
  const nums = fields.filter(additive).map(f => f.name);
  ROWS = null;
  return [...dims.slice(0, 2), ...nums.slice(0, 1)];
}

/**
 * The number a matrix sums by default: the first additive one (an amount, not an id, a code, a rate or a row number);
 * '' when there is none, so the matrix counts rows.
 * @param {{ name: string, type?: string }[]} fields @param {any[]} [rows]
 * @returns {string}
 */
export function sumFieldFor(fields, rows = []) {
  ROWS = rows;
  try {
    return (fields || []).find(additive)?.name || '';
  } finally {
    ROWS = null;
  }
}
