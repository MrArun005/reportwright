// E09: pw import reads the file's own encoding (XML declaration, UTF-16/UTF-8 BOM), refuses a compiled .jasper with a
// clear message, and prints each error once.
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeXml } from '../../src/importers/index.js';

const root = path.join(import.meta.dirname, '..', '..');
const jrxml = (enc) => `<?xml version="1.0" encoding="${enc}"?>\n<jasperReport name="Gruss"><title><band height="20"><staticText><reportElement x="0" y="0" width="200" height="20"/><text><![CDATA[Straße Grüße]]></text></staticText></band></title></jasperReport>`;
const latin1 = (s) => Uint8Array.from(s, c => c.charCodeAt(0));
const utf16 = (s, be) => { const b = Buffer.from(s, 'utf16le'); if (be) b.swap16(); return Buffer.concat([Buffer.from(be ? [0xfe, 0xff] : [0xff, 0xfe]), b]); };

describe('decodeXml', () => {
  for (const enc of ['ISO-8859-1', 'latin1', 'windows-1252']) it(`honours encoding="${enc}"`, () => expect(decodeXml(latin1(jrxml(enc)))).toContain('Straße Grüße'));
  it('UTF-16 LE and BE with a BOM', () => {
    expect(decodeXml(utf16(jrxml('UTF-16'), false))).toContain('Straße Grüße');
    expect(decodeXml(utf16(jrxml('UTF-16'), true))).toContain('Straße Grüße');
  });
  it('UTF-8, with or without a BOM (the BOM is dropped)', () => {
    const t = decodeXml(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(jrxml('UTF-8'))]));
    expect(t.startsWith('<?xml')).toBe(true);
    expect(t).toContain('Straße Grüße');
    expect(decodeXml(Buffer.from(jrxml('UTF-8')))).toContain('Straße Grüße');
  });
  it('a compiled .jasper file (Java serialization) says to import the .jrxml', () => {
    expect(() => decodeXml(Buffer.from([0xac, 0xed, 0, 5, 0x73, 0x72]))).toThrow('This is a compiled JasperReports file; import the .jrxml source instead.');
  });
});

describe('pw import', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-e09-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const pw = (...a) => { try { return { out: execFileSync(process.execPath, ['bin/pw.mjs', 'import', ...a], { cwd: root, encoding: 'utf8', stdio: 'pipe' }), err: '', code: 0 }; } catch (e) { return { out: e.stdout, err: e.stderr, code: e.status }; } };
  it('keeps ß and ü of an ISO-8859-1 file', () => {
    fs.writeFileSync(path.join(tmp, 'l1.jrxml'), latin1(jrxml('ISO-8859-1')));
    const r = pw(path.join(tmp, 'l1.jrxml'), '-o', '-');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Straße Grüße');
  });
  it('a .jasper file: the clear message, once', () => {
    fs.writeFileSync(path.join(tmp, 'r.jasper'), Buffer.from([0xac, 0xed, 0, 5, 0x73, 0x72, 0, 0x28]));
    const r = pw(path.join(tmp, 'r.jasper'), '-o', '-');
    expect(r.code).toBe(1);
    expect(r.err.trim()).toBe('pw: This is a compiled JasperReports file; import the .jrxml source instead.');
  });
  it('an XML error is printed exactly once', () => {
    fs.writeFileSync(path.join(tmp, 'bad.jrxml'), '<?xml version="1.0"?>\n<jasperReport name="x"><title><bogus');
    const r = pw(path.join(tmp, 'bad.jrxml'), '-o', '-');
    expect(r.code).toBe(1);
    const lines = r.err.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^pw: The file is not readable XML: .*, so the report is empty\.$/);
  });
});
