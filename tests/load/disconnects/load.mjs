// 8 users download ledgers for DURATION_S; 10% close the tab mid-download, 5% stop reading (socket open). Then: health,
// stuck Postgres backends, and a probe request. Pass: acquired === released, 0 stuck, probe ok.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
const PORT = Number(process.env.PORT || 7788), USERS = Number(process.env.USERS || 8), DURATION = Number(process.env.DURATION_S || 120) * 1000;
const out = { normal: { ok: 0, failed: 0 }, disconnect: 0, stall: 0, small: { ok: 0, failed: 0 } };
const get = (path, onRes) => new Promise((resolve) => {
  const req = http.get({ port: PORT, path, agent: false }, (res) => onRes(res, req, resolve));
  req.on('error', () => resolve('error'));
});
const normal = () => get('/pdf?rows=3000', (res, _req, done) => { let n = 0; res.on('data', (c) => { n += c.length; }); res.on('end', () => done(res.statusCode === 200 && n > 1000 ? 'ok' : 'bad')); res.on('error', () => done('bad')); res.on('aborted', () => done('bad')); });
const disconnect = () => get('/pdf?rows=20000', (res, req, done) => { res.once('data', () => { req.destroy(); done('left'); }); res.on('error', () => done('left')); });
// stops reading: pause and hold the socket 45 s (the export's timeoutMs is 30 s), then leave
const stall = () => get('/pdf?rows=300000', (res, req, done) => { res.once('data', () => { res.pause(); setTimeout(() => { req.destroy(); done('stalled'); }, 45000); }); });
const small = () => get('/small', (res, _r, done) => { res.resume(); res.on('end', () => done(res.statusCode === 200 ? 'ok' : 'bad')); });

const end = Date.now() + DURATION;
const user = async () => {
  while (Date.now() < end) {
    const r = Math.random();
    if (r < 0.10) { await disconnect(); out.disconnect++; }
    else if (r < 0.15) { await stall(); out.stall++; }
    else { (await normal()) === 'ok' ? out.normal.ok++ : out.normal.failed++; }
    (await small()) === 'ok' ? out.small.ok++ : out.small.failed++;
  }
};
const t0 = Date.now();
await Promise.all(Array.from({ length: USERS }, user));
console.log('load done in', Math.round((Date.now() - t0) / 1000), 's:', JSON.stringify(out));
await new Promise((r) => setTimeout(r, 35000)); // past timeoutMs: anything still held is a leak
const health = JSON.parse(await new Promise((r) => http.get({ port: PORT, path: '/health' }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => r(s)); })));
const stuck = execFileSync('psql', ['-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-d', 'pwload', '-tAc',
  "select count(*) from pg_stat_activity where datname='pwload' and pid<>pg_backend_pid() and state in ('active','idle in transaction')"]).toString().trim();
const t1 = Date.now(); const probe = await normal();
console.log(JSON.stringify({ healthAfter: health, stuckBackends: Number(stuck), probe, probeMs: Date.now() - t1 }, null, 1));
const pass = health.acquired === health.released && Number(stuck) === 0 && probe === 'ok';
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
