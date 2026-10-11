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
});
