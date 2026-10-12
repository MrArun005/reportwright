// Batch 5, item 7: batch output in shared storage (files, a database, or S3-compatible object storage), so every
// server reads what any server wrote; signed, expiring download links for scheduled email.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { unzipSync } from 'fflate';

const cwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-blobs-'));
let B;
beforeAll(async () => { fs.symlinkSync(path.join(cwd, 'public'), path.join(dir, 'public')); process.chdir(dir); B = await import('../../src/server/blobs.js'); });
afterAll(() => { process.chdir(cwd); for (const k of ['PW_STORAGE', 'PW_BLOBS', 'PW_S3_ACCESS_KEY_ID', 'PW_S3_SECRET_ACCESS_KEY', 'PW_BASE_URL', 'PW_SESSION_SECRET']) delete process.env[k]; fs.rmSync(dir, { recursive: true, force: true }); });

const roundTrip = async () => {
  const big = crypto.randomBytes(2.5 * 1024 * 1024); // three parts in a database
  await B.blobs().put('jobs/b_1/output.zip', big);
  await B.blobs().put('jobs/b_1/items/0', Buffer.from('zero'));
  await B.blobs().put('snap/x', Buffer.from('s'));
  expect(Buffer.compare(await B.blobs().get('jobs/b_1/output.zip'), big)).toBe(0);
  await B.blobs().put('jobs/b_1/items/0', Buffer.from('replaced'));
  expect(String(await B.blobs().get('jobs/b_1/items/0'))).toBe('replaced');
  expect((await B.blobs().list('jobs/b_1/')).map(b => b.key).sort()).toEqual(['jobs/b_1/items/0', 'jobs/b_1/output.zip']);
  expect((await B.blobs().list('jobs/b_1/')).find(b => b.key.endsWith('zip')).size).toBe(big.length);
  await B.removePrefix('jobs/b_1/items/');
  expect(await B.blobs().get('jobs/b_1/items/0')).toBe(null);
  await B.blobs().remove('jobs/b_1/output.zip');
  expect(await B.blobs().get('jobs/b_1/output.zip')).toBe(null);
};

