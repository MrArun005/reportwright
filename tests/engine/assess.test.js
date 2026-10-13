// pw assess: the corpus counts, the status / tier / usage rules, the no-write guarantee and the hostile-folder bounds.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assessFolder,
  buildAssessment,
  categorize,
  reportStatus,
  tierOf,
  parseUsage,
  parseHours,
  csvRows,
  reportKey,
} from '../../src/cli/assess.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const fixture = (p) => path.join(ROOT, 'tests/fixtures', p);
const rec = (over = {}) => ({
  source: 'a.rdl',
  format: 'SSRS',
  status: 'imported',
  stats: { items: 1, mapped: 1, approximated: 0, dropped: 0 },
  items: [],
  expressions: [],
  notes: [],
  references: [],
  sources: [],
  ...over,
});

describe('corpus (the repo fixtures)', () => {
  it('SSRS corpus: every report imports, a report-level count per status', async () => {
    const a = await assessFolder(fixture('rdl/corpus'));
    expect(a.summary.reports).toBe(32);
    expect(a.summary.failed).toBe(0);
    expect(a.summary.full + a.summary.small + a.summary.manual).toBe(32);
    expect(a.summary.readiness).toBe(Math.round(((a.summary.full + a.summary.small) / 32) * 100));
  }, 30000);

  it('JasperReports corpus: 49 reports, none failed, the usual untranslated functions', async () => {
    const a = await assessFolder(fixture('jrxml/corpus'));
    expect(a.summary.reports).toBe(49);
    expect(a.summary.failed).toBe(0);
    expect(a.blockers.some((b) => b.category === 'Fonts not bundled')).toBe(true);
  }, 30000);

  it('BIRT and ActiveReports corpora import', async () => {
    expect((await assessFolder(fixture('birt/corpus'))).summary.reports).toBe(29);
    expect((await assessFolder(fixture('rdlx'))).summary.reports).toBe(3);
  }, 30000);
});

describe('rules', () => {
  it('a clean report is full; dropped or untranslated is manual; approximated is small; a parse error is failed', () => {
    expect(reportStatus(rec()).status).toBe('full');
    expect(reportStatus(rec({ stats: { items: 2, mapped: 1, approximated: 0, dropped: 1 } })).status).toBe('manual');
    expect(reportStatus(rec({ expressions: [{ item: 'x', expression: 'f(1)' }] })).status).toBe('manual');
    expect(reportStatus(rec({ stats: { items: 2, mapped: 1, approximated: 1, dropped: 0 } })).status).toBe('small');
    expect(reportStatus(rec({ status: 'failed', error: 'bad xml' })).status).toBe('failed');
  });

  it('a configuration note (PW_DB) is not a fix', () => {
    expect(
      reportStatus(rec({ notes: ['Data source "Sales" is a SQL database: set PW_DB_SALES=<connection URL>'] })).status,
    ).toBe('full');
  });

  it('tiers: retire needs usage with no run in the window; otherwise by effort', () => {
    const now = Date.parse('2026-10-13');
    const old = { runs: 3, lastRun: new Date(now - 400 * 864e5) };
    expect(tierOf('full', 'Low', { runs: 0, lastRun: null }, 180, now)).toBe('Retire');
    expect(tierOf('full', 'Low', old, 180, now)).toBe('Retire');
    expect(tierOf('full', 'Low', { runs: 5, lastRun: new Date(now - 10 * 864e5) }, 180, now)).toBe('Simple');
    expect(tierOf('full', 'Low', null, 180, now)).toBe('Simple');
    expect(tierOf('small', 'Medium', null, 180, now)).toBe('Medium');
    expect(tierOf('manual', 'High', null, 180, now)).toBe('Complex');
    expect(tierOf('failed', 'High', null, 180, now)).toBe('Complex');
  });

  it('usage: the SSRS ExecutionLog3 export and a generic table join by file name', () => {
    const ssrs =
      'ItemPath,TimeStart,UserName,Format,Status\n"/Sales/Order Detail",2026-10-01 09:00:00,ann,PDF,rsSuccess\n"/Sales/Order Detail",2026-10-05 09:00:00,ann,PDF,rsSuccess\n';
    const m = parseUsage(ssrs, 'log.csv');
    expect(m.get('order detail').runs).toBe(2);
    expect(m.get('order detail').lastRun.toISOString().slice(0, 10)).toBe('2026-10-05');
    const generic = parseUsage('report,runs,last run date\nOrder Detail.rdl,7,2026-09-30\n', 'u.csv');
    expect(generic.get('order detail').runs).toBe(7);
    expect(parseUsage('[{"name":"Old.jrxml","runs":0,"lastRun":"2024-01-01"}]', 'u.json').get('old').runs).toBe(0);
    expect(csvRows('a,b\n"x, y","say ""hi"""\n')[0]).toEqual({ a: 'x, y', b: 'say "hi"' });
    expect(reportKey('C:\\reports\\Sales.rdlc')).toBe('sales');
  });

  it('hours: defaults, overrides, and bad input refused', () => {
    expect(parseHours('')).toEqual({ simple: 0.25, medium: 2, complex: 8 });
    expect(parseHours('complex=12, simple=0')).toEqual({ simple: 0, medium: 2, complex: 12 });
    expect(() => parseHours('huge=3')).toThrow();
    expect(() => parseHours('simple=-1')).toThrow();
  });

  it('categories: config is not a blocker; unknown notes are Other', () => {
    expect(categorize('set PW_DB_SALES=<url>').config).toBe(true);
    expect(categorize('something nobody wrote').category).toBe('Other');
    expect(categorize('the font "Lobster" is not bundled with ReportWright').category).toBe('Fonts not bundled');
  });

  it('expressions group by the functions they call', () => {
    const a = buildAssessment(
      {
        files: [
          rec({
            expressions: [
              { item: 'a', expression: 'DATEFORMAT(TODAY(), "x")' },
              { item: 'b', expression: 'TODAY()+1' },
            ],
          }),
        ],
        refused: [],
      },
      { now: Date.parse('2026-10-13') },
    );
    expect(a.expressionsUntranslated.find((e) => e.pattern === 'TODAY').count).toBe(2);
    expect(a.expressionsUntranslated.find((e) => e.pattern === 'DATEFORMAT').count).toBe(1);
  });
});

