// create-reportwright (packages/create-reportwright/src/create.mjs): arguments, template choice, the package.json
// rewrite and the non-empty folder refusal, on temp folders (no build, no install)
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs, pickTemplate, rewritePackageJson, appName, isEmptyDir, create, TEMPLATES } from '../../packages/create-reportwright/src/create.mjs';

const tmps = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'create-rw-')); tmps.push(d); return d; };
afterEach(() => { for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('create-reportwright', () => {
  it('parses the folder, --template / -t / --template=, --yes / -y', () => {
    expect(parseArgs([])).toEqual({ dir: undefined, template: undefined, yes: false, help: false });
    expect(parseArgs(['my-app', '--template', 'vue', '--yes'])).toMatchObject({ dir: 'my-app', template: 'vue', yes: true });
    expect(parseArgs(['-t', 'react', 'x', '-y'])).toMatchObject({ dir: 'x', template: 'react', yes: true });
    expect(parseArgs(['--template=angular'])).toMatchObject({ template: 'angular' });
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('rejects an unknown template, an unknown flag and two folders', () => {
    expect(() => parseArgs(['--template', 'jquery'])).toThrow(/unknown template "jquery"/);
    expect(() => parseArgs(['--template'])).toThrow(/unknown template/);
    expect(() => parseArgs(['--force'])).toThrow(/unknown option --force/);
    expect(() => parseArgs(['a', 'b'])).toThrow(/one folder only/);
  });

  it('picks a template by number or name; empty is node; anything else is undefined (asked again)', () => {
    expect(TEMPLATES).toEqual(['node', 'react', 'vue', 'svelte', 'angular']);
    expect(pickTemplate('')).toBe('node');
    expect(pickTemplate('3')).toBe('vue');
    expect(pickTemplate(' Svelte ')).toBe('svelte');
    expect(pickTemplate('9')).toBeUndefined();
    expect(pickTemplate('ember')).toBeUndefined();
  });

  it('rewrites the name and pins only @reportwright/* to the version', () => {
    const pkg = { name: 'reportwright-example-react', private: true, scripts: { dev: 'vite' },
      dependencies: { '@reportwright/react': '0.1.0', '@reportwright/viewer': '^0.1.0', react: '^19.0.0' }, devDependencies: { vite: '^7.0.0' } };
    expect(rewritePackageJson(pkg, 'my-app', '1.2.3')).toEqual({ ...pkg, name: 'my-app',
      dependencies: { '@reportwright/react': '1.2.3', '@reportwright/viewer': '1.2.3', react: '^19.0.0' }, devDependencies: { vite: '^7.0.0' } });
    expect(pkg.dependencies['@reportwright/react']).toBe('0.1.0'); // not mutated
    expect(appName('/x/My Reports!')).toBe('my-reports-');
    expect(appName('.hidden')).toBe('hidden');
  });

  it('copies the template into a new or empty folder and refuses a non-empty one', () => {
    const templatesDir = tmp();
    fs.mkdirSync(path.join(templatesDir, 'node'));
    fs.writeFileSync(path.join(templatesDir, 'node/package.json'), JSON.stringify({ name: 't', dependencies: { '@reportwright/engine': '0.0.1' } }));
    fs.writeFileSync(path.join(templatesDir, 'node/report.pw.json'), '{}');
    const base = tmp();
    const dir = path.join(base, 'new-app');
    create({ dir, template: 'node', version: '9.9.9', templatesDir });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))).toEqual({ name: 'new-app', dependencies: { '@reportwright/engine': '9.9.9' } });
    expect(fs.existsSync(path.join(dir, 'report.pw.json'))).toBe(true);

    const empty = path.join(base, 'empty'); fs.mkdirSync(path.join(empty, '.git'), { recursive: true });
    expect(isEmptyDir(empty)).toBe(true);
    create({ dir: empty, template: 'node', version: '9.9.9', templatesDir });

    expect(isEmptyDir(dir)).toBe(false);
    expect(() => create({ dir, template: 'node', version: '9.9.9', templatesDir })).toThrow(/is not empty/);
  });
});
