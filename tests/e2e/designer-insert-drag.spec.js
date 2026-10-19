// Insert from the toolbox into each band, and drag between bands, with the real mouse.
import { test, expect, bands } from './designer-fixture.js';

// a report without data: a table, matrix or chart goes straight in (with data, a gallery opens first)
const noData = () => ({
  ...bands(),
  dataSources: [],
  dataSets: [],
  sections: { ...bands().sections, body: { height: 420, items: bands().sections.body.items.slice(0, 1) } },
});
const BODY_ONLY = new Set(['table', 'matrix', 'subreport']);
const TYPES = [
  'textbox',
  'richtext',
  'table',
  'image',
  'line',
  'shape',
  'list',
  'container',
  'chart',
  'matrix',
  'barcode',
  'sparkline',
  'databar',
  'bullet',
  'iconset',
  'rangebar',
  'subreport',
  'toc',
  'field',
  'map',
  'checkbox',
];

test.describe('insert each item type into each band', () => {
  for (const section of ['pageHeader', 'body', 'pageFooter']) {
    test(`into the ${section}`, async ({ designer }) => {
      await designer.open(noData());
      const tools = await designer.root.locator('.tool[data-tool]').evaluateAll((l) => l.map((t) => t.dataset.tool));
      for (const t of TYPES) expect(tools, `the toolbox has ${t}`).toContain(t);
      for (const type of TYPES) {
        await designer.selectBand(section);
        const before = (await designer.def()).sections;
        await designer.insert(type);
        const d = await designer.def();
        const want = BODY_ONLY.has(type) && section !== 'body' ? 'body' : section;
        const added = d.sections[want].items.filter((i) => !before[want].items.some((b) => b.id === i.id));
        expect(
          added.map((i) => i.type),
          `${type} into ${section} lands in ${want}`,
        ).toEqual([type]);
        for (const other of ['pageHeader', 'body', 'pageFooter'].filter((s) => s !== want))
          expect(d.sections[other].items.length, `${type}: nothing new in ${other}`).toBe(before[other].items.length);
        // the band grew to hold it
        const it = added[0];
        expect(d.sections[want].height ?? 0).toBeGreaterThanOrEqual(Math.floor(it.y + it.h));
        await expect(designer.item(it.name)).toBeVisible();
      }
    });
  }
  test('a selected container takes the new item inside it', async ({ designer }) => {
    await designer.open();
    await designer.select('Box', { x: 10, y: 70 }); // below the table inside it
    await designer.insert('textbox');
    const d = await designer.def();
    const box = d.sections.body.items.find((i) => i.name === 'Box');
    expect(box.items.map((i) => i.type)).toEqual(['table', 'textbox']);
  });
});

test.describe('drag between bands', () => {
  test('a text box: body → page header → page footer, one undo step each', async ({ designer }) => {
    await designer.open();
    await designer.drag('T1', 'pageHeader', 0.6, 0.5);
    expect((await designer.where('T1')).band).toBe('pageHeader');
    await designer.drag('T1', 'pageFooter', 0.6, 0.5);
    expect((await designer.where('T1')).band).toBe('pageFooter');
    await designer.key('z');
    expect((await designer.where('T1')).band).toBe('pageHeader');
    await designer.key('z');
    expect((await designer.where('T1')).band).toBe('body');
  });
  for (const name of ['Tab', 'Box']) {
    test(`${name === 'Tab' ? 'a table' : 'a container holding a table'} dragged onto the page header stays in the body`, async ({
      designer,
    }) => {
      await designer.open();
      const before = await designer.where(name);
      await designer.drag(name, 'pageHeader', 0.5, 0.5);
      const after = await designer.where(name);
      expect(after.band).toBe('body');
      expect(after.parent).toBe(before.parent);
      const d = await designer.def();
      expect(d.sections.pageHeader.items.map((i) => i.name)).toEqual(['Head']);
    });
  }
  test('within the body: moved by the drag, on the grid (Alt: no smart guides)', async ({ designer }) => {
    await designer.open();
    const { item: a } = await designer.where('T1');
    const box = await designer.item('T1').boundingBox();
    const m = designer.page.mouse;
    await m.move(box.x + 5, box.y + 5);
    await m.down();
    await designer.page.keyboard.down('Alt');
    await m.move(box.x + 47, box.y + 67, { steps: 6 });
    await m.up();
    await designer.page.keyboard.up('Alt');
    const { item: b, band } = await designer.where('T1');
    expect(band).toBe('body');
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
    expect([b.x % 4, b.y % 4], 'on the 4 pt grid').toEqual([0, 0]);
  });
});
