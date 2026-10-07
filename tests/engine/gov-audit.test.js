// Batch 5, item 4: a tamper-evident audit log. Hash chains per stream, signed checkpoints naming every stream head,
// verification (library and CLI) that finds changed, removed and inserted events; shipping to a SIEM (an HTTPS webhook
// with HMAC, syslog RFC 5424 over TLS) with retry; client exports name the server's own record.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
/** The problems that mean a change; asserts the verdict that goes with them (tampered, or the given one when none). */
const tk = (r, otherwise) => { const k = kinds(r).filter(x => x !== 'unverified'); expect(r.status).toBe(k.length ? 'tampered' : otherwise); expect(r.ok).toBe(false); return k; };

describe('the hash chain', () => {
  it('chains every event and checks clean', async () => {
    for (let i = 0; i < 5; i++) await A.audit('report.view', { actor: `user:u${i}@x.test`, report: 'r1' });
    const ev = lines().map(l => JSON.parse(l));
    expect(ev.map(e => e.chain.n)).toEqual([0, 1, 2, 3, 4]);
    expect(ev[0].chain.prev).toBe('0'.repeat(64));
    for (let i = 1; i < 5; i++) expect(ev[i].chain.prev).toBe(ev[i - 1].hash);
    expect(A.hashEntry(ev[2])).toBe(ev[2].hash);
    const r = await A.verifyAudit();
    expect(r).toMatchObject({ status: 'unverified', ok: false, events: 5, unchained: 0, streams: 1, pending: 5 }); // consistent, but no signed checkpoint proves it yet
    expect(kinds(r)).toEqual(['unverified']);
  });
  it('finds a changed event, a removed one and one put in', async () => {
    let undo = edit(ls => ls.map((l, i) => (i === 2 ? l.replace('u2@x.test', 'u9@x.test') : l)));
    expect(tk(await A.verifyAudit())).toEqual(['altered']);
    undo();
    undo = edit(ls => ls.filter((_, i) => i !== 2));
    expect(tk(await A.verifyAudit())).toEqual(['missing']);
    undo();
    // an inserted event with a recomputed hash still breaks the next link (or claims a number twice)
    undo = edit(ls => { const e = JSON.parse(ls[2]); e.actor = 'user:mallory@x.test'; e.id = `${e.id}x`; e.hash = A.hashEntry(e); return [...ls.slice(0, 3), JSON.stringify(e), ...ls.slice(3)]; });
    expect(tk(await A.verifyAudit())).toContain('duplicate');
    undo();
    // re-hashing a changed event breaks the link to it
    undo = edit(ls => ls.map((l, i) => { if (i !== 2) return l; const e = JSON.parse(l); e.actor = 'user:mallory@x.test'; e.hash = A.hashEntry(e); return JSON.stringify(e); }));
    expect(tk(await A.verifyAudit())).toEqual(['broken']);
    undo();
    expect(tk(await A.verifyAudit(), 'unverified')).toEqual([]);
  });
  it('events from before the chain are counted, not judged; one put in later without a chain is refused', async () => {
    const old = (at) => JSON.stringify({ id: `${at}-000001-aaaaaa`, at, type: 'auth.login', actor: 'user:old@x.test', ip: '-', status: 'ok' });
    let undo = edit(ls => [old('2000-01-01T00:00:00.000Z'), ...ls]);
    const r1 = await A.verifyAudit(); expect(r1.unchained).toBe(1); expect(tk(r1, 'unverified')).toEqual([]);
    undo();
    undo = edit(ls => [...ls, old(new Date().toISOString())]);
    expect(tk(await A.verifyAudit())).toEqual(['unchained']);
    undo();
  });
  it('a line that is not an event fails the check (it is not skipped)', async () => {
    const undo = edit(ls => [...ls.slice(0, 2), '{"id": broken', ...ls.slice(2)]);
    expect(tk(await A.verifyAudit())).toEqual(['unreadable']);
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
    expect(r).toMatchObject({ status: 'ok', ok: true, checkpoints: 1, pending: 0 });
  });
  it('another key, or a changed signature, does not check', async () => {
    const undo = edit(ls => ls.map(l => { const e = JSON.parse(l); if (e.type !== 'audit.checkpoint') return l; e.sig = Buffer.alloc(64, 1).toString('base64'); return JSON.stringify(e); }));
    expect(tk(await A.verifyAudit())).toEqual(['signature']);
    undo();
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    process.env.PW_AUDIT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });
    try { expect(tk(await A.verifyAudit())).toEqual(['signature']); } finally { delete process.env.PW_AUDIT_PUBLIC_KEY; }
  });
  it('a whole stream removed, or a stream cut before its checkpointed head, shows', async () => {
    g.__pwAudit.chain = null; // another process: a second stream
    for (let i = 0; i < 3; i++) await A.audit('report.render', { actor: 'service', report: 'r2' });
    const second = g.__pwAudit.chain.s;
    const cp = await A.checkpoint(); // names both heads
    expect(Object.keys(cp.detail.heads).sort()).toEqual([first, second].sort());
    expect((await A.verifyAudit()).status).toBe('ok');
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
    expect((await A.verifyAudit()).status).toBe('ok');
  });
  it('pw audit verify checks the same from the command line (exit 1 when it does not)', () => {
    const run = () => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(home, 'bin/pw.mjs'), 'audit', 'verify'], { cwd: dir, env: { ...process.env, PW_STORAGE: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
    let r = run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^OK: every checkpointed event is proven/m);
    const undo = edit(ls => ls.map((l, i) => (i === 1 ? l.replace('u1@x.test', 'u7@x.test') : l)));
    r = run();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/altered[\s\S]*TAMPERED/);
    undo();
  });
});

