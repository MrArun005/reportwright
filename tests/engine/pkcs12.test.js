// src/server/pkcs12.js: the .p12 reader that replaced node-forge in production (sign.js).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPkcs12, rc2Cbc } from '../../src/server/pkcs12.js';

const OPENSSL = spawnSync('openssl', ['version']).status === 0;

describe('pkcs12', () => {
  it('RC2: the RFC 2268 test vectors', () => {
    const t = (k, bits, ct) => rc2Cbc(Buffer.from(k, 'hex'), bits, Buffer.alloc(8), Buffer.from(ct, 'hex')).toString('hex');
    expect(t('0000000000000000', 63, 'ebb773f993278eff')).toBe('0000000000000000');
    expect(t('ffffffffffffffff', 64, '278b27e42e2f0d49')).toBe('ffffffffffffffff');
    expect(t('88', 64, '61a8a244adacccf0')).toBe('0000000000000000');
    expect(t('88bca90e90875a7f0f79c384627bafb2', 128, '2269552ab0f85ca6')).toBe('0000000000000000');
  });
  it.skipIf(!OPENSSL)('openssl .p12 files (default AES/PBES2, -legacy): key and certificate, wrong password refused', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p12-'));
    try {
      const run = (...a) => { const r = spawnSync('openssl', a, { cwd: d }); if (r.status) throw new Error(r.stderr.toString()); };
      run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '30', '-subj', '/CN=t');
      run('pkcs12', '-export', '-inkey', 'k.pem', '-in', 'c.pem', '-out', 'a.p12', '-passout', 'pass:pw');
      const files = ['a.p12'];
      if (spawnSync('openssl', ['pkcs12', '-export', '-legacy', '-inkey', 'k.pem', '-in', 'c.pem', '-out', 'l.p12', '-passout', 'pass:pw'], { cwd: d }).status === 0) files.push('l.p12');
      for (const f of files) {
        const b = fs.readFileSync(path.join(d, f));
        const { keys, certs } = readPkcs12(b, 'pw');
        expect(keys).toHaveLength(1);
        expect(new crypto.X509Certificate(certs[0]).checkPrivateKey(keys[0])).toBe(true);
        expect(() => readPkcs12(b, 'nope')).toThrow();
      }
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  it.skipIf(!OPENSSL)('hostile files throw (or open) quickly: mutations, truncations, length and nesting bombs, huge iteration counts, no MAC', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p12f-'));
    try {
      const run = (...a) => { const r = spawnSync('openssl', a, { cwd: d }); if (r.status) throw new Error(r.stderr.toString()); };
      run('req', '-x509', '-newkey', 'rsa:1024', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '30', '-subj', '/CN=t');
      run('pkcs12', '-export', '-inkey', 'k.pem', '-in', 'c.pem', '-out', 'a.p12', '-passout', 'pass:pw');
      const good = fs.readFileSync(path.join(d, 'a.p12'));
      const ok = (b) => { const t = Date.now(); try { readPkcs12(b, 'pw'); } catch (e) { expect(e).toBeInstanceOf(Error); } expect(Date.now() - t).toBeLessThan(2000); };
      let seed = 1; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
      for (let i = 0; i < 300; i++) { const b = Buffer.from(good); for (let k = 0, n = 1 + rnd(4); k < n; k++) b[rnd(b.length)] = rnd(256); ok(b); }
      for (let i = 0; i < good.length; i += 7) ok(good.subarray(0, i));
      for (let i = 0; i < 200; i++) { const b = Buffer.from(good), at = rnd(b.length - 6); b[at + 1] = 0x84; b.fill(0xff, at + 2, at + 6); ok(b); } // 4 GB lengths
      ok(Buffer.concat([Buffer.alloc(20000, Buffer.from([0x30, 0x80])), Buffer.alloc(20000, 0)])); // nested indefinite lengths
      ok(Buffer.from([0x30])); ok(Buffer.alloc(0)); ok(Buffer.from([0x04, 0x80, 0, 0]));
      // an encryption iteration count over the cap is refused, not run
      run('pkcs12', '-export', '-iter', '1500000', '-inkey', 'k.pem', '-in', 'c.pem', '-out', 'i.p12', '-passout', 'pass:pw');
      expect(() => readPkcs12(fs.readFileSync(path.join(d, 'i.p12')), 'pw')).toThrow(/iteration count/);
      run('pkcs12', '-export', '-nomac', '-inkey', 'k.pem', '-in', 'c.pem', '-out', 'n.p12', '-passout', 'pass:pw');
      expect(() => readPkcs12(fs.readFileSync(path.join(d, 'n.p12')), 'pw')).toThrow(/no MAC/);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }, 120000);
});
