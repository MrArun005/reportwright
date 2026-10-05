// Batch 5, item 4: a tamper-evident audit log. Hash chains per stream, signed checkpoints naming every stream head,
// verification (library and CLI) that finds changed, removed and inserted events; shipping to a SIEM (an HTTPS webhook
// with HMAC, syslog RFC 5424 over TLS) with retry; client exports name the server's own record.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { testCert } from '../fixtures/mock-idp.js';

const home = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-chain-'));
const saved = {};
const ENV = { PW_SESSION_SECRET: 'c'.repeat(40), PW_AUDIT_CHECKPOINTS: 'off' };
let A, siem;
const g = globalThis;
const dir = path.join(tmp, 'files');

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  fs.mkdirSync(dir, { recursive: true });
  process.chdir(dir);
  delete process.env.PW_STORAGE;
  A = await import('../../src/server/audit.js');
  siem = await import('../../src/server/siem.js');
  g.__pwAudit.chain = null;
});
afterAll(() => {
  process.chdir(home);
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const dayFile = () => path.join(dir, 'data', 'audit', `${new Date().toISOString().slice(0, 10)}.jsonl`);
const lines = () => fs.readFileSync(dayFile(), 'utf8').split('\n').filter(Boolean);
const edit = (fn) => { const before = fs.readFileSync(dayFile(), 'utf8'); fs.writeFileSync(dayFile(), fn(lines()).map(l => `${l}\n`).join('')); return () => fs.writeFileSync(dayFile(), before); };
const kinds = (r) => r.problems.map(p => p.kind).sort();

describe('the hash chain', () => {
  it('chains every event and checks clean', async () => {
    for (let i = 0; i < 5; i++) await A.audit('report.view', { actor: `user:u${i}@x.test`, report: 'r1' });
    const ev = lines().map(l => JSON.parse(l));
    expect(ev.map(e => e.chain.n)).toEqual([0, 1, 2, 3, 4]);
    expect(ev[0].chain.prev).toBe('0'.repeat(64));
    for (let i = 1; i < 5; i++) expect(ev[i].chain.prev).toBe(ev[i - 1].hash);
    expect(A.hashEntry(ev[2])).toBe(ev[2].hash);
    const r = await A.verifyAudit();
    expect(r).toMatchObject({ ok: true, events: 5, unchained: 0, streams: 1 });
  });
  it('finds a changed event, a removed one and one put in', async () => {
    let undo = edit(ls => ls.map((l, i) => (i === 2 ? l.replace('u2@x.test', 'u9@x.test') : l)));
    expect(kinds(await A.verifyAudit())).toEqual(['altered']);
    undo();
    undo = edit(ls => ls.filter((_, i) => i !== 2));
    expect(kinds(await A.verifyAudit())).toEqual(['missing']);
    undo();
    // an inserted event with a recomputed hash still breaks the next link (or claims a number twice)
    undo = edit(ls => { const e = JSON.parse(ls[2]); e.actor = 'user:mallory@x.test'; e.id = `${e.id}x`; e.hash = A.hashEntry(e); return [...ls.slice(0, 3), JSON.stringify(e), ...ls.slice(3)]; });
    expect(kinds(await A.verifyAudit())).toContain('duplicate');
    undo();
    // re-hashing a changed event breaks the link to it
    undo = edit(ls => ls.map((l, i) => { if (i !== 2) return l; const e = JSON.parse(l); e.actor = 'user:mallory@x.test'; e.hash = A.hashEntry(e); return JSON.stringify(e); }));
    expect(kinds(await A.verifyAudit())).toEqual(['broken']);
    undo();
    expect((await A.verifyAudit()).ok).toBe(true);
  });
  it('events from before the chain are counted, not judged; one put in later without a chain is refused', async () => {
    const old = (at) => JSON.stringify({ id: `${at}-000001-aaaaaa`, at, type: 'auth.login', actor: 'user:old@x.test', ip: '-', status: 'ok' });
    let undo = edit(ls => [old('2000-01-01T00:00:00.000Z'), ...ls]);
    expect(await A.verifyAudit()).toMatchObject({ ok: true, unchained: 1 });
    undo();
    undo = edit(ls => [...ls, old(new Date().toISOString())]);
    expect(kinds(await A.verifyAudit())).toEqual(['unchained']);
    undo();
  });
  it('a line that is not an event fails the check (it is not skipped)', async () => {
    const undo = edit(ls => [...ls.slice(0, 2), '{"id": broken', ...ls.slice(2)]);
    expect(kinds(await A.verifyAudit())).toEqual(['unreadable']);
    undo();
  });
});

describe('signed checkpoints', () => {
  let first;
  it('a checkpoint names the stream heads and is signed with Ed25519', async () => {
    first = g.__pwAudit.chain.s;
    const cp = await A.checkpoint();
    expect(cp.type).toBe('audit.checkpoint');
    expect(cp.detail.heads[first][0]).toBe(4);
    expect(crypto.verify(null, Buffer.from(cp.hash, 'hex'), A.publicKey(), Buffer.from(cp.sig, 'base64'))).toBe(true);
    expect(A.publicKeyInfo().fingerprint).toMatch(/^[0-9a-f]{16}$/);
    const r = await A.verifyAudit();
    expect(r).toMatchObject({ ok: true, checkpoints: 1 });
  });
  it('another key, or a changed signature, does not check', async () => {
    const undo = edit(ls => ls.map(l => { const e = JSON.parse(l); if (e.type !== 'audit.checkpoint') return l; e.sig = Buffer.alloc(64, 1).toString('base64'); return JSON.stringify(e); }));
    expect(kinds(await A.verifyAudit())).toEqual(['signature']);
    undo();
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    process.env.PW_AUDIT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });
    try { expect(kinds(await A.verifyAudit())).toEqual(['signature']); } finally { delete process.env.PW_AUDIT_PUBLIC_KEY; }
  });
  it('a whole stream removed, or a stream cut before its checkpointed head, shows', async () => {
    g.__pwAudit.chain = null; // another process: a second stream
    for (let i = 0; i < 3; i++) await A.audit('report.render', { actor: 'service', report: 'r2' });
    const second = g.__pwAudit.chain.s;
    const cp = await A.checkpoint(); // names both heads
    expect(Object.keys(cp.detail.heads).sort()).toEqual([first, second].sort());
    expect((await A.verifyAudit()).ok).toBe(true);
    let undo = edit(ls => ls.filter(l => JSON.parse(l).chain?.s !== first));
    let r = await A.verifyAudit();
    expect(r.ok).toBe(false);
    expect(r.problems.some(p => p.kind === 'missing' && p.stream === first)).toBe(true);
    undo();
    // the first stream cut after event 3: event 4 (the head the checkpoints name) and its own checkpoint (5) gone
    undo = edit(ls => ls.filter(l => { const e = JSON.parse(l); return !(e.chain?.s === first && e.chain.n >= 4); }));
    r = await A.verifyAudit();
    expect(r.problems.some(p => p.kind === 'missing' && /ends at 3/.test(p.detail))).toBe(true);
    undo();
    expect((await A.verifyAudit()).ok).toBe(true);
  });
  it('pw audit verify checks the same from the command line (exit 1 when it does not)', () => {
    const run = () => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(home, 'bin/pw.mjs'), 'audit', 'verify'], { cwd: dir, env: { ...process.env, PW_STORAGE: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
    let r = run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/The audit log checks/);
    const undo = edit(ls => ls.map((l, i) => (i === 1 ? l.replace('u1@x.test', 'u7@x.test') : l)));
    r = run();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/altered/);
    undo();
  });
});

