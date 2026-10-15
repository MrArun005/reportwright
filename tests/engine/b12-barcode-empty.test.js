// #29: a barcode with no value prints nothing; the check and the render say so (once, not once per row)
import { describe, it, expect } from 'vitest';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { fontStore, report } from '../helpers.js';

const bc = (value, extra = {}) => ({
  type: 'barcode',
  name: 'Barcode1',
  x: 0,
  y: 0,
  w: 160,
  h: 48,
  symbology: 'code128',
  value,
  ...extra,
});

describe('barcode without a value', () => {
  it('a constant empty value: the check warns', () => {
    expect(validate(report([bc('')])).warnings).toContain('Barcode1 has no value: nothing is printed');
    expect(validate(report([bc(undefined)])).warnings).toContain('Barcode1 has no value: nothing is printed');
  });
  it('a value or an expression: no warning from the check', () => {
    expect(validate(report([bc('ABC')])).warnings.filter((w) => w.includes('no value'))).toEqual([]);
    expect(validate(report([bc('=Fields.sku')])).warnings.filter((w) => w.includes('no value'))).toEqual([]);
  });
  it('the render warns once', async () => {
    const m = await render(report([bc('')]), { fontStore });
    expect(m.warnings.filter((w) => w.includes('Barcode1'))).toEqual(['Barcode1 has no value: nothing is printed']);
  });
  it('an expression empty in some rows of a list: one warning, the other rows print', async () => {
    const list = {
      type: 'list',
      name: 'L',
      dataSet: 'Rows',
      x: 0,
      y: 0,
      w: 200,
      h: 50,
      items: [bc('=Fields.sku', { h: 40 })],
    };
    const m = await render(
      report([list], { data: { rows: [{ sku: 'A1' }, { sku: '' }, { sku: null }, { sku: 'B2' }] } }),
      { fontStore },
    );
    const ws = m.warnings.filter((w) => w.includes('Barcode1'));
    expect(ws).toEqual(['Barcode1: the value (=Fields.sku) is empty in some rows; no barcode is printed there']);
  });
});
