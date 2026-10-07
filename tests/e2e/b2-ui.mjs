// Batch 2: the Designer and viewer upgrade (grouped top bar, rail, status bar, collapsible Inspector, Export menu,
// page thumbnails, contents jump) and the Designer fixes (Inspector scroll and focus, Insert into a container, skip blank).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://localhost:3000';
const H = { 'content-type': 'application/json', origin: BASE };
const step = (s) => console.log('·', s);
const ids = [];
const create = async (definition) => {
  const r = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: H, body: JSON.stringify({ name: definition.name, definition }) });
  const { id } = await r.json();
  ids.push(id);
  return id;
};
const read = async (id) => { const r = await (await fetch(`${BASE}/api/reports/${id}`, { headers: H })).json(); return r.definition || r; };
const tb = (name, y, extra = {}) => ({ type: 'textbox', name, x: 0, y, w: 200, h: 20, value: name, ...extra });

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
try {
  const id = await create({
    $schema: 'pagewright/report@1', name: 'e2e b2 ui', page: { size: 'A4' },
    dataSources: [{ name: 'src', type: 'json', data: { rows: [{ city: 'Pune' }, { city: 'Delhi' }] } }],
    dataSets: [{ name: 'S', source: 'src', path: '$.rows[*]', fields: [{ name: 'city', type: 'string' }], filters: [{ expr: '=Fields.city', op: '=', value: '=Parameters.City' }] }],
    parameters: [{ name: 'City', type: 'string', nullable: true }],
    sections: { body: { height: 400, items: [
      { type: 'toc', name: 'Toc', x: 0, y: 0, w: 400, h: 20, title: 'Contents', source: 'headings' },
      tb('Intro', 40, { headingLevel: 1 }),
      { type: 'container', name: 'Box', x: 0, y: 80, w: 300, h: 60, items: [] },
      tb('Results', 160, { headingLevel: 1, bookmark: 'Results', pageBreakBefore: true }),
      tb('Far', 300, { headingLevel: 1, pageBreakBefore: true }),
    ] } },
  });
  await p.goto(`${BASE}/designer/${id}`);
  await p.waitForSelector('[data-testid=paper]');

  step('the top bar groups File, Insert, Arrange, View and Preview; the rail has Toolbox, Data and Outline; a status bar');
  for (const g of ['File', 'Insert', 'Arrange', 'View', 'Preview']) await p.getByRole('group', { name: g, exact: true }).waitFor();
  for (const r of ['tools', 'data', 'outline']) await p.getByTestId(`rail-${r}`).waitFor();
  await p.getByTestId('rail-outline').click();
  await p.waitForFunction(() => document.querySelector('[data-testid=rail-outline]').getAttribute('aria-current') === 'true');
  assert.match(await p.locator('.dstatus-page').innerText(), /A4 · 595 × 842 pt/);

  step('Insert puts a new item inside the selected container');
  await p.locator('[data-item=Box]').click({ position: { x: 5, y: 5 } });
  assert.match(await p.getByTestId('status-selection').innerText(), /^Box/);
  await p.getByTestId('rail-tools').click();
  await p.locator('[data-tool=textbox]').click();
  await p.keyboard.press('Control+s');
  await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  let def = await read(id);
  const box = def.sections.body.items.find(i => i.name === 'Box');
  assert.equal(box.items.length, 1, 'the text box went into the container');
  assert.equal(box.items[0].type, 'textbox');

  step('the Inspector starts at the top for a new selection, and no field keeps the focus');
  await p.locator('[data-item=Intro]').click({ position: { x: 5, y: 5 } });
  await p.locator('.dright').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await p.locator('.dright input').last().focus();
  await p.locator('[data-item=Results]').click({ position: { x: 5, y: 5 } });
  await p.waitForFunction(() => document.querySelector('.dright').scrollTop === 0);
  assert.equal(await p.evaluate(() => !!document.activeElement?.closest('.dright')), false, 'the focus is not in a stale field');

  step('Inspector sections collapse and expand');
  const head = p.locator('.dright .cat > h5').first();
  await head.click();
  assert.equal(await head.getAttribute('aria-expanded'), 'false');
  await head.press('Enter');
  assert.equal(await head.getAttribute('aria-expanded'), 'true');

  step('the side panels hide and show');
  await p.getByRole('button', { name: 'Show or hide the Inspector' }).click();
  await p.waitForFunction(() => document.querySelector('.dmain').dataset.right === 'closed');
  await p.getByRole('button', { name: 'Show or hide the Inspector' }).click();

  step('a filter can skip a blank parameter');
  await p.getByTestId('rail-data').click();
  await p.locator('.trow', { has: p.locator('.nm', { hasText: /^S$/ }) }).getByRole('button', { name: 'Edit' }).click();
  await p.getByTestId('filter-skip-blank').check();
  await p.locator('.dialog footer .btn.primary').click();
  await p.keyboard.press('Control+s');
  await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  def = await read(id);
  assert.equal(def.dataSets[0].filters[0].skipBlank, true);

  step('Preview: a contents entry jumps to its page');
  await p.getByTestId('tab-preview').click();
  await p.waitForSelector('.vpage svg');
  await p.locator('.vlink.hit[title*="Far"]').click();
  await p.waitForFunction(() => document.querySelector('input.pageno').value === '3');

  step('viewer: Export menu, thumbnails, contents; pages are documents named "Page n of N"');
  await p.goto(`${BASE}/viewer/${id}`);
  await p.waitForSelector('.vpage svg');
  assert.equal(await p.getByTestId('export-pdf').isVisible(), false, 'the formats are in a menu');
  await p.getByTestId('export-menu').click();
  for (const f of ['pdf', 'xlsx', 'docx', 'pptx', 'html', 'csv', 'json']) assert.ok(await p.getByTestId(`export-${f}`).isVisible(), f);
  await p.keyboard.press('Escape');
  assert.equal(await p.getByTestId('export-pdf').isVisible(), false);
  await p.getByRole('document', { name: 'Page 1 of 3' }).waitFor();
  await p.getByTestId('viewer-sidebar').click();
  assert.equal(await p.locator('.vthumb').count(), 3);
  await p.locator('.vthumb').nth(2).click();
  await p.waitForFunction(() => document.querySelector('input.pageno').value === '3');
  await p.getByTestId('side-contents').click();
  await p.locator('.vtoc', { hasText: 'Results' }).click();
  await p.waitForFunction(() => document.querySelector('input.pageno').value === '2');
  await p.locator('.vlink.hit[title*="Far"]').first().click();
  await p.waitForFunction(() => document.querySelector('input.pageno').value === '3');
  assert.match(await p.title(), /e2e b2 ui · ReportWright/);
  assert.deepEqual(errs, []);
} finally {
  for (const id of ids) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H });
  await b.close();
}
console.log('b2-ui OK');
