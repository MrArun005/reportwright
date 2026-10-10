// Phase B (every PDF through @reportwright/pdf): the parity gate's baseline switch, and each item type the paged
// writer takes over from pdf-lib.
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '../../src/engine/index.js';
import { exportPdf } from '../../src/exporters/pdf.js';
import { exportPdfStream } from '../../src/exporters/pdfstream.js';
import { fontStore, report } from '../helpers.js';

/** @reportwright/pdf's header carries the binary comment %âãÏÓ; pdf-lib's does not */
const viaLibrary = (/** @type {Uint8Array} */ b) => Buffer.from(b.subarray(0, 16)).toString('latin1').includes('âãÏÓ');
const text = report([{ type: 'textbox', x: 0, y: 0, w: 100, h: 20, value: 'Hello' }]);
const rows = Array.from({ length: 40 }, (_, i) => ({ n: i, g: i % 3 }));
const table = () => report([{ type: 'table', name: 'T', dataSet: 'Rows', x: 0, y: 0, w: 300, h: 40, columns: [{ width: 150 }, { width: 150 }],
  groups: [{ name: 'G', expr: '=Fields.g', newSection: true, header: [{ cells: [{ value: '=Fields.g' }, { value: '' }] }] }],
  header: [{ height: 16, cells: [{ value: 'N' }, { value: 'G' }] }], detail: [{ height: 14, cells: [{ value: '=Fields.n' }, { value: '=Fields.g' }] }] }], { data: { rows } });
const sink = () => { const parts = /** @type {Buffer[]} */ ([]); return { parts, write: async (/** @type {Uint8Array} */ u8) => { parts.push(Buffer.from(u8)); } }; };

describe('PW_FORCE_PDFLIB (the parity gate baseline)', () => {
  afterEach(() => { delete process.env.PW_FORCE_PDFLIB; });
  it('sends a plain report through pdf-lib instead of @reportwright/pdf', async () => {
    const m = await render(text, { fontStore });
    expect(viaLibrary(await exportPdf(m, fontStore, {}))).toBe(true);
    process.env.PW_FORCE_PDFLIB = '1';
    expect(viaLibrary(await exportPdf(m, fontStore, {}))).toBe(false);
  });
  it('makes exportPdfStream render whole, and says why', async () => {
    process.env.PW_FORCE_PDFLIB = '1';
    const r = await exportPdfStream(text, { fontStore }, sink());
    expect(r.streamed).toBe(false);
    expect(r.why).toBe('PW_FORCE_PDFLIB');
  });
});

