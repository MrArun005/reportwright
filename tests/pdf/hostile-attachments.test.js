// Hostile attachment names (core/filename.js): names that display or save as something else (bidi, zero-width, NTFS
// streams, dot look-alikes), Windows device names, types outside the passive allowlist, double extensions, a MIME type that contradicts the extension, a huge name. Each throws a clear error in under 1 s;
// a valid Unicode name round-trips in /UF with an ASCII /F.
import { describe, it, expect } from 'vitest';
import { PDFName, PDFDict } from 'pdf-lib';
import { createPdf, toBytes } from '../../packages/pdf/src/index.js';
import { HAS, run, save } from './tools.js';
import { load, annots, get, bytesOf } from './nav-tools.js';

const FILE = new TextEncoder().encode('%PDF-1.7 not really\n');
const page = () => createPdf({ write() {} }).addPage();
const refused = (name, o, re) => {
  const t = performance.now();
  expect(() => page().attachFile(FILE, { name, ...o })).toThrow(re);
  expect(performance.now() - t).toBeLessThan(1000);
};

describe('hostile attachment names', () => {
  it('bidi, zero-width, format and C1 characters and lone surrogates are refused', () => {
    refused('invoice‮fdp.exe', {}, /control, format, bidi or Windows-invalid character \(U\+202E\)/);
    refused('invoice⁧fdp.pdf', {}, /U\+2067/);
    refused('repo​rt.pdf', {}, /U\+200B/);
    refused('﻿report.pdf', {}, /U\+FEFF/);
    refused('re­port.pdf', {}, /U\+00AD/);
    refused('re\u0085port.pdf', {}, /U\+0085/);
    refused('re port.pdf', {}, /U\+2028/);
    refused('re\uD800port.pdf', {}, /U\+D800/);
    refused('a؜b.pdf', {}, /U\+061C/);
  });

  it('trailing dots and spaces are trimmed (and an empty result refused); device names are refused', async () => {
    refused(' . . ', {}, /file name is empty/);
    refused('CON.txt', {}, /Windows device name/);
    refused('nul', {}, /Windows device name/);
    refused('lpt9.tar.gz', {}, /Windows device name/);
    refused('Com1 .pdf', {}, /Windows device name/);
    const out = await toBytes((pdf) => { pdf.addPage().attachFile(FILE, { name: 'report.pdf .', mimeType: 'application/pdf' }); }, { creationDate: new Date(0) });
    const fs = annots(await load(out))[0].lookup(PDFName.of('FS'), PDFDict);
    expect(get(fs, 'UF')).toBe('report.pdf');
  });

  it('only passive types are allowed by default; others need allowTypes; inner extensions must be allowed too', async () => {
    refused('setup.exe', {}, /\.exe is not an allowed type.*allowTypes: \['exe'\]/);
    refused('notes.docm', {}, /\.docm is not an allowed type/);
    refused('x.scpt', {}, /\.scpt is not an allowed type/);
    refused('archive.zip', {}, /\.zip is not an allowed type.*zip with allowArchives/);
    refused('report', {}, /a name without an extension is not an allowed type/);
    refused('invoice.pdf.scr', {}, /\.scr is not an allowed type/);
    refused('invoice.scr.pdf', {}, /inner extension \.scr/);
    refused('report.docx.js', {}, /\.js is not an allowed type/);
    refused('a.exe', { allowTypes: ['.exe'] }, /is not an extension/);
    const ok = async (name, o = {}) => get(annots(await load(await toBytes((pdf) => { pdf.addPage().attachFile(FILE, { name, ...o }); }, { creationDate: new Date(0) })))[0].lookup(PDFName.of('FS'), PDFDict), 'UF');
    expect(await ok('tool.exe', { allowTypes: ['exe'] })).toBe('tool.exe');
    expect(await ok('photo.JPG')).toBe('photo.JPG');
    expect(await ok('data.csv', { mimeType: 'text/csv' })).toBe('data.csv');
    expect(await ok('Q3 report 2026.10.pdf')).toBe('Q3 report 2026.10.pdf'); // numeric and spaced parts are not extensions
    expect(await ok('bundle.zip', { allowArchives: true })).toBe('bundle.zip');
  });

  it('NTFS streams, Windows-invalid characters, dot look-alikes, hidden files and byte length are refused', () => {
    refused('x.exe::$DATA', {}, /Windows-invalid character \(U\+003A\)/);
    refused('report.pdf:evil.exe', {}, /U\+003A/);
    for (const c of '<>"|?*') refused(`a${c}b.pdf`, {}, /Windows-invalid/);
    refused('invoice\uFF0Eexe', {}, /looks like a dot \(U\+FF0E\)/);
    refused('a\u2024exe', {}, /looks like a dot \(U\+2024\)/);
    refused('a\u3002exe.pdf', {}, /U\+3002/);
    refused('a\uFE52exe.pdf', {}, /U\+FE52/);
    refused('a\u0701exe.pdf', {}, /U\+0701/);
    refused('.bashrc', {}, /starts with a dot/);
    refused('.pdf', {}, /starts with a dot/);
    refused(`${'ä'.repeat(126)}.pdf`, {}, /at most 255 bytes/); // 256 UTF-8 bytes
    refused('report.ex\u00e9', { allowTypes: ['exe'] }, /not an allowed type/); // its ASCII /F form would read report.ex_
  });

  it('a MIME type must agree with the extension; a 1 MB name is refused', () => {
    refused('photo.png', { mimeType: 'application/pdf' }, /MIME type application\/pdf does not match the extension \.png/);
    refused('notes.pdf', { mimeType: 'text/plain' }, /does not match/);
    refused('logo.jpg', { mimeType: 'image/png' }, /does not match/);
    refused('data', { mimeType: 'text/csv', allowTypes: ['bin'] }, /without an extension/);
    refused('a'.repeat(1 << 20), {}, /at most 255 bytes/);
    refused('a'.repeat(300) + '.pdf', {}, /at most 255 bytes/);
  });

  it('a valid Unicode name round-trips in /UF; /F is ASCII with "_" for the rest', async () => {
    const out = await toBytes((pdf) => { pdf.addPage().attachFile(FILE, { name: 'Rechnung März.pdf', mimeType: 'application/pdf', description: 'Desc (with) <delims> /JS' }); }, { creationDate: new Date(0), compress: false });
    const fs = annots(await load(out))[0].lookup(PDFName.of('FS'), PDFDict);
    expect(get(fs, 'UF')).toBe('Rechnung März.pdf'); // NFC: one ä
    expect(bytesOf(fs.get(PDFName.of('F'))).toString('latin1')).toBe('Rechnung M_rz.pdf');
    expect(get(fs, 'Desc')).toBe('Desc (with) <delims> /JS');
    expect(Buffer.from(out).toString('latin1')).not.toMatch(/\/JS\b|\/JavaScript/);
    if (HAS.poppler) expect(run('pdfdetach', ['-list', save(out)])).toMatch(/1: Rechnung März\.pdf/);
  });
});
