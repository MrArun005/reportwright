// B5 item 9: one JSON Schema (src/engine/schema/report.schema.js) for the published types and validate():
// report.d.ts is generated from it, the engine's own item properties are in it, and every example validates.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPORT_SCHEMA } from '../../src/engine/schema/report.schema.js';
import { validate } from '../../src/engine/schema/validate.js';
import { ITEMS, render } from '../../src/engine/index.js';
import { generate } from '../../scripts/gen-report-types.mjs';
import { fontStore } from '../helpers.js';

const defs = REPORT_SCHEMA.$defs;
const of = (s) => (s?.$ref ? defs[s.$ref.replace('#/$defs/', '')] : s);
const itemProps = new Map(defs.Item.anyOf.map(r => {
  const props = Object.assign({}, ...of(r).allOf.map(p => of(p).properties));
  return [props.type.const, props];
}));

describe('report JSON Schema', () => {
  it('packages/engine/report.d.ts is generated from it (node scripts/gen-report-types.mjs)', () => {
    expect(fs.readFileSync('packages/engine/report.d.ts', 'utf8')).toBe(generate());
  });
  it('has every item type and every property and choice the engine reads', () => {
    expect([...itemProps.keys()].sort()).toEqual(Object.keys(ITEMS).filter(t => !ITEMS[t].internal && itemProps.has(t)).sort());
    for (const [type, spec] of Object.entries(ITEMS)) {
      const props = itemProps.get(type);
      if (!props) continue;
      for (const p of spec.props || []) {
        expect(props[p.key], `${type}.${p.key}`).toBeDefined();
        const list = props[p.key].enum;
        for (const o of (p.options || []).map(o => (typeof o === 'object' ? o.value : o)).filter(o => o !== '' && o != null)) if (list) expect(list, `${type}.${p.key}`).toContain(o);
      }
    }
  });
  it('validate() knows the schema\'s properties (no "unknown property dir") and its choices', () => {
    const def = (tb) => ({ $schema: 'reportwright/report@1', sections: { body: { items: [{ type: 'textbox', x: 0, y: 0, w: 10, h: 10, ...tb }] } } });
    expect(validate(def({ dir: 'rtl', alt: 'x' })).warnings).toEqual([]);
    expect(validate(def({ dir: 'rtl2' })).warnings).toEqual(['textbox: "dir" is "rtl2"; expected one of "ltr", "rtl", "auto"']);
    expect(validate(def({ dir: '=Fields.d' })).warnings).toEqual([]);
  });
  const examples = [
    ...Object.entries(defs).flatMap(([n, s]) => (s.examples || []).map((e, i) => [`schema ${n} example ${i + 1}`, e])),
    ...['README.md', 'docs/QUICKSTART.md', ...fs.readdirSync('packages').map(p => `packages/${p}/README.md`)].filter(f => fs.existsSync(f)).flatMap(f =>
      [...fs.readFileSync(f, 'utf8').matchAll(/```json\n([\s\S]*?)```/g)].map((m, i) => [`${f} json block ${i + 1}`, m[1]]).filter(([, t]) => t.includes('reportwright/report@1')).map(([n, t]) => [n, JSON.parse(t)])),
  ];
  it.each(examples)('%s validates and renders', async (_, def) => {
    const v = validate(def);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect((await render(def, { fontStore })).pages.length).toBeGreaterThan(0);
  });
  it('the engine package publishes the schema as schema.json', () => {
    const src = fs.readFileSync(path.join('scripts/build-packages.mjs'), 'utf8');
    expect(src).toMatch(/'\.\/schema\.json'/);
  });
});