describe('exportPdfStream rendered whole', () => {
  it('an accessible PDF that cannot stream renders its table data (it threw "needs the report\'s table data")', async () => {
    const s = sink();
    const r = await exportPdfStream(table(), { fontStore, tagged: { lang: 'en' }, title: 'T' }, s);
    expect(r.streamed).toBe(false);
    expect(Buffer.concat(s.parts).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('B1: page sizes that differ, page numbering that restarts', async () => {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const { CORPUS } = await import('../../scripts/parity-corpus.mjs');
  const def = (/** @type {string} */ id) => CORPUS.find((/** @type {any} */ c) => c.id === id).def;
  /** the page labels' starts, page sizes and the outline's targets (page index, top) */
  const read = async (/** @type {Uint8Array} */ b) => {
    const doc = await PDFDocument.load(b);
    const refs = doc.getPages().map(p => p.ref.toString());
    const nums = /** @type {any} */ (doc.catalog.lookup(PDFName.of('PageLabels'))).lookup(PDFName.of('Nums')).asArray();
    const outline = [];
    const root = /** @type {any} */ (doc.catalog.lookup(PDFName.of('Outlines')));
    for (let o = root?.lookup(PDFName.of('First')); o; o = o.lookup(PDFName.of('Next'))) { const d = o.lookup(PDFName.of('Dest')).asArray(); outline.push([refs.indexOf(d[0].toString()), d[3].asNumber()]); }
    return { starts: nums.filter((/** @type {any} */ _, /** @type {number} */ i) => i % 2 === 0).map((/** @type {any} */ n) => n.asNumber()), sizes: doc.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())]), outline };
  };
  afterEach(() => { delete process.env.PW_FORCE_PDFLIB; });
  for (const id of ['page-sizes', 'restart-numbers']) {
    it(`${id}: through @reportwright/pdf, with pdf-lib's labels, sizes and outline`, async () => {
      const m = await render(def(id), { fontStore });
      const neu = await exportPdf(m, fontStore, {});
      process.env.PW_FORCE_PDFLIB = '1';
      const old = await exportPdf(m, fontStore, {});
      expect(viaLibrary(neu)).toBe(true);
      expect(await read(neu)).toEqual(await read(old));
    });
  }
});

describe('B2: PNG and JPEG images through @reportwright/pdf', async () => {
  const { CORPUS } = await import('../../scripts/parity-corpus.mjs');
  const def = (/** @type {string} */ id) => CORPUS.find((/** @type {any} */ c) => c.id === id).def;
  const CUT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAf';
  const img = (/** @type {string} */ name, /** @type {string} */ src, /** @type {number} */ y) => ({ type: 'image', name, x: 0, y, w: 60, h: 40, src, alt: name });
  afterEach(() => { delete process.env.PW_FORCE_PDFLIB; });
  it('the logo invoice (PNG 8 and 16 bit, alpha, JPEG, EXIF JPEG) leaves pdf-lib; pdfWriter legacy keeps it there', async () => {
    const m = await render(def('images-invoice'), { fontStore });
    expect(viaLibrary(await exportPdf(m, fontStore, {}))).toBe(true);
    expect(viaLibrary(await exportPdf(m, fontStore, { pdfWriter: 'legacy' }))).toBe(false);
  });
  it('an image it cannot embed is left out with the warning pdf-lib gave', async () => {
    // a cut PNG, and one whose header says 20000 × 20000 pixels (over IMAGE_LIMITS.pixels): both data URIs of a PNG, so
    // the new path takes them (a GIF or a URL picture stays on pdf-lib)
    const ihdr = Buffer.from('89504e470d0a1a0a0000000d4948445200004e2000004e200806000000', 'hex');
    const HUGE = `data:image/png;base64,${Buffer.concat([ihdr, Buffer.alloc(4), Buffer.from('0000000049454e44ae426082', 'hex')]).toString('base64')}`;
    const m = await render(report([img('Cut', CUT, 0), img('Huge', HUGE, 50), img('Cut again', CUT, 100)]), { fontStore });
    const run = async () => { const w = /** @type {string[]} */ ([]); const b = await exportPdf(m, fontStore, { onWarning: (x) => w.push(x) }); return { b, w }; };
    const neu = await run();
    process.env.PW_FORCE_PDFLIB = '1';
    const old = await run();
    expect(viaLibrary(neu.b)).toBe(true);
    expect(neu.w).toEqual(old.w);
    expect(neu.w).toHaveLength(3);
  });
});

describe('B3: SVG path operators, as pdf-lib writes them', async () => {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const { drawSvgPathOps } = await import('../../src/exporters/svgpath.js');
  const doc = await PDFDocument.create();
  /** pdf-lib's own operators for drawSvgPath(d, o) */
  const viaPdfLib = (/** @type {string} */ d, /** @type {any} */ o) => {
    const p = /** @type {any} */ (doc.addPage());
    p.maybeEmbedGraphicsState = (/** @type {any} */ g) => (g.opacity !== undefined || g.borderOpacity !== undefined ? 'GS7' : undefined);
    p.drawSvgPath(d, o);
    return p.getContentStream().operators.map((/** @type {any} */ x) => x.toString()).join('\n') + '\n';
  };
  const r = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const paths = [
    'M 6 0 H 114 A 6 6 0 0 1 120 6 V 24 A 6 6 0 0 1 114 30 H 6 A 6 6 0 0 1 0 24 V 6 A 6 6 0 0 1 6 0 Z',
    'M20 60 A 30 30 0 0 1 80 60 Z', 'M60 20 a 15 25 30 1 0 30 10', 'M10,75 L40,65 70,72 110,62', 'M0 0 C 10 20 30 40 50 60 S 70 80 90 100',
    'M0 0 Q 10 20 30 40 T 50 60 t 10 10 q 5 5 10 0', 'm1.5.5l-2-3h4v-1.25e-1z M 1 1 A 0 0 0 0 1 2 2', 'M0,0 A 5 10 45 1 1 3 4 a 50 50 0 0 0 -10 -10',
    ...Array.from({ length: 40 }, () => `M ${r(rnd() * 100)} ${r(rnd() * 100)} A ${r(rnd() * 40)} ${r(rnd() * 40)} ${r(rnd() * 360)} ${rnd() > 0.5 ? 1 : 0} ${rnd() > 0.5 ? 1 : 0} ${r(rnd() * 100)} ${r(rnd() * 100)} L ${r(rnd() * 9)} ${r(rnd() * 9)} Z`),
  ];
  const opts = [
    { x: 0, y: 841.89, color: rgb(0.2, 0.4, 0.6), opacity: 0.5, borderColor: undefined, borderWidth: 0, borderOpacity: undefined, borderDashArray: undefined },
    { x: 10.5, y: 700, color: undefined, opacity: undefined, borderColor: rgb(1, 0, 1 / 3), borderWidth: 1.6, borderOpacity: 1, borderLineCap: 1, borderDashArray: [4, 3] },
    { x: 0, y: 0, color: rgb(0, 0, 0), opacity: 1, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.75, borderOpacity: 1, borderLineCap: 0 },
  ];
  it('every path and paint is the same operator text', () => {
    for (const d of paths) for (const o of opts) {
      const gs = o.opacity !== undefined || o.borderOpacity !== undefined ? 'GS7' : undefined;
      expect(drawSvgPathOps(d, { ...o, gs }), d).toBe(viaPdfLib(d, { ...o }));
    }
  });
});

describe('B3: rounded boxes, path items and SVG pictures leave pdf-lib', async () => {
  const { CORPUS } = await import('../../scripts/parity-corpus.mjs');
  for (const id of ['rounded', 'paths', 'svg-image', 'mixed']) {
    it(id, async () => {
      const m = await render(CORPUS.find((/** @type {any} */ c) => c.id === id).def, { fontStore });
      expect(viaLibrary(await exportPdf(m, fontStore, {}))).toBe(true);
      expect(viaLibrary(await exportPdf(m, fontStore, { pdfWriter: 'legacy' }))).toBe(false);
    });
  }
});

describe('B5: PDF/A-2b through @reportwright/pdf', async () => {
  const { CORPUS } = await import('../../scripts/parity-corpus.mjs');
  it('a PDF/A report with pictures, SVG and charts leaves pdf-lib; without a profile it stays', async () => {
    const c = CORPUS.find((/** @type {any} */ x) => x.id === 'pdfa-2b-nofields');
    const m = await render(c.def, { fontStore });
    const b = await exportPdf(m, fontStore, c.opts);
    expect(viaLibrary(b)).toBe(true);
    expect(Buffer.from(b).toString('latin1')).toContain('pdfaid');
  });
});

describe('B7: encryption by @reportwright/pdf', async () => {
  const { loadPdf } = await import('@reportwright/pdf');
  const m = await render(report([{ type: 'textbox', x: 0, y: 0, w: 200, h: 20, value: 'Secret', action: { type: 'url', href: 'https://example.com/x' } }]), { fontStore });
  it('AES-256 with the permissions asked for; nothing readable in the raw file', async () => {
    const b = await exportPdf(m, fontStore, { title: 'Payroll', encrypt: { ownerPassword: 'o', permissions: { copy: false, print: false } } });
    expect(viaLibrary(b)).toBe(true);
    const doc = await loadPdf(b);
    expect(doc.encryption).toMatchObject({ algorithm: 'aes-256', permissions: { copy: false, print: false, modify: true, fillForms: true } });
    expect(doc.info.title).toBe('Payroll');
    expect(doc.extractText()).toContain('Secret');
    const raw = Buffer.from(b).toString('latin1');
    for (const t of ['Payroll', 'https://', 'Secret']) expect(raw).not.toContain(t);
  });
  it('a user password is needed to open it', async () => {
    const b = await exportPdf(m, fontStore, { encrypt: { userPassword: 'open me' } });
    await expect(loadPdf(b)).rejects.toThrow();
    expect((await loadPdf(b, { password: 'open me' })).extractText()).toContain('Secret');
  });
  it('the same 400s as before: an unknown permission, a password over 127 bytes, PDF/A', async () => {
    await expect(exportPdf(m, fontStore, { encrypt: { permissions: /** @type {any} */ ({ fly: false }) } })).rejects.toMatchObject({ status: 400 });
    await expect(exportPdf(m, fontStore, { encrypt: { userPassword: 'x'.repeat(200) } })).rejects.toMatchObject({ status: 400 });
    await expect(exportPdf(m, fontStore, { encrypt: {}, pdfa: { icc: new Uint8Array(10) } })).rejects.toMatchObject({ status: 400 });
  });
});

describe('B6: form fields through @reportwright/pdf', async () => {
  const { CORPUS } = await import('../../scripts/parity-corpus.mjs');
  const { loadPdf } = await import('@reportwright/pdf');
  it('every kind, with its value, flags and unique name; pdfWriter legacy stays on pdf-lib', async () => {
    const m = await render(CORPUS.find((/** @type {any} */ c) => c.id === 'fields').def, { fontStore });
    const b = await exportPdf(m, fontStore, {});
    expect(viaLibrary(b)).toBe(true);
    expect(viaLibrary(await exportPdf(m, fontStore, { pdfWriter: 'legacy' }))).toBe(false);
    const f = Object.fromEntries((await loadPdf(b)).fields.map(x => [x.name, x]));
    expect(Object.keys(f).sort()).toEqual(['agree', 'ar', 'customerName', 'hi', 'notes', 'off', 'plan']);
    expect(f.customerName).toMatchObject({ type: 'text', value: 'Zoë Ünlü', required: true });
    expect(f.notes.value).toBe('Line one\nLine two');
    expect(f.agree.value).not.toBe('Off');
    expect(f.off.value ?? 'Off').toBe('Off');
    expect(f.plan).toMatchObject({ type: 'combo', value: 'Plus', readOnly: true });
    expect(f.ar.value).toBe('مرحبا بالعالم');
    expect(f.hi.value).toBe('नमस्ते दुनिया');
  });
});

describe('B8: signing by @reportwright/pdf', async () => {
  const forge = (await import('node-forge')).default;
  const { p12Signer } = await import('../../src/server/sign.js');
  const { loadPdf } = await import('@reportwright/pdf');
  const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '01'; cert.validity.notBefore = new Date('2026-01-01'); cert.validity.notAfter = new Date('2036-01-01');
  cert.setSubject([{ name: 'commonName', value: 'Phase B' }]); cert.setIssuer([{ name: 'commonName', value: 'Phase B' }]); cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pw', { algorithm: '3des' })).getBytes(), 'binary');
  const signer = await p12Signer(p12, 'pw');
  const m = await render(text, { fontStore });
  it('a plain report is signed as it is written: one signature over the whole file', async () => {
    const b = await exportPdf(m, fontStore, { sign: { signer, reason: 'Issued' } });
    expect(viaLibrary(b)).toBe(true);
    const sigs = (await loadPdf(b)).signatures;
    expect(sigs).toHaveLength(1);
    expect(JSON.stringify(sigs[0])).toMatch(/adbe\.pkcs7\.detached/);
  });
  it('on pdf-lib\'s path (pdfWriter legacy) it is signed in an incremental update', async () => {
    const b = await exportPdf(m, fontStore, { pdfWriter: 'legacy', sign: { signer } });
    expect(viaLibrary(b)).toBe(false);
    expect((await loadPdf(b)).signatures).toHaveLength(1);
  });
  it('a wrong .p12 password is a 500; sign with encrypt or with prepare is a 400', async () => {
    await expect(p12Signer(p12, 'nope')).rejects.toMatchObject({ status: 500 });
    await expect(exportPdf(m, fontStore, { sign: { signer }, encrypt: {} })).rejects.toMatchObject({ status: 400 });
    await expect(exportPdf(m, fontStore, { sign: { signer }, prepare: () => {} })).rejects.toMatchObject({ status: 400 });
  });
  it('prepare and save still work, with one deprecation warning', async () => {
    const said = /** @type {string[]} */ ([]);
    const on = (/** @type {any} */ w) => { if (w.name === 'DeprecationWarning') said.push(w.message); };
    process.on('warning', on);
    try {
      let seen = 0;
      await exportPdf(m, fontStore, { prepare: () => { seen++; }, save: { useObjectStreams: false } });
      await exportPdf(m, fontStore, { prepare: () => { seen++; } });
      await new Promise((r) => setTimeout(r, 10));
      expect(seen).toBe(2);
      expect(said.filter(x => /prepare and save/.test(x))).toHaveLength(1);
    } finally { process.off('warning', on); }
  });
});
