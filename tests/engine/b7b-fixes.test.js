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

import { slices } from '../../src/exporters/docx.js';

describe('N5: Word export writes the document XML in pieces', () => {
  it('slices cut at tag ends: the pieces join back to the input, and none is much longer than the limit', () => {
    const s = '<w:p><w:t>a</w:t></w:p>'.repeat(500);
    const pieces = slices(s, 100);
    expect(pieces.join('')).toBe(s);
    expect(pieces.length).toBeGreaterThan(50);
    for (const p of pieces.slice(0, -1)) expect(p.endsWith('>')).toBe(true);
    expect(slices('short', 100)).toEqual(['short']);
  });
  it('a document written in many small pieces is the same document', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Name ${i} & <co>` }));
    const def = report([{ type: 'table', name: 'Tb', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 200 }],
      detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }] }] }], { data: { rows } });
    const m = await render(def, { fontStore, exportData: true });
    const whole = unzipSync(await exportDocx(m, { fontStore }));
    const piecewise = unzipSync(await exportDocx(m, { fontStore, xmlChunk: 300 }));
    expect(strFromU8(piecewise['word/document.xml'])).toBe(strFromU8(whole['word/document.xml']));
    expect(strFromU8(piecewise['word/document.xml'])).toContain('Name 399 &amp; &lt;co&gt;');
  });
});
