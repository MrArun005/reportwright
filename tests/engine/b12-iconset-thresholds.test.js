// #28: an icon set whose high threshold is below its low one never shows its middle icon: a warning says so
import { describe, it, expect } from 'vitest';
import { validate } from '../../src/engine/schema/validate.js';

const def = (items) => ({
  $schema: 'reportwright/report@1',
  name: 'T',
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', fields: [{ name: 'v', type: 'number' }] }],
  sections: { body: { items } },
});
const icon = (lower, upper) => ({ type: 'iconset', name: 'Iconset1', x: 0, y: 0, w: 18, h: 18, value: '=Fields.v', lower, upper });
const hits = (d) => validate(d).warnings.filter((w) => w.includes('threshold'));

describe('icon set thresholds', () => {
  it('upper below lower (expressions =80 / =20) is flagged', () => {
    expect(hits(def([icon('=80', '=20')]))).toEqual([
      'Iconset1: the high threshold (20) is below the low one (80), so the middle icon never shows',
    ]);
  });
  it('plain numbers too', () => {
    expect(hits(def([icon(80, 20)]))).toHaveLength(1);
  });
  it('the defaults (=33, =67) and equal thresholds are fine', () => {
    expect(hits(def([icon('=33', '=67')]))).toEqual([]);
    expect(hits(def([icon('=50', '=50')]))).toEqual([]);
  });
  it('a threshold that is an expression is not judged', () => {
    expect(hits(def([icon('=Fields.v * 2', '=20')]))).toEqual([]);
  });
  it('an icon set as a table cell visual is checked as well', () => {
    const table = {
      type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 100, h: 18, columns: [{ width: 100 }],
      detail: [{ height: 18, cells: [{ value: '', visual: { type: 'iconset', value: '=Fields.v', lower: '=90', upper: '=10' } }] }],
    };
    const ws = hits(def([table]));
    expect(ws).toHaveLength(1);
    expect(ws[0]).toContain('(10) is below the low one (90)');
  });
});