describe('no writes and hostile folders', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pw-assess-test-'));

  it('assessing writes nothing into the folder', async () => {
    const dir = tmp();
    fs.copyFileSync(fixture('rdl/kitchen-sink.rdl'), path.join(dir, 'k.rdl'));
    const before = fs.readdirSync(dir).sort();
    const a = await assessFolder(dir);
    expect(a.summary.reports).toBe(1);
    expect(fs.readdirSync(dir).sort()).toEqual(before);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('more than maxFiles files: the rest are refused, not read', async () => {
    const dir = tmp();
    for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(dir, `r${i}.rdl`), '<Report/>');
    const a = await assessFolder(dir);
    expect(a.summary.reports).toBeLessThanOrEqual(500);
    expect(a.refused.some((r) => /more than 500 files/.test(r.reason))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000);

  it('a huge file is refused by size and reported as failed, not loaded', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'big.rdl'), 'x'.repeat(9 * 1024 * 1024));
    const a = await assessFolder(dir);
    expect(a.summary.failed).toBe(1);
    expect(a.reports[0].issues.join(' ')).toMatch(/larger than/);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000);

  it('the total size cap refuses files past it', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.rdl'), 'x'.repeat(600));
    fs.writeFileSync(path.join(dir, 'b.rdl'), 'x'.repeat(600));
    const a = await assessFolder(dir, { maxTotal: 1000 });
    expect(a.refused.some((r) => /add up to more than 1000 bytes/.test(r.reason))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('POST /api/reports/assess', () => {
  it('multipart files and a zip answer the assessment; nothing else; a non-multipart body is refused', async () => {
    const route = await import('../../app/api/reports/assess/route.js');
    const { zipSync, strToU8 } = await import('fflate');
    const fd = new FormData();
    fd.append('files', new File([fs.readFileSync(fixture('rdl/kitchen-sink.rdl'))], 'kitchen-sink.rdl'));
    const zip = zipSync({ 'nested/x.jrxml': strToU8('<jasperReport/>'), 'readme.txt': strToU8('not a report') });
    fd.append('files', new File([zip], 'batch.zip'));
    const res = await route.POST(new Request('http://localhost/api/reports/assess', { method: 'POST', body: fd }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.reports).toBe(2);
    expect(body.reports.map((r) => r.file).sort()).toEqual(['kitchen-sink.rdl', 'x.jrxml']);
    const bad = await route.POST(
      new Request('http://localhost/api/reports/assess', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(bad.status).toBe(400);
  }, 30000);
});

describe('POST /api/reports/assess: untrusted uploads stay bounded', () => {
  const post = async (body, headers = {}) => (await import('../../app/api/reports/assess/route.js')).POST(
    new Request('http://localhost/api/reports/assess', { method: 'POST', body, headers, duplex: 'half' }));

  it('a zip whose headers understate an entry is refused by the bytes actually inflated', async () => {
    const { zipSync } = await import('fflate');
    const big = new Uint8Array(20 * 1024 * 1024); // 20 MB of zeros: a few KB compressed, over the 8 MB per-file cap
    const zip = zipSync({ 'bomb.rdl': big }, { level: 9 });
    // lie: rewrite every uncompressed-size field (local header +22, central directory +24) to 10 bytes
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i + 4 <= zip.length; i++) {
      const sig = dv.getUint32(i, true);
      if (sig === 0x04034b50) dv.setUint32(i + 22, 10, true);
      if (sig === 0x02014b50) dv.setUint32(i + 24, 10, true);
    }
    const fd = new FormData();
    fd.append('files', new File([zip], 'lying.zip'));
    const res = await post(fd);
    expect([400, 413]).toContain(res.status); // refused either way: damaged sizes or the inflated-bytes cap
    // an honest zip of the same entry is refused by the per-file cap counted while inflating
    const fd2 = new FormData();
    fd2.append('files', new File([zipSync({ 'big.rdl': big }, { level: 9 })], 'honest.zip'));
    const res2 = await post(fd2);
    expect(res2.status).toBe(413);
    expect((await res2.json()).error).toMatch(/larger than/);
  }, 30000);

  it('a body with no content-length is cut off at the cap, not buffered whole', async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream({
      pull(c) { if (sent >= 60) { c.close(); return; } sent++; c.enqueue(chunk); }, // 60 MB offered, generated lazily
    });
    const res = await post(stream, { 'content-type': 'multipart/form-data; boundary=x' });
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(60); // stopped reading once past the cap
  }, 30000);

  it('a usage file over 16 MB is refused', async () => {
    const fd = new FormData();
    fd.append('files', new File(['<Report/>'], 'a.rdl'));
    fd.append('usage', new File([new Uint8Array(17 * 1024 * 1024)], 'usage.csv'));
    const res = await post(fd);
    expect(res.status).toBe(413);
  }, 30000);
});

