// Runs the ReportWright snippet shown on site/switch.html against the real engine and checks the result.
// The snippet is imported from site/switch/snippets.js, so what the page shows is what runs here.
// Two substitutions, both for running inside this repo: the engine import points at packages/engine/entry.js,
// and defaultFontStore() gets { fontsUrl } because @reportwright/fonts is not installed in the worktree.
// The pdfmake / react-pdf / Puppeteer / PDFKit snippets are NOT run (those libraries are not installed here).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { RW_CODE, INVOICE_REPORT } from '../site/switch/snippets.js';

const root = path.join(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-check-'));
const code = RW_CODE
  .replace("'@reportwright/engine'", JSON.stringify(pathToFileURL(path.join(root, 'packages/engine/entry.js')).href))
  .replace('defaultFontStore()', `defaultFontStore({ fontsUrl: ${JSON.stringify(path.join(root, 'public/fonts'))} })`)
  + '\nexport { model };\n';
const file = path.join(dir, 'snippet.mjs');
fs.writeFileSync(file, code);
process.chdir(dir);
const { model } = await import(pathToFileURL(file).href);

const pdf = fs.readFileSync(path.join(dir, 'invoice.pdf'));
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
assert.equal(model.pages.length, 1, 'the invoice is one page');
const text = JSON.stringify(model);
for (const s of ['Invoice INV-1001', 'Bill to: Asha Traders', 'Steel bracket', 'Copper wire', '2,432.00']) assert.ok(text.includes(s), `page model has "${s}"`);

// the definition validates with no errors
const { validate } = await import(pathToFileURL(path.join(root, 'packages/engine/entry.js')).href);
const v = validate(INVOICE_REPORT);
assert.deepEqual(v.errors, [], 'validate() finds no errors');
console.log(`ok: ${model.pages.length} page, ${pdf.length} byte PDF, total 2,432.00, ${v.warnings.length} validate warnings`);
fs.rmSync(dir, { recursive: true, force: true });
