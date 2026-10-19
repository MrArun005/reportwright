// Copy, cut and paste with the keyboard (Ctrl or Cmd + C/X/V): into the band of the selection, a table (or a container
// holding one) never into a page band, paste right after a cut, and across two tabs.
import { test, expect, bands, serve } from './designer-fixture.js';

test.beforeEach(async ({ context, browserName }) => {
  // Chromium asks for permission to use the clipboard; Firefox and WebKit allow it on a key press
  if (browserName === 'chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://designer.test' });
});

/** The items that are new since `before`, with their bands. */
const added = async (designer, before) => {
  const d = await designer.def();
  const old = new Set();
  for (const b of ['pageHeader', 'body', 'pageFooter']) for (const i of before.sections[b].items) old.add(i.id);
  return ['pageHeader', 'body', 'pageFooter'].flatMap((b) =>
    d.sections[b].items
      .filter((i) => !old.has(i.id))
      .map((i) => ({ band: b, type: i.type, value: i.value, items: i.items?.map((c) => c.type) })),
  );
};

test('a text box copied in the body and pasted with the header item selected: in the header', async ({ designer }) => {
  await designer.open();
  await designer.select('T1');
  await designer.key('c');
  await designer.select('Head');
  const before = await designer.def();
  await designer.key('v');
  expect(await added(designer, before)).toEqual([
    { band: 'pageHeader', type: 'textbox', value: 'Hello', items: undefined },
  ]);
});

for (const [name, what] of [
  ['Tab', 'a table'],
  ['Box', 'a container holding a table'],
]) {
  test(`${what} pasted with a page header item selected: in the body, and the report has no error`, async ({
    designer,
  }) => {
    await designer.open();
    await designer.pick(name);
    await designer.key('c');
    await designer.select('Head');
    const before = await designer.def();
    await designer.key('v');
    const got = await added(designer, before);
    expect(got.map((g) => [g.band, g.type])).toEqual([['body', name === 'Box' ? 'container' : 'table']]);
    expect((await designer.issues()).join('\n')).not.toMatch(/can only be in the body/);
  });
}

test('cut, then paste at once: the item just cut, not the copy before it', async ({ designer }) => {
  await designer.open();
  await designer.select('Head');
  await designer.key('c'); // an older copy on the clipboard
  await designer.select('T1');
  await designer.key('x');
  expect(await designer.where('T1')).toBeNull();
  const before = await designer.def();
  await designer.key('v');
  expect(await added(designer, before)).toEqual([{ band: 'body', type: 'textbox', value: 'Hello', items: undefined }]);
  // in its own place again (a cut pasted back into its band)
  const d = await designer.def();
  const back = d.sections.body.items.at(-1);
  expect([back.x, back.y]).toEqual([10, 10]);
});

test('cut, paste, paste: the second copy cascades 12 pt', async ({ designer }) => {
  await designer.open();
  await designer.select('T1');
  await designer.key('x');
  await designer.key('v');
  await designer.key('v');
  const items = (await designer.def()).sections.body.items.filter((i) => i.value === 'Hello');
  expect(items.map((i) => [i.x, i.y])).toEqual([
    [10, 10],
    [22, 22],
  ]);
});

test('paste across two tabs: copied in one designer, pasted in another', async ({ designer, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'headless Firefox and WebKit do not share a system clipboard between pages');
  await designer.open();
  await designer.select('T1');
  await designer.key('c');
  const other = await context.newPage();
  const errors = [];
  other.on('pageerror', (e) => errors.push(e.message));
  const second = { ...bands(), name: 'Second', sections: { ...bands().sections, body: { height: 300, items: [] } } };
  await serve(other, { definition: second });
  await other.locator('#d [data-testid=paper]').waitFor({ timeout: 60000 });
  await other.locator('#d .band[data-section=body]').click({ position: { x: 200, y: 150 } });
  await other.keyboard.press('ControlOrMeta+v');
  await expect
    .poll(() => other.evaluate(() => window.h.getDefinition().sections.body.items.map((i) => [i.type, i.value])))
    .toEqual([['textbox', 'Hello']]);
  expect(errors).toEqual([]);
});

test('typing in a text field is not a paste of items', async ({ designer }) => {
  await designer.open();
  await designer.select('T1');
  await designer.key('c');
  const name = designer.root.locator('input[aria-label="Report name"]');
  await name.click();
  await name.fill('');
  const before = await designer.def();
  await designer.page.keyboard.press('ControlOrMeta+v');
  expect(await added(designer, before)).toEqual([]);
});
