// #3a: a sparkline's "style" is its kind (line, column, area, winloss), not a style object
import { describe, it, expect } from 'vitest';
import { validate } from '../../src/engine/schema/validate.js';

const def = (style) => ({
  $schema: 'reportwright/report@1',
  name: 'T',
  page: { size: 'A4', margins: [36, 36, 36, 36] },
  sections: {
    body: { items: [{ type: 'sparkline', name: 'Sparkline1', x: 0, y: 0, w: 100, h: 20, value: '', style }] },
  },
});
const styleWarnings = (style) => validate(def(style)).warnings.filter((w) => w.includes('style'));

describe('validate: sparkline style', () => {
  it('a sparkline with style "line" (the default) gets no style warning', () => {
    expect(styleWarnings('line')).toEqual([]);
  });
  it('each kind is accepted', () => {
    for (const s of ['line', 'column', 'area', 'winloss']) expect(styleWarnings(s)).toEqual([]);
  });
  it('an unknown kind is flagged once, with the choices', () => {
    const ws = styleWarnings('pie');
    expect(ws).toHaveLength(1);
    expect(ws[0]).toContain('"winloss"');
    expect(ws[0]).not.toContain('is ignored');
  });
});
