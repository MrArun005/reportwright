// The thumbnail worker thread (thumbs.js): draws one thumbnail at a time, so a heavy report never blocks the server's
// event loop. Plain Node, outside the bundler: the "@/" imports of the server code are mapped to src/ here.
import { parentPort } from 'node:worker_threads';
import { register } from 'node:module';

const src = new URL('../', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export function resolve(s, c, next) { return next(s.startsWith('@/') ? ${JSON.stringify(src)} + s.slice(2) : s, c); }`)}`);

let drawThumb;
try { ({ drawThumb } = await import('./thumbs.js')); }
catch (e) { parentPort.postMessage({ ready: false, error: String(e?.message || e) }); }

if (drawThumb) parentPort.on('message', async ({ n, def, principal, base }) => parentPort.postMessage({ n, result: await drawThumb({ def, principal, base }) }));
