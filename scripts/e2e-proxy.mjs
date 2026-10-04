// A stand-in for the signing-in reverse proxy in front of a PW_AUTH=proxy server, for the e2e tests (scripts/restart.sh):
// listens on PORT and passes every request to the app on INNER with x-pagewright-proxy-secret: PW_PROXY_SECRET.
// The Host header goes through as sent, so the app's Origin check sees the address the browser used.
//   PORT=3000 INNER=3001 PW_PROXY_SECRET=… node scripts/e2e-proxy.mjs
import http from 'node:http';

const { PORT = '3000', INNER = '3001', PW_PROXY_SECRET: secret } = process.env;
if (!secret) { console.error('Set PW_PROXY_SECRET'); process.exit(1); }
http.createServer((req, res) => {
  const up = http.request({ host: '127.0.0.1', port: Number(INNER), method: req.method, path: req.url, headers: { ...req.headers, 'x-pagewright-proxy-secret': secret } }, (r) => {
    res.writeHead(r.statusCode || 502, r.rawHeaders);
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e.message)); });
  req.pipe(up);
}).listen(Number(PORT), () => console.log(`e2e proxy :${PORT} → :${INNER}`));