describe('fail closed', () => {
  it('an empty log or window is unverified; an error is "error"; never ok', async () => {
    const r = await A.verifyAudit({ from: '2001-01-01', to: '2001-01-02' });
    expect(r.status).toBe('unverified');
    process.env.PW_STORAGE = 'bogus:';
    try { const e = await A.verifyAudit(); expect(e.status).toBe('error'); expect(e.ok).toBe(false); } finally { delete process.env.PW_STORAGE; }
  });
  it('time going backwards inside a stream is tampering, with where', async () => {
    const undo = edit(ls => ls.map((l, i) => { if (i !== 3) return l; const e = JSON.parse(l); e.at = '2001-01-01T00:00:00.000Z'; e.hash = A.hashEntry(e); return JSON.stringify(e); }));
    const r = await A.verifyAudit();
    expect(r.status).toBe('tampered');
    expect(r.problems.find(p => p.kind === 'backwards')?.id).toBeTruthy();
    undo();
  });
  it('events after the newest checkpoint are reported as not yet checkpointed', async () => {
    await A.checkpoint();
    await A.audit('report.view', { actor: 'user:new@x.test', report: 'r' });
    const r = await A.verifyAudit();
    expect(r.status).toBe('ok');
    expect(r.pending).toBe(1);
  });
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
      const st = await A.verifyAudit(); expect(st.status).toBe('unverified'); expect(st.problems.map(p => p.detail).join(' ')).toMatch(/older than the checkpoint interval[\s\S]*no signed checkpoint|no signed checkpoint[\s\S]*older than the checkpoint interval/);
      await A.checkpoint();
      expect((await A.verifyAudit()).status).toBe('ok');
      await new Promise(r => setTimeout(r, 450));
      const st2 = await A.verifyAudit(); expect(st2.status).toBe('unverified'); expect(kinds(st2)).toEqual(['unverified']); // no newer checkpoint: the end may be cut off
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
          expect(r.status).toBe('unverified');
        } finally { process.env.NODE_ENV = was; }
      }
      process.env.PW_AUDIT_KEY = 'short';
      expect(A.keySource()).toBe('none'); // a short key is not a key
    } finally { process.env.PW_SESSION_SECRET = keep; delete process.env.PW_AUDIT_KEY; }
    // with the real key back, those unsigned checkpoints leave the log unverified
    expect(tk(await A.verifyAudit(), 'unverified')).toEqual([]); // unsigned checkpoints prove nothing: never ok
  });
});

describe('the head moves only after a durable write', () => {
  it('failed writes are retried, then dropped without a number: the stream stays whole', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const st = store();
    const orig = st.appendAudit;
    let fails = 5; // the first event fails all 3 tries (dropped), the second fails twice then lands
    st.appendAudit = async (e) => { if (fails-- > 0) throw new Error('disk full'); return orig(e); };
    const before = g.__pwAudit.chain.n;
    try {
      const a = A.audit('report.view', { actor: 'user:lost@x.test', report: 'r' });
      const b = A.audit('report.view', { actor: 'user:kept@x.test', report: 'r' });
      await Promise.all([a, b]);
    } finally { st.appendAudit = orig; }
    expect(g.__pwAudit.chain.n).toBe(before + 1);
    const ev = lines().map(l => JSON.parse(l));
    expect(ev.some(e => e.actor === 'user:lost@x.test')).toBe(false);
    const kept = ev.find(e => e.actor === 'user:kept@x.test');
    expect(kept.chain.n).toBe(before);
    expect(tk(await A.verifyAudit(), 'unverified').filter(k => k !== 'unverified')).toEqual([]);
  });
  it('the API and the one pass test: only status "ok" passes', async () => {
    expect(A.auditProven({ status: 'ok' })).toBe(true);
    for (const r of [{ status: 'unverified', ok: true }, { status: 'tampered' }, { status: 'error' }, {}, null, { ok: true }]) expect(A.auditProven(r)).toBe(false);
    process.env.PW_AUTH = 'users';
    try {
      const users = await import('../../src/server/users.js');
      const session = await import('../../src/server/session.js');
      await users.createUser({ email: 'adm@x.test', role: 'admin', password: 'admin pass 123' });
      const cookie = session.sessionCookie(new Request('http://pw.test'), await users.getUser('adm@x.test')).split(';')[0];
      const route = (await import('../../app/api/audit/verify/route.js')).GET;
      const r = await (await route(new Request('http://pw.test/api/audit/verify', { headers: { cookie } }))).json();
      expect(['ok', 'unverified', 'tampered', 'error']).toContain(r.status);
      expect(r.ok).toBe(r.status === 'ok');
      expect((await route(new Request('http://pw.test/api/audit/verify?from=bad', { headers: { cookie } }))).status).toBe(400);
    } finally { delete process.env.PW_AUTH; }
  });
});