describe('blob stores', () => {
  it('keys are paths of safe segments only', () => {
    for (const k of ['../x', 'a/../b', '/abs', 'a//b', 'a/.hidden', 'a\\b', '']) expect(() => B.checkKey(k), k).toThrow(/Bad blob key/);
    expect(B.checkKey('jobs/b_x/items/12')).toBe('jobs/b_x/items/12');
  });
  it('files (data/blobs)', async () => { delete process.env.PW_STORAGE; await roundTrip(); expect(fs.existsSync(path.join(dir, 'data/blobs/snap/x'))).toBe(true); });
  it('a database (pw_blobs, 1 MB parts), shared by every server', async () => { process.env.PW_STORAGE = `sqlite:${path.join(dir, 'b.db')}`; try { await roundTrip(); } finally { delete process.env.PW_STORAGE; } });
  it('S3 signature V4 matches the AWS documentation example', () => {
    const h = B.signS3({ method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), headers: { range: 'bytes=0-9' }, region: 'us-east-1', accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', date: new Date('2013-05-24T00:00:00Z') });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  it('S3-compatible object storage (path style, as MinIO), every request signed', async () => {
    const objects = new Map();
    let unsigned = 0;
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://x');
      if (!/^AWS4-HMAC-SHA256 Credential=ak\//.test(req.headers.authorization || '')) { unsigned++; res.writeHead(403); return res.end(); }
      const chunks = []; for await (const c of req) chunks.push(c);
      const key = decodeURIComponent(u.pathname.replace(/^\/bkt\//, ''));
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); return res.end(); }
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      if (u.searchParams.get('list-type') === '2') {
        const p = u.searchParams.get('prefix') || '';
        res.writeHead(200, { 'content-type': 'application/xml' });
        return res.end(`<ListBucketResult>${[...objects].filter(([k]) => k.startsWith(p)).map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-10-05T00:00:00Z</LastModified></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
      }
      if (!objects.has(key)) { res.writeHead(404); return res.end(); }
      res.end(objects.get(key));
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    Object.assign(process.env, { PW_BLOBS: `s3://bkt/pw?region=eu-west-1&endpoint=http://127.0.0.1:${srv.address().port}`, PW_S3_ACCESS_KEY_ID: 'ak', PW_S3_SECRET_ACCESS_KEY: 'sk' });
    try {
      await roundTrip();
      expect(unsigned).toBe(0);
      expect([...objects.keys()]).toEqual(['pw/snap/x']);
    } finally { delete process.env.PW_BLOBS; srv.close(); }
  });
});

describe('batch output is shared', () => {
  const def = { $schema: 'reportwright/report@1', name: 'Q', page: { size: 'A4', margins: [36, 36, 36, 36] }, parameters: [{ name: 'n', type: 'string' }], dataSources: [], dataSets: [], sections: { body: { items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 200, h: 16, value: 'Item {Parameters.n}' }] } } };
  it('items and the zip live in the database: another server (another working folder) downloads it', async () => {
    process.env.PW_STORAGE = `sqlite:${path.join(dir, 'jobs.db')}`;
    process.env.PW_SESSION_SECRET = 'l'.repeat(40);
    process.env.PW_BASE_URL = 'https://pw.example';
    // renders on this thread: a render worker takes its cwd (the fonts folder) from when it boots, and this test changes
    // cwd below, so a worker booted after that would look for public/ in the other folder (a race, not the product)
    process.env.PW_RENDER_WORKERS = '0';
    try {
      const jobs = await import('../../src/server/jobs.js');
      const job = await jobs.createBatch({ template: def, items: [1, 2].map(n => ({ parameters: { n: String(n) } })), format: 'json' }, null);
      while (await jobs.workOnce('A'));
      expect(fs.existsSync(path.join(dir, 'data/jobs'))).toBe(false); // nothing on this server's disk
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-blobs-b-'));
      process.chdir(other);
      try {
        const f = await jobs.jobFile(job.id);
        expect(Object.keys(unzipSync(f.bytes)).sort()).toEqual(['1.json', '2.json']);
        expect(await (await import('../../src/server/blobs.js')).blobs().list(`jobs/${job.id}/items/`)).toEqual([]); // items cleaned up
        // a signed link opens this job's output only, until it expires
        const link = new URL(jobs.downloadLink(await jobs.getJob(job.id)));
        expect(link.origin).toBe('https://pw.example');
        const route = (await import('../../app/api/v1/batches/[id]/download/route.js')).GET;
        const get = (id, q) => route(new Request(`https://pw.example/api/v1/batches/${id}/download?${q}`), { params: Promise.resolve({ id }) });
        expect((await get(job.id, link.search.slice(1))).status).toBe(200);
        expect((await get(job.id, link.search.slice(1).replace(/sig=(.)/, (_, c) => `sig=${c === 'A' ? 'B' : 'A'}`))).status).toBe(403);
        expect((await get('b_other', link.search.slice(1))).status).toBe(403);
        expect((await get(job.id, `exp=${Math.floor(Date.now() / 1000) - 1}&sig=${link.searchParams.get('sig')}`)).status).toBe(403);
        expect(jobs.linkOk(job.id, link.searchParams.get('exp'), link.searchParams.get('sig'))).toBe(true);
        // a link to a saved report's batch stops when the report goes (the owner may no longer run it)
        const { writeReport, deleteReport } = await import('../../src/server/reports.js');
        await writeReport('linked', def);
        const j2 = await jobs.createBatch({ template: 'linked', items: [{ parameters: { n: '1' } }], format: 'json' }, null);
        while (await jobs.workOnce('A'));
        const l2 = new URL(jobs.downloadLink(await jobs.getJob(j2.id)));
        expect((await get(j2.id, l2.search.slice(1))).status).toBe(200);
        await deleteReport('linked');
        expect((await get(j2.id, l2.search.slice(1))).status).toBe(403);
      } finally { process.chdir(dir); fs.rmSync(other, { recursive: true, force: true }); }
    } finally { delete process.env.PW_STORAGE; delete process.env.PW_RENDER_WORKERS; }
  });
});
