// @ts-check
/**
 * PDF passwords and permissions: the standard security handler, revision 6 (AES-256, V5, crypt filter AESV3),
 * ISO 32000-2 §7.6.4. Needs only SHA-256/384/512 and AES-CBC, which WebCrypto has in browsers and Node 20+.
 *
 * Runs on pdf-lib's object graph after doc.flush(), before save({ useObjectStreams: false }): every string
 * becomes a hex string of ciphertext and every stream a raw stream of ciphertext. Nothing is spliced into PDF
 * syntax by hand. Error messages never contain a password.
 */
import { PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, PDFRawStream, PDFStream, PDFBool } from '../engine/lazylibs.js'; // set once exportPdf has loaded pdf-lib

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('PDF encryption needs WebCrypto (a browser, or Node 20 or later)');
  return s;
};
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const hex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/** AES-CBC with PKCS#7 padding (WebCrypto's only mode). @param {Uint8Array} key @param {Uint8Array} iv @param {Uint8Array} data */
async function aesCbc(key, iv, data) {
  const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data));
}
/** AES-CBC without padding, for data a multiple of 16 bytes: the padded result minus its last (padding) block. */
const aesCbcNoPad = async (key, iv, data) => (await aesCbc(key, iv, data)).subarray(0, data.length);
const sha = async (alg, data) => new Uint8Array(await subtle().digest(alg, data));

/**
 * Algorithm 2.B: the hash of a password, a salt and (for the owner) the U string.
 * @param {Uint8Array} pw @param {Uint8Array} salt @param {Uint8Array} udata
 */
export async function hash2B(pw, salt, udata) {
  let K = await sha('SHA-256', cat(pw, salt, udata));
  for (let round = 0; ; round++) {
    const one = cat(pw, K, udata);
    const K1 = new Uint8Array(one.length * 64);
    for (let i = 0; i < 64; i++) K1.set(one, i * one.length);
    const E = await aesCbcNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
    let mod = 0;
    for (let i = 0; i < 16; i++) mod += E[i];
    K = await sha(['SHA-256', 'SHA-384', 'SHA-512'][mod % 3], E);
    if (round >= 63 && E[E.length - 1] <= round + 1 - 32) break;
  }
  return K.subarray(0, 32);
}

/** A password as the handler wants it: NFKC (SASLprep's main step), UTF-8, at most 127 bytes. */
export function passwordBytes(pw, which) {
  const b = new TextEncoder().encode(String(pw ?? '').normalize('NFKC'));
  if (b.length > 127) throw Object.assign(new Error(`The ${which} password is too long (at most 127 bytes in UTF-8)`), { status: 400 });
  return b;
}

/** Permission names → bit numbers (1-based) of /P. */
export const PERMISSION_BITS = { print: 3, modify: 4, copy: 5, annotate: 6, fillForms: 9, accessibility: 10, assemble: 11, printHighQuality: 12 };

/** /P: reserved bits 7, 8 and 13–32 set, 1–2 clear; each permission allowed unless set to false. */
export function permissionsValue(perms = {}) {
  for (const k of Object.keys(perms)) if (!(k in PERMISSION_BITS)) throw Object.assign(new Error(`Unknown PDF permission "${String(k).slice(0, 40)}". Use ${Object.keys(PERMISSION_BITS).join(', ')}.`), { status: 400 });
  let p = 0xFFFFF0C0;
  for (const [k, bit] of Object.entries(PERMISSION_BITS)) if (perms[k] !== false) p |= 1 << (bit - 1);
  return p | 0; // a signed 32-bit integer in the file
}

/**
 * Encrypt a pdf-lib document in place.
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {{ userPassword?: string, ownerPassword?: string, permissions?: Record<string, boolean> }} opt
 */
