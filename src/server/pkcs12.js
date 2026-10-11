// @ts-check
// A PKCS#12 (.p12 / .pfx) reader on node:crypto, for the signing certificate (src/server/sign.js). It replaces
// node-forge, whose advisories have no fixed version. Reads DER and BER (indefinite lengths, chunked octet strings, as
// Windows writes them); checks the MAC; decrypts PBES2 (PBKDF2 + AES or 3DES) and the PKCS#12 PBEs (3DES, RC2, the
// RC2-40 OpenSSL 1.x used for certificates). Gives the private keys and the certificates (DER).
import crypto from 'node:crypto';

/** @typedef {{ tag: number, at: number, start: number, end: number, next: number, buf: Buffer }} Node */

/** One BER element at off. @param {Buffer} buf @param {number} off @returns {Node} */
function read(buf, off) {
  const tag = buf[off];
  if (tag === undefined || (tag & 0x1f) === 0x1f) throw new Error('bad tag');
  let len = buf[off + 1], p = off + 2;
  if (len === 0x80) { // indefinite: children up to 00 00
    let q = p;
    while (!(buf[q] === 0 && buf[q + 1] === 0)) { if (q >= buf.length) throw new Error('truncated'); q = read(buf, q).next; }
    return { tag, at: off, start: p, end: q, next: q + 2, buf };
  }
  if (len > 0x80) { const n = len & 0x7f; if (n > 4) throw new Error('too long'); len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[p++]; }
  if (p + len > buf.length) throw new Error('truncated');
  return { tag, at: off, start: p, end: p + len, next: p + len, buf };
}
/** @param {Node} n */
const kids = (n) => { const out = []; for (let p = n.start; p < n.end;) { const k = read(n.buf, p); out.push(k); p = k.next; } return out; };
/** The bytes of an OCTET STRING, primitive or constructed (BER chunks). @param {Node} n @returns {Buffer} */
const octets = (n) => (n.tag & 0x20 ? Buffer.concat(kids(n).map(octets)) : n.buf.subarray(n.start, n.end));
/** @param {Node} n */
const oid = (n) => {
  const b = n.buf.subarray(n.start, n.end), out = [Math.floor(b[0] / 40), b[0] % 40];
  for (let i = 1, v = 0; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { out.push(v); v = 0; } }
  return out.join('.');
};
/** @param {Node} n */
const int = (n) => { let v = 0; for (let i = n.start; i < n.end; i++) v = v * 256 + n.buf[i]; return v; };
/** @param {Buffer} b */
const root = (b) => read(b, 0);

const HASH = { '1.3.14.3.2.26': 'sha1', '2.16.840.1.101.3.4.2.1': 'sha256', '2.16.840.1.101.3.4.2.2': 'sha384', '2.16.840.1.101.3.4.2.3': 'sha512', '2.16.840.1.101.3.4.2.4': 'sha224' };
const HMAC = { '1.2.840.113549.2.7': 'sha1', '1.2.840.113549.2.8': 'sha224', '1.2.840.113549.2.9': 'sha256', '1.2.840.113549.2.10': 'sha384', '1.2.840.113549.2.11': 'sha512' };
const CBC = { '2.16.840.1.101.3.4.1.2': ['aes-128-cbc', 16], '2.16.840.1.101.3.4.1.22': ['aes-192-cbc', 24], '2.16.840.1.101.3.4.1.42': ['aes-256-cbc', 32], '1.2.840.113549.3.7': ['des-ede3-cbc', 24] };
// pbeWithSHAAnd…: [cipher, key bytes, RC2 effective bits]
const P12PBE = { '1.2.840.113549.1.12.1.3': ['3des', 24], '1.2.840.113549.1.12.1.4': ['3des', 16], '1.2.840.113549.1.12.1.5': ['rc2', 16, 128], '1.2.840.113549.1.12.1.6': ['rc2', 5, 40] };

/** The PKCS#12 password: BMPString, big-endian, with its 00 00. @param {string} pw */
const bmp = (pw) => { const b = Buffer.from(pw + '\0', 'utf16le'); return b.swap16(); };

