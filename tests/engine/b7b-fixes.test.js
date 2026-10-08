// External retest of 0.11.0 (B7-B): DOCX/HTML export, chart axes and warnings, the guarded fetch, CJK weights,
// warning de-duplication, parameter options, bidi controls.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { render } from '../../src/engine/index.js';
import { exportDocx } from '../../src/exporters/docx.js';
import { exportHtml } from '../../src/exporters/html.js';
import { fontStore, report } from '../helpers.js';

const text = (name, value, extra = {}) => ({ type: 'textbox', name, x: 0, y: 0, w: 300, h: 20, value, ...extra });

describe('N15: Word export of a report with no tables', () => {
  it('exports without exportData', async () => {
    const m = await render(report([text('T', 'Hello')]), { fontStore });
    expect(m.regions).toBeNull();
    const files = unzipSync(await exportDocx(m, { fontStore }));
    expect(strFromU8(files['word/document.xml'])).toContain('Hello');
  });
  it('a report with a table still asks for exportData', async () => {
    const rows = [{ a: 'x' }];
    const def = report([{ type: 'table', name: 'Tb', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rows', columns: [{ width: 200 }],
      detail: [{ height: 18, cells: [{ value: '=Fields.a' }] }] }], { data: { rows } });
    const m = await render(def, { fontStore });
    expect(m.hasTables).toBe(true);
    await expect(exportDocx(m, { fontStore })).rejects.toThrow(/exportData/);
  });
});
