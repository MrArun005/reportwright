// Automation API: render, push data, batches with webhook + zip + merged PDF, schedules, auth.
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';
const BASE = process.env.BASE || 'http://localhost:3000';
const SECRET = process.env.PW_WEBHOOK_SECRET || 'testsecret';
const step = (s) => console.log('·', s);
const KEY = process.env.PW_TEST_KEY || 'test-key';
const H = { authorization: `Bearer ${KEY}` };
const get = (p, h = H) => fetch(BASE + p, { headers: h });
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pdfText = (buf) => { fs.writeFileSync('/tmp/api.pdf', Buffer.from(buf)); return execFileSync('pdftotext', ['/tmp/api.pdf', '-'], { encoding: 'utf8' }); };

step('templates');
const tpl = await (await get('/api/v1/templates')).json();
assert.ok(tpl.some(t => t.id === 'loan-statement' && t.parameters.some(p => p.name === 'accountId')));

step('render: pull data');
let r = await post('/api/v1/render', { template: 'loan-statement', format: 'pdf', parameters: { accountId: 'LN-2025-001982' } });
assert.equal(r.status, 200);
assert.equal(r.headers.get('x-pagewright-pages'), '2');
assert.match(pdfText(await r.arrayBuffer()), /Arjun Mehta/);

step('render: push data');
const pushed = await (await fetch(`${BASE}/api/sample/loans/LN-2025-001982`)).json();
pushed.loan.name = 'Pushed Borrower';
r = await post('/api/v1/render', { template: 'loan-statement', parameters: { accountId: 'X-1' }, data: { loans: pushed } });
assert.match(pdfText(await r.arrayBuffer()), /Pushed Borrower/);

step('render: other formats and errors');
for (const [format, type] of [['xlsx', 'spreadsheetml'], ['html', 'text/html'], ['csv', 'text/csv'], ['json', 'application/json']]) {
  r = await post('/api/v1/render', { template: 'sales-by-region', format, parameters: { year: 2025 } });
  assert.equal(r.status, 200, format);
  assert.ok(r.headers.get('content-type').includes(type), format);
}
r = await post('/api/v1/render', { template: 'no-such' });
assert.equal(r.status, 404);
r = await post('/api/v1/render', { template: { $schema: 'pagewright/report@1', name: 'Inline', parameters: [{ name: 'p', required: true }], sections: { body: { items: [] } } } });
assert.equal(r.status, 400);
assert.deepEqual((await r.json()).missingParameters, ['p']);

step('auth: a key is required');
assert.equal((await get('/api/v1/templates', {})).status, 401);
assert.equal((await get('/api/v1/templates', { authorization: 'Bearer wrong' })).status, 401);

step('batch: zip + signed webhook');
let hook = null;
const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { hook = { body: b, sig: req.headers['x-pagewright-signature'] }; res.end('ok'); }); }).listen(4100);
r = await post('/api/v1/batches', { template: 'loan-statement', fileName: 'statement-{Parameters.accountId}', webhook: 'http://127.0.0.1:4100/hook',
  items: [{ parameters: { accountId: 'LN-2026-004417' } }, { parameters: { accountId: 'LN-2025-001982' } }, { parameters: { accountId: 'NOPE' } }] });
assert.equal(r.status, 202);
let job = await r.json();
for (let i = 0; i < 60 && !['completed', 'completed_with_errors', 'failed'].includes(job.status); i++) { await new Promise(s => setTimeout(s, 500)); job = await (await get(`/api/v1/batches/${job.id}`)).json(); }
assert.equal(job.status, 'completed_with_errors');
assert.equal(job.done, 2); assert.equal(job.failed, 1);
assert.match(job.errors[0], /NOPE/);
const zip = unzipSync(new Uint8Array(await (await get(`/api/v1/batches/${job.id}/download`)).arrayBuffer()));
assert.deepEqual(Object.keys(zip).sort(), ['statement-LN-2025-001982.pdf', 'statement-LN-2026-004417.pdf']);
for (let i = 0; i < 20 && !hook; i++) await new Promise(s => setTimeout(s, 250));
assert.ok(hook, 'webhook called');
assert.equal(hook.sig, 'sha256=' + crypto.createHmac('sha256', SECRET).update(hook.body).digest('hex'));
assert.equal(JSON.parse(hook.body).job.id, job.id);
srv.close();

step('batch: items from a URL, merged PDF');
r = await post('/api/v1/batches', { template: 'loan-statement', itemsFrom: { url: '/api/sample/loans', path: '$[*]', map: { accountId: '$.id' } }, output: { type: 'merged' } });
job = await r.json();
for (let i = 0; i < 60 && !['completed', 'completed_with_errors', 'failed'].includes(job.status); i++) { await new Promise(s => setTimeout(s, 500)); job = await (await get(`/api/v1/batches/${job.id}`)).json(); }
assert.equal(job.status, 'completed');
const merged = Buffer.from(await (await get(`/api/v1/batches/${job.id}/download`)).arrayBuffer());
fs.writeFileSync('/tmp/merged.pdf', merged);
assert.match(execFileSync('pdfinfo', ['/tmp/merged.pdf'], { encoding: 'utf8' }), /Pages:\s+10/);

step('schedule: next run in IST, run now, files to a folder');
r = await post('/api/v1/schedules', { name: 'Monthly statements', template: 'loan-statement', cron: '0 7 1 * *', timezone: 'Asia/Kolkata',
  itemsFrom: { url: '/api/sample/loans', path: '$[*]', map: { accountId: '$.id' } }, output: { type: 'folder', folder: 'monthly-test' }, fileName: '{Parameters.accountId}' });
assert.equal(r.status, 201);
const sch = await r.json();
assert.equal(new Date(sch.nextRunAt).toISOString().slice(11, 16), '01:30');
r = await post(`/api/v1/schedules/${sch.id}/run`, {});
job = await r.json();
for (let i = 0; i < 60 && !['completed', 'completed_with_errors', 'failed'].includes(job.status); i++) { await new Promise(s => setTimeout(s, 500)); job = await (await get(`/api/v1/batches/${job.id}`)).json(); }
assert.equal(job.status, 'completed');
assert.equal(job.folder, 'data/outputs/monthly-test');
assert.ok(fs.existsSync('data/outputs/monthly-test/LN-2026-004417.pdf'));
r = await post('/api/v1/schedules', { template: 'x', cron: 'nope' });
assert.equal(r.status, 400);
await fetch(`${BASE}/api/v1/schedules/${sch.id}`, { method: 'DELETE', headers: H });
console.log('PASS api');
