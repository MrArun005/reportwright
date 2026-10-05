#!/usr/bin/env node
// Validates the PDF/A-2b and PDF/UA-1 output of the showcase reports with veraPDF (https://verapdf.org; brew install
// verapdf, or the Java CLI). Renders each with bin/pw.mjs (--pdfa, --ua), runs `verapdf --flavour 2b|ua1`, prints one
// line per file and the failed rules, exits 1 when any file fails. VERAPDF=/path/to/verapdf to pick the binary.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const vera = process.env.VERAPDF || 'verapdf';
const REPORTS = (process.argv[2] ? process.argv.slice(2) : ['charts-showcase', 'invoice-gallery', 'platform-showcase', 'expressions-showcase', 'tablix-showcase', 'richtext-showcase', 'reuse-showcase']);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-vera-'));
let failed = 0;
for (const id of REPORTS) {
  for (const [flag, flavour] of [['--pdfa', '2b'], ['--ua', 'ua1']]) {
    const pdf = path.join(out, `${id}-${flavour}.pdf`);
    execFileSync(process.execPath, [path.join(root, 'bin/pw.mjs'), 'render', path.join(root, 'reports', `${id}.pw.json`), '-f', 'pdf', flag, '-o', pdf], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    let xml;
    try { xml = execFileSync(vera, ['--flavour', flavour, '--format', 'xml', pdf], { encoding: 'utf8', maxBuffer: 64 << 20 }); }
    catch (e) { xml = String(/** @type {any} */ (e).stdout || ''); if (!xml) throw e; } // veraPDF exits non-zero on a non-compliant file
    const ok = /isCompliant="true"/.test(xml);
    const rules = [...xml.matchAll(/<rule [^>]*clause="([^"]+)"[^>]*testNumber="(\d+)"[^>]*status="failed"[^>]*failedChecks="(\d+)"[^>]*>\s*<description>([^<]*)/g)].map(m => `    ${m[1]}-${m[2]} (${m[3]}x): ${m[4].trim()}`);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${flavour.padEnd(3)} ${id}`);
    if (!ok) { failed++; console.log(rules.join('\n') || xml.slice(0, 500)); }
  }
}
fs.rmSync(out, { recursive: true, force: true });
console.log(failed ? `${failed} file(s) failed` : 'all compliant');
process.exit(failed ? 1 : 0);
