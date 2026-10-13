import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

// Runs the suite in a headless VS Code (CI wraps this in xvfb-run). Needs `npm run build` and `npm run compile` first.
async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  await runTests({ version: '1.90.2', extensionDevelopmentPath, extensionTestsPath, launchArgs: ['--disable-extensions', '--disable-gpu'] });
}

main().catch((err) => { console.error(err); process.exit(1); });
