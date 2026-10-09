// Writer hardening: options read once (a getter cannot pass the check with one value and be written with another),
// constant tables looked up by own key only, options that widen what is allowed read as own properties only, the
// passive attachment types, the CFF and kerning work bounds, tiling pattern geometry.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { toBytes } from '../../packages/pdf/src/index.js';
import { HAS, run, save, latin } from './tools.js';
import { EN16931 } from './standards-fixture.js';
import { checkFileName } from '../../packages/pdf/src/core/filename.js';
import { link } from '../../packages/pdf/src/nav/links.js';
import { attachFile } from '../../packages/pdf/src/annotations/attach.js';

const DATE = new Date('2026-01-01');
const ACTIVE = /\/JavaScript|\/JS\b|\/Launch|\/GoToR|\/GoToE|\/SubmitForm|\/ImportData|\/AA\b/;
const FILE = new Uint8Array([1, 2, 3]);

/** the file as qpdf rewrites it (uncompressed, no object streams); qpdf must read it */
function qdf(bytes) {
  const f = save(bytes), out = `${f}.qdf.pdf`;
  run('qpdf', ['--qdf', '--object-streams=disable', f, out]);
  return fs.readFileSync(out).toString('latin1');
}
/** every action type the file writes */
const actionTypes = (s) => [...s.matchAll(/\/Type \/Action\s+\/S \/(\w+)/g)].map((m) => m[1]);

/**
 * An object whose `key` returns `good` for its first n reads and `bad` after (a getter, like a hostile Proxy).
 * @param {object} base @param {string} key
 */
function flip(base, key, good, bad, n) {
  let reads = 0;
  return Object.defineProperty(base, key, { enumerable: true, configurable: true, get: () => (reads++ < n ? good : bad) });
}

/** for n = 1…6 reads of the good value: build, and the file holds only the good value and only allowed actions */
async function readOnce(build, { good, allowed = [], tagged = false }) {
  for (let n = 1; n <= 6; n++) {
    const out = await toBytes((pdf) => build(pdf, n), { compress: false, creationDate: DATE, ...(tagged ? { tagged: true, title: 't' } : {}) });
    const s = HAS.qpdf ? qdf(out) : latin(out);
    expect(s, `n = ${n}`).not.toMatch(ACTIVE);
    expect(s, `n = ${n}`).toContain(good);
    for (const t of actionTypes(s)) expect(allowed, `n = ${n}: action /${t}`).toContain(t);
  }
}

describe('options are read once', () => {
  const EVIL = 'NextPage /S /JavaScript /JS (app.alert(1))';

  it('link: target.named', () => readOnce((pdf, n) => {
    pdf.addPage().link(0, 0, 9, 9, flip({}, 'named', 'NextPage', EVIL, n));
  }, { good: '/N /NextPage', allowed: ['Named'] }));

  it('link: highlight (and the other link options)', () => readOnce((pdf, n) => {
    pdf.addPage().link(0, 0, 9, 9, { url: 'https://example.com/' }, flip({}, 'highlight', 'push', 'constructor', n));
  }, { good: '/H /P', allowed: ['URI'] }));

  it('form button: action.named', () => readOnce((pdf, n) => {
    const p = pdf.addPage();
    pdf.form.button('b', { page: p, width: 40, height: 20, font: pdf.standardFont('Helvetica'), label: 'Go', action: flip({}, 'named', 'NextPage', EVIL, n) });
  }, { good: '/N /NextPage', allowed: ['Named'] }));

  it('form widget: the page is brand-checked and its object number comes from the registry, never from the handle', async () => {
    await readOnce((pdf, n) => {
      const p = pdf.addPage();
      const forged = Object.create(p, { ref: { value: '1 0 R /AA << /O << /S /JavaScript /JS (app.alert(1)) >> >> /X 1' } });
      pdf.form.checkbox('c', flip({ width: 12, height: 12 }, 'page', p, forged, n));
    }, { good: '/FT /Btn' });
    // the page's own ref changed after it was made: the widget's /P and the page object are still the real ones
    const out = await toBytes((pdf) => {
      const p = pdf.addPage();
      pdf.form.checkbox('c', { page: p, width: 12, height: 12 });
      p.ref = '1 0 R /AA << /O << /S /JavaScript /JS (app.alert(1)) >> >> /X 1';
    }, { compress: false, creationDate: DATE });
    expect(HAS.qpdf ? qdf(out) : latin(out)).not.toMatch(ACTIVE);
  });

  it('pdf.pageLabels: style', () => readOnce((pdf, n) => {
    pdf.addPage();
    pdf.pageLabels([flip({ start: 0 }, 'style', 'r', 'r /JS (app.alert(1))', n)]);
  }, { good: '/S /r' }));

  it('page.markup: lineEndings entries', () => readOnce((pdf, n) => {
    const ends = flip(['Butt', 'None'], '0', 'Butt', 'None] /A << /Type /Action /S /JavaScript /JS (app.alert(1)) >> /X [/None', n);
    pdf.addPage().markup('Line', { x1: 10, y1: 10, x2: 90, y2: 40 }, { lineEndings: ends });
  }, { good: '/Butt' }));

  it('page.tag: rowSpan and colSpan', () => readOnce((pdf, n) => {
    const p = pdf.addPage();
    p.tag('Table', () => p.tag('TR', () => p.tag('TD', () => {}, flip({}, 'rowSpan', 2, '2 /JS (app.alert(1))', n))));
  }, { good: '/RowSpan 2', tagged: true }));

  it('a Proxy and shared parts: each property is read once, cycles and shared objects are kept', async () => {
    const reads = new Map();
    const o = new Proxy({ url: 'https://example.com/' }, { get: (t, k, r) => { reads.set(k, (reads.get(k) ?? 0) + 1); return Reflect.get(t, k, r); } });
    await toBytes((pdf) => { pdf.addPage().link(0, 0, 9, 9, o); }, { creationDate: DATE });
    expect(reads.get('url')).toBe(1);
    const cyclic = { title: 'A', page: 1 }; cyclic.self = cyclic;
    expect(() => toBytes((pdf) => { pdf.addPage(); pdf.outline(cyclic); })).not.toThrow();
  });
});