describe('fail closed', () => {
  it('a stream rewritten from some event on, hashes and links recomputed, differs from the signed head', async () => {
    const undo = edit(ls => {
      const evs = ls.map(l => JSON.parse(l));
      const s0 = evs.find(e => e.chain?.n === 0).chain.s;
      let prev = null;
      return evs.map(e => {
        if (e.chain?.s !== s0) return JSON.stringify(e);
        if (e.chain.n >= 1) { if (e.actor) e.actor = e.actor.replace('u1@', 'u6@'); e.chain.prev = prev; e.hash = A.hashEntry(e); }
        prev = e.hash;
        return JSON.stringify(e);
      });
    });
    const r = await A.verifyAudit();
    expect(r.ok).toBe(false);
    expect(kinds(r)).toContain('altered'); // the checkpoint's head hash, and its own signature over the rewritten hash
    undo();
  });
  it('the end of the log cut off with its checkpoints, and events no checkpoint anchors, are found once the interval has passed', async () => {
    process.env.PW_AUDIT_CHECKPOINT_MINUTES = '0.002'; // 120 ms: the check allows two intervals and one more
    try {
      await A.checkpoint();
      await A.audit('report.view', { actor: 'user:late@x.test', report: 'r9' });
      await new Promise(r => setTimeout(r, 450));
      expect(kinds(await A.verifyAudit())).toEqual(['stale', 'unanchored']);
      await A.checkpoint();
      expect((await A.verifyAudit()).ok).toBe(true);
      await new Promise(r => setTimeout(r, 450));
      expect(kinds(await A.verifyAudit())).toEqual(['stale']); // no newer checkpoint: the end may be cut off
    } finally { delete process.env.PW_AUDIT_CHECKPOINT_MINUTES; }
  });
  it('no key configured: checkpoints are written unsigned, never with a known key, and verification fails', async () => {
    const keep = process.env.PW_SESSION_SECRET;
    delete process.env.PW_SESSION_SECRET;
    try {
      for (const env of ['production', 'development']) {
        const was = process.env.NODE_ENV; process.env.NODE_ENV = env;
        try {
          const cp = await A.checkpoint();
          expect(cp.sig).toBeUndefined();
          expect(A.keySource()).toBe('none');
          expect(A.publicKey()).toBe(null);
          const r = await A.verifyAudit();
          expect(r.ok).toBe(false);
          expect(kinds(r)).toContain('key');
        } finally { process.env.NODE_ENV = was; }
      }
      process.env.PW_AUDIT_KEY = 'short';
      expect(A.keySource()).toBe('none'); // a short key is not a key
    } finally { process.env.PW_SESSION_SECRET = keep; delete process.env.PW_AUDIT_KEY; }
    // those unsigned checkpoints now fail the check with the real key
    expect(kinds(await A.verifyAudit())).toContain('signature');
  });
});

