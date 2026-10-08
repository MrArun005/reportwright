// Production-shaped server for the N21/N22 check: a pg Pool (max 10), a cursor per export, the engine's exportPdfStream
// writing straight to the HTTP response, an AbortSignal tied to the request. ENGINE=path to src/exporters/pdfstream.js
import http from 'node:http';
import { createRequire } from 'node:module';
const ROOT = process.env.ROOT || new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(ROOT + '/package.json');
const pg = require('pg');
const { exportPdfStream } = await import(ROOT + '/src/exporters/pdfstream.js');
const { fontStore } = await import(ROOT + '/tests/helpers.js');

const pool = new pg.Pool({ host: '127.0.0.1', port: 5433, user: 'postgres', database: 'pwload', max: 10, connectionTimeoutMillis: 10000 });
const stats = { acquired: 0, released: 0, exports: { ok: 0, failed: 0, aborted: 0, timedOut: 0 } };

const def = {
  $schema: 'reportwright/report@1', name: 'Ledger', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 's', type: 'sql', connection: 'db', query: 'select id, g, amount from tx' }],
  dataSets: [{ name: 'D', source: 's', fields: [{ name: 'id', type: 'number' }, { name: 'g', type: 'string' }, { name: 'amount', type: 'number' }] }],
  sections: {
    body: { items: [{ type: 'table', name: 'T', dataSet: 'D', x: 0, y: 0, w: 450, h: 40, columns: [{ width: 100 }, { width: 150 }, { width: 200 }],
      header: [{ height: 14, cells: [{ value: 'Id' }, { value: 'Group' }, { value: 'Amount' }] }],
      detail: [{ height: 14, cells: [{ value: '=Fields.id' }, { value: '=Fields.g' }, { value: '=Fields.amount', format: 'N2' }] }],
      footer: [{ height: 14, cells: [{ value: 'Total' }, { value: '' }, { value: '=Sum(Fields.amount)', format: 'N2' }] }] }] },
    pageFooter: { height: 20, items: [{ type: 'textbox', name: 'P', x: 0, y: 2, w: 300, h: 14, value: 'Page {Globals.PageNumber} of {Globals.TotalPages}' }] },
  },
};

/** the pattern most users write: a client from the pool, a cursor, release in finally */
const sqlRowsFor = (limit) => (_src, _p, ctx) => (async function* () {
  const c = await pool.connect(); stats.acquired++;
  try {
    await c.query('BEGIN READ ONLY');
    await c.query(`DECLARE cur NO SCROLL CURSOR FOR select id, g, amount from tx order by id limit ${limit}`);
    for (;;) {
      ctx?.signal?.throwIfAborted();
      const r = await c.query('FETCH 500 FROM cur');
      if (!r.rows.length) break;
      yield r.rows.map((x) => ({ ...x, amount: Number(x.amount) }));
    }
  } finally {
    try { await c.query('ROLLBACK'); } catch { /* broken */ }
    c.release(); stats.released++;
  }
})();

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') return res.end(JSON.stringify({ ...stats, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } }));
  if (u.pathname === '/small') {
    try { const c = await pool.connect(); stats.acquired++; try { await c.query('select 1'); } finally { c.release(); stats.released++; } res.end('ok'); }
    catch (e) { res.statusCode = 503; res.end(String(e.message)); }
    return;
  }
  if (u.pathname !== '/pdf') { res.statusCode = 404; return res.end(); }
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(new Error('client left')); });
  res.setHeader('content-type', 'application/pdf');
  try {
    await exportPdfStream(def, { fontStore, sqlRows: sqlRowsFor(Number(u.searchParams.get('rows') || 3000)), signal: ac.signal, timeoutMs: 30000 }, res);
    res.end(); stats.exports.ok++;
  } catch (e) {
    if (ac.signal.aborted) stats.exports.aborted++;
    else if (e?.code === 'ETIMEDOUT' || e?.status === 504) stats.exports.timedOut++;
    else { stats.exports.failed++; console.error('export failed:', e?.message); }
    res.destroy();
  }
}).listen(Number(process.env.PORT || 7788), () => console.log('listening', process.env.PORT || 7788, 'engine', ROOT));
