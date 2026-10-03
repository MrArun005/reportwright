// Writes reports/loan-statement.pw.json (kept as a script so the sample stays readable).
import fs from 'node:fs';
const W = 523.28;
const ACC = '#155e75', MUTED = '#6b7280';
const tb = (name, x, y, w, h, value, style = {}, extra = {}) => ({ type: 'textbox', name, x, y, w, h, value, canGrow: true, style, ...extra });
const label = (name, x, y, w, text) => tb(name, x, y, w, 14, text, { fontSize: 8, color: MUTED });
const val = (name, x, y, w, value, style = {}, extra = {}) => tb(name, x, y, w, 14, value, { fontSize: 8.5, fontWeight: '600', ...style }, { dataSet: 'Loan', ...extra });

const kpiW = W / 4;
const kpis = [
  ['Principal outstanding', '=Fields.outstanding', { format: 'C0' }, 'Loan'],
  ['Installments paid', '{Fields.paidCount} of {Fields.months}', {}, 'Loan'],
  ['Total paid so far', '=Sum(IIF(Fields.status = "Paid", Fields.emi, 0))', { format: 'C0' }, 'Payments'],
  ['Next due', '=Fields.nextDue', { format: 'dd MMM yyyy', color: '#c2410c' }, 'Loan'],
];

const num = { textAlign: 'right', format: 'N2' };

