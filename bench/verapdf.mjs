#!/usr/bin/env node
// veraPDF on each library's output: the invoice and the 1,000-row table, made with --pdfa (validated as PDF/A-2b) and
// with --ua (validated as PDF/UA-1). A library without such an option writes its ordinary file, which is validated
// all the same. Writes out/verapdf.json. VERAPDF=/path/to/verapdf (default: verapdf on PATH; CI wraps the Docker image).
//   node verapdf.mjs [--libs=a,b] [--rows=1000]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = import.meta.dirname;
const vera = process.env.VERAPDF || 'verapdf';
const ROWS = Number(process.argv.find(a => a.startsWith('--rows='))?.slice(7) || 1000);
const libs = (process.argv.find(a => a.startsWith('--libs='))?.slice(7) || 'reportwright,pdfmake,react-pdf,pdfkit,puppeteer').split(',');
// what each library is given for each check; "none" = it has no such option
const OPTION = {
  reportwright: { '2b': 'pdfa: true', ua1: "tagged: { lang: 'en-US' }" },
  pdfmake: { '2b': "subset: 'PDF/A-2b', version: '1.7'", ua1: "subset: 'PDF/UA', tagged: true, language (no structure-tree API)" },
  'react-pdf': { '2b': 'none (no PDF/A option)', ua1: 'none (no tagging option)' },
  pdfkit: { '2b': "subset: 'PDF/A-2b', pdfVersion: '1.7'", ua1: "subset: 'PDF/UA', tagged: true, doc.struct() per cell by hand" },
  puppeteer: { '2b': 'none (Chrome has no PDF/A output)', ua1: 'tagged: true' },
};
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rw-vera-'));
let version = 'unknown';
try { version = execFileSync(vera, ['--version'], { encoding: 'utf8' }).trim().split('\n')[0]; } catch (e) { version = String(e.stdout || e.message).trim().split('\n')[0]; }

const checks = [];
for (const lib of libs) {
  for (const [workload, rows] of [['invoice', 0], ['table', ROWS]]) {
    for (const [flag, flavour] of [['--pdfa', '2b'], ['--ua', 'ua1']]) {
      const pdf = path.join(dir, `${lib}-${workload}-${flavour}.pdf`);
      const check = { lib, workload, rows, flavour, option: OPTION[lib][flavour] };
      try {
        execFileSync(process.execPath, [path.join(here, 'child.mjs'), lib, workload, String(rows), pdf, flag], { cwd: here, stdio: ['ignore', 'ignore', 'pipe'] });
      } catch (e) { checks.push({ ...check, compliant: null, note: `the library failed: ${String(e.stderr || e.message).trim().split('\n').pop()}` }); continue; }
      let xml;
      try { xml = execFileSync(vera, ['--flavour', flavour, '--format', 'xml', pdf], { encoding: 'utf8', maxBuffer: 256 << 20 }); }
      catch (e) { xml = String(e.stdout || ''); } // veraPDF exits non-zero for a non-compliant file
      if (!/isCompliant=/.test(xml)) { checks.push({ ...check, compliant: null, note: `veraPDF gave no verdict: ${xml.slice(0, 200)}` }); continue; }
      const failed = [...xml.matchAll(/<rule [^>]*clause="([^"]+)"[^>]*testNumber="(\d+)"[^>]*status="failed"[^>]*failedChecks="(\d+)"[^>]*>\s*<description>([^<]*)/g)]
        .map(m => ({ rule: `${m[1]}-${m[2]}`, checks: Number(m[3]), description: m[4].trim() }));
      checks.push({ ...check, compliant: /isCompliant="true"/.test(xml), failedRules: failed.length, failed: failed.slice(0, 5) });
      console.error(`${checks.at(-1).compliant ? 'PASS' : 'FAIL'} ${flavour.padEnd(3)} ${lib} ${workload}${failed.length ? ` (${failed.length} rules failed)` : ''}`);
    }
  }
}
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out/verapdf.json'), JSON.stringify({ tool: version, checks }, null, 1) + '\n');
