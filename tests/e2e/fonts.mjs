// Fonts and scripts in the browser: upload a font in the designer, use it, preview shows it, the server PDF
// embeds it as a subset; Hindi falls back to the bundled Noto font; the Hindi proof report renders on the server.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';

const BASE = process.env.BASE || 'http://localhost:3000';
const FIX = path.join(import.meta.dirname, '..', 'fixtures', 'fonts');
const step = (s) => console.log('·', s);

/** Embedded font programs of a PDF: [{ name, bytes }] */
async function pdfFonts(buf) {
  const doc = await PDFDocument.load(buf);
  const out = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type'))?.toString() !== '/FontDescriptor') continue;
    const ref = obj.get(PDFName.of('FontFile2')) || obj.get(PDFName.of('FontFile3'));
    out.push({ name: obj.get(PDFName.of('FontName')).toString(), bytes: zlib.inflateSync(Buffer.from(doc.context.lookup(ref).contents)).length });
  }
  return out;
}

// start clean: no fonts from an earlier run with these families
for (const f of await (await fetch(`${BASE}/api/fonts`)).json()) if (['E2E Brand', 'Poppins', 'E2E Plex'].includes(f.family)) await fetch(`${BASE}/api/fonts/${f.id}`, { method: 'DELETE', headers: { origin: BASE } });
await fetch(`${BASE}/api/reports/e2e-fonts`, { method: 'DELETE', headers: { origin: BASE } });

step('the API refuses a file that is not a font');
let r = await fetch(`${BASE}/api/fonts?family=Nope`, { method: 'POST', headers: { origin: BASE }, body: Buffer.from('%PDF-1.7 not a font') });
assert.equal(r.status, 415);
assert.match((await r.json()).error, /not a font file/);

step('the API takes a WOFF2 as the raw body');
r = await fetch(`${BASE}/api/fonts?family=E2E%20Plex`, { method: 'POST', headers: { origin: BASE }, body: fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'fonts', 'ui', 'ibm-plex-sans-latin-400-normal.woff2')) });
assert.equal(r.status, 201);
const plex = await r.json();
assert.equal(plex.family, 'E2E Plex');
r = await fetch(`${BASE}/fonts/custom/${plex.id}`);
assert.equal(r.status, 200);
assert.match(r.headers.get('cache-control'), /immutable/);
assert.equal(Buffer.from(await r.arrayBuffer()).readUInt32BE(0), 0x00010000); // unpacked to TrueType

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));

step('new report; upload a font from the designer');
await p.goto(BASE);
await p.getByLabel('New report name').fill('E2E fonts');
await p.getByRole('button', { name: 'New report' }).click();
await p.waitForURL(/\/designer\/e2e-fonts/);
await p.waitForSelector('[data-testid=paper]');
await p.getByRole('button', { name: 'Upload a font…' }).click();
const dlg = p.getByRole('dialog', { name: 'Fonts' });
await dlg.getByLabel('Font file').setInputFiles(path.join(FIX, 'Poppins-Regular.ttf'));
await dlg.getByLabel('Family').fill('E2E Brand');
await dlg.getByRole('button', { name: 'Upload font' }).click();
await dlg.getByText('Added E2E Brand 400').waitFor();
await dlg.getByText('E2E Brand').first().waitFor();
await dlg.getByRole('button', { name: 'Close' }).click();

step('use it as the report font, with a Hindi title');
await p.locator('[data-testid=inspector] label:has(> span:text-is("Font")) select').first().selectOption('E2E Brand');
await p.locator('[data-item=ReportTitle]').click();
await p.locator('[data-testid=inspector] .expr-row input').first().fill('Brand खाता विवरण क्षत्रिय');
await p.getByTestId('save').click();
await p.getByTestId('save-state').filter({ hasText: 'Saved' }).waitFor();

step('the preview draws it in the uploaded font (and Hindi in it too: Poppins has Devanagari)');
await p.getByTestId('tab-preview').click();
await p.waitForSelector('.vpage svg');
const fonts = await (await fetch(`${BASE}/api/fonts`)).json();
const brand = fonts.find(f => f.family === 'E2E Brand');
await p.waitForFunction((fam) => [...document.querySelectorAll('.vpage text')].some(t => t.getAttribute('font-family') === fam), `pw-u-${brand.id}`);
const loaded = await p.evaluate((fam) => [...document.fonts].filter(f => f.family.replace(/"/g, '') === fam).map(f => f.status), `pw-u-${brand.id}`);
assert.ok(loaded.includes('loaded'), `the font face loaded (${loaded})`);
const runs = await p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
assert.ok(runs.includes('क्षत्रिय'), 'Hindi drawn as shaped runs');
const widths = await p.$$eval('.vpage text', ns => ns.filter(n => n.textContent === 'क्षत्रिय').map(n => n.getComputedTextLength()));
assert.ok(widths[0] > 10, 'the run has width');

step('the server PDF embeds the uploaded font as a small subset');
r = await fetch(`${BASE}/api/reports/e2e-fonts/pdf`);
assert.equal(r.status, 200);
const embedded = await pdfFonts(Buffer.from(await r.arrayBuffer()));
const pop = embedded.find(f => /Poppins/.test(f.name));
assert.ok(pop, `Poppins embedded: ${JSON.stringify(embedded)}`);
assert.ok(pop.bytes < fs.statSync(path.join(FIX, 'Poppins-Regular.ttf')).size / 3, `subset (${pop.bytes} bytes)`);

step('the Hindi proof report renders on the server in the brand font');
for (const [file, weight] of [['Poppins-Regular.ttf', 400], ['Poppins-SemiBold.ttf', 600]]) {
  const form = new FormData();
  form.set('file', new Blob([fs.readFileSync(path.join(FIX, file))]), file);
  form.set('family', 'Poppins');
  form.set('weight', String(weight));
  r = await fetch(`${BASE}/api/fonts`, { method: 'POST', headers: { origin: BASE }, body: form });
  assert.equal(r.status, 201, await r.clone().text());
}
r = await fetch(`${BASE}/api/reports/loan-statement-hindi/pdf`);
assert.equal(r.status, 200);
const proof = await pdfFonts(Buffer.from(await r.arrayBuffer()));
assert.ok(proof.some(f => /Poppins-SemiBold/.test(f.name)) && proof.some(f => /Poppins-Regular/.test(f.name)), JSON.stringify(proof));
assert.ok(proof.some(f => /NotoSansDevanagari/.test(f.name)), 'the Inter line falls back to Noto Sans Devanagari');
await p.goto(`${BASE}/viewer/loan-statement-hindi`);
await p.waitForSelector('.vpage svg text');
await p.waitForFunction(() => [...document.querySelectorAll('.vpage text')].some(t => t.textContent === 'विवरण'));
if (process.env.SHOT) await p.locator('.vpage').first().screenshot({ path: process.env.SHOT });

await b.close();
await fetch(`${BASE}/api/reports/e2e-fonts`, { method: 'DELETE', headers: { origin: BASE } });
for (const f of await (await fetch(`${BASE}/api/fonts`)).json()) if (['E2E Brand', 'E2E Plex'].includes(f.family) || (f.family === 'Poppins' && !process.env.KEEP_FONTS)) await fetch(`${BASE}/api/fonts/${f.id}`, { method: 'DELETE', headers: { origin: BASE } });
assert.deepEqual(errs, []);
console.log('PASS fonts');
