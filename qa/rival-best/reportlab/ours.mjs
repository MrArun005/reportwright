// The ReportLab long document: a table grouped by section (heading row), one growing justified paragraph a row.
import { execFileSync } from 'node:child_process';
import { report, renderDef } from '../lib/rw.mjs';

const rows = JSON.parse(execFileSync('python3', ['gen.py'], { encoding: 'utf8' }));
const def = report('Long document', [
  { type: 'table', name: 'Doc', dataSet: 'P', x: 0, y: 0, w: 515, h: 40, columns: [{ width: 515 }],
    groups: [{ name: 'Section', expr: '=Fields.section', sort: 'none',
      header: [{ height: 24, style: { fontSize: 14, fontWeight: 'bold', paddingTop: 8 }, cells: [{ value: '=Fields.section' }] }] }],
    detail: [{ height: 14, canGrow: true, style: { fontSize: 10, textAlign: 'justify', paddingBottom: 6 }, cells: [{ value: '=Fields.text' }] }] },
], { dataSources: [{ name: 'src', type: 'json', data: rows }], dataSets: [{ name: 'P', source: 'src', fields: [{ name: 'section', type: 'string' }, { name: 'text', type: 'string' }] }],
  sections: { pageFooter: { height: 20, items: [{ type: 'textbox', name: 'Pg', x: 0, y: 4, w: 515, h: 12, value: 'Page {Globals.PageNumber}', style: { fontSize: 8, textAlign: 'right' } }] } } });
await renderDef(def);
