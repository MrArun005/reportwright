// The packages' type declarations as a user's project sees them: npm pack each package, install the tarballs (with
// typescript, @types/react and vue) in a new project and run tsc --noEmit with skipLibCheck false over an import of
// every typed entry. Fails on any error, so a declaration naming a module the package does not depend on (1.0.0
// shipped 13 TS2307s for 'pdf-lib') cannot come back. Run npm run build:packages first. Needs the registry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const PKGS = ['fonts', 'fonts-cjk', 'engine', 'viewer', 'react', 'vue', 'svelte', 'angular'];
const ENTRIES = [
  '@reportwright/engine',
  '@reportwright/engine/report',
  '@reportwright/engine/pool',
  '@reportwright/fonts',
  '@reportwright/fonts-cjk',
  '@reportwright/viewer',
  '@reportwright/viewer/designer',
  '@reportwright/viewer/react-peer',
  '@reportwright/viewer/react-peer/designer',
  '@reportwright/react',
  '@reportwright/vue',
  '@reportwright/svelte',
  '@reportwright/angular',
];
const ver = (n) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', n, 'package.json'), 'utf8')).version;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-types-'));
const npm = (args, cwd = dir) =>
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
try {
  const tgz = PKGS.map((p) =>
    path.join(
      dir,
      npm(['pack', path.join(root, 'packages', p), '--pack-destination', dir, '--silent'])
        .trim()
        .split('\n')
        .pop(),
    ),
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'rw-types-check', private: true, type: 'module' }),
  );
  npm([
    'install',
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',
    '--legacy-peer-deps',
    ...tgz,
    `typescript@${ver('typescript')}`,
    '@types/react@19.1.8',
    '@types/react-dom@19.1.6',
    'vue@3',
  ]);
  fs.writeFileSync(
    path.join(dir, 'index.ts'),
    ENTRIES.map((e, i) => `import * as m${i} from '${e}';\nexport { m${i} };\n`).join(''),
  );
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2022',
        lib: ['es2022', 'dom', 'dom.iterable'],
        jsx: 'react-jsx',
        types: [],
      },
      files: ['index.ts'],
    }),
  );
  try {
    execFileSync(process.execPath, [path.join(dir, 'node_modules/typescript/bin/tsc'), '-p', dir], {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    console.log(`package types: ${ENTRIES.length} entries, 0 errors (skipLibCheck false)`);
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    console.error(out.split(dir).join('<project>'));
    console.error(`package types: ${(out.match(/error TS\d+/g) || []).length} errors (skipLibCheck false)`);
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