describe('the chain on SQLite', () => {
  it('a changed row is found', async () => {
    process.env.PW_STORAGE = `sqlite:${path.join(tmp, 'chain.db')}`;
    try {
      g.__pwAudit.chain = null;
      for (let i = 0; i < 3; i++) await A.audit('report.view', { actor: `user:s${i}@x.test`, report: 'r' });
      expect((await A.verifyAudit()).ok).toBe(true);
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(path.join(tmp, 'chain.db'));
      const row = db.prepare("SELECT id, data FROM pw_audit WHERE actor = 'user:s1@x.test'").get();
      db.prepare('UPDATE pw_audit SET data = ? WHERE id = ?').run(row.data.replace('s1@x.test', 's8@x.test'), row.id);
      db.close();
      expect(kinds(await A.verifyAudit())).toEqual(['altered']);
    } finally { delete process.env.PW_STORAGE; }
  });
});

describe('shipping to a SIEM', () => {
  it('HTTPS webhook (here http, allowed for the test): batches, HMAC, and retry with backoff after a failure', async () => {
    const got = [];
    let fails = 1;
    const srv = http.createServer(async (req, res) => {
      let body = ''; for await (const c of req) body += c;
      if (fails-- > 0) { res.writeHead(503); return res.end(); }
      got.push({ sig: req.headers['x-pagewright-signature'], body });
      res.end('ok');
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    Object.assign(process.env, { PW_AUDIT_SIEM: `http://127.0.0.1:${srv.address().port}/hook`, PW_AUDIT_SIEM_ALLOW_HTTP: '1', PW_AUDIT_SIEM_SECRET: 'siem-secret' });
    try {
      siem.siemReset();
      await A.audit('auth.login', { actor: 'user:ship@x.test' });
      await new Promise(r => setTimeout(r, 1500)); // the first try fails; the retry comes after 1 s
      await siem.siemIdle();
      expect(got).toHaveLength(1);
      const [e] = JSON.parse(got[0].body);
      expect(e).toMatchObject({ type: 'auth.login', actor: 'user:ship@x.test' });
      expect(e.hash).toBe(A.hashEntry(e)); // the chained event, as stored
      expect(got[0].sig).toBe(`sha256=${crypto.createHmac('sha256', 'siem-secret').update(got[0].body).digest('hex')}`);
      expect(siem.siemStatus()).toMatchObject({ on: true, kind: 'webhook', sent: 1, queued: 0 });
    } finally { for (const k of ['PW_AUDIT_SIEM', 'PW_AUDIT_SIEM_ALLOW_HTTP', 'PW_AUDIT_SIEM_SECRET']) delete process.env[k]; srv.close(); }
  });
  it('plain http is refused unless allowed; syslog over TLS sends octet-counted RFC 5424 messages', async () => {
    process.env.PW_AUDIT_SIEM = 'http://siem.test/hook';
    expect(siem.siemTarget()).toBe(null);
    const c = testCert('localhost');
    const caFile = path.join(tmp, 'ca.pem'); fs.writeFileSync(caFile, c.cert);
    let data = '';
    const srv = tls.createServer({ key: c.key, cert: c.cert }, (s) => s.on('data', d => { data += d; }));
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    Object.assign(process.env, { PW_AUDIT_SIEM: `syslog+tls://localhost:${srv.address().port}`, PW_AUDIT_SIEM_CA: caFile });
    try {
      siem.siemReset();
      await A.audit('auth.login_failed', { actor: 'anon', status: 'failed', detail: { reason: 'x' } });
      await siem.siemIdle();
      for (let i = 0; i < 50 && !data; i++) await new Promise(r => setTimeout(r, 20));
      const m = /^(\d+) (<(\d+)>1 \S+ \S+ pagewright \d+ auth\.login_failed - (\{.*\}))$/s.exec(data);
      expect(m).toBeTruthy();
      expect(Number(m[1])).toBe(Buffer.byteLength(m[2]));
      expect(m[3]).toBe(String(16 * 8 + 4)); // local0.warning for a failure
      expect(JSON.parse(m[4]).type).toBe('auth.login_failed');
    } finally { siem.siemReset(); for (const k of ['PW_AUDIT_SIEM', 'PW_AUDIT_SIEM_CA']) delete process.env[k]; srv.close(); }
  });
  it('a certificate the system and PW_AUDIT_SIEM_CA do not trust is refused (nothing is sent)', async () => {
    const c = testCert('localhost');
    let data = '';
    const srv = tls.createServer({ key: c.key, cert: c.cert }, (s) => s.on('data', d => { data += d; }));
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    process.env.PW_AUDIT_SIEM = `syslog+tls://localhost:${srv.address().port}`;
    try {
      siem.siemReset();
      await A.audit('auth.login', { actor: 'user:x@x.test' });
      await new Promise(r => setTimeout(r, 300));
      expect(data).toBe('');
      expect(siem.siemStatus().lastError).toMatch(/certificate/i);
    } finally { siem.siemReset(); delete process.env.PW_AUDIT_SIEM; srv.close(); }
  });
});
