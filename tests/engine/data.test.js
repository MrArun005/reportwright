import { describe, it, expect } from 'vitest';
import { jsonPath, parseCsv, detectFields, buildDataSets } from '../../src/engine/data/index.js';

describe('data layer', () => {
  const doc = { a: { list: [{ x: 1, y: { z: 'p' } }, { x: 2, y: { z: 'q' } }] } };
  it('walks JSON paths', () => {
    expect(jsonPath(doc, '$.a.list').length).toBe(2);
    expect(jsonPath(doc, '$.a.list[1].x')).toBe(2);
    expect(jsonPath(doc, '$.a.list[*].y.z')).toEqual(['p', 'q']);
    expect(() => jsonPath(doc, '$..bad')).toThrow();
  });
  it('parses CSV with quotes', () => {
    expect(parseCsv('name,amt\n"Rao, K",10\n"He said ""hi""",20\n')).toEqual([{ name: 'Rao, K', amt: '10' }, { name: 'He said "hi"', amt: '20' }]);
  });
  it('detects field types', () => {
    expect(detectFields([{ a: 1, b: '2026-01-05', c: 'x', d: true }])).toEqual([
      { name: 'a', type: 'number' }, { name: 'b', type: 'date' }, { name: 'c', type: 'string' }, { name: 'd', type: 'boolean' }]);
  });
  it('builds typed, filtered, sorted rows with calculated fields', () => {
    const def = { dataSets: [{ name: 'R', source: 's', path: '$', fields: [{ name: 'n', type: 'number' }, { name: 'k', type: 'string' }, { name: 'dbl', type: 'number', expr: '=Fields.n * 2' }],
      filters: [{ expr: '=Fields.k', op: '<>', value: 'skip' }], sort: [{ by: '=Fields.n', dir: 'desc' }] }] };
    const sets = buildDataSets(def, { s: [{ n: '3', k: 'a' }, { n: '10', k: 'b' }, { n: '7', k: 'skip' }] }, { params: {}, globals: {}, dataSets: {} });
    expect(sets.R).toEqual([{ n: 10, k: 'b', dbl: 20 }, { n: 3, k: 'a', dbl: 6 }]);
  });
});
