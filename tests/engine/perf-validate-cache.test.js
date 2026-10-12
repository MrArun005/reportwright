// #10 perf: validate() is cached by the definition's content: an equal def hits, an edited (mutated) def re-validates.
import { describe, it, expect } from 'vitest';
import { validate, validateCached } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { fontStore } from '../helpers.js';

const def = () => ({
  $schema: 'reportwright/report@1', name: 'T', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'src', type: 'json', data: { rows: [{ a: 1 }] } }],
  dataSets: [{ name: 'Rows', source: 'src', path: '$.rows' }],
  sections: { body: { items: [{ type: 'textbox', name: 'a', x: 0, y: 0, w: 200, h: 18, value: 'hi' }] } },
});
describe('validateCached', () => {
  it('equal defs share one result; a mutated def is validated again', () => {
    const d = def();
    const v1 = validateCached(d);
    expect(validateCached(def())).toBe(v1);
    d.sections.body.items[0].format = 'N2x';
    const v2 = validateCached(d);
    expect(v2).not.toBe(v1);
    expect(v2).toEqual(validate(d));
    expect(v2.warnings.join(' ')).toMatch(/N2x/);
    delete d.sections.body;
    expect(validateCached(d).errors.join(' ')).toMatch(/no body/);
  });
  it('render: a def mutated between renders throws on the new fatal error', async () => {
    const d = def();
    await render(d, { fontStore });
    delete d.sections.body;
    await expect(render(d, { fontStore })).rejects.toThrow(/no body/);
  });
});
