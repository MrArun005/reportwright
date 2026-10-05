// @ts-check
// A render worker thread (pool.js): runs one server render at a time, so renders never hold the server's event loop.
// Plain Node, outside the bundler: the "@/" imports of the server code are mapped to src/ here. The engine's fonts,
// HarfBuzz and the ICC profile load once per worker (module state in renderer.js) and serve every render after.
// A built copy (scripts/build-worker.mjs) has the server code bundled in and no "@/" left: the hook is then idle.
import { parentPort, workerData } from 'node:worker_threads';
import { register } from 'node:module';

const src = new URL('../', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export function resolve(s, c, next) { return next(s.startsWith('@/') ? ${JSON.stringify(src)} + s.slice(2) : s, c); }`)}`);

// development without PW_SESSION_SECRET: the request thread's random secret, so the server's calls to itself check out
if (workerData?.devSecret) globalThis.__pwDevSecret = workerData.devSecret;

let mod;
try {
  const [renderer, thumbs] = await Promise.all([import('./renderer.js'), import('./thumbs.js')]);
  mod = { ...renderer, drawThumb: thumbs.drawThumb };
} catch (e) { parentPort.postMessage({ ready: false, error: String(e?.message || e) }); }

/** The bytes, transferable: their own ArrayBuffer (a small Buffer lives in Node's shared pool and cannot move). */
const own = (b) => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength && !(b.buffer instanceof SharedArrayBuffer) ? b : new Uint8Array(b));

async function run(m) {
  if (m.kind === 'thumb') return { result: await mod.drawThumb(m) };
  if (m.kind === 'pack') return { result: await (await import('./jobs.js')).packOutput(m.spec) }; // a batch's zip or merged PDF
  const { opt } = m;
  // a saved template is read and checked here, as the principal (the same perms code as on the request thread)
  const def = m.def ?? (m.how === 'runnable' ? await (await import('./perms.js')).readRunnable(opt.principal, m.ref) : await mod.loadTemplate(m.ref, opt.principal));
  const r = await mod.renderTo(def, opt);
  const bytes = own(r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes));
  return { result: { bytes, contentType: r.contentType, ext: r.ext, name: def.name || null, pages: r.model.pages.length, ms: r.model.stats?.ms ?? null, warnings: r.model.warnings?.length ?? 0 }, transfer: [bytes.buffer] };
}

if (mod) {
  parentPort.on('message', async (m) => {
    let out;
    try {
      const { result, transfer } = await run(m);
      out = { id: m.id, ok: result, heapMB: process.memoryUsage().heapUsed / 1048576 };
      parentPort.postMessage(out, transfer || []);
    } catch (e) {
      const err = /** @type {any} */ (e);
      parentPort.postMessage({ id: m.id, err: { message: String(err?.message || err), status: err?.status, missingParameters: err?.missingParameters }, heapMB: process.memoryUsage().heapUsed / 1048576 });
    }
  });
  parentPort.postMessage({ ready: true });
}
