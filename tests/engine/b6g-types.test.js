// B6g #9, #37: the shipped .d.ts compile with skipLibCheck: false, and render()'s options are typed.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TSC = path.join(ROOT, 'node_modules/typescript/bin/tsc');

/** Type-checks files with skipLibCheck: false; `paths` maps package names to declaration files. Returns tsc's output or ''. */
function typecheck(files, paths = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-types-'));
  const cfg = path.join(dir, 'tsconfig.json');
  fs.writeFileSync(cfg, JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', lib: ['es2022', 'dom'], types: [], baseUrl: ROOT, paths },
    files,
  }));
  try { execFileSync(process.execPath, [TSC, '-p', cfg], { encoding: 'utf8', stdio: 'pipe' }); return ''; }
  catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('report.d.ts', () => {
  it('compiles with skipLibCheck: false', () => {
    const out = typecheck([path.join(ROOT, 'packages/engine/report.d.ts'), path.join(ROOT, 'packages/engine/pool/index.d.ts')]);
    expect(out).toBe('');
  });
});

describe('render() options', () => {
  it('the engine declarations are emitted from the JSDoc and the fixture compiles: bad options are errors', () => {
    // inside the repo's node_modules, so the emitted files resolve the packages they name (pdf-lib…) as they do in a build
    fs.mkdirSync(path.join(ROOT, 'node_modules/.cache'), { recursive: true });
    const outDir = fs.mkdtempSync(path.join(ROOT, 'node_modules/.cache/b6g-dts-'));
    try {
      // the same emit as scripts/build-packages.mjs, into a temp folder
      execFileSync(process.execPath, [TSC, '--allowJs', '--declaration', '--emitDeclarationOnly', '--noCheck', '--skipLibCheck', '--rootDir', ROOT, '--outDir', outDir, path.join(ROOT, 'packages/engine/entry.js')], { cwd: ROOT, stdio: 'pipe' });
      const out = typecheck([path.join(ROOT, 'tests/fixtures/types/engine-options.ts')], {
        '@reportwright/engine': [path.join(outDir, 'packages/engine/entry.d.ts')],
      });
      expect(out).toBe('');
    } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
  });
});
