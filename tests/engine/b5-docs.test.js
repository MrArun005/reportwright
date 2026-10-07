// B5 item 18: the generated references are up to date, and the examples' report validates and renders.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { schemaMd, functionsMd } from '../../scripts/gen-docs.mjs';
import { validate } from '../../src/engine/schema/validate.js';
import { render } from '../../src/engine/index.js';
import { fontStore } from '../helpers.js';

describe('docs', () => {
  it('docs/SCHEMA.md and docs/FUNCTIONS.md match the schema and the engine (node scripts/gen-docs.mjs)', () => {
    expect(fs.readFileSync('docs/SCHEMA.md', 'utf8')).toBe(schemaMd());
    expect(fs.readFileSync('docs/FUNCTIONS.md', 'utf8')).toBe(functionsMd());
  });
  it('examples/report.pw.json with examples/data.json validates and renders', async () => {
    const def = JSON.parse(fs.readFileSync('examples/report.pw.json', 'utf8'));
    def.dataSources[0].data = JSON.parse(fs.readFileSync('examples/data.json', 'utf8'));
    expect(validate(def)).toMatchObject({ errors: [], warnings: [] });
    const m = await render(def, { fontStore });
    expect(m.pages[0].items.some(i => i.t === 'text' && i.lines.some(l => l.text === 'Asha Rao'))).toBe(true);
  });
  it('the examples use the version about to be published', () => {
    const v = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    for (const d of ['node', 'react', 'vue', 'svelte', 'angular']) {
      const deps = JSON.parse(fs.readFileSync(`examples/${d}/package.json`, 'utf8')).dependencies;
      for (const [n, r] of Object.entries(deps)) if (n.startsWith('@reportwright/')) expect(r, `${d} ${n}`).toBe(v);
    }
  });
});
