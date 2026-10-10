// Memory of a streaming export (docs/research/STREAMING-1M.md, phase 0): one process per (format, rows, shape) renders
// a 6-column report whose rows come from a local HTTP JSON source written lazily (no million-row array anywhere), into
// a stream that a reader drains, and reports the render process's peak resident memory above its start (engine loaded),
// sampled every 10 ms. The render process gets the small worker's heap (--max-old-space-size=192), as a streaming render
// gets in the server's pool.
//   node scripts/mem-stream.mjs [format=csv|xlsx|pdf] [rows=100000,300000] [shape=plain|sorted|grouped|numbered|tagged|zebra|zebra3]
// pdf: the server's streaming PDF (renderer.js → engine/paged.js windows of rows → exporters/pdfstream.js).
// Prints one JSON line per run, then the flat-line verdict: peak(last) - peak(first) < FLAT_MB (30).
// Never run 1M on a small laptop: project it from the slope (rows are linear).
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FLAT_MB = 30;

/** The report: id, name, city, qty, price, day from one JSON source. */
export function memReport(url, shape = 'plain', format = 'csv') {
  const table = {
    type: 'table', name: 'Rows', dataSet: 'D', x: 0, y: 0, w: 520, h: 40,
    columns: [{ width: 60 }, { width: 140 }, { width: 90 }, { width: 60 }, { width: 80 }, { width: 90 }],
    header: [{ height: 16, cells: [{ value: 'Id' }, { value: 'Name' }, { value: 'City' }, { value: 'Qty' }, { value: 'Price' }, { value: 'Day' }] }],
    detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.name' }, { value: '=Fields.city' }, { value: '=Fields.qty' }, { value: '=Fields.price', style: { format: 'N2' } }, { value: '=Fields.day', style: { format: 'd' } }] }],
    footer: [{ height: 14, cells: [{ value: 'Total' }, null, null, { value: '=Sum(Fields.qty)' }, { value: '=Sum(Fields.price)', style: { format: 'N2' } }, null] }],
    ...(shape === 'grouped' ? { groups: [{ name: 'City', expr: '=Fields.city', header: [{ cells: [{ value: '=Fields.city' }] }], footer: [{ cells: [null, null, null, { value: '=Sum(Fields.qty)' }, { value: '=Sum(Fields.price)', style: { format: 'N2' } }, null] }] }] } : {}),
  };
  // zebra: an expression background per detail row; zebra3 adds expression borders and number formats
  if (shape === 'zebra' || shape === 'zebra3') table.detail[0].style = { backgroundColor: '=IIf(RowNumber() Mod 2 = 0, "#f3f4f6", "#ffffff")' };
  if (shape === 'zebra3') {
    table.detail[0].style.borderBottom = '=IIf(RowNumber() Mod 2 = 0, "0.5pt solid #d1d5db", "0.5pt solid #e5e7eb")';
    table.detail[0].cells[3].style = { format: '=IIf(Fields.qty > 5, "N0", "N1")' };
  }
  return {
    $schema: 'reportwright/report@1', name: `mem-${shape}`, page: { size: 'A4', margins: [36, 36, 36, 36] },
    dataSources: [{ name: 's', type: 'rest', url }],
    dataSets: [{ name: 'D', source: 's', path: '$.rows', fields: [{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }, { name: 'city', type: 'string' }, { name: 'qty', type: 'number' }, { name: 'price', type: 'number' }, { name: 'day', type: 'date' }],
      ...(shape === 'sorted' ? { sort: [{ by: '=Fields.city' }, { by: '=Fields.id', dir: 'desc' }] } : {}) }],
    // numbered: "Page N of M" in the page footer (a streaming PDF counts its pages first)
    sections: { body: { items: [table] }, ...(shape === 'numbered' ? { pageFooter: { height: 16, items: [{ type: 'textbox', name: 'P', x: 0, y: 0, w: 520, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] } } : {}) },
  };
}

/** A JSON source of n rows, written as it is read (back-pressure through the socket). */
export function dataServer() {
  const CITIES = ['Pune', 'Delhi', 'Chennai', 'Mumbai', 'Kolkata', 'Bengaluru', 'Hyderabad'];
  const server = http.createServer(async (req, res) => {
    const n = Number(new URL(req.url, 'http://x').searchParams.get('n')) || 1000;
    res.writeHead(200, { 'content-type': 'application/json' });
    const put = (s) => (res.write(s) ? null : new Promise(r => res.once('drain', r)));
    await put('{"rows":[');
    let buf = '';
    for (let i = 0; i < n; i++) {
      buf += `${i ? ',' : ''}{"id":${i},"name":"Customer ${i}","city":"${CITIES[(i * 3) % 7]}","qty":${(i * 37) % 11},"price":${((i * 7.31) % 100).toFixed(2)},"day":"2026-0${1 + (i % 9)}-1${i % 10}"}`;
      if (buf.length > 65536) { const w = put(buf); buf = ''; if (w) await w; }
    }
    await put(buf + ']}');
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/rows` })));
}

/** One run in a fresh process: { format, rows, shape, peakMB, baseMB, bytes, ms }. */
export function runOnce(format, rows, shape, url) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--max-old-space-size=192', '--expose-gc', '--no-warnings', path.join(ROOT, 'scripts/mem-stream.mjs'), '--child', format, String(rows), shape, `${url}?n=${rows}`],
      { cwd: ROOT, env: { ...process.env, PW_MODE: 'dev', PW_RENDER_TIMEOUT_MS: '600000' }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', (code) => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { reject(new Error(`run failed (${code}): ${out}`)); } });
  });
}

async function child(format, rows, shape, url) {
  const src = pathToFileURL(path.join(ROOT, 'src') + '/').href;
  const { register } = await import('node:module');
  register(`data:text/javascript,${encodeURIComponent(`export function resolve(s, c, next) { return next(s.startsWith('@/') ? ${JSON.stringify(src)} + s.slice(2) : s, c); }`)}`);
  const { renderTo } = await import('../src/server/renderer.js');
  const { portSink, portSource } = await import('../src/server/stream-out.js');
  const { MessageChannel } = await import('node:worker_threads');
  // warm: the engine and the fonts, as a worker has them before its first render
  {
    const { port1, port2 } = new MessageChannel();
    const s = portSource(port1);
    const sink = portSink(port2);
    const r = renderTo(memReport(`${url.split('?')[0]}?n=10`, shape, format), { format, out: sink, self: new URL(url).origin });
    r.then((x) => { if (x.streamed) sink.end(); else s.abandon(); }, () => s.abandon());
    await new Response(s.stream).arrayBuffer();
    if (!(await r).streamed) throw new Error('the report did not stream');
  }
  global.gc?.();
  await new Promise(r => setTimeout(r, 200));
  const rss = () => process.memoryUsage.rss() / 1048576;
  const base = rss();
  let peak = base;
  const t = setInterval(() => { const x = rss(); if (x > peak) peak = x; }, 10);
  const t0 = Date.now();
  const { port1, port2 } = new MessageChannel();
  const s = portSource(port1);
  const sink = portSink(port2);
  const done = renderTo(memReport(url, shape, format), { format, out: sink, self: new URL(url).origin, ...(shape === 'tagged' ? { ua: true, pdfa: true } : {}) }); // tagged: an accessible PDF/A
  done.then((x) => { if (x.streamed) sink.end(); else s.abandon(); }, () => s.abandon()); // as the render worker does
  let bytes = 0;
  const reader = s.stream.getReader();
  for (;;) { const { done: end, value } = await reader.read(); if (end) break; bytes += value.length; }
  const r = await done;
  clearInterval(t);
  peak = Math.max(peak, rss());
  process.stdout.write(JSON.stringify({ format, rows, shape, streamed: !!r.streamed, baseMB: Math.round(base), peakMB: Math.round(peak), aboveBaseMB: Math.round(peak - base), bytes, ms: Date.now() - t0 }) + '\n');
  process.exit(0);
}

if (process.argv[2] === '--child') await child(process.argv[3], Number(process.argv[4]), process.argv[5], process.argv[6]);
else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const format = process.argv[2] || 'csv';
  const sizes = (process.argv[3] || '100000,300000').split(',').map(Number);
  const shape = process.argv[4] || 'plain';
  const { server, url } = await dataServer();
  const runs = [];
  for (const n of sizes) { const r = await runOnce(format, n, shape, url); runs.push(r); console.log(JSON.stringify(r)); }
  server.close();
  const a = runs[0], b = runs[runs.length - 1];
  const slope = (b.peakMB - a.peakMB) / ((b.rows - a.rows) / 1e6); // MB per million rows
  console.log(`flat line: peak ${a.peakMB} MB at ${a.rows} rows → ${b.peakMB} MB at ${b.rows} (${b.peakMB - a.peakMB >= 0 ? '+' : ''}${b.peakMB - a.peakMB} MB; limit +${FLAT_MB}): ${b.peakMB - a.peakMB < FLAT_MB ? 'FLAT' : 'GROWS'}. Projected 1M: ~${Math.round(b.peakMB + slope * (1 - b.rows / 1e6))} MB RSS for the whole render process`);
}
