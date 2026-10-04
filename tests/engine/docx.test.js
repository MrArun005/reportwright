// Word export (ROADMAP week 12): text as paragraphs in reading order, tables as Word tables.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { render } from '../../src/engine/index.js';
import { exportDocx } from '../../src/exporters/docx.js';
import { sampleLoan } from '../../src/sample/loans.js';
import { fontStore } from '../helpers.js';

const def = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'reports', 'loan-statement.pw.json'), 'utf8'));
const model = () => render(def, { fontStore, sources: { loans: sampleLoan('LN-2025-001982') }, now: new Date('2026-10-03T10:30:00') });
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

describe('Word export', () => {
  it('is a valid package with the document, styles and page size', async () => {
    const m = await model();
    const files = unzipSync(await exportDocx(m, { title: 'Loan statement' }));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']));
    const doc = strFromU8(files['word/document.xml']);
    expect(doc).toMatch(/<w:pgSz w:w="11906" w:h="16838"\/>/); // A4 in twips
    expect(doc).toContain('LOAN STATEMENT');
    expect(doc).toContain('Arjun Mehta');
    expect((doc.match(/<w:pageBreakBefore\/>/g) || []).length).toBe(m.pages.length - 1);
    expect(strFromU8(files['docProps/core.xml'])).toContain('Loan statement');
  });

  it('tables become Word tables, with the header row repeating', async () => {
    const doc = strFromU8(unzipSync(await exportDocx(await model()))['word/document.xml']);
    expect((doc.match(/<w:tbl>/g) || []).length).toBeGreaterThan(0);
    expect(doc).toContain('<w:tblHeader/>');
    // the header keeps its own fill, so white header text stays readable
    const head = doc.split('<w:tr>').find(r => r.includes('<w:tblHeader/>'));
    expect(head).toMatch(/w:fill="(?!FFFFFF|F1F5F9)[0-9A-F]{6}"/);
    expect(head).toContain('Due date');
    // a row of the payment schedule: instalment number and its EMI in the same row
    const row = doc.split('<w:tr>').find(r => r.includes('>1<') && r.includes('Paid'));
    expect(row).toBeTruthy();
    expect(row).toContain("15,217.00"); // its EMI
    expect(row).toContain("10 Mar 2025"); // its due date
  });

  it('escapes text', async () => {
    const m = await model();
    m.pages[0].items.push({ t: 'text', font: 'Inter-Regular', size: 9, color: '#000', lines: [{ x: 40, y: 800, text: 'A & B <c> "d"', w: 50 }] });
    const doc = strFromU8(unzipSync(await exportDocx(m))['word/document.xml']);
    expect(doc).toContain('A &amp; B &lt;c&gt; &quot;d&quot;');
  });

  it.skipIf(!has('textutil'))('macOS textutil reads it back', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-docx-')), 's.docx');
    fs.writeFileSync(file, await exportDocx(await model()));
    const txt = execFileSync('textutil', ['-convert', 'txt', '-stdout', file], { encoding: 'utf8' });
    expect(txt).toContain('LOAN STATEMENT');
    expect(txt).toContain('Arjun Mehta');
  });
});

describe('text styling in Word, Excel and CSV (phase 1)', () => {
  const styled = async () => {
    const { report } = await import('../helpers.js');
    return render(report([
      { type: 'textbox', name: 'U', x: 0, y: 0, w: 200, h: 20, value: 'Underlined', style: { textDecoration: 'underline' } },
      { type: 'textbox', name: 'S', x: 0, y: 30, w: 200, h: 20, value: 'Struck', style: { textDecoration: 'line-through' } },
      { type: 'textbox', name: 'J', x: 0, y: 60, w: 140, h: 120, value: 'The quick brown fox jumps over the lazy dog while the cat watches.', style: { textAlign: 'justify' } },
    ]), { fontStore });
  };
  it('Word keeps underline, strike-through and justify, and a justified box stays one paragraph', async () => {
    const doc = strFromU8(unzipSync(await exportDocx(await styled()))['word/document.xml']);
    const runOf = (text) => doc.split('<w:r>').find(r => r.includes(`>${text}<`));
    expect(runOf('Underlined')).toContain('<w:u w:val="single"/>');
    expect(runOf('Struck')).toContain('<w:strike/>');
    expect(doc).toContain('<w:jc w:val="both"/>');
    expect(doc).toContain('>The quick brown fox jumps over the lazy dog while the cat watches.<');
  });
  it('CSV and Excel text dumps keep a justified line as one line, not one word per row', async () => {
    const { exportCsv } = await import('../../src/exporters/csv.js');
    const csv = exportCsv(await styled()).split('\r\n');
    expect(csv.length).toBeLessThan(8);
    expect(csv.some(l => l.startsWith('The quick'))).toBe(true);
  });
});