/** RFC 7292 B.2. @param {string} hash @param {Buffer} pw BMP @param {Buffer} salt @param {number} iter @param {number} id @param {number} n */
function p12kdf(hash, pw, salt, iter, id, n) {
  const u = crypto.createHash(hash).digest().length, v = hash === 'sha384' || hash === 'sha512' ? 128 : 64;
  const fill = (/** @type {Buffer} */ s) => { const len = v * Math.ceil(s.length / v); const o = Buffer.alloc(len); for (let i = 0; i < len; i++) o[i] = s[i % s.length]; return o; };
  const D = Buffer.alloc(v, id), I = Buffer.concat([salt.length ? fill(salt) : Buffer.alloc(0), pw.length ? fill(pw) : Buffer.alloc(0)]);
  const out = [];
  for (let got = 0; got < n; got += u) {
    let A = crypto.createHash(hash).update(D).update(I).digest();
    for (let i = 1; i < iter; i++) A = crypto.createHash(hash).update(A).digest();
    out.push(A);
    const B = fill(A);
    for (let j = 0; j < I.length; j += v) { // I_j = (I_j + B + 1) mod 2^v
      let c = 1;
      for (let k = v - 1; k >= 0; k--) { c += I[j + k] + B[k]; I[j + k] = c & 0xff; c >>= 8; }
    }
  }
  return Buffer.concat(out).subarray(0, n);
}