export async function encryptPdf(doc, opt) {
  const user = passwordBytes(opt.userPassword, 'user');
  // no owner password: a random one nobody knows, so the permissions cannot be lifted
  const owner = opt.ownerPassword != null && opt.ownerPassword !== '' ? passwordBytes(opt.ownerPassword, 'owner') : random(32);
  const P = permissionsValue(opt.permissions || {});
  const fileKey = random(32);
  const zero = new Uint8Array(16);

  const uvs = random(8), uks = random(8);
  const U = cat(await hash2B(user, uvs, new Uint8Array()), uvs, uks);
  const UE = await aesCbcNoPad(await hash2B(user, uks, new Uint8Array()), zero, fileKey);
  const ovs = random(8), oks = random(8);
  const O = cat(await hash2B(owner, ovs, U), ovs, oks);
  const OE = await aesCbcNoPad(await hash2B(owner, oks, U), zero, fileKey);
  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, P, true);
  perms.set([0xff, 0xff, 0xff, 0xff, 0x54 /* T: metadata encrypted */, 0x61, 0x64, 0x62], 4);
  perms.set(random(4), 12);
  const Perms = await aesCbcNoPad(fileKey, zero, perms); // one block: CBC with a zero IV is ECB

  await doc.flush();
  const ctx = doc.context;
  /** a fresh IV, then AES-256-CBC with padding (AESV3) */
  const enc = async (bytes) => { const iv = random(16); return cat(iv, await aesCbc(fileKey, iv, bytes)); };
  const seen = new Set();
  /** @returns {Promise<any>} the object to store in place of obj */
  const walk = async (obj) => {
    if (obj instanceof PDFString || obj instanceof PDFHexString) return PDFHexString.of(hex(await enc(obj.asBytes())));
    if (obj instanceof PDFArray) { for (let i = 0; i < obj.size(); i++) obj.set(i, await walk(obj.get(i))); return obj; }
    if (obj instanceof PDFDict) {
      if (seen.has(obj)) return obj;
      seen.add(obj);
      for (const [k, v] of obj.entries()) obj.set(k, await walk(v));
      return obj;
    }
    if (obj instanceof PDFStream) {
      await walk(obj.dict);
      const contents = obj instanceof PDFRawStream ? obj.contents : /** @type {any} */ (obj).getContents();
      return PDFRawStream.of(obj.dict, await enc(contents));
    }
    return obj;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) ctx.assign(ref, await walk(obj));
  // the trailer's Info dictionary is an indirect object (done above); the /ID and the Encrypt dictionary stay plain
  const encrypt = ctx.obj({
    Filter: 'Standard', V: 5, R: 6, Length: 256,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } }, StmF: 'StdCF', StrF: 'StdCF',
    O: PDFHexString.of(hex(O)), U: PDFHexString.of(hex(U)), OE: PDFHexString.of(hex(OE)), UE: PDFHexString.of(hex(UE)),
    P: PDFNumber.of(P), Perms: PDFHexString.of(hex(Perms)), EncryptMetadata: PDFBool.True,
  });
  ctx.trailerInfo.Encrypt = ctx.register(encrypt);
  const id = PDFHexString.of(hex(random(16)));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
}

/**
 * The `pdf` option of an API request or the CLI → encryptPdf options, or undefined for no password.
 * Checks the shape (400 on anything else); the passwords themselves are checked in passwordBytes.
 * @param {any} pdf { userPassword?, ownerPassword?, permissions?: { print?: boolean, … } }
 */
export function pdfEncryptOptions(pdf) {
  if (pdf == null) return undefined;
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (typeof pdf !== 'object' || Array.isArray(pdf)) throw bad('pdf must be an object: { userPassword, ownerPassword, permissions }');
  for (const k of Object.keys(pdf)) if (!['userPassword', 'ownerPassword', 'permissions'].includes(k)) throw bad(`Unknown pdf option "${String(k).slice(0, 40)}"`);
  for (const k of ['userPassword', 'ownerPassword']) if (pdf[k] != null && typeof pdf[k] !== 'string') throw bad(`pdf.${k} must be a string`);
  const perms = pdf.permissions ?? {};
  if (typeof perms !== 'object' || Array.isArray(perms)) throw bad('pdf.permissions must be an object of true/false');
  for (const [k, v] of Object.entries(perms)) if (typeof v !== 'boolean') throw bad(`pdf.permissions.${String(k).slice(0, 40)} must be true or false`);
  if (!pdf.userPassword && !pdf.ownerPassword && !Object.keys(perms).length) return undefined;
  permissionsValue(perms); // unknown names → 400 now, before rendering
  passwordBytes(pdf.userPassword, 'user'); passwordBytes(pdf.ownerPassword, 'owner');
  return { userPassword: pdf.userPassword || '', ownerPassword: pdf.ownerPassword || undefined, permissions: perms };
}
