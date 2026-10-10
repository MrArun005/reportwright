// @ts-check
// Digital signatures for PDFs rendered on the server: a detached PKCS#7 signature
// (adbe.pkcs7.detached) over the whole file. The certificate is a .p12 file:
// PW_SIGN_P12 (its path) and PW_SIGN_PASSWORD. Only routes behind an API key may sign:
// a signature vouches for the content, and anyone who can reach an open route could choose it.
import fs from 'node:fs/promises';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';

/**
 * options: exportPdf's sign option (@reportwright/pdf signs as it writes, with a .p12 signer through its cmsSigner).
 * prepare, save and sign: the pdf-lib + @signpdf way, deprecated (removed in 0.15).
 * @returns {Promise<{ options: { signer: any, name: string, reason: string, location: string, contactInfo: string }, prepare: (doc: any) => void, save: object, sign: (pdf: Uint8Array) => Promise<Uint8Array> }>}
 */
export async function pdfSigner({ name = 'ReportWright', reason = 'Issued by ReportWright', location = '', contactInfo = '' } = {}) {
  const file = process.env.PW_SIGN_P12;
  if (!file) throw Object.assign(new Error('Signing is not set up: set PW_SIGN_P12 (a .p12 certificate file) and PW_SIGN_PASSWORD'), { status: 400 });
  const unreadable = () => Object.assign(new Error('PW_SIGN_P12 points to a file that cannot be read'), { status: 500 });
  const password = process.env.PW_SIGN_PASSWORD || '';
  let st;
  try { st = await fs.stat(file); } catch { throw unreadable(); }
  // the .p12 is opened (its PKCS#12 decrypted) once per process, again when the file or the password changes
  if (!cached || cached.file !== file || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size || cached.password !== password) {
    let p12;
    try { p12 = await fs.readFile(file); } catch { throw unreadable(); }
    cached = { file, mtimeMs: st.mtimeMs, size: st.size, password, p12, signer: await p12Signer(p12, password) };
  }
  const { p12, signer: p12signer } = cached;
  /** the deprecated @signpdf signer, made only when its sign() is used */
  let legacy;
  return {
    options: { signer: p12signer, name, reason, location, contactInfo },
    // loaded when used: it needs pdf-lib, which is only a development dependency now
    prepare: async (doc) => (await import('@signpdf/placeholder-pdf-lib')).pdflibAddPlaceholder({ pdfDoc: doc, reason, contactInfo, name, location }),
    save: { useObjectStreams: false }, // the signature dictionary must stay findable in the file
    sign: async (pdf) => new Uint8Array(await new SignPdf().sign(Buffer.from(pdf), legacy ??= new P12Signer(p12, { passphrase: password }))),
  };
}

/** @type {{ file: string, mtimeMs: number, size: number, password: string, p12: Uint8Array, signer: any } | null} */
let cached = null;
let loads = 0;
/** For tests: how many times a .p12 was opened (decrypted) in this process. */
export const p12Loads = () => loads;

/**
 * A @reportwright/pdf signer from a PKCS#12 file (its examples/p12-signer.mjs): the key and its certificate chain, the
 * signer's certificate first; RSA, PKCS#1 v1.5. A wrong password or a file without a key is a 500 (the server's setup).
 * @param {Uint8Array} p12 @param {string} password
 */
export async function p12Signer(p12, password) {
  const forge = (await import('node-forge')).default;
  const { cmsSigner } = await import('@reportwright/pdf');
  const setup = (/** @type {string} */ m) => Object.assign(new Error(m), { status: 500 });
  loads++;
  let box;
  try { box = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(p12).toString('binary'))), password); }
  catch { throw setup('PW_SIGN_P12 could not be opened (a wrong PW_SIGN_PASSWORD, or not a PKCS#12 file)'); }
  const bags = (/** @type {string} */ type) => box.getBags({ bagType: type })[type] ?? [];
  const key = /** @type {any} */ ([...bags(forge.pki.oids.pkcs8ShroudedKeyBag), ...bags(forge.pki.oids.keyBag)][0]?.key);
  if (!key?.n) throw setup('PW_SIGN_P12 has no RSA private key');
  const certs = bags(forge.pki.oids.certBag).map((b) => /** @type {any} */ (b.cert)).filter(Boolean);
  const mine = certs.findIndex((c) => c.publicKey.n?.equals(key.n));
  if (mine < 0) throw setup("PW_SIGN_P12 has no certificate for its key");
  certs.unshift(certs.splice(mine, 1)[0]);
  // an expired or not yet valid certificate signs nothing: readers would show the signature as invalid
  const now = Date.now(), v = certs[0].validity;
  if (!(v.notBefore.getTime() <= now && now <= v.notAfter.getTime())) throw setup("PW_SIGN_P12's certificate is expired or not yet valid");
  return cmsSigner({
    certs: certs.map((c) => forge.pki.certificateToPem(c)).join('\n'),
    keyAlgorithm: 'rsa',
    sign(bytes, hash) {
      const md = { 'SHA-256': forge.md.sha256, 'SHA-384': forge.md.sha384, 'SHA-512': forge.md.sha512 }[hash].create();
      md.update(Buffer.from(bytes).toString('binary'));
      return Uint8Array.from(Buffer.from(key.sign(md), 'binary'));
    },
  });
}
