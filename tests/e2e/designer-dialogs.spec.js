// Dialogs: Escape or a click outside asks before it throws away changes (and not when there are none); an Escape
// meant for something inside a dialog (the expression editor's suggestions) does not close the dialog, nor reach the
// designer behind it.
import { test, expect } from './designer-fixture.js';

/** Open the data set dialog of D from the Data panel. */
async function openDataSet(designer) {
  await designer.root.locator('[data-testid=rail-data]').click();
  await designer.root.getByRole('button', { name: 'Edit D', exact: true }).click();
  const dlg = designer.root.locator('.dialog[role=dialog]');
  await expect(dlg).toBeVisible();
  return dlg;
}
/** Answer the next window.confirm, and say what it asked. */
const answerConfirm = (page, accept) =>
  new Promise((resolve) =>
    page.once('dialog', async (d) => {
      const m = d.message();
      await (accept ? d.accept() : d.dismiss());
      resolve(m);
    }),
  );

test('an unchanged dialog closes on Escape without asking', async ({ designer }) => {
  await designer.open();
  const dlg = await openDataSet(designer);
  let asked = false;
  designer.page.once('dialog', (d) => {
    asked = true;
    d.dismiss();
  });
  await designer.page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(asked).toBe(false);
});

test('a changed dialog: Escape asks; No keeps it open with the change, Yes discards it', async ({ designer }) => {
  await designer.open();
  const before = await designer.def();
  const dlg = await openDataSet(designer);
  const path = dlg.getByRole('textbox').first();
  await path.fill('ChangedName');
  await path.blur();
  let ask = answerConfirm(designer.page, false);
  await designer.page.keyboard.press('Escape');
  expect(await ask).toMatch(/discard|lose|unsaved|changes/i);
  await expect(dlg).toBeVisible();
  await expect(path).toHaveValue('ChangedName');
  ask = answerConfirm(designer.page, true);
  await designer.page.keyboard.press('Escape');
  await ask;
  await expect(dlg).toHaveCount(0);
  expect(await designer.def(), 'nothing applied').toEqual(before);
});

test('a changed dialog: a click outside it asks too', async ({ designer }) => {
  await designer.open();
  const dlg = await openDataSet(designer);
  await dlg.getByRole('textbox').first().fill('Other');
  const ask = answerConfirm(designer.page, false);
  const box = await designer.root.locator('.scrim').first().boundingBox();
  await designer.page.mouse.click(box.x + 5, box.y + 5);
  await ask;
  await expect(dlg).toBeVisible();
});

test("Escape in the expression editor's suggestions closes them, not the dialog; the next Escape closes it", async ({
  designer,
}) => {
  await designer.open();
  await designer.select('T1');
  await designer.root.locator('[data-testid=inspector] button.fx').first().click();
  const dlg = designer.root.locator('.dialog[role=dialog]');
  await expect(dlg).toBeVisible();
  const editor = dlg.locator('.cm-content').first();
  await editor.click();
  await designer.page.keyboard.press('ControlOrMeta+a');
  await designer.page.keyboard.type('=Fields.reg');
  await designer.page.keyboard.press('Control+Space').catch(() => {});
  const popup = dlg.locator('.cm-tooltip-autocomplete');
  await expect(popup).toBeVisible();
  await designer.page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(dlg, 'still open').toBeVisible();
  await designer.page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  // the designer behind it kept its selection (the Escapes were the dialog's)
  await expect(designer.root.locator('[data-testid=status-selection]')).toContainText('T1');
});

test('the shortcuts dialog (?) closes on Escape, and the selection stays', async ({ designer }) => {
  await designer.open();
  await designer.select('T1');
  await designer.page.keyboard.press('?');
  const dlg = designer.root.locator('.dialog[role=dialog]');
  await expect(dlg).toBeVisible();
  await designer.page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(designer.root.locator('[data-testid=status-selection]')).toContainText('T1');
});

test("keys pressed while a dialog is open are not the canvas's: no nudge, no delete, no paste behind it", async ({
  designer,
  context,
  browserName,
}) => {
  if (browserName === 'chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://designer.test' });
  await designer.open();
  await designer.select('T1');
  await designer.key('c');
  const before = await designer.def();
  await designer.page.keyboard.press('?');
  const dlg = designer.root.locator('.dialog[role=dialog]');
  await expect(dlg).toBeVisible();
  for (const k of ['ArrowRight', 'ArrowDown', 'Delete', 'Backspace']) await designer.page.keyboard.press(k);
  for (const k of ['v', 'x', 'd', 'z']) await designer.key(k);
  expect(await designer.def(), 'the report behind the dialog is unchanged').toEqual(before);
  await designer.page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(designer.root.locator('[data-testid=status-selection]')).toContainText('T1');
});
