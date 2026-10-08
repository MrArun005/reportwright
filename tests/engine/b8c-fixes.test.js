// External retest of 0.12.1 (B8-C): polar chart warnings, subset font names, deprecation wording, rich text and
// legend messages, silent mistakes in validate(), text in number fields, BIRT number formats.
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, report } from '../helpers.js';

describe('N9: a valid polar chart gives no warnings', () => {
  const rows = [{ deg: 0, v: 10, w: 3 }, { deg: 90, v: 20, w: 1 }, { deg: 180, v: 15, w: 4 }, { deg: 270, v: 5, w: 2 }];
  const polar = {
    type: 'chart', name: 'C', x: 0, y: 0, w: 300, h: 300, dataSet: 'Rows', chartType: 'polar', xValue: '=Fields.deg', legend: 'bottom',
    series: [{ name: 'V', value: '=Sum(Fields.v)' }, { name: 'W', value: '=Sum(Fields.w)' }],
  };
  it('validate() and render() say nothing about a valid polar chart', async () => {
    const def = report([polar], { data: { rows } });
    expect(validate(def).warnings).toEqual([]);
    const m = await render(def, { fontStore });
    expect(m.warnings).toEqual([]);
  });
  it('a polar chart with a blank series value still draws every row, with no warning', async () => {
    const def = report([{ ...polar, series: [{ name: 'V', value: '=Sum(Fields.v)' }, { name: 'Blank', value: '=Sum(Fields.nope)' }] }], { data: { rows } });
    const m = await render(def, { fontStore });
    expect(m.warnings.filter(w => /not drawn/.test(w))).toEqual([]);
  });
  it('a polar chart with no xValue says what the angle is (validate and render), not "rows have no x or y value"', async () => {
    const { xValue, ...noAngle } = polar;
    const def = report([noAngle], { data: { rows } });
    const w = validate(def).warnings;
    expect(w.some(x => /^C: a polar chart needs xValue/.test(x))).toBe(true);
    const m = await render(def, { fontStore });
    expect(m.warnings.some(x => /^C: a polar chart needs xValue/.test(x))).toBe(true);
    expect(m.warnings.some(x => /rows have no x or y value/.test(x))).toBe(false);
  });
});
