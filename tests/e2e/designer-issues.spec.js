// What the designer's Issues panel says about a new barcode and a table of contents in a page band, and that a table
// of contents in the body jumps to its entries in the viewer.
import { test, expect, bands, serve } from './designer-fixture.js';

test('a new barcode has no value, and the Issues panel says it prints nothing', async ({ designer }) => {
  await designer.open();
  await designer.selectBand('body');
  await designer.insert('barcode');
  const d = await designer.def();
  const bc = d.sections.body.items.find((i) => i.type === 'barcode');
  expect(bc.value).toBe('');
  await expect
    .poll(() => designer.issues())
    .toContainEqual(expect.stringContaining(`${bc.name} has no value: nothing is printed`));
  // a value: the issue goes
  await designer.select(bc.name);
  const value = designer.root.getByRole('textbox', { name: /^Value/ }).first();
  await value.fill('SKU-1');
  await value.press('Tab');
  await expect.poll(async () => (await designer.issues()).join('\n')).not.toContain(`${bc.name} has no value`);
});

for (const section of ['pageHeader', 'pageFooter']) {
  test(`a table of contents in the ${section === 'pageHeader' ? 'page header' : 'page footer'}: the Issues panel warns`, async ({
    designer,
  }) => {
    await designer.open();
    await designer.selectBand(section);
    await designer.insert('toc');
    const d = await designer.def();
    const toc = d.sections[section].items.find((i) => i.type === 'toc');
    expect(toc, 'it stays in the page band (it is allowed there, with a warning)').toBeTruthy();
    await expect
      .poll(() => designer.issues())
      .toContainEqual(
        expect.stringContaining(`${toc.name} is in a page band: a table of contents lists entries only in the body`),
      );
  });
}

test('a table of contents in the body: no warning, and in the viewer its entries jump to their pages', async ({
  designer,
  page,
}) => {
  const report = {
    ...bands(),
    sections: {
      pageHeader: { height: 0, items: [] },
      body: {
        height: 400,
        items: [
          { type: 'toc', name: 'Toc', x: 0, y: 0, w: 400, h: 20, title: 'Contents', source: 'headings' },
          { type: 'textbox', name: 'H1', x: 0, y: 60, w: 300, h: 18, value: 'Introduction', headingLevel: 1 },
          {
            type: 'textbox',
            name: 'H2',
            x: 0,
            y: 100,
            w: 300,
            h: 18,
            value: 'Results',
            headingLevel: 1,
            pageBreakBefore: true,
          },
          {
            type: 'textbox',
            name: 'H3',
            x: 0,
            y: 140,
            w: 300,
            h: 18,
            value: 'Appendix',
            headingLevel: 1,
            pageBreakBefore: true,
          },
        ],
      },
      pageFooter: { height: 0, items: [] },
    },
  };
  await designer.open(report);
  expect((await designer.issues()).join('\n')).not.toMatch(/page band|Toc/);
  // the same report in the viewer
  const v = await page.context().newPage();
  const errors = [];
  v.on('pageerror', (e) => errors.push(e.message));
  await serve(v, { definition: report, viewer: true });
  await v.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  await expect(v.locator('#d .vpage')).toHaveCount(3, { timeout: 30000 });
  const pageTop = (n) =>
    v.locator(`#d .vpage[data-page="${n}"]`).evaluate((el) => {
      const sc = el.closest('.vpages');
      return el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    });
  for (const [label, n] of [
    ['Appendix', 3],
    ['Results', 2],
  ]) {
    await v
      .locator('#d .vlink')
      .filter({ hasText: `Go to ${label}` })
      .first()
      .click();
    // the entry's page is scrolled to the top of the view
    await expect.poll(() => pageTop(n), { message: `${label} → page ${n}` }).toBeLessThan(60);
    await expect.poll(() => pageTop(n)).toBeGreaterThan(-800);
  }
  expect(errors).toEqual([]);
});