// RC2 (RFC 2268), decryption only: node:crypto has no RC2 (OpenSSL 3 moved it to the legacy provider)
/** @param {Buffer} key @param {number} bits */
function rc2Keys(key, bits) {
  const L = Buffer.alloc(128); key.copy(L);
  const T = key.length, T8 = (bits + 7) >> 3, TM = 255 % (1 << (8 + bits - 8 * T8));
  for (let i = T; i < 128; i++) L[i] = PI[(L[i - 1] + L[i - T]) & 0xff];
  L[128 - T8] = PI[L[128 - T8] & TM];
  for (let i = 127 - T8; i >= 0; i--) L[i] = PI[L[i + 1] ^ L[i + T8]];
  const K = new Uint16Array(64); for (let i = 0; i < 64; i++) K[i] = L[2 * i] | (L[2 * i + 1] << 8);
  return K;
}
const PI = Buffer.from([ // RFC 2268's PITABLE
    0xd9, 0x78, 0xf9, 0xc4, 0x19, 0xdd, 0xb5, 0xed, 0x28, 0xe9, 0xfd, 0x79, 0x4a, 0xa0, 0xd8, 0x9d, 0xc6, 0x7e, 0x37, 0x83, 0x2b, 0x76, 0x53, 0x8e, 0x62, 0x4c, 0x64, 0x88, 0x44, 0x8b, 0xfb, 0xa2,
    0x17, 0x9a, 0x59, 0xf5, 0x87, 0xb3, 0x4f, 0x13, 0x61, 0x45, 0x6d, 0x8d, 0x09, 0x81, 0x7d, 0x32, 0xbd, 0x8f, 0x40, 0xeb, 0x86, 0xb7, 0x7b, 0x0b, 0xf0, 0x95, 0x21, 0x22, 0x5c, 0x6b, 0x4e, 0x82,
    0x54, 0xd6, 0x65, 0x93, 0xce, 0x60, 0xb2, 0x1c, 0x73, 0x56, 0xc0, 0x14, 0xa7, 0x8c, 0xf1, 0xdc, 0x12, 0x75, 0xca, 0x1f, 0x3b, 0xbe, 0xe4, 0xd1, 0x42, 0x3d, 0xd4, 0x30, 0xa3, 0x3c, 0xb6, 0x26,
    0x6f, 0xbf, 0x0e, 0xda, 0x46, 0x69, 0x07, 0x57, 0x27, 0xf2, 0x1d, 0x9b, 0xbc, 0x94, 0x43, 0x03, 0xf8, 0x11, 0xc7, 0xf6, 0x90, 0xef, 0x3e, 0xe7, 0x06, 0xc3, 0xd5, 0x2f, 0xc8, 0x66, 0x1e, 0xd7,
    0x08, 0xe8, 0xea, 0xde, 0x80, 0x52, 0xee, 0xf7, 0x84, 0xaa, 0x72, 0xac, 0x35, 0x4d, 0x6a, 0x2a, 0x96, 0x1a, 0xd2, 0x71, 0x5a, 0x15, 0x49, 0x74, 0x4b, 0x9f, 0xd0, 0x5e, 0x04, 0x18, 0xa4, 0xec,
    0xc2, 0xe0, 0x41, 0x6e, 0x0f, 0x51, 0xcb, 0xcc, 0x24, 0x91, 0xaf, 0x50, 0xa1, 0xf4, 0x70, 0x39, 0x99, 0x7c, 0x3a, 0x85, 0x23, 0xb8, 0xb4, 0x7a, 0xfc, 0x02, 0x36, 0x5b, 0x25, 0x55, 0x97, 0x31,
    0x2d, 0x5d, 0xfa, 0x98, 0xe3, 0x8a, 0x92, 0xae, 0x05, 0xdf, 0x29, 0x10, 0x67, 0x6c, 0xba, 0xc9, 0xd3, 0x00, 0xe6, 0xcf, 0xe1, 0x9e, 0xa8, 0x2c, 0x63, 0x16, 0x01, 0x3f, 0x58, 0xe2, 0x89, 0xa9,
    0x0d, 0x38, 0x34, 0x1b, 0xab, 0x33, 0xff, 0xb0, 0xbb, 0x48, 0x0c, 0x5f, 0xb9, 0xb1, 0xcd, 0x2e, 0xc5, 0xf3, 0xdb, 0x47, 0xe5, 0xa5, 0x9c, 0x77, 0x0a, 0xa6, 0x20, 0x68, 0xfe, 0x7f, 0xc1, 0xad,
]);
/** RC2-CBC decrypt, padding kept. @param {Buffer} key @param {number} bits @param {Buffer} iv @param {Buffer} data */
export function rc2Cbc(key, bits, iv, data) {
  if (data.length % 8) throw new Error('bad length');
  const K = rc2Keys(key, bits), out = Buffer.alloc(data.length);
  const ror = (/** @type {number} */ x, /** @type {number} */ s) => ((x >> s) | (x << (16 - s))) & 0xffff;
  let prev = iv;
  for (let o = 0; o < data.length; o += 8) {
    const R = [0, 1, 2, 3].map(i => data.readUInt16LE(o + 2 * i));
    let j = 63;
    const mixR = () => { for (let i = 3; i >= 0; i--) { R[i] = ror(R[i], [1, 2, 3, 5][i]); R[i] = (R[i] - K[j--] - (R[(i + 3) & 3] & R[(i + 2) & 3]) - (~R[(i + 3) & 3] & R[(i + 1) & 3])) & 0xffff; } };
    const mashR = () => { for (let i = 3; i >= 0; i--) R[i] = (R[i] - K[R[(i + 3) & 3] & 63]) & 0xffff; };
    for (let r = 0; r < 5; r++) mixR(); mashR();
    for (let r = 0; r < 6; r++) mixR(); mashR();
    for (let r = 0; r < 5; r++) mixR();
    for (let i = 0; i < 4; i++) out.writeUInt16LE(R[i] ^ prev.readUInt16LE(2 * i), o + 2 * i);
    prev = data.subarray(o, o + 8);
  }
  return out;
}
/** @param {Buffer} key @param {number} bits @param {Buffer} iv @param {Buffer} data */
function rc2Decrypt(key, bits, iv, data) {
  const out = rc2Cbc(key, bits, iv, data);
  const pad = out[out.length - 1];
  if (!pad || pad > 8 || out.subarray(out.length - pad).some(b => b !== pad)) throw new Error('bad padding');
  return out.subarray(0, out.length - pad);
}

