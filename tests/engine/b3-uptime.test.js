// Batch 3 item 7b: scripts/uptime-check.mjs against a stand-in server: up, down, and too many 5xx answers.
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { execFile } from 'node:child_process';
import path from 'node:path';

const script = path.join(import.meta.dirname, '../../scripts/uptime-check.mjs');
const check = (env) => new Promise((ok) => execFile(process.execPath, [script], { env: { ...process.env, ...env } }, (e, out) => ok({ code: e ? e.code : 0, out })));
const serve = (ready, ok2xx, bad5xx) => new Promise((ok) => {
  const s = http.createServer((req, res) => {
    if (req.url === '/api/v1/readyz') { res.statusCode = ready; return res.end('{}'); }
    if (req.url === '/api/v1/metrics') {
      if (req.headers.authorization !== 'Bearer k') { res.statusCode = 401; return res.end(); }
      const old = `pagewright_http_requests_total{method="GET",route="reports",status="2xx"} ${ok2xx}\npagewright_http_requests_total{method="POST",route="v1",status="5xx"} ${bad5xx}\n`; // as 0.13.2 answers: the new names, then the deprecated old ones (counted once)
      return res.end(old.replaceAll('pagewright_', 'reportwright_') + old);
    }
    res.statusCode = 404; res.end();
  }).listen(0, () => ok(s));
});

describe('uptime check', () => {
  it('passes when ready with few errors; fails when not ready or above the 5xx limit', async () => {
    for (const [ready, a, b, code, msg] of [[200, 100, 1, 0, /ok/], [503, 100, 0, 1, /readyz: 503/], [200, 90, 10, 1, /5xx answers: 10 of 100/]]) {
      const s = await serve(ready, a, b);
      const r = await check({ BASE: `http://127.0.0.1:${s.address().port}`, PW_MONITOR_KEY: 'k' });
      s.close();
      expect(r.code, r.out).toBe(code);
      expect(r.out).toMatch(msg);
    }
  }, 30000);
});