describe('nothing is lost quietly', () => {
  it('a security event that cannot be written fails the request; a low-value one does not', async () => {
    const { store } = await import('../../src/server/storage/index.js');
    const st = store();
    const orig = st.appendAudit;
    st.appendAudit = async () => { throw new Error('disk full'); };
    try {
      await expect(A.audit('auth.login', { actor: 'user:x@x.test' })).rejects.toMatchObject({ status: 503 });
      await expect(A.audit('user.update', { actor: 'user:x@x.test' })).rejects.toMatchObject({ status: 503 });
      await expect(A.audit('report.view', { actor: 'user:x@x.test' })).resolves.toBeUndefined();
    } finally { st.appendAudit = orig; }
    expect(A.isSecurityEvent('report.export')).toBe(true);
    expect(A.isSecurityEvent('api.call')).toBe(false);
  });
  it('a re-key hands the old key over (signed by both), so what it signed still checks; another key does not', async () => {
    await A.checkpoint(); // signed with the PW_SESSION_SECRET key
    const oldSecret = process.env.PW_SESSION_SECRET;
    process.env.PW_AUDIT_KEY = 'n'.repeat(40); // the new key
    try {
      expect(tk(await A.verifyAudit())).toContain('signature');
      const e = await A.rekey(A.keyFromSecret(oldSecret));
      expect(typeof e.oldSig).toBe('string');
      await A.checkpoint();
      let r = await A.verifyAudit();
      expect(kinds(r).filter(k => k !== 'unverified')).toEqual([]);
      // a re-key record that a stranger signed hands nothing over
      const undo = edit(ls => ls.map(l => { const x = JSON.parse(l); if (x.type !== 'audit.rekey') return l; x.oldSig = Buffer.alloc(64, 2).toString('base64'); return JSON.stringify(x); }));
      r = await A.verifyAudit();
      expect(r.status).toBe('tampered');
      undo();
      await expect(A.rekey(A.keyFromSecret('n'.repeat(40)))).rejects.toThrow(/configured now/);
    } finally { delete process.env.PW_AUDIT_KEY; }
  });
});

describe('retention leaves a signed record', () => {
  it('pruning writes audit.prune first; a stream may then start late only where the record says', async () => {
    const d2 = path.join(tmp, 'retention');
    fs.mkdirSync(d2, { recursive: true });
    process.chdir(d2);
    g.__pwAudit.chain = null;
    try {
      for (let i = 0; i < 3; i++) await A.audit('report.view', { actor: `user:r${i}@x.test` });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 400 * 86400000)); // a year and more later
      const removed = await A.prune();
      expect(removed).toBeGreaterThan(0);
      for (let i = 0; i < 2; i++) await A.audit('report.view', { actor: `user:n${i}@x.test` });
      vi.useRealTimers();
      const all = () => fs.readdirSync(path.join(d2, 'data/audit')).flatMap(f => fs.readFileSync(path.join(d2, 'data/audit', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
      const pr = all().find(e => e.type === 'audit.prune');
      expect(Object.values(pr.detail.last)[0][0]).toBe(2);
      expect(all().some(e => e.actor === 'user:r0@x.test')).toBe(false);
      expect(tk(await A.verifyAudit(), 'unverified')).toEqual([]); // starts at 3, as the signed record says
      // without the prune record, the missing start is tampering
      const files = fs.readdirSync(path.join(d2, 'data/audit')).map(f => path.join(d2, 'data/audit', f));
      const keep = files.map(f => fs.readFileSync(f, 'utf8'));
      for (const f of files) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.includes('"audit.prune"')).join('\n'));
      expect(tk(await A.verifyAudit())).toContain('missing');
      files.forEach((f, i) => fs.writeFileSync(f, keep[i]));
    } finally { vi.useRealTimers(); process.chdir(dir); }
  });
});

describe('the chain on SQLite', () => {
  it('a changed row is found', async () => {
    process.env.PW_STORAGE = `sqlite:${path.join(tmp, 'chain.db')}`;
    try {
      g.__pwAudit.chain = null;
      for (let i = 0; i < 3; i++) await A.audit('report.view', { actor: `user:s${i}@x.test`, report: 'r' });
      expect(tk(await A.verifyAudit(), 'unverified')).toEqual([]);
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(path.join(tmp, 'chain.db'));
      const row = db.prepare("SELECT id, data FROM pw_audit WHERE actor = 'user:s1@x.test'").get();
      db.prepare('UPDATE pw_audit SET data = ? WHERE id = ?').run(row.data.replace('s1@x.test', 's8@x.test'), row.id);
      db.close();
      expect(tk(await A.verifyAudit())).toEqual(['altered']);
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
      const m = /^(\d+) (<(\d+)>1 \S+ \S+ reportwright \d+ auth\.login_failed - (\{.*\}))$/s.exec(data);
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
