// Exports batch 2 in the viewer: the Export options menu (accessible PDF, PDF/A, Excel formulas, kind of HTML file),
// PowerPoint, Word with pictures, Excel with live totals, and the HTML Tables view working offline.
//   BASE=http://localhost:3000 node tests/e2e/exports-b2.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
// the formats are in the viewer's Export menu: open it first
const openExport = async (pg) => { if (!(await pg.getByTestId('export-pdf').isVisible())) await pg.getByTestId('export-menu').click(); };

const BASE = process.env.BASE || 'http://localhost:3000';
const step = (s) => console.log('·', s);
fs.mkdirSync('/tmp/shots', { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const logs = [];
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
const ready = async () => {
  await p.waitForSelector('.vpage svg', { timeout: 60000 });
  await p.waitForFunction(() => !document.querySelector('.stat[title*="still rendering"]'));
};
const download = async (testid) => {
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), openExport(p).then(() => p.getByTestId(testid).click())]).catch(async (e) => {
    await p.screenshot({ path: `/tmp/shots/exports-b2-${testid}-fail.png` }); // what the viewer shows instead (CI artifact)
    console.log('no download:', testid, 'page errors:', errs, 'console:', logs);
    throw e;
  });
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
};

await p.goto(`${BASE}/viewer/charts-showcase`);
await ready();

step('the toolbar has PowerPoint and Export options; the menu shows the four options');
const ids = await p.$$eval('[data-toolbar-id]', ns => ns.map(n => n.dataset.toolbarId));
assert.ok(ids.includes('powerpoint') && ids.includes('exportOptions'), ids.join());
await p.getByTestId('export-options').click();
for (const t of ['opt-pdfua', 'opt-pdfa', 'opt-formulas', 'opt-html']) assert.ok(await p.getByTestId(t).isVisible(), t);
assert.equal(await p.getByTestId('opt-formulas').isChecked(), true, 'formulas on by default');
await p.screenshot({ path: '/tmp/shots/exports-b2-options.png' });

step('accessible PDF: the downloaded file has a structure tree, MarkInfo and the PDF/UA identifier');
await p.getByTestId('opt-pdfua').check();
await p.keyboard.press('Escape');
let f = await download('export-pdf');
let doc = await PDFDocument.load(f.bytes);
assert.ok(doc.catalog.has(PDFName.of('StructTreeRoot')), f.name);
assert.match(doc.catalog.lookup(PDFName.of('MarkInfo')).toString(), /\/Marked true/);
assert.match(Buffer.from(doc.catalog.lookup(PDFName.of('Metadata'), PDFRawStream).contents).toString(), /pdfuaid:part>1</);

step('the option is remembered after a reload; off again gives a plain PDF');
await p.reload();
await ready();
await p.getByTestId('export-options').click();
assert.equal(await p.getByTestId('opt-pdfua').isChecked(), true);
await p.getByTestId('opt-pdfua').uncheck();
await p.keyboard.press('Escape');
f = await download('export-pdf');
doc = await PDFDocument.load(f.bytes);
assert.ok(!doc.catalog.has(PDFName.of('StructTreeRoot')), 'plain PDF has no structure tree');

step('PowerPoint: one slide per page, text editable, charts as pictures');
f = await download('export-pptx');
assert.match(f.name, /\.pptx$/);
let z = unzipSync(f.bytes);
const slides = Object.keys(z).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k));
assert.equal(slides.length, 2);
assert.match(strFromU8(z['ppt/slides/slide1.xml']), /<a:t>Charts showcase<\/a:t>/);
assert.ok(Object.keys(z).some(k => k.startsWith('ppt/media/') && k.endsWith('.png')), 'chart pictures (PNG from the browser canvas)');

step('Word: charts as pictures with SVG and PNG');
f = await download('export-docx');
z = unzipSync(f.bytes);
const media = Object.keys(z).filter(k => k.startsWith('word/media/'));
assert.ok(media.some(k => k.endsWith('.png')) && media.some(k => k.endsWith('.svg')), media.join());

step('Excel: opens, with a Charts sheet of pictures');
f = await download('export-xlsx');
z = unzipSync(f.bytes);
assert.ok(Object.keys(z).some(k => k.startsWith('xl/media/')), 'pictures in the workbook');

step('HTML "pages and sortable tables": the Tables view works offline from the file');
await p.getByTestId('export-options').click();
await p.getByTestId('opt-html').selectOption('tables');
await p.keyboard.press('Escape');
f = await download('export-html');
const file = '/tmp/shots/exports-b2.html';
fs.writeFileSync(file, f.bytes);
const off = await ctx.newPage();
const offErrs = [];
off.on('pageerror', e => offErrs.push(e.message));
off.on('console', m => { if (m.type() === 'error') offErrs.push(m.text()); });
await off.route('**/*', r => (r.request().url().startsWith('file:') || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
await off.goto(`file://${file}`);
await off.getByRole('button', { name: 'Tables' }).click();
await off.waitForSelector('#pw-tables table');
assert.ok(await off.locator('#pw-tables tbody tr').count() > 0);
await off.screenshot({ path: '/tmp/shots/exports-b2-html-tables.png', fullPage: true });
assert.deepEqual(offErrs, [], 'no CSP or script errors in the file');

assert.deepEqual(errs, []);
await b.close();
console.log('exports-b2 e2e: OK');
