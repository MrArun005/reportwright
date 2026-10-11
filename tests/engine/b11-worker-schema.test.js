// The render worker bundles the report schema without its prose (scripts/embed-options.mjs stripSchema): validate()
// must say exactly what it says with the full schema, on the corpus and on the b11 silent-error cases.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripSchema } from '../../scripts/embed-options.mjs';
import { REPORT_SCHEMA } from '../../src/engine/schema/report.schema.js';
import { report } from '../helpers.js';

const root = path.join(import.meta.dirname, '../..');
const defs = [
  ...fs.readdirSync(path.join(root, 'reports')).filter(f => f.endsWith('.pw.json')).map(f => JSON.parse(fs.readFileSync(path.join(root, 'reports', f), 'utf8'))),
  // the b11 cases: half-written filters, bare sorts and groups, a misspelt parameter and style, an unknown type and data set
  report([{ type: 'table', name: 'T', x: 0, y: 0, w: 200, h: 40, dataSet: 'Rowz', columns: [{ width: 200 }], detail: [{ cells: [{ value: '=Parameters.Regoin' }] }],
    filters: [{ expr: '=Fields.a >= 2' }, { expr: '=Fields.a', op: '>=' }, { expr: '=Fields.a', op: 'between', value: 1 }, { expr: '', op: '=', value: 1 }, { expr: '=Fields.a', op: 'equals', value: 1 }],
    sort: [{ by: 'a' }, { by: 'rr' }], groups: [{ expr: 'a' }], style: { fontWieght: 'bold' } }, { type: 'textbx', x: 0, y: 50, w: 10, h: 10, dir: 'rtl2' }],
  { data: { rows: [{ a: 1 }] }, def: { parameters: [{ name: 'Region', type: 'string' }] } }),
];

describe('the worker\'s stripped report schema', () => {
  it('has no prose left, keeps properties named title or description, and is smaller', () => {
    const s = stripSchema(REPORT_SCHEMA);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/"(description|\$comment|examples|x-ts)":(?!\{"type")/);
    expect(s.$defs.Chart.allOf.some(p => p.properties?.title) || JSON.stringify(s.$defs.Chart).includes('"title":{')).toBe(true);
    expect(text.length).toBeLessThan(JSON.stringify(REPORT_SCHEMA).length * 0.8);
  });
  it('validate() gives the same errors and warnings as with the full schema', async () => {
    const full = (await import('../../src/engine/schema/validate.js')).validate;
    vi.resetModules();
    vi.doMock('../../src/engine/schema/report.schema.js', () => ({ REPORT_SCHEMA: stripSchema(REPORT_SCHEMA) }));
    const stripped = (await import('../../src/engine/schema/validate.js')).validate;
    vi.doUnmock('../../src/engine/schema/report.schema.js');
    expect(stripped).not.toBe(full);
    for (const d of defs) expect(stripped(structuredClone(d))).toEqual(full(structuredClone(d)));
    expect(full(defs.at(-1)).errors.length).toBeGreaterThan(4); // the b11 cases do say something
  });
});
