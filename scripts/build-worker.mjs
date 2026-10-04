// Builds pw-worker/render-worker.mjs: the render worker (src/server/render-worker.mjs) with the server code it runs
// bundled in. A production server (next start, and the standalone output in the Docker image, which has no src/) runs
// this copy, so its workers run the code of the same build; next.config.mjs traces pw-worker/ into the standalone
// output. next dev and the tests run the sources (src/server/pool.js, workerFile).
import { build } from 'esbuild';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
await build({
  entryPoints: [path.join(root, 'src/server/render-worker.mjs')],
  outfile: path.join(root, 'pw-worker/render-worker.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: ['node20'],
  alias: { '@': path.join(root, 'src') },
  // CommonJS packages inside an ES module bundle still call require() for Node's own modules
  banner: { js: "import { createRequire as __pwRequire } from 'node:module'; const require = __pwRequire(import.meta.url);" },
  logLevel: 'warning',
  logOverride: { 'unsupported-dynamic-import': 'silent' }, // the SQL drivers: loaded by name at run time, if installed
});
