// Docs that ship in the npm packages must not claim what the repository cannot yet prove (B7 docs drift).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PUBLIC_DOCS = [
  ...fs.readdirSync(path.join(ROOT, 'packages')).map(p => `packages/${p}/README.md`),
  'docs/RELEASING.md', 'SECURITY.md', 'README.md',
];

describe('package docs', () => {
  it('claim no npm provenance until the repository is public (N11)', () => {
    for (const f of PUBLIC_DOCS) {
      expect({ file: f, provenance: /provenance/i.test(read(f)) && /shields\.io\/badge\/npm-provenance/.test(read(f)) }).toEqual({ file: f, provenance: false });
    }
  });
});

// README code is checked, not just read: the engine quick start's statement.pw.json renders, and the viewer's data
// shape matches the data set path it documents.
import { spawnSync } from 'node:child_process';
import { render } from '../../src/engine/index.js';
import { validate } from '../../src/engine/schema/validate.js';
import { withData } from '../../src/embed/index.js';
import { NO_CJK_FONTS } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';

const fence = (src, lang, after) => {
  const from = after ? src.indexOf(after) : 0;
  const m = new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g');
  m.lastIndex = Math.max(0, from);
  const r = m.exec(src);
  if (!r) throw new Error(`no \`\`\`${lang} block after ${after}`);
  return r[1];
};

describe('README examples run', () => {
  it('the engine quick start: statement.pw.json renders as written', async () => {
    const def = JSON.parse(fence(read('packages/engine/README.md'), 'json', 'statement.pw.json'));
    expect(validate(def).errors).toEqual([]);
    const out = await render(def, { fontStore, parameters: { accountId: 'LN-1' } });
    const all = out.pages.flatMap(texts);
    expect(all).toEqual(expect.arrayContaining(['Statement', 'Design', 'Hosting']));
    expect(all.join(' ')).toMatch(/1,299\.50/);
  });
  it('the viewer data example: { rows } for a "$.rows" data set, the bare array for a data set with no path', async () => {
    const readme = read('packages/viewer/README.md');
    expect(readme).toMatch(/data: \{ orders: \{ rows: \[\.\.\.\] \} \}/);
    const rows = [{ item: 'Design', amount: 1200 }, { item: 'Hosting', amount: 99.5 }];
    const base = (path) => ({ $schema: 'reportwright/report@1', name: 'R', page: { size: 'A4', margins: [36, 36, 36, 36] },
      dataSources: [{ name: 'orders', type: 'json', data: {} }], dataSets: [{ name: 'D', source: 'orders', ...(path ? { path } : {}) }],
      sections: { body: { items: [{ type: 'table', x: 0, y: 0, w: 400, h: 40, dataSet: 'D', columns: [{ width: 200 }, { width: 200 }],
        detail: [{ height: 16, cells: [{ value: '=Fields.item' }, { value: '=Fields.amount' }] }],
        footer: [{ height: 16, cells: [{ value: 'Total' }, { value: '=Sum(Fields.amount)' }] }] }] } } });
    const total = async (def, data) => (await render(withData(def, data), { fontStore })).pages.flatMap(texts);
    expect(await total(base('$.rows'), { orders: { rows } })).toContain('1299.5');
    expect(await total(base(), { orders: rows })).toContain('1299.5');
    expect(await total(base('$.rows'), { orders: rows })).not.toContain('1299.5');
  });
});

describe('engine text and CLI help (B7 docs drift)', () => {
  it('the CJK warning names the npm command first, the app second (#28)', () => {
    expect(NO_CJK_FONTS).toMatch(/npx reportwright-fonts-cjk/);
    expect(NO_CJK_FONTS.indexOf('npx reportwright-fonts-cjk')).toBeLessThan(NO_CJK_FONTS.indexOf('npm run fonts:cjk'));
  });
  it('the old positional export form says it will be removed in 1.0 (N12)', () => {
    expect(read('packages/engine/entry.js')).not.toMatch(/removed in 0\.9/);
    expect(read('packages/engine/entry.js')).toMatch(/will be removed in 1\.0/);
  });
  it('the CLI help marks audit and migrate-storage as server only (N13)', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'pw.mjs'), '--help'], { encoding: 'utf8' });
    const help = r.stdout + r.stderr;
    expect(help.indexOf('SERVER ONLY')).toBeGreaterThan(-1);
    expect(help.indexOf('SERVER ONLY')).toBeLessThan(help.indexOf('pw audit verify'));
    expect(help).toMatch(/pw migrate-storage[^\n]*SERVER ONLY/);
  });
  it('the engine README does not claim the pw command (N13)', () => {
    expect(read('packages/engine/README.md')).not.toMatch(/Includes the `pw` command line/);
  });
});
