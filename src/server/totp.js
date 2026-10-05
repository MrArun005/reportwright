// @ts-check
// Two-factor sign-in with an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30-second steps; RFC 4226 HOTP).
// The shared secret is kept sealed (AES-256-GCM) in the user record, with a key derived from PW_DATA_KEY, else
// PW_SESSION_SECRET (rotating that secret makes every enrolled authenticator unreadable: users enrol again after an
// admin resets them). Recovery codes: 10 random 80-bit codes, shown once, stored as SHA-256 hashes (the codes are random,
// so a fast hash is enough), each good once. A code is accepted one step either side of now (clock drift), and each
// time step is good once per user, on every server (a storage lease), so a code seen over a shoulder cannot be replayed.
import crypto from 'node:crypto';
import { sessionSecret } from './session.js';
import { store } from './storage/index.js';

const STEP = 30, DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** @param {Buffer} buf */
export function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
/** @param {string} s */
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('Not base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, RFC 4226's recommendation), base32. */
export const newSecret = () => base32(crypto.randomBytes(20));

/** HOTP for a counter. @param {Buffer} key @param {number} counter */
export function hotp(key, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** DIGITS).padStart(DIGITS, '0');
}
/** The code for a time (ms). @param {string} secret base32 @param {number} [at] */
export const totp = (secret, at = Date.now()) => hotp(unbase32(secret), Math.floor(at / 1000 / STEP));

/**
 * The time step a code matches (now, or one step either side), or null. Constant-time per candidate.
 * @param {string} secret base32 @param {string} code @param {number} [at]
 */
export function matchStep(secret, code, at = Date.now()) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = unbase32(secret);
  const now = Math.floor(at / 1000 / STEP);
  let hit = null;
  for (const s of [now - 1, now, now + 1]) if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(c)) && hit === null) hit = s;
  return hit;
}

/**
 * Accept a code once: the step it matches must not have been used by this user on any server. True when accepted.
 * @param {string} email @param {string} secret @param {string} code
 */
export async function useCode(email, secret, code) {
  const step = matchStep(secret, code);
  if (step === null) return false;
  const name = `totp-used:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 24)}:${step}`;
  return store().lease(name, crypto.randomBytes(8).toString('hex'), 4 * STEP * 1000); // held past the window it could match in
}

/** The otpauth:// URI an authenticator app reads (from the QR code). @param {string} email @param {string} secret */
export function otpauthUri(email, secret) {
  const issuer = (process.env.PW_TOTP_ISSUER || 'Pagewright').replace(/[:\x00-\x1f]/g, '').slice(0, 64) || 'Pagewright';
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}

/** A QR code of the URI as SVG (black on white, with a quiet zone), drawn by bwip-js. @param {string} text */
export async function qrSvg(text) {
  // @ts-ignore: bwip-js has no type declarations
  const bwip = /** @type {any} */ (await import('bwip-js'));
  return bwip.toSVG({ bcid: 'qrcode', text, scale: 4, eclevel: 'M', backgroundcolor: 'FFFFFF', paddingwidth: 4, paddingheight: 4 });
}

/* ---------------- secrets at rest ---------------- */

function dataKey() {
  const k = process.env.PW_DATA_KEY;
  if (k && k.length < 32) throw new Error('PW_DATA_KEY is too short: use at least 32 random characters.');
  return Buffer.from(crypto.hkdfSync('sha256', k || sessionSecret(), 'pagewright', 'totp-secret-v1', 32));
}
/** "v1:" + base64(iv | tag | ciphertext). @param {string} text */
export function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
/** The text, or null when the seal is broken or the key changed. @param {string} sealed */
export function unseal(sealed) {
  try {
    if (!String(sealed).startsWith('v1:')) return null;
    const b = Buffer.from(String(sealed).slice(3), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', dataKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; }
}

/* ---------------- recovery codes ---------------- */

/** Normalised: upper case, no spaces or dashes. @param {string} code */
export const hashRecovery = (code) => crypto.createHash('sha256').update(`pw-recovery:${String(code ?? '').toUpperCase().replace(/[\s-]/g, '')}`).digest('hex');
/** 10 codes like "ABCD-EFGH-JKLM-NPQR" (80 bits each) and their hashes. */
export function newRecoveryCodes(n = 10) {
  const codes = Array.from({ length: n }, () => base32(crypto.randomBytes(10)).match(/.{4}/g).join('-'));
  return { codes, hashes: codes.map(hashRecovery) };
}
