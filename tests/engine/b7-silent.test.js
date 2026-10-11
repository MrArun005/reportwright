// B7 #8: the silent mistakes warn or fail (a short table row, a required parameter with no value, a chart with no series).
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, report } from '../helpers.js';

const tableDef = (cells) => report([{ type: 'table', name: 'T1', x: 0, y: 0, w: 300, h: 40, dataSet: 'Rows', columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
  detail: [{ cells }] }], { data: { rows: [{ a: 1 }] } });
const chartDef = (item) => ({ $schema: 'reportwright/report@1', page: { size: 'A4' }, sections: { body: { items: [{ type: 'chart', name: 'C1', x: 0, y: 0, w: 300, h: 200, ...item }] } } });
const paramDef = (p) => report([{ type: 'textbox', x: 0, y: 0, w: 300, h: 20, value: '=Parameters.P' }], { def: { parameters: [p] } });

describe('#8 a table row with fewer cells than columns', () => {
  it('warns, naming the table, the row and the missing count', () => {
    expect(validate(tableDef([{ value: '=Fields.a' }])).warnings.join('\n')).toMatch(/T1 detail row 1: the row has 1 of 3 cells and no colSpan covers the other 2/);
  });
  it('a colSpan that covers the missing cells does not warn', () => {
    expect(validate(tableDef([{ value: '=Fields.a', colSpan: 3 }])).warnings.join('\n')).not.toMatch(/cells and no colSpan/);
  });
});

describe('#8 a required parameter with no value', () => {
  for (const [label, p] of [
    ['no default', { name: 'P', type: 'string', required: true }],
    ['default ""', { name: 'P', type: 'string', required: true, default: '' }],
    ['default null', { name: 'P', type: 'string', required: true, default: null }],
    ['hidden', { name: 'P', type: 'string', required: true, hidden: true }],
  ]) {
    it(`render() throws "Enter a value" (${label})`, async () => {
      await expect(render(paramDef(p), { fontStore })).rejects.toThrow('Enter a value for: P');
    });
  }
  it('an explicit null for a nullable required parameter is a value and renders', async () => {
    const m = await render(paramDef({ name: 'P', type: 'string', required: true, nullable: true }), { fontStore, parameters: { P: null } });
    expect(m.pages.length).toBeGreaterThan(0);
  });
});

describe('#8 a required nullable parameter with no default', () => {
  it('validate() warns that it is null and the report can draw blank', () => {
    expect(validate(paramDef({ name: 'P', type: 'string', required: true, nullable: true })).warnings.join('\n')).toMatch(/Parameter "P" is required and nullable/);
  });
});

describe('#8 a chart with no series', () => {
  it('warns for a column chart with an empty series list', () => {
    expect(validate(chartDef({ chartType: 'column', series: [] })).warnings.join('\n')).toMatch(/C1: the chart has no series/);
  });
  it('warns for a chart with no series at all', () => {
    expect(validate(chartDef({ chartType: 'pie' })).warnings.join('\n')).toMatch(/C1: the chart has no series/);
  });
  it('does not warn for gantt, which takes its bars from ganttStart and ganttEnd', () => {
    expect(validate(chartDef({ chartType: 'gantt' })).warnings.join('\n')).not.toMatch(/no series/);
  });
});