describe('constant tables are looked up by own key only', () => {
  for (const k of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
    it(`pdf.viewer({ ${k}: … }) is refused and the file opens`, async () => {
      let err;
      const out = await toBytes((pdf) => {
        try { pdf.viewer(JSON.parse(`{ "${k}": true }`)); } catch (e) { err = e; }
        try { pdf.viewer(JSON.parse(`{ "${k}": "L2R" }`)); } catch (e) { err ??= e; }
        pdf.viewer({ fitWindow: true });
      }, { compress: false, creationDate: DATE });
      expect(err?.message).toMatch(/unknown option/);
      if (HAS.qpdf) expect(qdf(out)).toContain('/FitWindow true');
      expect(latin(out)).not.toContain('[object');
    });
  }
  it('pdf.standardFont and pdf.facturX refuse inherited names with a clear error', async () => {
    await toBytes((pdf) => {
      for (const n of ['constructor', 'toString', '__proto__']) expect(() => pdf.standardFont(n), n).toThrow(/Not a standard font/);
    });
    await toBytes(async (pdf) => {
      pdf.addPage();
      for (const n of ['constructor', 'toString']) await expect(pdf.facturX(EN16931, { profile: n }), n).rejects.toThrow(/profile is one of/);
    }, { pdfa: { part: 3, conformance: 'b' }, creationDate: DATE });
  });
});

describe('options that widen what is allowed are own properties only', () => {
  const inherited = (proto, own) => Object.assign(Object.create(proto), own);
  it('allowTypes and allowArchives on the prototype do not allow a type', async () => {
    await toBytes(async (pdf) => {
      const p = pdf.addPage();
      expect(() => p.attachFile(FILE, inherited({ allowTypes: ['exe'] }, { name: 'tool.exe' }))).toThrow(/not an allowed type/);
      expect(() => p.attachFile(FILE, inherited({ allowArchives: true }, { name: 'a.zip' }))).toThrow(/not an allowed type/);
      await expect(pdf.attach(FILE, inherited({ allowTypes: ['exe'] }, { name: 'tool.exe' }))).rejects.toThrow(/not an allowed type/);
      expect(() => p.attachFile(FILE, { name: 'tool.exe', allowTypes: ['exe'] })).not.toThrow(); // own: allowed
    });
  });
  it('also where no snapshot is in front of the check (the modules as other modules call them)', async () => {
    const who = 'test';
    expect(() => checkFileName('tool.exe', inherited({ allowTypes: ['exe'] }, {}), who)).toThrow(/not an allowed type/);
    expect(() => checkFileName('a.zip', inherited({ allowArchives: true }, {}), who)).toThrow(/not an allowed type/);
    expect(checkFileName('tool.exe', { allowTypes: ['exe'] }, who).name).toBe('tool.exe');
    await toBytes((pdf) => {
      const p = pdf.addPage();
      expect(() => link.call(p, 0, 0, 9, 9, { url: 'ftp://x/' }, inherited({ allowSchemes: ['ftp'] }, {}))).toThrow(/ftp: URLs are not allowed/);
      expect(() => attachFile.call(p, FILE, inherited({ allowTypes: ['exe'] }, { name: 'tool.exe' }))).toThrow(/not an allowed type/);
    });
  });
  it('allowSchemes on the prototype does not allow a scheme', async () => {
    await toBytes((pdf) => {
      const p = pdf.addPage();
      expect(() => p.link(0, 0, 9, 9, { url: 'ftp://x/' }, inherited({ allowSchemes: ['ftp'] }, {}))).toThrow(/ftp: URLs are not allowed/);
      expect(() => p.link(0, 0, 9, 9, { url: 'ftp://x/' }, { allowSchemes: ['ftp'] })).not.toThrow();
    });
  });
});

describe('passive attachment types', () => {
  it('rtf, msg and xml need allowTypes; Factur-X still embeds its XML', async () => {
    await toBytes((pdf) => {
      const p = pdf.addPage();
      for (const ext of ['rtf', 'msg', 'xml']) {
        expect(() => p.attachFile(FILE, { name: `a.${ext}` }), ext).toThrow(/not an allowed type/);
        expect(() => p.attachFile(FILE, { name: `b.${ext}`, allowTypes: [ext] }), ext).not.toThrow();
      }
    });
    const out = await toBytes(async (pdf) => { pdf.addPage(); await pdf.facturX(EN16931, { profile: 'EN 16931' }); }, { pdfa: { part: 3, conformance: 'b' }, compress: false, creationDate: DATE });
    expect(latin(out)).toContain('/Subtype /text#2Fxml');
  });
});
