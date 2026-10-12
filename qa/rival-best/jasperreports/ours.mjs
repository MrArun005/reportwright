// The Jasper crosstab as a ReportWright matrix: region rows x quarter columns, Sum(amount), row and column totals.
import { report, renderDef } from '../lib/rw.mjs';
const rows = Array.from({ length: 5000 }, (_, i) => ({ region: `Region ${String((i % 12) + 1).padStart(2, '0')}`, quarter: `Q${((i * 7) % 4) + 1}`, amount: ((i * 37) % 1000) / 10 + 5 }));
const def = report('Crosstab', [
  { type: 'textbox', name: 'Title', x: 0, y: 0, w: 515, h: 24, value: 'Sales by region and quarter', style: { fontSize: 16, fontWeight: 'bold' } },
  { type: 'matrix', name: 'X', dataSet: 'S', x: 0, y: 30, w: 500, h: 60, rowHeaderWidth: 100, columnWidth: 80,
    rowGroups: [{ expr: '=Fields.region', total: 'after', totalLabel: 'Total' }], columnGroups: [{ expr: '=Fields.quarter', total: 'after', totalLabel: 'Total' }],
    values: [{ value: '=Sum(Fields.amount)', format: 'N2' }] },
], { dataSources: [{ name: 'src', type: 'json', data: rows }], dataSets: [{ name: 'S', source: 'src', fields: [{ name: 'region', type: 'string' }, { name: 'quarter', type: 'string' }, { name: 'amount', type: 'number' }] }] });
await renderDef(def);
