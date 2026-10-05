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

// The key that seals TOTP secrets at rest is PW_DATA_KEY (32+ characters), with PW_DATA_KEY_OLD (comma-separated) for a
// rotation: a seal names its key ("v2:<key id>:…"), so old seals still open while new ones use the new key. It never
// silently falls back to PW_SESSION_SECRET: rotating that (the usual answer to a leak) would make every enrolment
// unreadable. In development, without PW_DATA_KEY, the session secret seals (said once in the log). Seals from before
// key ids ("v1:") are opened with PW_DATA_KEY or the session secret, as they were made. checkDataKey() at boot refuses a
// changed key that would strand the stored seals.
const kdf = (material) => Buffer.from(crypto.hkdfSync('sha256', material, 'pagewright', 'totp-secret-v1', 32));
const kidOf = (material) => crypto.createHash('sha256').update(`pw-data-key:${material}`).digest('hex').slice(0, 8);
const g = /** @type {any} */ (globalThis);
/** The keys that open seals, the current one first: [{ kid, key }]. */
function dataKeys() {
  const list = [];
  const cur = process.env.PW_DATA_KEY;
  if (cur && cur.length < 32) throw Object.assign(new Error('PW_DATA_KEY is too short: use at least 32 random characters.'), { status: 500 });
  if (cur) list.push(cur);
  else {
    const dev = (/** @type {any} */ (process.env).PW_MODE === 'dev') || (!process.env.PW_MODE && ['development', 'test'].includes(String(process.env.NODE_ENV)));
    if (!dev) throw Object.assign(new Error('Two-factor sign-in needs PW_DATA_KEY on the server (32+ random characters, kept apart from PW_SESSION_SECRET): it seals the authenticator secrets.'), { status: 500 });
    if (!g.__pwDataKeyWarned) { g.__pwDataKeyWarned = true; console.warn('[pagewright] PW_DATA_KEY is not set: development seals two-factor secrets with PW_SESSION_SECRET. Production refuses this.'); }
    list.push(sessionSecret());
  }
  for (const o of (process.env.PW_DATA_KEY_OLD || '').split(',').map(x => x.trim()).filter(x => x.length >= 32)) list.push(o);
  return list.map(m => ({ kid: kidOf(m), key: kdf(m) }));
}
/** "v2:<key id>:" + base64(iv | tag | ciphertext). @param {string} text */
export function seal(text) {
  const [{ kid, key }] = dataKeys();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  rememberKid(kid);
  return `v2:${kid}:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
const open = (key, b) => { const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
/** The text, or null when the seal is broken or no configured key opens it. @param {string} sealed */
export function unseal(sealed) {
  try {
    const t = String(sealed);
    const m = /^v2:([0-9a-f]{8}):(.+)$/.exec(t);
    if (m) { const k = dataKeys().find(x => x.kid === m[1]); return k ? open(k.key, Buffer.from(m[2], 'base64')) : null; }
    if (!t.startsWith('v1:')) return null;
    const b = Buffer.from(t.slice(3), 'base64');
    // v1 was sealed with PW_DATA_KEY, or the session secret when there was none
    for (const material of [process.env.PW_DATA_KEY, ...(process.env.PW_DATA_KEY_OLD || '').split(','), process.env.PW_SESSION_SECRET].map(x => (x || '').trim()).filter(Boolean)) {
      try { return open(kdf(material), b); } catch { /* the next key */ }
    }
    return null;
  } catch { return null; }
}

/** The key id that sealed the stored secrets, kept in settings ("datakey") so a changed key is noticed at boot. */
function rememberKid(kid) {
  if (g.__pwDataKid === kid) return;
  g.__pwDataKid = kid;
  store().put('settings', 'datakey', JSON.stringify({ id: 'datakey', kid, at: new Date().toISOString() })).catch(() => { g.__pwDataKid = null; });
}
/**
 * At boot: when secrets were sealed with a key that is no longer configured (PW_DATA_KEY changed without its old value
 * in PW_DATA_KEY_OLD, or the session secret rotated in development), say so: production refuses to start rather than
 * leave every enrolled user unable to sign in. Returns the problem, or ''.
 */
export async function checkDataKey() {
  const t = await store().get('settings', 'datakey').catch(() => null);
  if (!t) return '';
  let kid; try { kid = JSON.parse(t).kid; } catch { return ''; }
  let kids;
  try { kids = dataKeys().map(k => k.kid); } catch (e) { return /** @type {Error} */ (e).message; }
  return kids.includes(kid) ? '' : `The two-factor secrets were sealed with a key that is no longer configured (key id ${kid}). Put the previous PW_DATA_KEY in PW_DATA_KEY_OLD (comma-separated), or every enrolled user loses two-factor sign-in.`;
}

/* ---------------- recovery codes ---------------- */

/** Normalised: upper case, no spaces or dashes. @param {string} code */
export const hashRecovery = (code) => crypto.createHash('sha256').update(`pw-recovery:${String(code ?? '').toUpperCase().replace(/[\s-]/g, '')}`).digest('hex');
/** 10 codes like "ABCD-EFGH-JKLM-NPQR" (80 bits each) and their hashes. */
export function newRecoveryCodes(n = 10) {
  const codes = Array.from({ length: n }, () => base32(crypto.randomBytes(10)).match(/.{4}/g).join('-'));
  return { codes, hashes: codes.map(hashRecovery) };
}
