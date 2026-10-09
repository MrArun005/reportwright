// B6g #8: silent mistakes in a report definition get a warning (or error) with a "did you mean" where one is sensible.
import { describe, it, expect } from 'vitest';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { fontStore } from '../helpers.js';

const base = (extra = {}, item = {}) => ({
  $schema: 'pagewright/report@1', name: 'T', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows: [] } }],
  dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }],
  sections: { body: { items: [{ type: 'textbox', name: 'a', x: 0, y: 0, w: 200, h: 18, value: 'hi', ...item }] } },
  ...extra,
});
const warnings = (extra, item) => validate(base(extra, item)).warnings;
const expectWarning = (ws, ...parts) => {
  const hit = ws.find(w => parts.every(p => w.includes(p)));
  expect(hit, `no warning with ${parts.join(' + ')} in ${JSON.stringify(ws)}`).toBeTruthy();
};

describe('validate: silent mistakes', () => {
  it('an unknown format code (N2x) is flagged, suggesting N2', () => {
    expectWarning(warnings({}, { format: 'N2x' }), '"N2x"', 'N2');
  });
  it('an unknown format code in a style is flagged too', () => {
    expectWarning(warnings({}, { style: { format: 'N2x' } }), '"N2x"');
  });
  it('an unknown colour name (redd) is flagged, suggesting red', () => {
    expectWarning(warnings({}, { style: { color: 'redd' } }), '"redd"', '"red"');
  });
  it('a known colour name is not flagged', () => {
    expect(warnings({}, { style: { color: 'red' } }).some(w => w.includes('colour'))).toBe(false);
  });
  it('a style name that is not in the named styles is flagged, suggesting the near one', () => {
    expectWarning(warnings({ styles: { named: { Header: { fontWeight: 'bold' } } } }, { styleName: 'Hedaer' }), '"Hedaer"', '"Header"');
  });
  it('a sort entry without "by" (the shape is {by, dir}) is flagged', () => {
    const def = base({ dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', sort: [{ expr: '=Fields.Name' }] }] });
    expectWarning(validate(def).warnings, 'Data set "Rows"', '{by, dir}');
  });
  it('a sort entry with an unknown key is flagged, suggesting dir', () => {
    const def = base({ dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', sort: [{ by: '=Fields.Name', direction: 'desc' }] }] });
    expectWarning(validate(def).warnings, '"direction"', '"dir"');
  });
  it('a filter with unknown keys (expression, operator) is flagged, naming the expected keys', () => {
    const def = base({ dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', filters: [{ expression: '=Fields.Region', operator: '=', value: 'North' }] }] });
    const ws = validate(def).warnings;
    expectWarning(ws, 'Data set "Rows", filter 1', '"expression"', '"expr"', '{expr, op, value, value2, skipBlank}');
    expectWarning(ws, 'Data set "Rows", filter 1', '"operator"', '"op"');
  });
  it('a filter on an item is checked too, and a well-formed filter is not flagged', () => {
    expectWarning(warnings({}, { type: 'table', dataSet: 'Rows', filters: [{ expr: '=Fields.A', opp: '=', value: 1 }] }), 'filter 1', '"opp"', '"op"');
    const ok = base({ dataSets: [{ name: 'Rows', source: 'src', path: '$.rows', filters: [{ expr: '=Fields.A', op: 'between', value: 1, value2: 2, skipBlank: true }] }] });
    expect(validate(ok).warnings.some(w => w.includes('filter'))).toBe(false);
  });
  it('a date parameter default that is not a date is flagged', () => {
    const ws = warnings({ parameters: [{ name: 'asOf', type: 'date', default: '31/12/2026' }] });
    expectWarning(ws, 'Parameter "asOf"', '31/12/2026');
  });
  it('a required parameter with no value fails the render with a clear error, not a blank report', async () => {
    const def = base({ parameters: [{ name: 'region', type: 'string', required: true }] });
    await expect(render(def, { fontStore })).rejects.toThrow('Enter a value for: region');
  });
  it('a chart with no series is flagged', () => {
    const def = base({}, {});
    def.sections.body.items = [{ type: 'chart', name: 'C', x: 0, y: 0, w: 300, h: 150, chartType: 'column', series: [] }];
    expectWarning(validate(def).warnings, 'C', 'no series');
  });
  it('an image with a local file path is flagged', () => {
    expectWarning(warnings({}, { type: 'image', src: 'C:\\logos\\x.png' }), 'local file path');
    expectWarning(warnings({}, { type: 'image', src: './a.png' }), 'local file path');
  });
  it('an image with an https or embedded source is not flagged', () => {
    expect(warnings({}, { type: 'image', src: 'https://example.com/a.png' }).some(w => w.includes('local file'))).toBe(false);
    expect(warnings({}, { type: 'image', src: 'embedded:logo' }).some(w => w.includes('local file'))).toBe(false);
  });
  it('an unknown page size (A44) is flagged, suggesting A4', () => {
    expectWarning(validate(base({ page: { size: 'A44', margins: 36 } })).warnings, '"A44"', '"A4"');
  });
  // resolvePage matches a padded or differently cased name ("A4 ", "a4") to A4, so it is not flagged. The old
  // expectation (a warning) predates that: the engine used to ignore the padding and fall back to A4 silently.
  it('a page size with a trailing space ("A4 ") resolves to A4 and is not flagged', () => {
    expect(validate(base({ page: { size: 'A4 ', margins: 36 } })).warnings.some(w => /page size/i.test(w))).toBe(false);
  });
});
