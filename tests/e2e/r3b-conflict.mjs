// R3-B item 7: two designers edit one report. The second save meets the first (409): nothing is overwritten, the
// designer offers "Save mine over theirs" and "Take theirs"; a draft made before someone else's save warns on restore.
//   BASE=http://localhost:3600 node tests/e2e/r3b-conflict.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:3000';
const H = { 'content-type': 'application/json', origin: BASE };
const step = (s) => console.log('·', s);
const def = (name) => ({ $schema: 'pagewright/report@1', name, page: { size: 'A4', margins: [36, 36, 36, 36] }, sections: { body: { height: 200, items: [] } } });
const r = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'r3b conflict', definition: def('r3b conflict') }) });
const { id } = await r.json();
const read = async () => (await fetch(`${BASE}/api/reports/${id}`, { headers: H })).json();

const b = await chromium.launch();
const errs = [];
const designer = async () => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(`${BASE}/designer/${id}`);
  await p.waitForSelector('[data-testid=paper]');
  return p;
};
const rename = async (p, name) => { const n = p.getByLabel('Report name'); await n.fill(name); };
try {
  step('two designers open the same report');
  const A = await designer(), B = await designer();
  await rename(A, 'Name from A');
  await rename(B, 'Name from B');
  step('A saves: 200');
  await A.keyboard.press('Control+s');
  await A.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  assert.equal((await read()).name, 'Name from A');
  step('B saves from the old revision: a conflict, nothing overwritten');
  await B.keyboard.press('Control+s');
  await B.getByTestId('save-conflict').waitFor();
  assert.equal((await read()).name, 'Name from A');
  step('B takes theirs: the designer shows A\'s save, then B edits and saves on top');
  await B.getByTestId('conflict-theirs').click();
  await B.getByTestId('save-conflict').waitFor({ state: 'detached' });
  assert.equal(await B.getByLabel('Report name').inputValue(), 'Name from A');
  await rename(B, 'Name from A, then B');
  await B.keyboard.press('Control+s');
  await B.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  assert.equal((await read()).name, 'Name from A, then B');
  step('A (now stale) saves, then chooses "save mine over theirs" on purpose');
  await rename(A, 'A again');
  await A.keyboard.press('Control+s');
  await A.getByTestId('save-conflict').waitFor();
  await A.getByTestId('conflict-mine').click();
  await A.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  assert.equal((await read()).name, 'A again');
  assert.deepEqual(errs, []);
  console.log('r3b conflict: ok');
} finally {
  await b.close();
  await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: H });
}
