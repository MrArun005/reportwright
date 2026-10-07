// @ts-check
// Digital signatures for PDFs rendered on the server: a detached PKCS#7 signature
// (adbe.pkcs7.detached) over the whole file. The certificate is a .p12 file:
// PW_SIGN_P12 (its path) and PW_SIGN_PASSWORD. Only routes behind an API key may sign:
// a signature vouches for the content, and anyone who can reach an open route could choose it.
import fs from 'node:fs/promises';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';

/** @returns {Promise<{ prepare: (doc: any) => void, save: object, sign: (pdf: Uint8Array) => Promise<Uint8Array> }>} */
export async function pdfSigner({ name = 'ReportWright', reason = 'Issued by ReportWright', location = '', contactInfo = '' } = {}) {
  const file = process.env.PW_SIGN_P12;
  if (!file) throw Object.assign(new Error('Signing is not set up: set PW_SIGN_P12 (a .p12 certificate file) and PW_SIGN_PASSWORD'), { status: 400 });
  let p12;
  try { p12 = await fs.readFile(file); } catch { throw Object.assign(new Error('PW_SIGN_P12 points to a file that cannot be read'), { status: 500 }); }
  const signer = new P12Signer(p12, { passphrase: process.env.PW_SIGN_PASSWORD || '' });
  return {
    prepare: (doc) => pdflibAddPlaceholder({ pdfDoc: doc, reason, contactInfo, name, location }),
    save: { useObjectStreams: false }, // the signature dictionary must stay findable in the file
    sign: async (pdf) => new Uint8Array(await new SignPdf().sign(Buffer.from(pdf), signer)),
  };
}
