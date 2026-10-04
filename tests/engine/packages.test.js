// Phase 7: the npm packages build, the framework wrappers keep the framework and the viewer external,
// and the published types type-check a consumer (tests/fixtures/types/consumer.ts, with @ts-expect-error lines).
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const node = (...args) => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const json = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

describe('npm packages', () => {
  beforeAll(() => { node('scripts/build-embed.mjs'); node('scripts/build-packages.mjs'); }, 240000);

  it.each([['react', ['react']], ['vue', ['vue']], ['svelte', []], ['angular', []]])('@pagewright/%s imports the framework and the viewer, bundles neither', (name, frameworks) => {
    const src = fs.readFileSync(path.join(root, `packages/${name}/dist/index.js`), 'utf8');
    expect(src.length).toBeLessThan(8000); // a thin wrapper, not a bundle
    expect(src).toMatch(/import\('@pagewright\/viewer'\)/);
    for (const f of frameworks) expect(src).toMatch(new RegExp(`from '${f}'`));
    const pkg = json(`packages/${name}/package.json`);
    expect(pkg.dependencies).toBeUndefined();
    expect(Object.keys(pkg.peerDependencies)).toEqual(expect.arrayContaining(['@pagewright/viewer', ...frameworks]));
    expect(fs.existsSync(path.join(root, `packages/${name}`, pkg.types))).toBe(true);
  });

  it('the viewer package has the designer entry and generated types; the engine has its API and report types', () => {
    const v = json('packages/viewer/package.json');
    expect(v.exports['./designer'].default).toBe('./dist/designer.js');
    expect(fs.readFileSync(path.join(root, 'packages/viewer/dist/designer.d.ts'), 'utf8')).toMatch(/export function mountDesigner\(target: string \| HTMLElement, opts\?: DesignerOptions\): DesignerHandle/);
    expect(fs.readFileSync(path.join(root, 'packages/viewer/dist/viewer.d.ts'), 'utf8')).toMatch(/export type ViewerOptions/);
    expect(fs.existsSync(path.join(root, 'packages/engine/dist/types/src/exporters/pdf.d.ts'))).toBe(true);
    expect(json('packages/engine/package.json').files).toEqual(expect.arrayContaining(['index.d.ts', 'report.d.ts']));
  });

  it('a TypeScript consumer type-checks, and every wrong case fails', () => {
    let out = '';
    try { node('node_modules/typescript/bin/tsc', '-p', 'tests/fixtures/types'); } catch (e) { out = String(e.stdout) + String(e.stderr); }
    expect(out).toBe('');
  }, 120000);
});
