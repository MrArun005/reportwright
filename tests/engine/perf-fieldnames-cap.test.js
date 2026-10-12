// #9 perf: field names come from the first 200 inline rows, also when the data is a plain row list.
import { describe, it, expect } from 'vitest';
import { validate } from '../../src/engine/schema/validate.js';

const def = (rows) => ({
  $schema: 'reportwright/report@1',
  dataSources: [{ name: 'd', type: 'json', data: rows }],
  dataSets: [{ name: 'ds', source: 'd' }],
  sections: { body: { items: [{ type: 'textbox', name: 't', x: 0, y: 0, w: 50, h: 10, dataSet: 'ds', value: '=Fields.late' }] } },
});
describe('fieldNames row cap', () => {
  it('a field seen in the first 200 rows is known; rows after 200 are not scanned', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ a: i }));
    const early = rows.map((r, i) => (i === 5 ? { ...r, late: 1 } : r));
    const late = rows.map((r, i) => (i === 900 ? { ...r, late: 1 } : r));
    const w = (d) => validate(d).warnings.join('\n');
    expect(w(def(early))).not.toMatch(/late/);
    expect(w(def(late))).toMatch(/late/);
  });
});
