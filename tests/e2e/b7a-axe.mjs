// #15/#39: axe on the embedded viewer (search options shown, Export menu open) and the designer: no
// label-content-name-mismatch (a control's visible text is part of its accessible name) and no color-contrast failures.
// Run npm run build:embed first (it serves public/embed/esm).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.join(import.meta.dirname, '..', '..');
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const RULES = ['label-content-name-mismatch', 'color-contrast'];
const ORIGIN = 'http://axe.test';
const FILES = { '/pw/': path.join(root, 'public/embed/esm/'), '/pw-fonts/': path.join(root, 'packages/fonts/public/fonts/') };
const TYPES = { '.js': 'text/javascript', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.map': 'application/json' };
const definition = {
  $schema: 'reportwright/report@1', name: 'Axe', page: { size: 'A4', margins: [36, 36, 36, 36] },
  dataSources: [{ name: 'orders', type: 'json', data: { rows: [{ customer: 'Asha Rao', amount: 1200.5 }] } }],
  dataSets: [{ name: 'Rows', source: 'orders', path: '$.rows', fields: [{ name: 'customer', type: 'string' }, { name: 'amount', type: 'number' }] }],
  sections: { body: { items: [{ type: 'table', name: 'T', x: 0, y: 0, w: 400, h: 40, dataSet: 'Rows', columns: [{ width: 200 }, { width: 200 }],
    header: [{ height: 16, cells: [{ value: 'Customer' }, { value: 'Amount' }] }],
    detail: [{ height: 16, cells: [{ value: '=Fields.customer' }, { value: '=Fields.amount', style: { format: 'N2' } }] }] }] } },
};
const html = (mod, call) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>axe</title><div id="r"></div><script type="module">
import { ${call} } from '/pw/${mod}.js';
${call}('#r', { definition: ${JSON.stringify(definition)}, fontsUrl: '/pw-fonts/', height: '900px' });
</script>`;

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/viewer') return route.fulfill({ body: html('viewer', 'mountViewer'), contentType: 'text/html' });
  if (u.pathname === '/designer') return route.fulfill({ body: html('designer', 'mountDesigner'), contentType: 'text/html' });
  const pre = Object.keys(FILES).find(k => u.pathname.startsWith(k));
  const f = pre && path.join(FILES[pre], u.pathname.slice(pre.length));
  if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
});
const axe = async () => {
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate((rules) => window.axe.run(document, { runOnly: { type: 'rule', values: rules } }), RULES);
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => `${n.target.join(' > ')} (${n.failureSummary.split('\n').slice(1).join(' ').trim()})`).join('; ')}`);
};

await p.goto(`${ORIGIN}/viewer`);
await p.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('.vpage text'), null, { timeout: 60000 });
await p.getByRole('searchbox').fill('Asha'); // the match buttons show
await p.getByTestId('export-menu').click();
await p.getByTestId('export-pdf').waitFor();
await p.waitForTimeout(600); // the menu's fade-in
const viewer = await axe();
// the badge and a name the hint repeats are aria-hidden: each format's name is said once
assert.equal(await p.getByRole('menuitem', { name: 'PDF document', exact: true }).count(), 1);
assert.equal(await p.getByRole('menuitem', { name: /^HTML \(interactive\)/ }).count(), 1); // the default kind is marked
assert.equal(await p.getByRole('menuitem', { name: /^HTML \(print\)/ }).count(), 1);

await p.goto(`${ORIGIN}/designer`);
await p.waitForFunction(() => document.querySelector('#r')?.shadowRoot?.querySelector('[data-testid], button'), null, { timeout: 60000 });
await p.waitForTimeout(1500);
const designer = await axe();
// N42: every critical or serious axe rule on the designer, in four states: as opened, the Outline shown, an item
// selected from the Outline, and after keyboard moves in it (aria-required-children flagged the Outline's listbox)
const full = async (state) => {
  const r = await p.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  return r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').map(v => `${state}: ${v.id} (${v.impact}) ${v.nodes.map(n => n.target.join(' > ')).slice(0, 3).join('; ')}`);
};
const states = [...await full('opened')];
await p.locator('#r').getByRole('tab', { name: /outline/i }).first().click().catch(() => p.locator('#r').getByRole('button', { name: /outline/i }).first().click());
await p.waitForTimeout(400);
states.push(...await full('outline shown'));
await p.locator('#r').getByRole('button', { name: 'T', exact: true }).first().click();
await p.waitForTimeout(400);
states.push(...await full('item selected'));
await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Home');
await p.waitForTimeout(300);
states.push(...await full('keyboard moved'));
await b.close();
assert.deepEqual({ viewer, designer, states }, { viewer: [], designer: [], states: [] });
assert.deepEqual(errors, []);
console.log(`b7a-axe: ok (${RULES.join(', ')} on the viewer and the designer; every critical or serious rule on the designer in 4 states)`);
