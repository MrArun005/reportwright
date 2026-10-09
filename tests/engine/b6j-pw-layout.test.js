// b6j: `pw test --layout` (and a case's "layout": true) compares the layout: item boxes, font size, colour and table
// column widths. The default text mode compares the words only, so a font size or colour change passes there.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..', '..');
const PW = path.join(ROOT, 'bin', 'pw.mjs');
const run = (args) => {
  const r = spawnSync(process.execPath, [PW, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: 'Asia/Kolkata' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-layout-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// one heading (font size, colour) and a two-column table (column width): the same words whatever the style
const report = ({ size = 10, color = '#155e75', colWidth = 120 } = {}) => ({
  $schema: 'reportwright/report@1', name: 'Layout', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows: [{ n: 1, who: 'Asha' }, { n: 2, who: 'Ben' }] } }],
  dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }],
  sections: { body: { items: [
    { type: 'textbox', name: 'Title', x: 0, y: 0, w: 300, h: 20, value: 'Account', style: { fontSize: size, color } },
    { type: 'table', name: 'T', x: 0, y: 40, w: 400, h: 40, dataSet: 'Rows', repeatHeader: true, columns: [{ width: colWidth }, { width: 280 }],
      header: [{ height: 16, cells: [{ value: 'No' }, { value: 'Who' }] }],
      detail: [{ height: 16, cells: [{ value: '=Fields.n' }, { value: '=Fields.who' }] }] },
  ] } },
});

/** A folder with report.pw.json and __tests__/report.test.json, as pw test reads them. */
function folder(name, def, cases) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '__tests__'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.pw.json'), JSON.stringify(def));
  fs.writeFileSync(path.join(dir, '__tests__', 'report.test.json'), JSON.stringify({ report: '../report.pw.json', cases }));
  return dir;
}
const setReport = (dir, def) => fs.writeFileSync(path.join(dir, 'report.pw.json'), JSON.stringify(def));

describe('pw test --layout', () => {
  it('a font size change passes in text mode and fails in layout mode', () => {
    const dir = folder('size', report({ size: 10 }), [{ name: 'default' }]);
    expect(run(['test', dir, '--update']).code).toBe(0);
    expect(run(['test', dir, '--update', '--layout']).code).toBe(0);
    setReport(dir, report({ size: 14 }));
    expect(run(['test', dir]).code).toBe(0);
    const r = run(['test', dir, '--layout']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^- .*size=10/m);
    expect(r.out).toMatch(/^\+ .*size=14/m);
  });

  it('a colour change fails in layout mode only', () => {
    const dir = folder('colour', report(), [{ name: 'default' }]);
    expect(run(['test', dir, '--update']).code).toBe(0);
    expect(run(['test', dir, '--update', '--layout']).code).toBe(0);
    setReport(dir, report({ color: '#ff0000' }));
    expect(run(['test', dir]).code).toBe(0);
    const r = run(['test', dir, '--layout']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^\+ .*color=#ff0000/m);
  });

  it('a table column width change fails in layout mode only', () => {
    const dir = folder('column', report(), [{ name: 'default' }]);
    expect(run(['test', dir, '--update']).code).toBe(0);
    expect(run(['test', dir, '--update', '--layout']).code).toBe(0);
    setReport(dir, report({ colWidth: 160 }));
    expect(run(['test', dir]).code).toBe(0);
    const r = run(['test', dir, '--layout']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^- table T columns 120 280$/m);
    expect(r.out).toMatch(/^\+ table T columns 160 280$/m);
  });

  it('a case with "layout": true is compared by layout; the other cases stay text', () => {
    const dir = folder('case', report(), [{ name: 'words' }, { name: 'shape', layout: true }]);
    expect(run(['test', dir, '--update']).code).toBe(0);
    setReport(dir, report({ size: 14 }));
    const r = run(['test', dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/report › shape/);
    expect(r.out).not.toMatch(/report › words/);
  });

  it('the layout snapshot lists the boxes, sizes, colours and column widths per page', () => {
    const dir = folder('shape', report(), [{ name: 'default' }]);
    expect(run(['test', dir, '--update', '--layout']).code).toBe(0);
    const snap = fs.readFileSync(path.join(dir, '__tests__', 'report.default.layout.snap.txt'), 'utf8');
    expect(snap).toMatch(/^--- page 1$/m);
    expect(snap).toMatch(/^table T columns 120 280$/m);
    expect(snap).toMatch(/size=10 color=#155e75/);
  });
});
