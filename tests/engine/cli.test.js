// The pw command line (ROADMAP week 9): render, test and diff with no server.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..', '..');
const PW = path.join(ROOT, 'bin', 'pw.mjs');
const run = (args, cwd = ROOT) => {
  const r = spawnSync(process.execPath, [PW, ...args], { cwd, encoding: 'utf8', env: { ...process.env, TZ: 'Asia/Kolkata' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const DATA = 'reports/__tests__/loan-statement.data.json';

describe('pw render', () => {
  it('renders a report to text with pushed data', () => {
    const r = run(['render', 'reports/loan-statement.pw.json', '-d', `loans=${DATA}`, '-p', 'accountId=LN-2026-004417', '-f', 'txt', '-o', '-']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('LOAN STATEMENT');
    expect(r.out).toMatch(/Page 1 of 8/);
  });
  it('writes a PDF (and PDF/A)', () => {
    const out = path.join(tmp, 'x.pdf');
    const r = run(['render', 'reports/loan-statement.pw.json', '-d', `loans=${DATA}`, '-p', 'accountId=LN-2026-004417', '--pdfa', '-o', out]);
    expect(r.code).toBe(0);
    const pdf = fs.readFileSync(out);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('pdfaid:part>2');
  });
  it('explains a relative data URL it cannot load', () => {
    const r = run(['render', 'reports/loan-statement.pw.json', '-p', 'accountId=LN-2026-004417', '-f', 'txt', '-o', '-']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--base|-d loans=/);
  });
});

describe('pw test', () => {
  it('passes when every page matches its snapshot', () => {
    const r = run(['test', 'reports']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1 passed/);
  });

  it('fails when the statement total changes, and shows the lines', () => {
    // a copy of the reports folder with one instalment amount changed
    const dir = path.join(tmp, 'reports');
    fs.cpSync(path.join(ROOT, 'reports'), dir, { recursive: true });
    const file = path.join(dir, '__tests__', 'loan-statement.data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.schedule[0].principal += 1000;
    fs.writeFileSync(file, JSON.stringify(data));
    const r = run(['test', dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/loan-statement › home-loan: page \d+ changed/);
    expect(r.out).toMatch(/^- .*\d/m);
    expect(r.out).toMatch(/^\+ .*\d/m);
    // --update accepts the change
    expect(run(['test', dir, '--update']).code).toBe(0);
    expect(run(['test', dir]).code).toBe(0);
  });
});

describe('pw diff', () => {
  it('says when two versions render the same', () => {
    const r = run(['diff', 'reports/loan-statement.pw.json', 'reports/loan-statement.pw.json', '-d', `loans=${DATA}`, '-p', 'accountId=LN-2026-004417']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/No differences/);
  });
  it('shows what changed on the page', () => {
    const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'loan-statement.pw.json'), 'utf8'));
    def.sections.pageHeader.items.find(i => i.value === 'LOAN STATEMENT').value = 'LOAN ACCOUNT STATEMENT';
    const changed = path.join(tmp, 'changed.pw.json');
    fs.writeFileSync(changed, JSON.stringify(def));
    const r = run(['diff', 'reports/loan-statement.pw.json', changed, '-d', `loans=${DATA}`, '-p', 'accountId=LN-2026-004417']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('- LOAN STATEMENT');
    expect(r.out).toContain('+ LOAN ACCOUNT STATEMENT');
  });
});

it('unknown commands print the help', () => {
  const r = run(['frobnicate']);
  expect(r.code).toBe(2);
  expect(r.err).toMatch(/pw render/);
});
