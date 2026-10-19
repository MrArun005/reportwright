// Undo after each action returns the exact definition before it (deep-equal JSON), and redo the one after it; then the
// whole history undone and redone ends where it was.
import { test, expect } from './designer-fixture.js';

test.beforeEach(async ({ context, browserName }) => {
  if (browserName === 'chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://designer.test' });
});

/** What a user does, each one undo step. */
const ACTIONS = {
  'insert a text box into the header': async (d) => {
    await d.selectBand('pageHeader');
    await d.insert('textbox');
  },
  'insert a barcode into the body': async (d) => {
    await d.selectBand('body');
    await d.insert('barcode');
  },
  'drag T1 to the footer': async (d) => d.drag('T1', 'pageFooter', 0.6, 0.5),
  'nudge T1 right': async (d) => {
    await d.select('T1');
    await d.page.keyboard.press('ArrowRight');
  },
  'copy T1, paste it': async (d) => {
    await d.select('T1');
    await d.key('c');
    await d.key('v');
  },
  'cut Head': async (d) => {
    await d.select('Head');
    await d.key('x');
  },
  'paste it back': async (d) => {
    await d.selectBand('pageHeader');
    await d.key('v');
  },
  'duplicate T1': async (d) => {
    await d.select('T1');
    await d.key('d');
  },
  'delete the table': async (d) => {
    await d.pick('Tab');
    await d.page.keyboard.press('Delete');
  },
  'rename T1 in the inspector': async (d) => {
    await d.select('T1');
    const name = d.root.locator('[data-testid=inspector] input[aria-label="Item name"]');
    await name.fill('Renamed');
    await name.press('Enter');
    await d.root
      .locator('[data-testid=paper]')
      .click({ position: { x: 2, y: 2 } })
      .catch(() => {});
  },
};

test('undo and redo after each action', async ({ designer }) => {
  await designer.open();
  const states = [await designer.def()];
  for (const [what, act] of Object.entries(ACTIONS)) {
    await act(designer);
    await designer.page.waitForTimeout(900); // past the 800 ms in which edits of one field merge into one step
    const after = await designer.def();
    expect(after, `${what}: changed the report`).not.toEqual(states.at(-1));
    await designer.page.keyboard.press('Escape');
    await designer.key('z');
    expect(await designer.def(), `${what}: undo gives the report before it`).toEqual(states.at(-1));
    await designer.key('Shift+z');
    expect(await designer.def(), `${what}: redo gives the report after it`).toEqual(after);
    states.push(after);
  }
  // all of it undone: the report as opened; all redone: as it ended
  for (let i = states.length - 1; i > 0; i--) await designer.key('z');
  expect(await designer.def(), 'everything undone').toEqual(states[0]);
  for (let i = 1; i < states.length; i++) await designer.key('y');
  expect(await designer.def(), 'everything redone').toEqual(states.at(-1));
});