/** Decrypt with an AlgorithmIdentifier (PBES2 or a PKCS#12 PBE). @param {Node} alg @param {Buffer} data @param {string} password */
function decrypt(alg, data, password) {
  const [id, params] = kids(alg), o = oid(id);
  if (o === '1.2.840.113549.1.5.13') { // PBES2
    const [kdf, enc] = kids(params);
    const [kdfId, kdfP] = kids(kdf);
    if (oid(kdfId) !== '1.2.840.113549.1.5.12') throw new Error('unsupported KDF');
    const kp = kids(kdfP), salt = octets(kp[0]), iter = int(kp[1]);
    const prf = kp.find((k, i) => i > 1 && k.tag === 0x30);
    const hash = prf ? HMAC[/** @type {keyof typeof HMAC} */ (oid(kids(prf)[0]))] : 'sha1';
    const [encId, iv] = kids(enc), c = CBC[/** @type {keyof typeof CBC} */ (oid(encId))];
    if (!c || !hash) throw new Error('unsupported cipher');
    const key = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iter, c[1], hash);
    const d = crypto.createDecipheriv(c[0], key, octets(iv));
    return Buffer.concat([d.update(data), d.final()]);
  }
  const p = P12PBE[/** @type {keyof typeof P12PBE} */ (o)];
  if (!p) throw new Error(`unsupported encryption ${o}`);
  const [saltN, iterN] = kids(params), salt = octets(saltN), iter = int(iterN), pw = bmp(password);
  const key = p12kdf('sha1', pw, salt, iter, 1, Number(p[1])), iv = p12kdf('sha1', pw, salt, iter, 2, 8);
  if (p[0] === 'rc2') return rc2Decrypt(key, Number(p[2]), iv, data);
  const d = crypto.createDecipheriv('des-ede3-cbc', p[1] === 16 ? Buffer.concat([key, key.subarray(0, 8)]) : key, iv);
  return Buffer.concat([d.update(data), d.final()]);
}

const BAG = { key: '1.2.840.113549.1.12.10.1.1', shrouded: '1.2.840.113549.1.12.10.1.2', cert: '1.2.840.113549.1.12.10.1.3' };

/**
 * Open a .p12. Throws on a wrong password (the MAC, or the decryption) or a file that is not PKCS#12.
 * @param {Uint8Array} p12 @param {string} password @returns {{ keys: crypto.KeyObject[], certs: Buffer[] }}
 */
export function readPkcs12(p12, password) {
  const pfx = kids(root(Buffer.from(p12)));
  const [ct, body] = kids(pfx[1]);
  if (oid(ct) !== '1.2.840.113549.1.7.1') throw new Error('not a password-protected PKCS#12');
  const safe = octets(kids(body)[0]);
  if (pfx[2]) { // the MAC: proves the password before anything is decrypted
    const [di, saltN, iterN] = kids(pfx[2]);
    const [algN, digN] = kids(di), hash = HASH[/** @type {keyof typeof HASH} */ (oid(kids(algN)[0]))];
    if (!hash) throw new Error('unsupported MAC');
    const n = crypto.createHash(hash).digest().length;
    const key = p12kdf(hash, bmp(password), octets(saltN), iterN ? int(iterN) : 1, 3, n);
    const mac = crypto.createHmac(hash, key).update(safe).digest(), want = octets(digN);
    if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) throw new Error('wrong password');
  }
  /** @type {crypto.KeyObject[]} */ const keys = []; /** @type {Buffer[]} */ const certs = [];
  for (const ci of kids(root(safe))) {
    const [t, c] = kids(ci), type = oid(t);
    let contents;
    if (type === '1.2.840.113549.1.7.1') contents = octets(kids(c)[0]);
    else if (type === '1.2.840.113549.1.7.6') { // EncryptedData
      const eci = kids(kids(kids(c)[0])[1]);
      contents = decrypt(eci[1], octets(eci[2]), password);
    } else continue;
    for (const bag of kids(root(contents))) {
      const [idN, valN] = kids(bag), id = oid(idN), v = kids(valN)[0];
      if (id === BAG.cert) { const [certType, certV] = kids(v); if (oid(certType) === '1.2.840.113549.1.9.22.1') certs.push(Buffer.from(octets(kids(certV)[0]))); }
      else if (id === BAG.key) keys.push(crypto.createPrivateKey({ key: Buffer.from(v.buf.subarray(v.at, v.next)), format: 'der', type: 'pkcs8' }));
      else if (id === BAG.shrouded) { const [alg, data] = kids(v); keys.push(crypto.createPrivateKey({ key: decrypt(alg, octets(data), password), format: 'der', type: 'pkcs8' })); }
    }
  }
  return { keys, certs };
}