const def = {
  $schema: 'pagewright/report@1',
  name: 'Loan statement',
  locale: 'en-IN', currency: 'INR',
  page: { size: 'A4', orientation: 'portrait', margins: [36, 36, 30, 36] },
  parameters: [{ name: 'accountId', type: 'string', prompt: 'Loan account', required: true, default: 'LN-2026-004417' }],
  dataSources: [{ name: 'loans', type: 'rest', method: 'GET', url: '/api/sample/loans/{Parameters.accountId}' }],
  dataSets: [
    { name: 'Loan', source: 'loans', path: '$.loan', fields: [
      { name: 'accountId', type: 'string' }, { name: 'name', type: 'string' }, { name: 'city', type: 'string' }, { name: 'product', type: 'string' },
      { name: 'principal', type: 'number' }, { name: 'rate', type: 'number' }, { name: 'months', type: 'number' }, { name: 'emi', type: 'number' },
      { name: 'disbursedOn', type: 'date' }, { name: 'paidCount', type: 'number' }, { name: 'outstanding', type: 'number' }, { name: 'nextDue', type: 'date' },
    ] },
    { name: 'Payments', source: 'loans', path: '$.schedule', fields: [
      { name: 'installment', type: 'number' }, { name: 'dueDate', type: 'date' }, { name: 'emi', type: 'number' }, { name: 'principal', type: 'number' },
      { name: 'interest', type: 'number' }, { name: 'balance', type: 'number' }, { name: 'status', type: 'string' },
    ] },
  ],
  styles: { base: { fontFamily: 'Inter', fontSize: 9, color: '#1f2937' } },
  sections: {
    pageHeader: { height: 50, items: [
      { type: 'shape', name: 'BrandMark', shape: 'rect', x: 0, y: 2, w: 5, h: 28, style: { fill: ACC, stroke: 'none' } },
      tb('Company', 12, 0, 260, 18, 'Pagewright Finance', { fontSize: 13, fontWeight: 'bold', color: ACC }),
      tb('Address', 12, 18, 300, 12, 'Registered office: 4th Floor, 100 Feet Road, Indiranagar, Bengaluru 560038', { fontSize: 7, color: MUTED }),
      tb('DocTitle', W - 200, 1, 200, 14, 'LOAN STATEMENT', { fontSize: 9, fontWeight: 'bold', color: ACC, textAlign: 'right' }),
      tb('DocAccount', W - 200, 16, 200, 12, '=Parameters.accountId', { fontSize: 8, fontFamily: 'JetBrains Mono', textAlign: 'right', color: MUTED }),
      { type: 'line', name: 'HeaderRule', x: 0, y: 38, w: W, h: 0, style: { stroke: '#d1d5db', strokeWidth: 0.75 } },
    ] },
    body: { height: 320, items: [
      tb('Title', 0, 0, 320, 25, 'Statement of account', { fontSize: 16, fontWeight: 'bold' }),
      tb('AsOf', 0, 25, 320, 14, "As of {Format(Today(), 'dd MMMM yyyy')}", { fontSize: 8.5, color: MUTED }),

      label('LblBorrower', 0, 48, 90, 'Borrower'), val('Borrower', 90, 48, 180, '=Fields.name'),
      label('LblCity', 0, 64, 90, 'City'), val('City', 90, 64, 180, '=Fields.city'),
      label('LblProduct', 0, 80, 90, 'Product'), val('Product', 90, 80, 180, '=Fields.product'),
      label('LblDisbursed', 0, 96, 90, 'Disbursed on'), val('Disbursed', 90, 96, 180, '=Fields.disbursedOn', { format: 'dd MMM yyyy' }),
      label('LblSanctioned', 290, 48, 100, 'Sanctioned amount'), val('Sanctioned', 390, 48, W - 390, '=Fields.principal', { format: 'C0', textAlign: 'right' }),
      label('LblRate', 290, 64, 100, 'Interest rate'), val('Rate', 390, 64, W - 390, "{Format(Fields.rate, 'N2')}% p.a.", { textAlign: 'right' }),
      label('LblTenure', 290, 80, 100, 'Tenure'), val('Tenure', 390, 80, W - 390, '{Fields.months} months', { textAlign: 'right' }),
      label('LblEmi', 290, 96, 100, 'Monthly EMI'), val('Emi', 390, 96, W - 390, '=Fields.emi', { format: 'C0', textAlign: 'right' }),

      { type: 'shape', name: 'KpiPanel', shape: 'rect', x: 0, y: 122, w: W, h: 50, style: { fill: '#f0f9ff', stroke: '#bae6fd', strokeWidth: 0.75, radius: 6 } },
      ...kpis.flatMap(([l, v, st, ds], i) => [
        tb(`KpiLabel${i + 1}`, i * kpiW + 10, 130, kpiW - 14, 12, l.toUpperCase(), { fontSize: 6.5, color: MUTED, fontWeight: '600' }),
        tb(`KpiValue${i + 1}`, i * kpiW + 10, 144, kpiW - 14, 20, v, { fontSize: 13, fontWeight: 'bold', textAlign: 'left', ...st }, { dataSet: ds, canGrow: false }),
      ]),

      tb('ScheduleTitle', 0, 186, 300, 16, 'Repayment schedule', { fontSize: 11, fontWeight: 'bold' }),
      {
        type: 'table', name: 'Schedule', x: 0, y: 206, w: W, h: 54, dataSet: 'Payments', repeatHeader: true, noRowsText: 'No installments',
        columns: [34, 74, 80, 80, 80, 95.28, 80].map(width => ({ width })),
        style: { fontSize: 8, padding: [3.5, 5, 3.5, 5] },
        header: [{ height: 18, style: { fontWeight: 'bold', color: '#ffffff', backgroundColor: ACC, fontSize: 7.5, verticalAlign: 'middle' }, cells: [
          { value: '#', style: { textAlign: 'center' } }, { value: 'Due date' }, { value: 'EMI', style: { textAlign: 'right' } },
          { value: 'Principal', style: { textAlign: 'right' } }, { value: 'Interest', style: { textAlign: 'right' } },
          { value: 'Balance', style: { textAlign: 'right' } }, { value: 'Status', style: { textAlign: 'center' } },
        ] }],
        detail: [{ height: 16, style: { backgroundColor: "=IIF(RowNumber() % 2 = 0, '#f8fafc', null)", borderBottom: '0.5 solid #e5e7eb' }, cells: [
          { value: '=Fields.installment', style: { textAlign: 'center', color: MUTED, format: 'N0' } },
          { value: '=Fields.dueDate', style: { format: 'dd MMM yyyy' } },
          { value: '=Fields.emi', style: num }, { value: '=Fields.principal', style: num }, { value: '=Fields.interest', style: num },
          { value: '=Fields.balance', style: { ...num, fontFamily: 'JetBrains Mono', fontSize: 7.5 } },
          { value: '=Fields.status', style: { textAlign: 'center', fontWeight: '600', color: "=Switch(Fields.status = 'Overdue', '#b91c1c', Fields.status = 'Upcoming', '#6b7280', True, '#15803d')" } },
        ] }],
        footer: [{ height: 20, style: { fontWeight: 'bold', backgroundColor: '#ecfeff', borderTop: `1 solid ${ACC}`, verticalAlign: 'middle' }, cells: [
          { value: 'Total ({CountRows()} installments)', colSpan: 2 }, null,
          { value: '=Sum(Fields.emi)', style: num }, { value: '=Sum(Fields.principal)', style: num }, { value: '=Sum(Fields.interest)', style: num },
          { value: '' }, { value: '' },
        ] }],
      },
      tb('Note', 0, 274, W, 24, 'This statement is generated by the system and does not need a signature. Report any difference within 30 days of the statement date. An overdue installment attracts a penal charge as per the loan agreement.', { fontSize: 7, color: MUTED, lineHeight: 1.35 }),
    ] },
    pageFooter: { height: 26, items: [
      { type: 'line', name: 'FooterRule', x: 0, y: 4, w: W, h: 0, style: { stroke: '#d1d5db', strokeWidth: 0.75 } },
      tb('Generated', 0, 9, 280, 12, "Generated on {Format(Globals.ExecutionTime, 'dd MMM yyyy, hh:mm tt')} · {Globals.ReportName}", { fontSize: 7, color: MUTED }),
      tb('PageNo', W - 200, 9, 200, 12, 'Page {Globals.PageNumber} of {Globals.TotalPages}', { fontSize: 7, color: MUTED, textAlign: 'right' }),
    ] },
  },
};
fs.writeFileSync(new URL('../reports/loan-statement.pw.json', import.meta.url), JSON.stringify(def, null, 2));
console.log('wrote reports/loan-statement.pw.json');
