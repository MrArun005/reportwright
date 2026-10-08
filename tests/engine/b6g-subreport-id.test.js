// B6g #24: a subreport's report id is evaluated first, then must pass the server's id rule before loadReport sees it.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { fontStore, report } from '../helpers.js';

const sub = (report) => ({ type: 'subreport', name: 'Sub', x: 0, y: 0, w: 300, h: 40, report });
const def = (report) => report_([sub(report)]);
const report_ = (body) => ({ ...report(body), parameters: [{ name: 'r', type: 'string', default: 'x' }] });
const child = () => report([{ type: 'textbox', name: 'C', x: 0, y: 0, w: 200, h: 18, value: 'child body' }]);

const run = async (reportRef, params = {}) => {
  const asked = [];
  const loadReport = async (id) => { asked.push(id); return child(); };
  const m = await render(def(reportRef), { fontStore, loadReport, parameters: params });
  return { asked, warnings: m.warnings || [] };
};

describe('subreport report ids', () => {
  it('a traversal id is refused before loadReport is called', async () => {
    const { asked, warnings } = await run('../../../etc/passwd');
    expect(asked).toEqual([]);
    expect(warnings.some(w => /not a report id/.test(w))).toBe(true);
  });
  it('an expression that evaluates to a traversal id is refused', async () => {
    const { asked, warnings } = await run('=Parameters.r', { r: '../secret' });
    expect(asked).toEqual([]);
    expect(warnings.some(w => /not a report id/.test(w))).toBe(true);
  });
  it('an expression that evaluates to a valid id is loaded with that id', async () => {
    const { asked } = await run('=Parameters.r', { r: 'sales-2026' });
    expect(asked).toEqual(['sales-2026']);
  });
  it('a host id with capitals and underscores is loaded as it is (library users name their own reports)', async () => {
    const { asked } = await run('Invoice_Detail');
    expect(asked).toEqual(['Invoice_Detail']);
  });
  it.each(['a/b', 'a\\b', 'a.json', '..', '.hidden', 'a b', 'x'.repeat(129)])('%s is refused', async (id) => {
    const { asked, warnings } = await run(id);
    expect(asked).toEqual([]);
    expect(warnings.some(w => /not a report id/.test(w))).toBe(true);
  });
  it('an unevaluated expression text is refused, not sent as an id', async () => {
    const { asked } = await run('=Parameters.r');
    expect(asked.every(id => !id.startsWith('='))).toBe(true);
  });
});
