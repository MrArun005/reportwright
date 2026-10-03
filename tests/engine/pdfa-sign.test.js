// PDF/A-2b and digital signatures (C4). veraPDF, openssl and pdfsig checks run when the tools exist.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import forge from 'node-forge';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } from 'pdf-lib';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { fontStore, report } from '../helpers.js';

const ICC = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'icc', 'sRGB-v2-magic.icc'));
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
const VERAPDF = process.env.VERAPDF_BIN && fs.existsSync(process.env.VERAPDF_BIN) ? process.env.VERAPDF_BIN : null;

const body = [
  { type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 18, value: 'Statement for Zoë', action: { type: 'url', url: 'https://example.com/' } },
  { type: 'shape', name: 'S', shape: 'rect', x: 0, y: 30, w: 100, h: 40, style: { fill: 'rgba(37, 99, 235, 0.5)' } },
  { type: 'field', name: 'F', kind: 'text', fieldName: 'note', value: 'hi', x: 0, y: 80, w: 200, h: 18 },
];
const model = () => render(report(body, { def: { name: 'PDF/A test' } }), { fontStore });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-pdfa-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('PDF/A-2b', () => {
  it('has the metadata, colour profile, file id and printable annotations PDF/A needs', async () => {
    const bytes = await exportPdf(await model(), fontStore, { title: 'PDF/A test', pdfa: { icc: ICC } });
    const doc = await PDFDocument.load(bytes);
    const meta = doc.catalog.lookup(PDFName.of('Metadata'));
    expect(meta).toBeInstanceOf(PDFRawStream);
    const xmp = Buffer.from(meta.contents).toString('utf8');
    expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('PDF/A test');
    const intents = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    const intent = intents.lookup(0, PDFDict);
    expect(intent.get(PDFName.of('S'))).toEqual(PDFName.of('GTS_PDFA1'));
    expect(intent.lookup(PDFName.of('DestOutputProfile'))).toBeTruthy();
    expect(Buffer.from(bytes).toString('latin1')).toMatch(/\/ID \[\s*<[0-9A-F]{32}>\s*<[0-9A-F]{32}>\s*\]/i);
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
      for (let i = 0; annots && i < annots.size(); i++) expect(annots.lookup(i, PDFDict).get(PDFName.of('F'))?.toString()).toBe('4');
    }
  });

  it('refuses PDF/A without the colour profile', async () => {
    await expect(exportPdf(await model(), fontStore, { pdfa: {} })).rejects.toThrow(/colour profile/);
  });

  it.skipIf(!VERAPDF)('passes veraPDF (PDF/A-2B profile)', async () => {
    const file = path.join(tmp, 'a.pdf');
    fs.writeFileSync(file, await exportPdf(await model(), fontStore, { title: 'PDF/A test', pdfa: { icc: ICC } }));
    let out;
    try { out = execFileSync(VERAPDF, ['-f', '2b', '--format', 'text', file], { encoding: 'utf8' }); } catch (e) { out = e.stdout; }
    expect(out).toMatch(/^PASS /m);
  });
});

describe('digital signatures', () => {
  let p12File;
  beforeAll(() => {
    // a throwaway self-signed certificate
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 86400000);
    cert.validity.notAfter = new Date(Date.now() + 86400000 * 365);
    const attrs = [{ name: 'commonName', value: 'Pagewright Test Signer' }];
    cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'test-pass', { algorithm: '3des' });
    p12File = path.join(tmp, 'signer.p12');
    fs.writeFileSync(p12File, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
  }, 60000);

  const signed = async () => {
    process.env.PW_SIGN_P12 = p12File; process.env.PW_SIGN_PASSWORD = 'test-pass';
    try {
      const { renderTo } = await import('../../src/server/renderer.js');
      return (await renderTo(report(body, { def: { name: 'Signed' } }), { format: 'pdf', sign: true, pdfa: true, baseUrl: 'http://127.0.0.1:3000' })).bytes;
    } finally { delete process.env.PW_SIGN_P12; delete process.env.PW_SIGN_PASSWORD; }
  };
  /** The signed byte ranges and the CMS blob, read the way a PDF reader does. */
  const parts = (bytes) => {
    const s = Buffer.from(bytes).toString('latin1');
    const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(s);
    const [a, b, c, d] = m.slice(1).map(Number);
    const buf = Buffer.from(bytes);
    const content = Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]);
    const hex = buf.subarray(a + b + 1, c - 1).toString('latin1').replace(/0+$/, '');
    return { content, cms: Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex'), covers: c + d === buf.length };
  };

  it('signs the whole file: the CMS digest is the hash of the signed ranges', async () => {
    const { content, cms, covers } = parts(await signed());
    expect(covers).toBe(true);
    const digest = crypto.createHash('sha256').update(content).digest();
    expect(cms.includes(digest)).toBe(true);
  }, 60000);

  it('a changed byte no longer matches the signature', async () => {
    const bytes = Buffer.from(await signed());
    const i = bytes.indexOf('Signed') > 0 ? bytes.indexOf('/Producer') : 100;
    bytes[i + 2] ^= 1;
    const { content, cms } = parts(bytes);
    expect(cms.includes(crypto.createHash('sha256').update(content).digest())).toBe(false);
  }, 60000);

  it.skipIf(!has('openssl'))('openssl verifies the signature over the signed ranges', async () => {
    const { content, cms } = parts(await signed());
    fs.writeFileSync(path.join(tmp, 'sig.der'), cms);
    fs.writeFileSync(path.join(tmp, 'content.bin'), content);
    const out = execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', path.join(tmp, 'sig.der'), '-content', path.join(tmp, 'content.bin'), '-noverify', '-out', path.join(tmp, 'out.bin')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(out + '').toBeDefined(); // openssl exits non-zero (throws) when the signature is wrong
  }, 60000);

  it.skipIf(!has('pdfsig'))('poppler pdfsig reports a valid signature', async () => {
    const file = path.join(tmp, 's.pdf');
    fs.writeFileSync(file, await signed());
    let out;
    try { out = execFileSync('pdfsig', [file], { encoding: 'utf8' }); } catch (e) { out = e.stdout; }
    expect(out).toMatch(/Signature Validation: Signature is Valid/);
  }, 60000);

  it('says what to set when signing is not set up', async () => {
    const { renderTo } = await import('../../src/server/renderer.js');
    await expect(renderTo(report(body), { format: 'pdf', sign: true, baseUrl: 'http://127.0.0.1:3000' })).rejects.toThrow(/PW_SIGN_P12/);
  });
});
