// Designer: paste goes to the selected band and fits it (#12, #13).
import { describe, it, expect, beforeEach } from 'vitest';
import { pasteItems, copySelection, findItem, secOf, selectedBand } from '../../src/designer/store.js';
import { S, load, where } from './designer-bands.fixture.js';

beforeEach(load);

describe('#12/#13: paste goes to the selected band and fits it', () => {
  it('copied in the body, pasted into the footer: at the top of its free space, the footer keeps its height', async () => {
    S().select({ kind: 'items', ids: ['b'] });
    await copySelection();
    S().select({ kind: 'items', ids: ['f1'] });
    expect(pasteItems('pageFooter')).toBe(1);
    const id = S().sel.ids[0];
    expect(where(id).section).toBe('pageFooter');
    expect(secOf(S().def, 'pageFooter').height).toBe(24);
    expect(findItem(S().def, id).item.y).toBe(4); // 24 - 20: clamped so it fits
  });
  it('several items keep their places relative to each other', async () => {
    S().select({ kind: 'items', ids: ['a', 'b'] });
    await copySelection();
    S().apply((d) => {
      d.sections.pageFooter.height = 100;
    });
    pasteItems('pageFooter');
    const [p, q] = S().sel.ids.map((i) => findItem(S().def, i).item);
    expect([p.y, q.y]).toEqual([32, 62]); // below F1 (2 + 20 + 8), 30 apart as A and B
    expect(secOf(S().def, 'pageFooter').height).toBe(100);
  });
  it('an item taller than the band grows it to the item, no more', async () => {
    S().apply((d) => {
      d.sections.body.items[0].h = 60;
    });
    S().select({ kind: 'items', ids: ['a'] });
    await copySelection();
    pasteItems('pageFooter');
    expect(secOf(S().def, 'pageFooter').height).toBe(60);
  });
  it('the same band: 12 pt right and down, as before', async () => {
    S().select({ kind: 'items', ids: ['a'] });
    await copySelection();
    pasteItems('body');
    expect(findItem(S().def, S().sel.ids[0]).item).toMatchObject({ x: 22, y: 22 });
  });
});

describe('#12: the band a paste goes to', () => {
  it('the selected band, the band of the selected item, else the body', () => {
    expect(selectedBand(S().def, { kind: 'section', section: 'pageHeader' })).toBe('pageHeader');
    expect(selectedBand(S().def, { kind: 'items', ids: ['f1'] })).toBe('pageFooter');
    expect(selectedBand(S().def, { kind: 'items', ids: ['kid'] })).toBe('body');
    expect(selectedBand(S().def, { kind: 'report' })).toBe('body');
  });
});
